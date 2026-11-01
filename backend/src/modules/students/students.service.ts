import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ScopeService } from '../core/scope.service';
import { LevelsService } from '../core/levels.service';
import { PiiService } from '../core/pii.service';
import { AuditService } from '../audit/audit.service';
import { isValidIin } from '../../common/utils/crypto';
import { endOfMonth, fmtDate, todayStr, toDate, minDate } from '../../common/utils/dates';
import { levelIndex, round1 } from '../../common/utils/stats';
import { StudentInput, StudentListQuery, StudentUpdate } from './students.dto';
import { MOVEMENT_TYPES } from '../reference/reference.module';

export interface StudentRow {
  id: number;
  studentCode: string;
  fullName: string;
  gender: 'M' | 'F';
  birthDate: string;
  classId: number | null;
  className: string | null;
  nationality?: string | null;
  status: string;
  attPct: number | null;
  tjbPct: number | null;
  level: string | null;
  levelIndex: number | null;
}

const SORTS: Record<string, string> = {
  name: 's.full_name',
  class: 'c.grade, c.letter, s.full_name',
  gender: 's.gender, s.full_name',
  birth: 's.birth_date',
  nationality: 'n.name, s.full_name',
  att: 'att.att_pct NULLS LAST, s.full_name',
  tjb: 'tjb.pct NULLS LAST, s.full_name',
  code: 's.student_code',
};

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly levels: LevelsService,
    private readonly pii: PiiService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /** Server-side сүзгі, сұрыптау және пагинация бір SQL сұранысымен. */
  async list(user: AuthUser, q: StudentListQuery, unpaged = false) {
    const year = q.schoolYearId
      ? await this.prisma.schoolYear.findFirst({ where: { id: q.schoolYearId, schoolId: user.schoolId }, include: { quarters: true } })
      : await this.scope.currentYear(user.schoolId);
    if (!year) throw new NotFoundException('Оқу жылы табылмады');
    const today = todayStr();
    const from = q.from ?? fmtDate(year.startDate)!;
    const to = q.to ?? minDate(fmtDate(year.endDate)!, today);
    const quarter = q.quarterId
      ? year.quarters.find((x) => x.id === q.quarterId)
      : year.quarters.find((x) => fmtDate(x.startDate)! <= today && today <= fmtDate(x.endDate)!) ?? year.quarters.filter((x) => fmtDate(x.startDate)! <= today).pop() ?? year.quarters[0];
    const ids = await this.scope.classIds(user, year.id);
    const canNat = user.permissions.includes(P.NATIONALITY_VIEW);

    const where: Prisma.Sql[] = [Prisma.sql`s.school_id = ${user.schoolId}`, Prisma.sql`s.deleted_at IS NULL`];
    const status = q.status ?? 'ACTIVE';
    if (status !== 'ALL') where.push(Prisma.sql`s.status = ${status}::"StudentStatus"`);
    if (ids) where.push(ids.length ? Prisma.sql`s.class_id IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`);
    if (q.classId) where.push(Prisma.sql`s.class_id = ${q.classId}`);
    else if (status === 'ACTIVE') where.push(Prisma.sql`c.school_year_id = ${year.id}`);
    if (q.gender) where.push(Prisma.sql`s.gender = ${q.gender}::"Gender"`);
    if (q.nationalityId && canNat) where.push(Prisma.sql`s.nationality_id = ${q.nationalityId}`);
    if (q.search?.trim()) {
      const like = `%${q.search.trim().replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      where.push(Prisma.sql`(s.full_name ILIKE ${like} OR s.student_code ILIKE ${like})`);
    }
    const sortKey = q.sort && SORTS[q.sort] && !(q.sort === 'nationality' && !canNat) ? q.sort : 'name';
    const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
    const order = Prisma.raw(
      SORTS[sortKey]
        .split(', ')
        .map((c) => (c.includes('NULLS') ? c.replace(' NULLS LAST', ` ${dir} NULLS LAST`) : `${c} ${dir}`))
        .join(', '),
    );
    const limit = unpaged ? Prisma.empty : Prisma.sql`LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;

    const rows = await this.prisma.$queryRaw<
      { id: number; student_code: string; full_name: string; gender: 'M' | 'F'; birth_date: Date; class_id: number | null; class_name: string | null; nationality: string | null; status: string; att_pct: number | null; tjb_pct: number | null; total: bigint }[]
    >`
      WITH att AS (
        SELECT student_id, 100.0 * count(*) FILTER (WHERE status IN ('P','K')) / NULLIF(count(*), 0) AS att_pct
        FROM attendance WHERE school_id = ${user.schoolId} AND date BETWEEN ${toDate(from)} AND ${toDate(to)}
        GROUP BY student_id
      ), tjb AS (
        SELECT r.student_id, avg(r.percent)::float AS pct
        FROM assessment_results r JOIN assessments a ON a.id = r.assessment_id
        WHERE a.school_id = ${user.schoolId} AND a.type IN ('TJB', 'ARALYK') AND a.quarter_id = ${quarter?.id ?? -1} AND NOT r.absent
        GROUP BY r.student_id
      )
      SELECT s.id, s.student_code, s.full_name, s.gender, s.birth_date, s.class_id, c.name AS class_name,
             n.name AS nationality, s.status::text AS status, att.att_pct::float AS att_pct, tjb.pct AS tjb_pct,
             count(*) OVER() AS total
      FROM students s
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN nationalities n ON n.id = s.nationality_id
      LEFT JOIN att ON att.student_id = s.id
      LEFT JOIN tjb ON tjb.student_id = s.id
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY ${order}, s.id
      ${limit}`;
    const lv = await this.levels.get(user.schoolId);
    const items: StudentRow[] = rows.map((r) => {
      const li = r.tjb_pct != null ? levelIndex(r.tjb_pct, lv) : null;
      return {
        id: r.id,
        studentCode: r.student_code,
        fullName: r.full_name,
        gender: r.gender,
        birthDate: fmtDate(r.birth_date)!,
        classId: r.class_id,
        className: r.class_name,
        ...(canNat ? { nationality: r.nationality } : {}),
        status: r.status,
        attPct: r.att_pct != null ? round1(r.att_pct) : null,
        tjbPct: r.tjb_pct != null ? round1(r.tjb_pct) : null,
        level: li != null ? lv[li].name : null,
        levelIndex: li,
      };
    });
    return { items, total: rows.length ? Number(rows[0].total) : 0, page: q.page, pageSize: q.pageSize, quarterId: quarter?.id ?? null };
  }

  async get(user: AuthUser, id: number) {
    await this.scope.assertStudent(user, id);
    const s = await this.prisma.student.findUniqueOrThrow({
      where: { id },
      include: { class: { include: { schoolYear: true } }, nationality: true },
    });
    const canNat = user.permissions.includes(P.NATIONALITY_VIEW);
    const canIin = user.permissions.includes(P.STUDENTS_IIN_VIEW);
    const year = await this.scope.currentYear(user.schoolId);
    const today = todayStr();
    const agg = await this.prisma.$queryRaw<{ total: bigint; present: bigint; n: bigint; s: bigint; a: bigint; k: bigint; o: bigint }[]>`
      SELECT count(*) total,
        count(*) FILTER (WHERE status IN ('P','K')) present,
        count(*) FILTER (WHERE status = 'N') n,
        count(*) FILTER (WHERE status = 'S') s,
        count(*) FILTER (WHERE status = 'A') a,
        count(*) FILTER (WHERE status = 'K') k,
        count(*) FILTER (WHERE status = 'O') o
      FROM attendance WHERE student_id = ${id} AND date BETWEEN ${year.startDate} AND ${toDate(minDate(fmtDate(year.endDate)!, today))}`;
    const a = agg[0];
    const total = Number(a.total);
    return {
      id: s.id,
      studentCode: s.studentCode,
      lastName: s.lastName,
      firstName: s.firstName,
      middleName: s.middleName,
      fullName: s.fullName,
      gender: s.gender,
      birthDate: fmtDate(s.birthDate),
      classId: s.classId,
      className: s.class?.name ?? null,
      schoolYear: s.class?.schoolYear.name ?? year.name,
      ...(canNat ? { nationalityId: s.nationalityId, nationality: s.nationality?.name ?? null } : {}),
      // ЖСН ешқашан толық жіберілмейді — тек соңғы 4 сан. Толық мәні бөлек, аудиттелетін эндпоинт арқылы.
      iinMasked: s.iinLast4 ? `••••••••${s.iinLast4}` : null,
      canRevealIin: canIin && !!s.iinEncrypted,
      phone: s.phone,
      parentName: s.parentName,
      parentPhone: s.parentPhone,
      enrolledAt: fmtDate(s.enrolledAt),
      previousSchool: s.previousSchool,
      notes: s.notes,
      status: s.status,
      attendance: {
        total,
        pct: total ? round1((Number(a.present) / total) * 100) : null,
        excused: Number(a.s) + Number(a.a) + Number(a.o),
        sick: Number(a.a),
        unexcused: Number(a.n),
        late: Number(a.k),
      },
    };
  }

  async revealIin(user: AuthUser, id: number, meta: RequestMeta) {
    if (!user.permissions.includes(P.STUDENTS_IIN_VIEW)) throw new ForbiddenException('ЖСН көруге рұқсат жоқ');
    const s = await this.scope.assertStudent(user, id);
    if (!s.iinEncrypted) throw new NotFoundException('ЖСН енгізілмеген');
    const iin = this.pii.decrypt(s.iinEncrypted);
    await this.audit.record(user, { action: 'ЖСН көрді', entity: 'student', entityId: id, summary: `ЖСН көрді · ${s.fullName}`, before: 'жасырын', after: 'көрсетілді' }, meta);
    return { iin };
  }

  async history(user: AuthUser, id: number) {
    await this.scope.assertStudent(user, id);
    const rows = await this.prisma.studentMovement.findMany({
      where: { studentId: id },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: { fromClass: true, toClass: true },
    });
    return rows.map((m) => ({
      id: m.id,
      date: fmtDate(m.date),
      type: m.type,
      typeName: MOVEMENT_TYPES.find((t) => t.code === m.type)?.name,
      fromClass: m.fromClass?.name ?? null,
      toClass: m.toClass?.name ?? null,
      fromSchool: m.fromSchool,
      toSchool: m.toSchool,
      reason: m.reason,
      orderNumber: m.orderNumber,
      orderDate: fmtDate(m.orderDate),
      comment: m.comment,
    }));
  }

  /** Ай бойынша қатысу торы: әр күн үшін сабақтар мен статустар. */
  async attendanceMonth(user: AuthUser, id: number, month?: string) {
    await this.scope.assertStudent(user, id);
    const m = month ?? todayStr().slice(0, 7);
    const from = `${m}-01`;
    const to = endOfMonth(from);
    const rows = await this.prisma.attendance.findMany({
      where: { studentId: id, date: { gte: toDate(from), lte: toDate(to) } },
      include: { lesson: { include: { subject: true } } },
      orderBy: [{ date: 'asc' }, { lesson: { period: 'asc' } }],
    });
    const days: Record<string, { period: number; subject: string; status: string }[]> = {};
    rows.forEach((r) => {
      const d = fmtDate(r.date)!;
      (days[d] ??= []).push({ period: r.lesson.period, subject: r.lesson.subject.name, status: r.status });
    });
    const byMonth = await this.prisma.$queryRaw<{ m: string; total: bigint; present: bigint }[]>`
      SELECT to_char(date, 'YYYY-MM') m, count(*) total, count(*) FILTER (WHERE status IN ('P','K')) present
      FROM attendance WHERE student_id = ${id} GROUP BY 1 ORDER BY 1`;
    const bySubject = await this.prisma.$queryRaw<{ subject: string; total: bigint; present: bigint }[]>`
      SELECT sub.name subject, count(*) total, count(*) FILTER (WHERE a.status IN ('P','K')) present
      FROM attendance a JOIN lessons l ON l.id = a.lesson_id JOIN subjects sub ON sub.id = l.subject_id
      WHERE a.student_id = ${id} GROUP BY 1 ORDER BY 1`;
    return {
      month: m,
      days,
      byMonth: byMonth.map((r) => ({ month: r.m, pct: round1((Number(r.present) / Number(r.total)) * 100), total: Number(r.total) })),
      bySubject: bySubject.map((r) => ({ subject: r.subject, pct: round1((Number(r.present) / Number(r.total)) * 100), total: Number(r.total) })),
    };
  }

  async assessments(user: AuthUser, id: number) {
    await this.scope.assertStudent(user, id);
    const lv = await this.levels.get(user.schoolId);
    const rows = await this.prisma.assessmentResult.findMany({
      where: { studentId: id },
      include: { assessment: { include: { subject: true, quarter: { include: { schoolYear: true } } } } },
      orderBy: [{ assessment: { quarter: { schoolYear: { startDate: 'desc' } } } }, { assessment: { quarter: { number: 'desc' } } }, { assessment: { type: 'asc' } }],
    });
    return rows.map((r) => {
      const pct = Number(r.percent);
      const li = levelIndex(pct, lv);
      return {
        id: r.id,
        assessmentId: r.assessmentId,
        type: r.assessment.type,
        title: r.assessment.title,
        section: r.assessment.section,
        subject: r.assessment.subject.name,
        quarter: r.assessment.quarter.number,
        schoolYear: r.assessment.quarter.schoolYear.name,
        score: Number(r.score),
        maxScore: Number(r.assessment.maxScore),
        pct: round1(pct),
        absent: r.absent,
        level: r.absent ? null : lv[li].name,
        levelIndex: r.absent ? null : li,
      };
    });
  }

  private async validateRefs(user: AuthUser, dto: StudentInput) {
    if (dto.classId) await this.scope.assertClass(user, dto.classId);
    if (dto.nationalityId) {
      if (!user.permissions.includes(P.NATIONALITY_VIEW) && !user.permissions.includes(P.STUDENTS_WRITE)) throw new ForbiddenException();
      const n = await this.prisma.nationality.findUnique({ where: { id: dto.nationalityId } });
      if (!n) throw new BadRequestException('Ұлт табылмады');
    }
    if (dto.iin && !isValidIin(dto.iin)) throw new BadRequestException('ЖСН бақылау саны сәйкес емес');
    if (dto.birthDate > todayStr()) throw new BadRequestException('Туған күні болашақта болмайды');
  }

  private pii4(dto: StudentInput) {
    if (dto.iin === undefined) return {};
    if (dto.iin === null) return { iinEncrypted: null, iinLast4: null, iinHash: null };
    return { iinEncrypted: this.pii.encrypt(dto.iin), iinLast4: dto.iin.slice(-4), iinHash: this.pii.hash(dto.iin) };
  }

  private fullName(d: StudentInput) {
    return [d.lastName, d.firstName, d.middleName].filter(Boolean).join(' ');
  }

  async create(user: AuthUser, dto: StudentInput, meta: RequestMeta) {
    await this.validateRefs(user, dto);
    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.student.findFirst({ where: { schoolId: user.schoolId }, orderBy: { id: 'desc' }, select: { studentCode: true } });
      const lastNum = last ? Number(last.studentCode.replace(/\D/g, '')) || 26000 : 26000;
      const s = await tx.student.create({
        data: {
          schoolId: user.schoolId,
          studentCode: `ST-${lastNum + 1}`,
          lastName: dto.lastName,
          firstName: dto.firstName,
          middleName: dto.middleName ?? null,
          fullName: this.fullName(dto),
          gender: dto.gender,
          birthDate: toDate(dto.birthDate),
          nationalityId: dto.nationalityId ?? null,
          classId: dto.classId ?? null,
          phone: dto.phone ?? null,
          parentName: dto.parentName ?? null,
          parentPhone: dto.parentPhone ?? null,
          enrolledAt: dto.enrolledAt ? toDate(dto.enrolledAt) : toDate(todayStr()),
          previousSchool: dto.previousSchool ?? null,
          notes: dto.notes ?? null,
          ...this.pii4(dto),
        },
      });
      await this.audit.record(user, { action: 'Оқушы қосты', entity: 'student', entityId: s.id, summary: `${s.fullName} (${s.studentCode})`, after: { fullName: s.fullName, classId: s.classId } }, meta, tx);
      return s;
    });
    await this.cache.bump(user.schoolId);
    return this.get(user, created.id);
  }

  async update(user: AuthUser, id: number, dto: StudentUpdate, meta: RequestMeta) {
    const before = await this.scope.assertStudent(user, id);
    await this.validateRefs(user, dto);
    const data: Prisma.StudentUncheckedUpdateInput = {
      lastName: dto.lastName,
      firstName: dto.firstName,
      middleName: dto.middleName ?? null,
      fullName: this.fullName(dto),
      gender: dto.gender,
      birthDate: toDate(dto.birthDate),
      phone: dto.phone ?? null,
      parentName: dto.parentName ?? null,
      parentPhone: dto.parentPhone ?? null,
      enrolledAt: dto.enrolledAt ? toDate(dto.enrolledAt) : before.enrolledAt,
      previousSchool: dto.previousSchool ?? null,
      notes: dto.notes ?? null,
      ...(dto.nationalityId !== undefined ? { nationalityId: dto.nationalityId } : {}),
      ...(dto.classId !== undefined && dto.classId !== before.classId ? { classId: dto.classId } : {}),
      ...(dto.status && this.scope.isSchoolWide(user) ? { status: dto.status } : {}),
      ...this.pii4(dto),
    };
    const changed: Record<string, [unknown, unknown]> = {};
    for (const k of ['fullName', 'gender', 'phone', 'parentName', 'parentPhone', 'previousSchool', 'classId', 'status', 'nationalityId'] as const) {
      const nv = (data as Record<string, unknown>)[k];
      const ov = (before as Record<string, unknown>)[k];
      if (nv !== undefined && nv !== ov) changed[k] = [ov, nv];
    }
    if (fmtDate(before.birthDate) !== dto.birthDate) changed.birthDate = [fmtDate(before.birthDate), dto.birthDate];
    if (dto.iin !== undefined) changed.iin = ['жасырын', dto.iin ? 'өзгертілді' : 'жойылды'];
    await this.prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id }, data });
      if (Object.keys(changed).length) {
        await this.audit.record(
          user,
          {
            action: 'Оқушы деректерін өзгертті',
            entity: 'student',
            entityId: id,
            summary: `${before.fullName}: ${Object.keys(changed).join(', ')}`,
            before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[0]])),
            after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[1]])),
          },
          meta,
          tx,
        );
      }
    });
    await this.cache.bump(user.schoolId);
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: number, meta: RequestMeta) {
    const s = await this.scope.assertStudent(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id }, data: { deletedAt: new Date(), iinEncrypted: null, iinHash: null } });
      await this.audit.record(user, { action: 'Оқушыны жойды', entity: 'student', entityId: id, summary: `${s.fullName} (${s.studentCode})` }, meta, tx);
    });
    await this.cache.bump(user.schoolId);
    return { ok: true };
  }
}
