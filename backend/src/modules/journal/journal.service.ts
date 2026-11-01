import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ScopeService } from '../core/scope.service';
import { LevelsService } from '../core/levels.service';
import { AuditService } from '../audit/audit.service';
import { fmtDate, fmtDot, toDate } from '../../common/utils/dates';
import { round1 } from '../../common/utils/stats';
import { computeQuarter, GradeWeights, yearMark } from '../../common/utils/grades';
import { ColumnInput, CreateColumnInput, JournalQuery, SaveFinalsInput, SaveMarksInput } from './journal.dto';

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly levels: LevelsService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async weights(schoolId: number): Promise<GradeWeights> {
    const s = await this.levels.settings(schoolId);
    return { fo: s.foWeight, bjb: s.bjbWeight, tjb: s.tjbWeight };
  }

  /** Сынып, пән және тоқсанның бір оқу жылына жататынын тексереді. */
  private async context(user: AuthUser, q: JournalQuery) {
    const cls = await this.scope.assertClass(user, q.classId);
    const [subject, quarter] = await Promise.all([
      this.prisma.subject.findFirst({ where: { id: q.subjectId, schoolId: user.schoolId } }),
      this.prisma.quarter.findFirst({ where: { id: q.quarterId, schoolYearId: cls.schoolYearId } }),
    ]);
    if (!subject) throw new NotFoundException('Пән табылмады');
    if (!quarter) throw new BadRequestException('Тоқсан сынып оқу жылына сәйкес емес');
    return { cls, subject, quarter };
  }

  private async canWrite(user: AuthUser, classId: number, subjectId: number) {
    if (!this.scope.can(user, P.ASSESSMENTS_WRITE)) return false;
    try {
      await this.scope.assertTeaches(user, classId, subjectId);
      return true;
    } catch {
      return false;
    }
  }

  /** Журнал: сыныптың белсенді оқушылары + тоқсанда бағасы бар (кейін кеткен) оқушылар. */
  async get(user: AuthUser, q: JournalQuery) {
    const { cls, subject, quarter } = await this.context(user, q);
    const where = { classId: q.classId, subjectId: q.subjectId, quarterId: q.quarterId };
    const [columns, assessments, finals, lv, w, canWrite] = await Promise.all([
      this.prisma.gradeColumn.findMany({ where, include: { grades: true }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
      this.prisma.assessment.findMany({ where, include: { results: true }, orderBy: [{ type: 'asc' }, { date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.quarterGrade.findMany({ where }),
      this.levels.get(user.schoolId),
      this.weights(user.schoolId),
      this.canWrite(user, q.classId, q.subjectId),
    ]);
    const linked = new Set<number>([
      ...columns.flatMap((c) => c.grades.map((g) => g.studentId)),
      ...assessments.flatMap((a) => a.results.map((r) => r.studentId)),
      ...finals.map((f) => f.studentId),
    ]);
    const students = await this.prisma.student.findMany({
      where: { schoolId: user.schoolId, deletedAt: null, OR: [{ classId: q.classId, status: 'ACTIVE' }, { id: { in: [...linked] } }] },
      select: { id: true, fullName: true, studentCode: true, classId: true, status: true },
      orderBy: { fullName: 'asc' },
    });
    const bjb = assessments.filter((a) => a.type === 'BJB');
    const tjb = assessments.find((a) => a.type === 'TJB') ?? null;

    const rows = students.map((s) => {
      const marks = columns.map((c) => c.grades.find((g) => g.studentId === s.id)?.value ?? null);
      const bjbRes = bjb.map((a) => {
        const r = a.results.find((x) => x.studentId === s.id);
        return r ? { score: Number(r.score), max: Number(a.maxScore), absent: r.absent, pct: r.absent ? null : round1(Number(r.percent)) } : null;
      });
      const tr = tjb?.results.find((x) => x.studentId === s.id);
      const tjbRes = tjb && tr ? { score: Number(tr.score), max: Number(tjb.maxScore), absent: tr.absent, pct: tr.absent ? null : round1(Number(tr.percent)) } : null;
      const computed = computeQuarter(
        {
          fo: marks.filter((m): m is number => m != null),
          bjb: bjbRes.filter((r): r is NonNullable<typeof r> => !!r && !r.absent).map((r) => ({ score: r.score, max: r.max })),
          tjb: tjbRes && !tjbRes.absent ? { score: tjbRes.score, max: tjbRes.max } : null,
        },
        w,
        lv,
      );
      const f = finals.find((x) => x.studentId === s.id);
      return {
        studentId: s.id,
        fullName: s.fullName,
        studentCode: s.studentCode,
        left: s.classId !== q.classId || s.status !== 'ACTIVE',
        marks,
        foCount: marks.filter((m) => m != null).length,
        foAvg: computed.foPct == null ? null : round1((computed.foPct / 100) * 10),
        bjb: bjbRes.map((r) => (r ? { score: r.score, absent: r.absent, pct: r.pct } : null)),
        tjb: tjbRes ? { score: tjbRes.score, absent: tjbRes.absent, pct: tjbRes.pct } : null,
        computed,
        final: f ? { mark: f.mark, computedPct: f.computedPct == null ? null : Number(f.computedPct), updatedAt: f.updatedAt.toISOString() } : null,
      };
    });

    return {
      classId: cls.id,
      className: cls.name,
      subjectId: subject.id,
      subject: subject.name,
      quarterId: quarter.id,
      quarter: quarter.number,
      startDate: fmtDate(quarter.startDate),
      endDate: fmtDate(quarter.endDate),
      canWrite,
      weights: w,
      levels: lv,
      columns: columns.map((c) => ({ id: c.id, date: fmtDate(c.date)!, topic: c.topic })),
      bjb: bjb.map((a) => ({ id: a.id, title: a.title, maxScore: Number(a.maxScore) })),
      tjb: tjb ? { id: tjb.id, title: tjb.title, maxScore: Number(tjb.maxScore) } : null,
      rows,
      finalsCount: finals.length,
    };
  }

  /** Жылдық көрініс: барлық тоқсанның қойылған бағалары + жылдық баға. */
  async year(user: AuthUser, classId: number, subjectId: number) {
    const cls = await this.scope.assertClass(user, classId);
    const subject = await this.prisma.subject.findFirst({ where: { id: subjectId, schoolId: user.schoolId } });
    if (!subject) throw new NotFoundException('Пән табылмады');
    const quarters = await this.prisma.quarter.findMany({ where: { schoolYearId: cls.schoolYearId }, orderBy: { number: 'asc' } });
    const finals = await this.prisma.quarterGrade.findMany({ where: { classId, subjectId, quarterId: { in: quarters.map((x) => x.id) } } });
    const students = await this.prisma.student.findMany({
      where: { schoolId: user.schoolId, deletedAt: null, OR: [{ classId, status: 'ACTIVE' }, { id: { in: [...new Set(finals.map((f) => f.studentId))] } }] },
      select: { id: true, fullName: true, studentCode: true, classId: true, status: true },
      orderBy: { fullName: 'asc' },
    });
    const rows = students.map((s) => {
      const marks = quarters.map((qq) => finals.find((f) => f.studentId === s.id && f.quarterId === qq.id)?.mark ?? null);
      return { studentId: s.id, fullName: s.fullName, studentCode: s.studentCode, left: s.classId !== classId || s.status !== 'ACTIVE', marks, year: yearMark(marks), complete: marks.every((m) => m != null) };
    });
    const withYear = rows.filter((r) => r.year != null);
    return {
      classId,
      className: cls.name,
      subjectId,
      subject: subject.name,
      quarters: quarters.map((qq) => ({ id: qq.id, number: qq.number })),
      rows,
      distribution: [2, 3, 4, 5].map((m) => withYear.filter((r) => r.year === m).length),
    };
  }

  private async assertWritable(user: AuthUser, q: JournalQuery) {
    const ctx = await this.context(user, q);
    await this.scope.assertTeaches(user, q.classId, q.subjectId);
    return ctx;
  }

  private assertInQuarter(date: string, quarter: { startDate: Date; endDate: Date; number: number }) {
    const d = toDate(date);
    if (d < quarter.startDate || d > quarter.endDate) {
      throw new BadRequestException(`Күн ${quarter.number}-тоқсан аралығында болуы керек (${fmtDot(quarter.startDate)} – ${fmtDot(quarter.endDate)})`);
    }
  }

  async createColumn(user: AuthUser, dto: CreateColumnInput, meta: RequestMeta) {
    const { cls, subject, quarter } = await this.assertWritable(user, dto);
    this.assertInQuarter(dto.date, quarter);
    const count = await this.prisma.gradeColumn.count({ where: { classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId } });
    if (count >= 120) throw new BadRequestException('Бір тоқсанға 120-дан артық баған қосуға болмайды');
    const c = await this.prisma.$transaction(async (tx) => {
      const c = await tx.gradeColumn.create({
        data: { schoolId: user.schoolId, classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId, teacherId: user.teacherId, date: toDate(dto.date), topic: dto.topic || null },
      });
      await this.audit.record(user, { action: 'Журналға баған қосты', entity: 'journal', entityId: c.id, summary: `${cls.name} · ${subject.name} · ${fmtDot(dto.date)}${dto.topic ? ` · ${dto.topic}` : ''}` }, meta, tx);
      return c;
    });
    return { id: c.id, date: fmtDate(c.date)!, topic: c.topic };
  }

  private async loadColumn(user: AuthUser, id: number) {
    const c = await this.prisma.gradeColumn.findFirst({ where: { id, schoolId: user.schoolId }, include: { class: true, subject: true, quarter: true, _count: { select: { grades: true } } } });
    if (!c) throw new NotFoundException('Журнал бағаны табылмады');
    await this.scope.assertTeaches(user, c.classId, c.subjectId);
    return c;
  }

  async updateColumn(user: AuthUser, id: number, dto: ColumnInput, meta: RequestMeta) {
    const c = await this.loadColumn(user, id);
    this.assertInQuarter(dto.date, c.quarter);
    const next = await this.prisma.$transaction(async (tx) => {
      const n = await tx.gradeColumn.update({ where: { id }, data: { date: toDate(dto.date), topic: dto.topic || null } });
      await this.audit.record(
        user,
        { action: 'Журнал бағанын өзгертті', entity: 'journal', entityId: id, summary: `${c.class.name} · ${c.subject.name}`, before: `${fmtDot(c.date)} ${c.topic ?? ''}`.trim(), after: `${fmtDot(dto.date)} ${dto.topic ?? ''}`.trim() },
        meta,
        tx,
      );
      return n;
    });
    return { id: next.id, date: fmtDate(next.date)!, topic: next.topic };
  }

  async removeColumn(user: AuthUser, id: number, meta: RequestMeta) {
    const c = await this.loadColumn(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.gradeColumn.delete({ where: { id } });
      await this.audit.record(user, { action: 'Журнал бағанын жойды', entity: 'journal', entityId: id, summary: `${c.class.name} · ${c.subject.name} · ${fmtDot(c.date)} · ${c._count.grades} баға` }, meta, tx);
    });
    await this.cache.bump(user.schoolId);
    return { ok: true };
  }

  /** Ағымдағы бағаларды топтап сақтау (тек өзгергендері жіберіледі). */
  async saveMarks(user: AuthUser, dto: SaveMarksInput, meta: RequestMeta) {
    const { cls, subject, quarter } = await this.assertWritable(user, dto);
    const columns = await this.prisma.gradeColumn.findMany({ where: { classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId }, select: { id: true } });
    const colIds = new Set(columns.map((c) => c.id));
    const allowed = await this.allowedStudents(user, dto);
    for (const m of dto.marks) {
      if (!colIds.has(m.columnId)) throw new BadRequestException('Баған осы журналға жатпайды');
      if (!allowed.has(m.studentId)) throw new BadRequestException('Тізімде басқа сыныптың оқушысы бар');
    }
    let set = 0;
    let cleared = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const m of dto.marks) {
        if (m.value == null) {
          cleared += (await tx.grade.deleteMany({ where: { columnId: m.columnId, studentId: m.studentId } })).count;
        } else {
          await tx.grade.upsert({
            where: { columnId_studentId: { columnId: m.columnId, studentId: m.studentId } },
            create: { columnId: m.columnId, studentId: m.studentId, value: m.value, updatedById: user.id },
            update: { value: m.value, updatedById: user.id },
          });
          set++;
        }
      }
      await this.audit.record(
        user,
        { action: 'Журналға баға қойды', entity: 'journal', entityId: `${dto.classId}:${dto.subjectId}:${dto.quarterId}`, summary: `${cls.name} · ${subject.name} · ${quarter.number}-тоқсан`, after: `${set} баға${cleared ? `, ${cleared} өшірілді` : ''}` },
        meta,
        tx,
      );
    });
    await this.cache.bump(user.schoolId);
    return this.get(user, dto);
  }

  private async allowedStudents(user: AuthUser, q: JournalQuery) {
    const rows = await this.prisma.student.findMany({
      where: {
        schoolId: user.schoolId,
        deletedAt: null,
        OR: [
          { classId: q.classId, status: 'ACTIVE' },
          { grades: { some: { column: { classId: q.classId, subjectId: q.subjectId, quarterId: q.quarterId } } } },
          { assessmentResults: { some: { assessment: { classId: q.classId, subjectId: q.subjectId, quarterId: q.quarterId } } } },
          { quarterGrades: { some: { classId: q.classId, subjectId: q.subjectId, quarterId: q.quarterId } } },
        ],
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** Тоқсандық қорытынды бағаларды қою. Есептелген пайыз тарих үшін бірге сақталады. */
  async saveFinals(user: AuthUser, dto: SaveFinalsInput, meta: RequestMeta) {
    const { cls, subject, quarter } = await this.assertWritable(user, dto);
    const current = await this.get(user, dto);
    const byStudent = new Map(current.rows.map((r) => [r.studentId, r]));
    for (const g of dto.grades) if (!byStudent.has(g.studentId)) throw new BadRequestException('Тізімде басқа сыныптың оқушысы бар');
    const changes: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const g of dto.grades) {
        const row = byStudent.get(g.studentId)!;
        const key = { quarterId_classId_subjectId_studentId: { quarterId: dto.quarterId, classId: dto.classId, subjectId: dto.subjectId, studentId: g.studentId } };
        const prev = row.final?.mark ?? null;
        if (g.mark == null) {
          if (prev != null) {
            await tx.quarterGrade.delete({ where: key });
            changes.push(`${row.fullName}: ${prev}→—`);
          }
          continue;
        }
        await tx.quarterGrade.upsert({
          where: key,
          create: { schoolId: user.schoolId, quarterId: dto.quarterId, classId: dto.classId, subjectId: dto.subjectId, studentId: g.studentId, mark: g.mark, computedPct: row.computed.pct, updatedById: user.id },
          update: { mark: g.mark, computedPct: row.computed.pct, updatedById: user.id },
        });
        if (prev !== g.mark) {
          const manual = row.computed.mark != null && row.computed.mark !== g.mark ? ` (есеп: ${row.computed.mark})` : '';
          changes.push(`${row.fullName}: ${prev ?? '—'}→${g.mark}${manual}`);
        }
      }
      if (changes.length) {
        await this.audit.record(
          user,
          { action: 'Тоқсандық баға қойды', entity: 'journal', entityId: `${dto.classId}:${dto.subjectId}:${dto.quarterId}`, summary: `${cls.name} · ${subject.name} · ${quarter.number}-тоқсан · ${changes.length} оқушы`, after: changes.slice(0, 40).join('; ') },
          meta,
          tx,
        );
      }
    });
    await this.cache.bump(user.schoolId);
    return this.get(user, dto);
  }
}
