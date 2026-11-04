import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ScopeService } from '../core/scope.service';
import { LevelsService } from '../core/levels.service';
import { AuditService } from '../audit/audit.service';
import { addDays, fmtDate, fmtDot, todayStr, toDate } from '../../common/utils/dates';
import { round1 } from '../../common/utils/stats';
import { computeQuarter, GradeWeights, usesInterim, weightsFor, yearMark } from '../../common/utils/grades';
import { ColumnInput, CreateColumnInput, JournalQuery, SaveFinalsInput, SaveMarksInput } from './journal.dto';
import { autoColumns } from './journal-auto';

@Injectable()
export class JournalService {
  private readonly log = new Logger(JournalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly levels: LevelsService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /** Салмақтар сынып параллеліне тәуелді: 2–4 сыныптарда ФО + аралық бағалау. */
  async weights(schoolId: number, grade: number): Promise<GradeWeights> {
    return weightsFor(grade, await this.levels.settings(schoolId));
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
    const group = await this.scope.resolveGroup(user, q.classId, q.subjectId, q.groupId);
    return { cls, subject, quarter, group };
  }

  private async canWrite(user: AuthUser, q: { classId: number; subjectId: number; groupId?: number | null }) {
    if (!this.scope.can(user, P.ASSESSMENTS_WRITE)) return false;
    try {
      await this.scope.assertTeaches(user, q.classId, q.subjectId);
      await this.scope.resolveGroup(user, q.classId, q.subjectId, q.groupId, true);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Топ таңдалса: топ мүшелері + топ бөлінгенге дейінгі деректері бар, басқа топқа кірмеген оқушылар.
   * Топтар жоқ болса: сыныптың белсенді оқушылары + деректері бар (кейін кеткен) оқушылар.
   */
  private async students(user: AuthUser, classId: number, subjectId: number, groupId: number | null, linked: Set<number>) {
    const others = groupId
      ? new Set((await this.prisma.subjectGroupMember.findMany({ where: { classId, subjectId, groupId: { not: groupId } }, select: { studentId: true } })).map((m) => m.studentId))
      : new Set<number>();
    const linkedIds = [...linked].filter((id) => !others.has(id));
    return this.prisma.student.findMany({
      where: {
        schoolId: user.schoolId,
        deletedAt: null,
        OR: [groupId ? { groupMemberships: { some: { groupId } }, status: 'ACTIVE' } : { classId, status: 'ACTIVE' }, { id: { in: linkedIds } }],
      },
      select: { id: true, fullName: true, studentCode: true, classId: true, status: true, groupMemberships: { where: { classId, subjectId }, select: { groupId: true } } },
      orderBy: { fullName: 'asc' },
    });
  }

  /**
   * Сабақ кестесі бойынша журналға бағандарды автоматты қосу: соңғы синхрондаудан кейінгі күннен бүгінге дейінгі сабақ күндері.
   * Өткен күндер қайта өңделмейді, сондықтан мұғалім өшірген баған қайта қосылмайды. Аяқталған тоқсандар толтырылмайды.
   */
  private async autoSync(
    user: AuthUser,
    q: JournalQuery,
    cls: { schoolYearId: number },
    quarter: { id: number; startDate: Date; endDate: Date },
    group: { id: number; teacherId: number | null } | null,
  ) {
    const gid = group?.id ?? null;
    const key = `${q.classId}:${q.subjectId}:${quarter.id}:${gid ?? 0}`;
    const today = todayStr();
    const start = fmtDate(quarter.startDate)!;
    const end = fmtDate(quarter.endDate)!;
    if (today < start) return;
    const state = await this.prisma.journalAutoSync.findUnique({ where: { key } });
    const prev = state ? fmtDate(state.syncedUntil)! : null;
    const from = prev ? addDays(prev, 1) : start;
    const to = today < end ? today : end;
    if (from > to) return;
    // Тоқсан аяқталғаннан кейін алғаш ашылса — бұрынғы (импортталған) журналға тиіспейміз.
    if (!prev && today > end) {
      await this.prisma.journalAutoSync.createMany({ data: [{ key, schoolId: user.schoolId, syncedUntil: toDate(end) }], skipDuplicates: true });
      return;
    }
    const assignment = await this.prisma.teachingAssignment.findUnique({
      where: { classId_subjectId_schoolYearId: { classId: q.classId, subjectId: q.subjectId, schoolYearId: cls.schoolYearId } },
      select: { teacherId: true, slots: { select: { weekday: true }, orderBy: [{ weekday: 'asc' }, { period: 'asc' }] } },
    });
    // Кесте әлі жүктелмесе — күтеміз: кесте келгенде тоқсан басынан толтырылады.
    if (!assignment?.slots.length) return;
    const range = { gte: toDate(from), lte: toDate(to) };
    const [cols, plan] = await Promise.all([
      this.prisma.gradeColumn.findMany({
        where: { classId: q.classId, subjectId: q.subjectId, quarterId: quarter.id, date: range, ...(gid ? { OR: [{ groupId: gid }, { groupId: null }] } : {}) },
        select: { date: true },
      }),
      this.prisma.planLesson.findMany({
        where: { classId: q.classId, subjectId: q.subjectId, quarterId: quarter.id, groupId: gid, date: range },
        select: { date: true, topic: true },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const existing = new Map<string, number>();
    for (const c of cols) existing.set(fmtDate(c.date)!, (existing.get(fmtDate(c.date)!) ?? 0) + 1);
    const topics = new Map<string, string[]>();
    for (const l of plan) if (l.topic) topics.set(fmtDate(l.date)!, [...(topics.get(fmtDate(l.date)!) ?? []), l.topic]);
    const create = autoColumns(from, to, assignment.slots.map((s) => s.weekday), existing, topics);
    const teacherId = group?.teacherId ?? assignment.teacherId;
    const done = await this.prisma.$transaction(async (tx) => {
      // Бір уақытта екі сұрау келсе — тек біреуі қосады (compare-and-swap).
      if (prev) {
        const r = await tx.journalAutoSync.updateMany({ where: { key, syncedUntil: toDate(prev) }, data: { syncedUntil: toDate(to) } });
        if (!r.count) return false;
      } else {
        const r = await tx.journalAutoSync.createMany({ data: [{ key, schoolId: user.schoolId, syncedUntil: toDate(to) }], skipDuplicates: true });
        if (!r.count) return false;
      }
      if (create.length) {
        await tx.gradeColumn.createMany({
          data: create.map((c) => ({ schoolId: user.schoolId, classId: q.classId, subjectId: q.subjectId, quarterId: quarter.id, groupId: gid, teacherId, date: toDate(c.date), topic: c.topic })),
        });
      }
      return true;
    });
    if (done && create.length) await this.cache.bump(user.schoolId);
  }

  /** Журнал: сыныптың белсенді оқушылары + тоқсанда бағасы бар (кейін кеткен) оқушылар. */
  async get(user: AuthUser, q: JournalQuery) {
    const { cls, subject, quarter, group } = await this.context(user, q);
    try {
      await this.autoSync(user, q, cls, quarter, group);
    } catch (e) {
      this.log.warn(`journal auto-sync failed: ${(e as Error).message}`);
    }
    const base = { classId: q.classId, subjectId: q.subjectId, quarterId: q.quarterId };
    // Топ көрінісінде топқа арналған және топ бөлінгенге дейін бүкіл сыныпқа жасалған деректер көрсетіледі.
    const where = group ? { ...base, OR: [{ groupId: group.id }, { groupId: null }] } : base;
    const [columns, assessments, finals, lv, w, canWrite] = await Promise.all([
      this.prisma.gradeColumn.findMany({ where, include: { grades: true, homework: { select: { studentId: true } } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
      this.prisma.assessment.findMany({ where, include: { results: true, _count: { select: { criteria: true } } }, orderBy: [{ type: 'asc' }, { date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.quarterGrade.findMany({ where: base }),
      this.levels.get(user.schoolId),
      this.weights(user.schoolId, cls.grade),
      this.canWrite(user, q),
    ]);
    const linked = new Set<number>([
      ...columns.flatMap((c) => c.grades.map((g) => g.studentId)),
      ...assessments.flatMap((a) => a.results.map((r) => r.studentId)),
      ...finals.map((f) => f.studentId),
    ]);
    const students = await this.students(user, q.classId, q.subjectId, group?.id ?? null, linked);
    // Қатысу: баған күндеріндегі осы пән сабағына келмегендер (себепсіз/себепті/ауру/басқа).
    const colDates = [...new Set(columns.map((c) => fmtDate(c.date)!))];
    const absentRows = colDates.length
      ? await this.prisma.attendance.findMany({
          where: {
            schoolId: user.schoolId,
            studentId: { in: students.map((s) => s.id) },
            status: { in: ['N', 'S', 'A', 'O'] },
            date: { in: columns.map((c) => c.date) },
            lesson: { classId: q.classId, subjectId: q.subjectId },
          },
          select: { studentId: true, date: true, status: true },
        })
      : [];
    const absentMap = new Map(absentRows.map((a) => [`${a.studentId}:${fmtDate(a.date)}`, a.status as string]));
    const bjb = assessments.filter((a) => a.type === 'BJB');
    // Топ көрінісінде топтың ТЖБ-сы басым; болмаса бүкіл сыныптың ТЖБ-сы.
    const interim = assessments.filter((a) => a.type === 'ARALYK');
    const tjb = assessments.filter((a) => a.type === 'TJB').sort((a, b) => (b.groupId ? 1 : 0) - (a.groupId ? 1 : 0))[0] ?? null;

    const rows = students.map((s) => {
      const marks = columns.map((c) => c.grades.find((g) => g.studentId === s.id)?.value ?? null);
      const bjbRes = bjb.map((a) => {
        const r = a.results.find((x) => x.studentId === s.id);
        return r ? { score: Number(r.score), max: Number(a.maxScore), absent: r.absent, pct: r.absent ? null : round1(Number(r.percent)) } : null;
      });
      const interimRes = interim.map((a) => {
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
          interim: interimRes.filter((r): r is NonNullable<typeof r> => !!r && !r.absent).map((r) => ({ score: r.score, max: r.max })),
        },
        w,
        lv,
      );
      const f = finals.find((x) => x.studentId === s.id);
      return {
        studentId: s.id,
        fullName: s.fullName,
        studentCode: s.studentCode,
        left: s.classId !== q.classId || s.status !== 'ACTIVE' || (!!group && !s.groupMemberships.some((m) => m.groupId === group.id)),
        marks,
        /** Әр баған бойынша үй тапсырмасын орындағаны. */
        homework: columns.map((c) => c.homework.some((h) => h.studentId === s.id)),
        /** Әр баған күнінде сабаққа келмегені: N | S | A | O, келсе null. */
        absent: columns.map((c) => absentMap.get(`${s.id}:${fmtDate(c.date)}`) ?? null),
        foCount: marks.filter((m) => m != null).length,
        foAvg: computed.foPct == null ? null : round1((computed.foPct / 100) * 10),
        bjb: bjbRes.map((r) => (r ? { score: r.score, absent: r.absent, pct: r.pct } : null)),
        tjb: tjbRes ? { score: tjbRes.score, absent: tjbRes.absent, pct: tjbRes.pct } : null,
        interim: interimRes.map((r) => (r ? { score: r.score, absent: r.absent, pct: r.pct } : null)),
        computed,
        final: f ? { mark: f.mark, computedPct: f.computedPct == null ? null : Number(f.computedPct), updatedAt: f.updatedAt.toISOString() } : null,
      };
    });

    return {
      classId: cls.id,
      className: cls.name,
      subjectId: subject.id,
      subject: subject.name,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      quarterId: quarter.id,
      quarter: quarter.number,
      startDate: fmtDate(quarter.startDate),
      endDate: fmtDate(quarter.endDate),
      canWrite,
      /** 2–4 сыныптар: БЖБ/ТЖБ орнына аралық бағалау. */
      primary: usesInterim(cls.grade),
      weights: w,
      levels: lv,
      columns: columns.map((c) => ({ id: c.id, date: fmtDate(c.date)!, topic: c.topic })),
      bjb: bjb.map((a) => ({ id: a.id, title: a.title, maxScore: Number(a.maxScore), criteria: a._count.criteria, groupId: a.groupId, date: fmtDate(a.date) })),
      tjb: tjb ? { id: tjb.id, title: tjb.title, maxScore: Number(tjb.maxScore), criteria: tjb._count.criteria, groupId: tjb.groupId, date: fmtDate(tjb.date) } : null,
      interim: interim.map((a) => ({ id: a.id, title: a.title, maxScore: Number(a.maxScore), criteria: a._count.criteria, groupId: a.groupId, date: fmtDate(a.date) })),
      rows,
      finalsCount: finals.length,
    };
  }

  /** Жылдық көрініс: барлық тоқсанның қойылған бағалары + жылдық баға. */
  async year(user: AuthUser, classId: number, subjectId: number, groupId?: number | null) {
    const cls = await this.scope.assertClass(user, classId);
    const subject = await this.prisma.subject.findFirst({ where: { id: subjectId, schoolId: user.schoolId } });
    if (!subject) throw new NotFoundException('Пән табылмады');
    const group = await this.scope.resolveGroup(user, classId, subjectId, groupId);
    const quarters = await this.prisma.quarter.findMany({ where: { schoolYearId: cls.schoolYearId }, orderBy: { number: 'asc' } });
    const finals = await this.prisma.quarterGrade.findMany({ where: { classId, subjectId, quarterId: { in: quarters.map((x) => x.id) } } });
    const students = await this.students(user, classId, subjectId, group?.id ?? null, new Set(finals.map((f) => f.studentId)));
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
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      quarters: quarters.map((qq) => ({ id: qq.id, number: qq.number })),
      rows,
      distribution: [2, 3, 4, 5].map((m) => withYear.filter((r) => r.year === m).length),
    };
  }

  private async assertWritable(user: AuthUser, q: JournalQuery) {
    const ctx = await this.context(user, q);
    await this.scope.assertTeaches(user, q.classId, q.subjectId);
    await this.scope.resolveGroup(user, q.classId, q.subjectId, q.groupId, true);
    return ctx;
  }

  private assertInQuarter(date: string, quarter: { startDate: Date; endDate: Date; number: number }) {
    const d = toDate(date);
    if (d < quarter.startDate || d > quarter.endDate) {
      throw new BadRequestException(`Күн ${quarter.number}-тоқсан аралығында болуы керек (${fmtDot(quarter.startDate)} – ${fmtDot(quarter.endDate)})`);
    }
  }

  async createColumn(user: AuthUser, dto: CreateColumnInput, meta: RequestMeta) {
    const { cls, subject, quarter, group } = await this.assertWritable(user, dto);
    this.assertInQuarter(dto.date, quarter);
    const count = await this.prisma.gradeColumn.count({ where: { classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId, groupId: group?.id ?? null } });
    if (count >= 120) throw new BadRequestException('Бір тоқсанға 120-дан артық баған қосуға болмайды');
    const c = await this.prisma.$transaction(async (tx) => {
      const c = await tx.gradeColumn.create({
        data: { schoolId: user.schoolId, classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId, groupId: group?.id ?? null, teacherId: user.teacherId, date: toDate(dto.date), topic: dto.topic || null },
      });
      await this.audit.record(user, { action: 'Журналға баған қосты', entity: 'journal', entityId: c.id, summary: `${cls.name}${group ? ` (${group.name})` : ''} · ${subject.name} · ${fmtDot(dto.date)}${dto.topic ? ` · ${dto.topic}` : ''}` }, meta, tx);
      return c;
    });
    return { id: c.id, date: fmtDate(c.date)!, topic: c.topic };
  }

  private async loadColumn(user: AuthUser, id: number) {
    const c = await this.prisma.gradeColumn.findFirst({ where: { id, schoolId: user.schoolId }, include: { class: true, subject: true, quarter: true, _count: { select: { grades: true } } } });
    if (!c) throw new NotFoundException('Журнал бағаны табылмады');
    await this.scope.assertWriteScope(user, c.classId, c.subjectId, c.groupId);
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
    const current = await this.get(user, dto);
    const colIds = new Set(current.columns.map((c) => c.id));
    const allowed = new Set(current.rows.map((r) => r.studentId));
    const hw = dto.homework ?? [];
    for (const m of [...dto.marks, ...hw]) {
      if (!colIds.has(m.columnId)) throw new BadRequestException('Баған осы журналға жатпайды');
      if (!allowed.has(m.studentId)) throw new BadRequestException('Тізімде бұл журналға (сыныпқа не топқа) жатпайтын оқушы бар');
    }
    let set = 0;
    let cleared = 0;
    let hwDone = 0;
    let hwUndone = 0;
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
      for (const h of hw) {
        if (h.done) {
          await tx.homeworkMark.upsert({
            where: { columnId_studentId: { columnId: h.columnId, studentId: h.studentId } },
            create: { columnId: h.columnId, studentId: h.studentId, updatedById: user.id },
            update: {},
          });
          hwDone++;
        } else {
          hwUndone += (await tx.homeworkMark.deleteMany({ where: { columnId: h.columnId, studentId: h.studentId } })).count;
        }
      }
      const parts = [
        set || cleared || !hw.length ? `${set} баға${cleared ? `, ${cleared} өшірілді` : ''}` : '',
        hwDone || hwUndone ? `үй тапсырмасы: +${hwDone}${hwUndone ? ` / −${hwUndone}` : ''}` : '',
      ].filter(Boolean);
      await this.audit.record(
        user,
        { action: 'Журналға баға қойды', entity: 'journal', entityId: `${dto.classId}:${dto.subjectId}:${dto.quarterId}`, summary: `${cls.name} · ${subject.name} · ${quarter.number}-тоқсан`, after: parts.join('; ') },
        meta,
        tx,
      );
    });
    await this.cache.bump(user.schoolId);
    return this.get(user, dto);
  }

  /** Тоқсандық қорытынды бағаларды қою. Есептелген пайыз тарих үшін бірге сақталады. */
  async saveFinals(user: AuthUser, dto: SaveFinalsInput, meta: RequestMeta) {
    const { cls, subject, quarter } = await this.assertWritable(user, dto);
    const current = await this.get(user, dto);
    const byStudent = new Map(current.rows.map((r) => [r.studentId, r]));
    for (const g of dto.grades) if (!byStudent.has(g.studentId)) throw new BadRequestException('Тізімде бұл журналға (сыныпқа не топқа) жатпайтын оқушы бар');
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
