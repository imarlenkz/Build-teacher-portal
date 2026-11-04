import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser } from '../../common/auth-user';
import { ScopeService } from '../core/scope.service';
import { fmtDate, minDate, QUARTER_ROMAN, todayStr, toDate } from '../../common/utils/dates';
import { markStats, MarkStats, round1 } from '../../common/utils/stats';
import { yearMark } from '../../common/utils/grades';

export interface SubjectAnalysisQuery {
  schoolYearId?: number;
  /** Тоқсан id; 0 — жылдық бағалар; бос — бағасы бар соңғы тоқсан. */
  quarterId?: number;
  /** Параллель (2–11). */
  grade?: number;
  classId?: number;
  /** Пән таңдалса — сыныптар бойынша толық талдау қосылады. */
  subjectId?: number;
}

interface MarkRow {
  quarter_id: number;
  class_id: number;
  subject_id: number;
  student_id: number;
  mark: number;
}

type Avg = { bjbAvg: number | null; tjbAvg: number | null };

/**
 * Пәндер бойынша жалпы талдау: тоқсандық (немесе жылдық) бағалар негізінде сапа, үлгерім,
 * 5/4/3/2 саны, орташа баға, СОУ; қосымша БЖБ/ТЖБ орташа пайызы. 1-сынып бағаланбайды.
 */
@Injectable()
export class SubjectAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly cache: CacheService,
  ) {}

  async build(user: AuthUser, q: SubjectAnalysisQuery) {
    const year = q.schoolYearId
      ? await this.prisma.schoolYear.findFirst({ where: { id: q.schoolYearId, schoolId: user.schoolId }, include: { quarters: { orderBy: { number: 'asc' } } } })
      : await this.scope.currentYear(user.schoolId);
    if (!year) throw new NotFoundException('Оқу жылы табылмады');
    if (q.classId) await this.scope.assertClass(user, q.classId);
    const ids = q.classId ? [q.classId] : await this.scope.classIds(user, year.id);
    const h = createHash('sha1').update(JSON.stringify([q, year.id, ids])).digest('hex').slice(0, 16);
    return this.cache.wrap(user.schoolId, `an:subjects:${h}`, 300, () => this.compute(user.schoolId, year, ids, q));
  }

  /** Бағасы бар, басталған соңғы тоқсан; ондай болмаса — ағымдағы тоқсан. */
  private defaultQuarter(raw: { id: number; startDate: Date; endDate: Date }[], qs: { id: number; hasMarks: boolean }[]) {
    const today = todayStr();
    const started = raw.filter((x) => fmtDate(x.startDate)! <= today).map((x) => x.id);
    return (
      [...qs].reverse().find((x) => x.hasMarks && started.includes(x.id))?.id ??
      [...qs].reverse().find((x) => x.hasMarks)?.id ??
      raw.find((x) => fmtDate(x.startDate)! <= today && today <= fmtDate(x.endDate)!)?.id ??
      qs[0].id
    );
  }

  private async compute(schoolId: number, year: { id: number; name: string; startDate: Date; endDate: Date; quarters: { id: number; number: number; startDate: Date; endDate: Date }[] }, ids: number[] | null, q: SubjectAnalysisQuery) {
    const quarterIds = year.quarters.map((x) => x.id);
    const classFilter = ids == null ? Prisma.empty : ids.length ? Prisma.sql`AND c.id IN (${Prisma.join(ids)})` : Prisma.sql`AND FALSE`;
    const gradeFilter = q.grade ? Prisma.sql`AND c.grade = ${q.grade}` : Prisma.empty;
    const classes = await this.prisma.$queryRaw<{ id: number; name: string; grade: number; letter: string }[]>`
      SELECT c.id, c.name, c.grade, c.letter FROM classes c
      WHERE c.school_id = ${schoolId} AND c.school_year_id = ${year.id} AND c.grade >= 2 ${classFilter} ${gradeFilter}
      ORDER BY c.grade, c.letter`;
    const classIds = classes.map((c) => c.id);
    const quarters = year.quarters.map((x) => ({ id: x.id, number: x.number, label: `${QUARTER_ROMAN[x.number - 1]} тоқсан`, hasMarks: false }));
    const empty = { schoolYearId: year.id, yearName: year.name, quarters, quarterId: q.quarterId ?? null, periodLabel: '', totals: { ...markStats([]), bjbAvg: null, tjbAvg: null, attendancePct: null }, subjects: [], detail: null };
    if (!classIds.length || !quarterIds.length) return empty;

    const marks = await this.prisma.$queryRaw<MarkRow[]>`
      SELECT g.quarter_id, g.class_id, g.subject_id, g.student_id, g.mark
      FROM quarter_grades g JOIN students st ON st.id = g.student_id AND st.deleted_at IS NULL
      WHERE g.school_id = ${schoolId} AND g.quarter_id IN (${Prisma.join(quarterIds)}) AND g.class_id IN (${Prisma.join(classIds)})`;
    for (const x of quarters) x.hasMarks = marks.some((m) => m.quarter_id === x.id);

    // Кезең: нақты тоқсан, жылдық (0) немесе бағасы бар соңғы тоқсан.
    const quarterId = q.quarterId === 0 ? 0 : (q.quarterId ?? this.defaultQuarter(year.quarters, quarters));
    const isYear = quarterId === 0;
    const periodLabel = isYear ? 'Жылдық' : (quarters.find((x) => x.id === quarterId)?.label ?? '');

    /** Кезеңдегі бағалар: тоқсан бойынша — сол тоқсан; жылдық — оқушының қойылған тоқсандық бағаларының орташасы. */
    const periodMarks = (rows: MarkRow[]): MarkRow[] => {
      if (!isYear) return rows.filter((r) => r.quarter_id === quarterId);
      const by = new Map<string, MarkRow[]>();
      for (const r of rows) {
        const k = `${r.class_id}:${r.subject_id}:${r.student_id}`;
        by.set(k, [...(by.get(k) ?? []), r]);
      }
      return [...by.values()].map((list) => ({ ...list[0], quarter_id: 0, mark: yearMark(list.map((x) => x.mark))! }));
    };
    const pm = periodMarks(marks);

    // БЖБ/ТЖБ орташа пайызы (2–4 сыныптардың аралық бағалауы ТЖБ орнында).
    const aQuarters = isYear ? quarterIds : [quarterId];
    const assess = await this.prisma.$queryRaw<{ class_id: number; subject_id: number; type: 'BJB' | 'TJB'; pct: number; n: bigint }[]>`
      SELECT a.class_id, a.subject_id, (CASE WHEN a.type = 'ARALYK' THEN 'TJB' ELSE a.type::text END) AS type, avg(r.percent)::float pct, count(*) n
      FROM assessment_results r JOIN assessments a ON a.id = r.assessment_id
      JOIN students st ON st.id = r.student_id AND st.deleted_at IS NULL
      WHERE a.school_id = ${schoolId} AND a.quarter_id IN (${Prisma.join(aQuarters)}) AND a.class_id IN (${Prisma.join(classIds)}) AND NOT r.absent
      GROUP BY 1, 2, 3`;
    const assessAvg = (pred: (r: (typeof assess)[number]) => boolean): Avg => {
      const pick = (t: 'BJB' | 'TJB') => {
        const rs = assess.filter((r) => r.type === t && pred(r));
        const n = rs.reduce((s, r) => s + Number(r.n), 0);
        return n ? round1(rs.reduce((s, r) => s + r.pct * Number(r.n), 0) / n) : null;
      };
      return { bjbAvg: pick('BJB'), tjbAvg: pick('TJB') };
    };

    // Қатысу: кезең ішіндегі сабақтар (бүгінге дейін).
    const pq = year.quarters.find((x) => x.id === quarterId);
    const from = fmtDate(isYear || !pq ? year.startDate : pq.startDate)!;
    const to = minDate(todayStr(), fmtDate(isYear || !pq ? year.endDate : pq.endDate)!);
    const att =
      from <= to
        ? await this.prisma.$queryRaw<{ class_id: number; subject_id: number; total: bigint; present: bigint }[]>`
      SELECT l.class_id, l.subject_id, count(*) total, count(*) FILTER (WHERE a.status IN ('P','K')) present
      FROM attendance a JOIN lessons l ON l.id = a.lesson_id
      WHERE a.school_id = ${schoolId} AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)} AND l.class_id IN (${Prisma.join(classIds)})
      GROUP BY 1, 2`
        : [];
    const attPct = (pred: (r: (typeof att)[number]) => boolean) => {
      const rs = att.filter(pred);
      const t = rs.reduce((s, r) => s + Number(r.total), 0);
      return t ? round1((rs.reduce((s, r) => s + Number(r.present), 0) / t) * 100) : null;
    };

    const subjectIds = [...new Set([...pm.map((r) => r.subject_id), ...assess.map((r) => r.subject_id)])];
    const subjects = await this.prisma.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true } });
    const nameOf = new Map(subjects.map((s) => [s.id, s.name]));

    const subjectRows = subjectIds
      .map((sid) => {
        const rows = pm.filter((r) => r.subject_id === sid);
        const trend = quarters.map((x) => {
          const st = markStats(marks.filter((r) => r.subject_id === sid && r.quarter_id === x.id).map((r) => r.mark));
          return { quarterId: x.id, label: x.label, quality: st.quality, progress: st.progress, avgMark: st.avgMark };
        });
        return {
          subjectId: sid,
          name: nameOf.get(sid) ?? '—',
          classes: new Set(rows.map((r) => r.class_id)).size,
          ...markStats(rows.map((r) => r.mark)),
          ...assessAvg((r) => r.subject_id === sid),
          attendancePct: attPct((r) => r.subject_id === sid),
          trend,
        };
      })
      .filter((s) => s.count > 0 || s.bjbAvg != null || s.tjbAvg != null)
      .sort((a, b) => a.name.localeCompare(b.name, 'kk'));

    let detail = null;
    if (q.subjectId) {
      const sid = q.subjectId;
      const [assignments, groups, failing] = await Promise.all([
        this.prisma.teachingAssignment.findMany({ where: { subjectId: sid, classId: { in: classIds } }, select: { classId: true, teacher: { select: { user: { select: { fullName: true } } } } } }),
        this.prisma.subjectGroup.findMany({ where: { subjectId: sid, classId: { in: classIds } }, select: { classId: true, teacher: { select: { user: { select: { fullName: true } } } } }, orderBy: { order: 'asc' } }),
        this.prisma.student.findMany({
          where: { id: { in: pm.filter((r) => r.subject_id === sid && r.mark <= 2).map((r) => r.student_id) } },
          select: { id: true, fullName: true },
        }),
      ]);
      const teacherOf = (cid: number) => {
        const g = [...new Set(groups.filter((x) => x.classId === cid && x.teacher).map((x) => x.teacher!.user.fullName))];
        return g.length ? g.join(', ') : (assignments.find((a) => a.classId === cid)?.teacher.user.fullName ?? null);
      };
      const prevQ = !isYear ? quarters.find((x) => x.number === (quarters.find((y) => y.id === quarterId)?.number ?? 0) - 1) : undefined;
      const byClass = classes
        .map((c) => {
          const st = markStats(pm.filter((r) => r.subject_id === sid && r.class_id === c.id).map((r) => r.mark));
          const prev = prevQ ? markStats(marks.filter((r) => r.subject_id === sid && r.class_id === c.id && r.quarter_id === prevQ.id).map((r) => r.mark)) : null;
          return { classId: c.id, className: c.name, grade: c.grade, teacher: teacherOf(c.id), ...st, ...assessAvg((r) => r.subject_id === sid && r.class_id === c.id), attendancePct: attPct((r) => r.subject_id === sid && r.class_id === c.id), prevQuality: prev?.quality ?? null };
        })
        .filter((r) => r.count > 0 || r.bjbAvg != null || r.tjbAvg != null);
      const grades = [...new Set(byClass.map((r) => r.grade))].sort((a, b) => a - b);
      const byGrade = grades.map((g) => {
        const cids = new Set(classes.filter((c) => c.grade === g).map((c) => c.id));
        return { grade: g, ...markStats(pm.filter((r) => r.subject_id === sid && cids.has(r.class_id)).map((r) => r.mark)), ...assessAvg((r) => r.subject_id === sid && cids.has(r.class_id)) };
      });
      const cname = new Map(classes.map((c) => [c.id, c.name]));
      const failingRows = pm
        .filter((r) => r.subject_id === sid && r.mark <= 2)
        .map((r) => ({ studentId: r.student_id, fullName: failing.find((s) => s.id === r.student_id)?.fullName ?? '—', className: cname.get(r.class_id) ?? '' }))
        .sort((a, b) => a.className.localeCompare(b.className, 'kk') || a.fullName.localeCompare(b.fullName, 'kk'));
      detail = { subjectId: sid, name: nameOf.get(sid) ?? (await this.prisma.subject.findUnique({ where: { id: sid } }))?.name ?? '—', prevLabel: prevQ?.label ?? null, byClass, byGrade, failing: failingRows };
    }

    return {
      schoolYearId: year.id,
      yearName: year.name,
      quarters,
      quarterId,
      periodLabel,
      totals: { ...(markStats(pm.map((r) => r.mark)) as MarkStats), ...assessAvg(() => true), attendancePct: attPct(() => true) },
      subjects: subjectRows,
      detail,
    };
  }
}
