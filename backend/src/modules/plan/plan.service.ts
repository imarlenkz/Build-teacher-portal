import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ScopeService } from '../core/scope.service';
import { AuditService } from '../audit/audit.service';
import { fmtDate, fmtDot, todayStr, toDate } from '../../common/utils/dates';
import { CopyPlanInput, PlanImportInput, PlanLessonInput, PlanQuery, PlanToJournalInput, SavePlanInput } from './plan.dto';
import { parsePlanWorkbook, PlanRow } from './plan-import';

type Quarter = { id: number; number: number; startDate: Date; endDate: Date };
type LessonData = { section: string | null; topic: string; objectives: string | null; hours: number; date: string | null; notes: string | null };

const TOPIC_MAX = 160; // журнал бағанының тақырыбы

@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  private async context(user: AuthUser, q: PlanQuery) {
    const cls = await this.scope.assertClass(user, q.classId);
    const [subject, quarter, year] = await Promise.all([
      this.prisma.subject.findFirst({ where: { id: q.subjectId, schoolId: user.schoolId } }),
      this.prisma.quarter.findFirst({ where: { id: q.quarterId, schoolYearId: cls.schoolYearId } }),
      this.prisma.schoolYear.findUnique({ where: { id: cls.schoolYearId }, include: { quarters: { orderBy: { number: 'asc' } } } }),
    ]);
    if (!subject) throw new NotFoundException('Пән табылмады');
    if (!quarter || !year) throw new BadRequestException('Тоқсан сынып оқу жылына сәйкес емес');
    const group = await this.scope.resolveGroup(user, q.classId, q.subjectId, q.groupId);
    await this.scope.assertTeaches(user, q.classId, q.subjectId);
    return { cls, subject, quarter, year, group };
  }

  private async writable(user: AuthUser, q: PlanQuery) {
    const ctx = await this.context(user, q);
    if (!this.scope.can(user, P.ASSESSMENTS_WRITE)) throw new ForbiddenException('Жоспарды өзгертуге рұқсат жоқ');
    await this.scope.resolveGroup(user, q.classId, q.subjectId, q.groupId, true);
    return ctx;
  }

  private async canWrite(user: AuthUser, q: PlanQuery) {
    if (!this.scope.can(user, P.ASSESSMENTS_WRITE)) return false;
    try {
      await this.scope.resolveGroup(user, q.classId, q.subjectId, q.groupId, true);
      return true;
    } catch {
      return false;
    }
  }

  private where(q: PlanQuery, groupId: number | null, quarterIds?: number[]): Prisma.PlanLessonWhereInput {
    return { classId: q.classId, subjectId: q.subjectId, quarterId: quarterIds ? { in: quarterIds } : q.quarterId, groupId };
  }

  /** Сабақ кестесіндегі апта күндері (әр сабақ — бір элемент): [1, 3, 3] — дүйсенбіде 1, сәрсенбіде 2 сабақ. */
  private async slots(classId: number, subjectId: number, schoolYearId: number) {
    const s = await this.prisma.timetableSlot.findMany({
      where: { assignment: { classId, subjectId, schoolYearId } },
      select: { weekday: true, period: true },
      orderBy: [{ weekday: 'asc' }, { period: 'asc' }],
    });
    return s.map((x) => x.weekday);
  }

  /** КТЖ: тоқсан сабақтары + журналда өткізілгені (сол күні баған бар ма). */
  async get(user: AuthUser, q: PlanQuery) {
    const { cls, subject, quarter, year, group } = await this.context(user, q);
    const gid = group?.id ?? null;
    const colWhere = { classId: q.classId, subjectId: q.subjectId, quarterId: q.quarterId, ...(group ? { OR: [{ groupId: group.id }, { groupId: null }] } : {}) };
    const [lessons, columns, weekdays, canWrite, counts] = await Promise.all([
      this.prisma.planLesson.findMany({ where: this.where(q, gid), orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
      this.prisma.gradeColumn.findMany({ where: colWhere, select: { id: true, date: true, topic: true }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
      this.slots(q.classId, q.subjectId, cls.schoolYearId),
      this.canWrite(user, q),
      this.prisma.planLesson.groupBy({ by: ['quarterId'], where: { classId: q.classId, subjectId: q.subjectId, groupId: gid, quarterId: { in: year.quarters.map((x) => x.id) } }, _count: true, _sum: { hours: true } }),
    ]);
    const byDate = new Map<string, { id: number; topic: string | null }[]>();
    for (const c of columns) {
      const d = fmtDate(c.date)!;
      byDate.set(d, [...(byDate.get(d) ?? []), { id: c.id, topic: c.topic }]);
    }
    const today = todayStr();
    return {
      classId: cls.id,
      className: cls.name,
      grade: cls.grade,
      subjectId: subject.id,
      subject: subject.name,
      groupId: gid,
      groupName: group?.name ?? null,
      quarterId: quarter.id,
      quarter: quarter.number,
      startDate: fmtDate(quarter.startDate)!,
      endDate: fmtDate(quarter.endDate)!,
      schoolYear: year.name,
      today,
      canWrite,
      /** Сабақ кестесі бойынша апта күндері — күндерді автоматты толтыру үшін. */
      weekdays,
      quarters: year.quarters.map((x) => {
        const c = counts.find((k) => k.quarterId === x.id);
        return { id: x.id, number: x.number, lessons: c?._count ?? 0, hours: c?._sum.hours ?? 0 };
      }),
      journalColumns: columns.length,
      lessons: lessons.map((l) => {
        const d = fmtDate(l.date);
        const col = d ? byDate.get(d)?.[0] : undefined;
        return {
          id: l.id,
          order: l.order,
          section: l.section,
          topic: l.topic,
          objectives: l.objectives,
          hours: l.hours,
          date: d,
          notes: l.notes,
          /** Журналда сол күнге баған бар болса — сабақ өткізілген деп есептеледі. */
          columnId: col?.id ?? null,
          past: !!d && d <= today,
        };
      }),
    };
  }

  private check(lessons: LessonData[], quarter: Quarter, issues?: { row: number; message: string }[], rows?: number[]) {
    const s = fmtDate(quarter.startDate)!;
    const e = fmtDate(quarter.endDate)!;
    lessons.forEach((l, i) => {
      if (l.date && (l.date < s || l.date > e)) {
        if (!issues) throw new BadRequestException(`${i + 1}-сабақ: күні ${quarter.number}-тоқсан аралығында болуы керек (${fmtDot(s)} – ${fmtDot(e)})`);
        issues.push({ row: rows?.[i] ?? i + 1, message: `«${l.topic.slice(0, 40)}»: ${fmtDot(l.date)} ${quarter.number}-тоқсанға жатпайды, күні алынып тасталды` });
        l.date = null;
      }
    });
  }

  private async replace(tx: Prisma.TransactionClient, user: AuthUser, q: { classId: number; subjectId: number }, groupId: number | null, quarterId: number, lessons: LessonData[]) {
    await tx.planLesson.deleteMany({ where: { classId: q.classId, subjectId: q.subjectId, quarterId, groupId } });
    if (!lessons.length) return;
    await tx.planLesson.createMany({
      data: lessons.map((l, i) => ({
        schoolId: user.schoolId,
        classId: q.classId,
        subjectId: q.subjectId,
        quarterId,
        groupId,
        teacherId: user.teacherId,
        order: i + 1,
        section: l.section || null,
        topic: l.topic,
        objectives: l.objectives || null,
        hours: l.hours,
        date: l.date ? toDate(l.date) : null,
        notes: l.notes || null,
      })),
    });
  }

  private label(cls: { name: string }, subject: { name: string }, group: { name: string } | null) {
    return `${cls.name}${group ? ` (${group.name})` : ''} · ${subject.name}`;
  }

  /** Тоқсан жоспарын толық сақтау (реті — массив реті). */
  async save(user: AuthUser, dto: SavePlanInput, meta: RequestMeta) {
    const { cls, subject, quarter, group } = await this.writable(user, dto);
    const lessons: LessonData[] = dto.lessons.map((l: PlanLessonInput) => ({
      section: l.section ?? null,
      topic: l.topic,
      objectives: l.objectives ?? null,
      hours: l.hours ?? 1,
      date: l.date ?? null,
      notes: l.notes ?? null,
    }));
    const empty = lessons.findIndex((l) => !l.topic);
    if (empty >= 0) throw new BadRequestException(`${empty + 1}-сабақтың тақырыбы бос`);
    this.check(lessons, quarter);
    const before = await this.prisma.planLesson.count({ where: this.where(dto, group?.id ?? null) });
    await this.prisma.$transaction(async (tx) => {
      await this.replace(tx, user, dto, group?.id ?? null, quarter.id, lessons);
      await this.audit.record(
        user,
        { action: 'КТЖ сақтады', entity: 'plan', entityId: `${dto.classId}:${dto.subjectId}:${dto.quarterId}`, summary: `${this.label(cls, subject, group)} · ${quarter.number}-тоқсан`, before: `${before} сабақ`, after: `${lessons.length} сабақ, ${lessons.reduce((a, l) => a + l.hours, 0)} сағат` },
        meta,
        tx,
      );
    });
    return this.get(user, dto);
  }

  /** Excel-ден импорт: алдын ала қарау (apply=false) немесе тоқсан(дар) жоспарын ауыстыру. */
  async importFile(user: AuthUser, dto: PlanImportInput, meta: RequestMeta) {
    const { cls, subject, quarter, year, group } = await this.writable(user, dto);
    let parsed: Awaited<ReturnType<typeof parsePlanWorkbook>>;
    try {
      parsed = await parsePlanWorkbook(Buffer.from(dto.data, 'base64'), { startYear: year.startDate.getUTCFullYear() });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const { rows, errors, warnings } = parsed;
    const marked = new Set(rows.map((r) => r.quarter).filter((x): x is number => x != null));
    // Файлда бірнеше тоқсан белгіленсе — әрқайсысы өз тоқсанына; әйтпесе барлығы таңдалған тоқсанға.
    const split = dto.splitQuarters !== false && marked.size >= 2;
    const buckets = new Map<number, PlanRow[]>();
    for (const r of rows) {
      const qn = split ? (r.quarter ?? quarter.number) : quarter.number;
      if (!year.quarters.some((x) => x.number === qn)) {
        warnings.push({ row: r.row, message: `${qn}-тоқсан оқу жылында жоқ, жол өткізілді` });
        continue;
      }
      buckets.set(qn, [...(buckets.get(qn) ?? []), r]);
    }
    const gid = group?.id ?? null;
    const existing = await this.prisma.planLesson.groupBy({ by: ['quarterId'], where: { classId: dto.classId, subjectId: dto.subjectId, groupId: gid }, _count: true });
    const plan = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([qn, list]) => {
        const qq = year.quarters.find((x) => x.number === qn)!;
        const lessons: LessonData[] = list.map((r) => ({ section: r.section, topic: r.topic, objectives: r.objectives, hours: r.hours, date: r.date, notes: r.notes }));
        this.check(lessons, qq, warnings, list.map((r) => r.row));
        if (lessons.length > 300) errors.push({ row: 0, message: `${qn}-тоқсанда ${lessons.length} сабақ — 300-ден аспауы керек` });
        return { quarter: qq, lessons, existing: existing.find((e) => e.quarterId === qq.id)?._count ?? 0 };
      });
    const summary = {
      sheet: parsed.sheet,
      split,
      total: rows.length,
      hours: rows.reduce((a, r) => a + r.hours, 0),
      dated: rows.filter((r) => r.date).length,
      quarters: plan.map((p) => ({ id: p.quarter.id, number: p.quarter.number, lessons: p.lessons.length, hours: p.lessons.reduce((a, l) => a + l.hours, 0), existing: p.existing })),
      sample: plan.flatMap((p) => p.lessons.slice(0, 8).map((l) => ({ quarter: p.quarter.number, ...l }))).slice(0, 12),
      errors,
      warnings: warnings.slice(0, 200),
    };
    if (!dto.apply || errors.length) return { applied: false, ...summary };
    await this.prisma.$transaction(async (tx) => {
      for (const p of plan) await this.replace(tx, user, dto, gid, p.quarter.id, p.lessons);
      await this.audit.record(
        user,
        {
          action: 'КТЖ импорттады',
          entity: 'plan',
          entityId: `${dto.classId}:${dto.subjectId}`,
          summary: `${this.label(cls, subject, group)} · Excel`,
          after: plan.map((p) => `${p.quarter.number}-тоқсан: ${p.lessons.length} сабақ`).join('; '),
        },
        meta,
        tx,
      );
    });
    return { applied: true, ...summary };
  }

  /** Жоспарды басқа сыныптарға (параллельге) көшіру. Мақсаттағы тоқсан жоспары ауыстырылады. */
  async copy(user: AuthUser, dto: CopyPlanInput, meta: RequestMeta) {
    const { cls, subject, quarter, year, group } = await this.context(user, dto);
    const quarterIds = dto.allQuarters ? year.quarters.map((x) => x.id) : [quarter.id];
    const src = await this.prisma.planLesson.findMany({ where: this.where(dto, group?.id ?? null, quarterIds), orderBy: [{ order: 'asc' }, { id: 'asc' }] });
    if (!src.length) throw new BadRequestException('Көшіретін жоспар жоқ');
    const numberOf = new Map(year.quarters.map((x) => [x.id, x.number]));
    const done: string[] = [];
    const targets: { q: PlanQuery; label: string; gid: number | null; quarters: Quarter[] }[] = [];
    for (const t of dto.targets) {
      const tq: PlanQuery = { classId: t.classId, subjectId: dto.subjectId, quarterId: quarter.id, groupId: t.groupId ?? null };
      if (t.classId === dto.classId && (t.groupId ?? null) === (group?.id ?? null)) continue;
      const tc = await this.scope.assertClass(user, t.classId);
      await this.scope.assertTeaches(user, t.classId, dto.subjectId);
      const tg = await this.scope.resolveGroup(user, t.classId, dto.subjectId, t.groupId, true);
      const quarters = tc.schoolYearId === year.id ? year.quarters : await this.prisma.quarter.findMany({ where: { schoolYearId: tc.schoolYearId } });
      targets.push({ q: tq, label: `${tc.name}${tg ? ` (${tg.name})` : ''}`, gid: tg?.id ?? null, quarters });
    }
    if (!targets.length) throw new BadRequestException('Көшіретін сынып таңдалмады');
    await this.prisma.$transaction(async (tx) => {
      for (const t of targets) {
        for (const qid of quarterIds) {
          const tq = t.quarters.find((x) => x.number === numberOf.get(qid));
          if (!tq) continue;
          const lessons = src
            .filter((l) => l.quarterId === qid)
            .map((l) => ({ section: l.section, topic: l.topic, objectives: l.objectives, hours: l.hours, date: dto.withDates ? fmtDate(l.date) : null, notes: l.notes }));
          if (!lessons.length) continue;
          this.check(lessons, tq, []);
          await this.replace(tx, user, t.q, t.gid, tq.id, lessons);
        }
        done.push(t.label);
      }
      await this.audit.record(
        user,
        { action: 'КТЖ көшірді', entity: 'plan', entityId: `${dto.classId}:${dto.subjectId}`, summary: `${this.label(cls, subject, group)} → ${done.join(', ')}`, after: dto.allQuarters ? 'барлық тоқсан' : `${quarter.number}-тоқсан` },
        meta,
        tx,
      );
    });
    return { copied: done, lessons: src.length };
  }

  /** Жоспардағы күндер бойынша журналға бағандар (сабақтар) қосу; тақырыбы бос бағандарға тақырып жазу. */
  async toJournal(user: AuthUser, dto: PlanToJournalInput, meta: RequestMeta) {
    const { cls, subject, quarter, group } = await this.writable(user, dto);
    const gid = group?.id ?? null;
    const today = todayStr();
    const lessons = await this.prisma.planLesson.findMany({ where: { ...this.where(dto, gid), date: { not: null } }, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
    const topics = new Map<string, string[]>();
    for (const l of lessons) {
      const d = fmtDate(l.date)!;
      if (dto.untilToday !== false && d > today) continue;
      topics.set(d, [...(topics.get(d) ?? []), l.topic]);
    }
    if (!topics.size) throw new BadRequestException(dto.untilToday !== false ? 'Бүгінге дейін күні қойылған сабақ жоқ' : 'Жоспарда күні қойылған сабақ жоқ');
    const colWhere = { classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId, ...(group ? { OR: [{ groupId: group.id }, { groupId: null }] } : {}) };
    const columns = await this.prisma.gradeColumn.findMany({ where: colWhere, select: { id: true, date: true, topic: true, groupId: true } });
    const own = await this.prisma.gradeColumn.count({ where: { classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId, groupId: gid } });
    const byDate = new Map(columns.map((c) => [fmtDate(c.date)!, c]));
    const join = (list: string[]) => {
      const t = list.join('; ');
      return t.length > TOPIC_MAX ? t.slice(0, TOPIC_MAX - 1).trimEnd() + '…' : t;
    };
    const create: { date: string; topic: string }[] = [];
    const update: { id: number; topic: string }[] = [];
    for (const [d, list] of topics) {
      const c = byDate.get(d);
      if (!c) create.push({ date: d, topic: join(list) });
      else if (!c.topic && (c.groupId ?? null) === gid) update.push({ id: c.id, topic: join(list) });
    }
    if (own + create.length > 120) throw new BadRequestException('Бір тоқсанға 120-дан артық баған қосуға болмайды');
    await this.prisma.$transaction(async (tx) => {
      if (create.length) {
        await tx.gradeColumn.createMany({
          data: create.map((c) => ({ schoolId: user.schoolId, classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId, groupId: gid, teacherId: user.teacherId, date: toDate(c.date), topic: c.topic })),
        });
      }
      for (const u of update) await tx.gradeColumn.update({ where: { id: u.id }, data: { topic: u.topic } });
      if (create.length || update.length) {
        await this.audit.record(
          user,
          { action: 'КТЖ-дан журналға бағандар қосты', entity: 'journal', entityId: `${dto.classId}:${dto.subjectId}:${dto.quarterId}`, summary: `${this.label(cls, subject, group)} · ${quarter.number}-тоқсан`, after: `${create.length} жаңа баған, ${update.length} тақырып` },
          meta,
          tx,
        );
      }
    });
    if (create.length) await this.cache.bump(user.schoolId);
    return { created: create.length, updated: update.length };
  }
}
