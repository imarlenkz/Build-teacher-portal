import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Quarter, SchoolYear } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ScopeService } from '../core/scope.service';
import { LevelsService } from '../core/levels.service';
import { INSIGHTS_PROVIDER, InsightsProvider } from '../insights/insights';
import { IN_TYPES, OUT_TYPES } from '../movements/movements.module';
import { addDays, endOfMonth, fmtDate, MONTHS_KK_SHORT, maxDate, minDate, QUARTER_ROMAN, startOfMonth, startOfWeek, todayStr, toDate, weekday } from '../../common/utils/dates';
import { avg, levelIndex, Level, round1, scoreStats } from '../../common/utils/stats';

export type Period = 'today' | 'week' | 'month' | 'quarter' | 'year';
type YearQ = SchoolYear & { quarters: Quarter[] };

interface ScopeSel {
  classIds: number[] | null;
  subjectId?: number;
}

const WD_SHORT = ['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб', 'Жс'];

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly levels: LevelsService,
    private readonly cache: CacheService,
    @Inject(INSIGHTS_PROVIDER) private readonly insights: InsightsProvider,
  ) {}

  private key(user: AuthUser, name: string, extra: unknown, ids: number[] | null) {
    const h = createHash('sha1').update(JSON.stringify([name, extra, ids, user.permissions.includes(P.NATIONALITY_VIEW)])).digest('hex').slice(0, 16);
    return `an:${name}:${h}`;
  }

  currentQuarter(year: YearQ, today = todayStr()) {
    return (
      year.quarters.find((q) => fmtDate(q.startDate)! <= today && today <= fmtDate(q.endDate)!) ??
      [...year.quarters].sort((a, b) => a.number - b.number).filter((q) => fmtDate(q.startDate)! <= today).pop() ??
      year.quarters[0]
    );
  }

  private classFilter(alias: string, s: ScopeSel) {
    if (!s.classIds) return Prisma.empty;
    if (!s.classIds.length) return Prisma.sql`AND FALSE`;
    return Prisma.sql`AND ${Prisma.raw(alias)}.class_id IN (${Prisma.join(s.classIds)})`;
  }

  private subjectFilter(alias: string, s: ScopeSel) {
    return s.subjectId ? Prisma.sql`AND ${Prisma.raw(alias)}.subject_id = ${s.subjectId}` : Prisma.empty;
  }

  /** Қатысу агрегаты берілген аралық үшін. */
  async attendanceAgg(schoolId: number, s: ScopeSel, from: string, to: string) {
    const r = await this.prisma.$queryRaw<{ total: bigint; p: bigint; n: bigint; s: bigint; a: bigint; k: bigint; o: bigint }[]>`
      SELECT count(*) total,
        count(*) FILTER (WHERE a.status = 'P') p, count(*) FILTER (WHERE a.status = 'N') n,
        count(*) FILTER (WHERE a.status = 'S') s, count(*) FILTER (WHERE a.status = 'A') a,
        count(*) FILTER (WHERE a.status = 'K') k, count(*) FILTER (WHERE a.status = 'O') o
      FROM attendance a JOIN lessons l ON l.id = a.lesson_id
      WHERE a.school_id = ${schoolId} AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)}
      ${this.classFilter('l', s)} ${this.subjectFilter('l', s)}`;
    const x = r[0];
    const total = Number(x.total);
    const present = Number(x.p) + Number(x.k);
    return {
      total,
      present,
      absent: total - present,
      excused: Number(x.s) + Number(x.a) + Number(x.o),
      sick: Number(x.a),
      unexcused: Number(x.n),
      late: Number(x.k),
      pct: total ? round1((present / total) * 100) : null,
    };
  }

  /** Оқушы × тоқсан × түр бойынша орташа пайыз. 2–4 сыныптардың аралық бағалауы жиынтық (ТЖБ) ретінде есептеледі. */
  private async assessmentRows(schoolId: number, s: ScopeSel, quarterIds: number[]) {
    if (!quarterIds.length) return [];
    return this.prisma.$queryRaw<{ student_id: number; quarter_id: number; type: 'BJB' | 'TJB'; pct: number }[]>`
      SELECT r.student_id, a.quarter_id, (CASE WHEN a.type = 'ARALYK' THEN 'TJB' ELSE a.type::text END) AS type, avg(r.percent)::float pct
      FROM assessment_results r JOIN assessments a ON a.id = r.assessment_id
      JOIN students st ON st.id = r.student_id AND st.deleted_at IS NULL
      WHERE a.school_id = ${schoolId} AND a.quarter_id IN (${Prisma.join(quarterIds)}) AND NOT r.absent
      ${this.classFilter('a', s)} ${this.subjectFilter('a', s)}
      GROUP BY 1, 2, 3`;
  }

  private quarterStats(rows: { quarter_id: number; type: string; pct: number }[], quarters: Quarter[], lv: Level[]) {
    return [...quarters]
      .sort((a, b) => a.number - b.number)
      .map((q) => {
        const t = rows.filter((r) => r.quarter_id === q.id && r.type === 'TJB').map((r) => ({ score: r.pct, pct: r.pct }));
        const b = rows.filter((r) => r.quarter_id === q.id && r.type === 'BJB').map((r) => ({ score: r.pct, pct: r.pct }));
        const both = [...t, ...b];
        const ts = scoreStats(t, lv);
        const bs = scoreStats(b, lv);
        const all = scoreStats(both, lv);
        return {
          quarterId: q.id,
          number: q.number,
          label: `${QUARTER_ROMAN[q.number - 1]} тоқсан`,
          tjbAvg: t.length ? ts.avgPct : null,
          bjbAvg: b.length ? bs.avgPct : null,
          quality: t.length ? ts.quality : b.length ? bs.quality : null,
          progress: t.length ? ts.progress : b.length ? bs.progress : null,
          avgPct: both.length ? all.avgPct : null,
          tjbCount: t.length,
          bjbCount: b.length,
        };
      });
  }

  private periodRange(period: Period, year: YearQ, today: string) {
    const q = this.currentQuarter(year, today);
    const yStart = fmtDate(year.startDate)!;
    switch (period) {
      case 'today':
        return { from: today, to: today };
      case 'week':
        return { from: maxDate(startOfWeek(today), yStart), to: today };
      case 'month':
        return { from: maxDate(startOfMonth(today), yStart), to: today };
      case 'quarter':
        return { from: fmtDate(q.startDate)!, to: minDate(today, fmtDate(q.endDate)!) };
      default:
        return { from: yStart, to: minDate(today, fmtDate(year.endDate)!) };
    }
  }

  /** Қатысу динамикасы: кезеңге сай топтау (сабақ / күн / апта / ай). */
  private async attendanceSeries(schoolId: number, s: ScopeSel, period: Period, from: string, to: string) {
    const groupExpr =
      period === 'today'
        ? Prisma.sql`l.period::text`
        : period === 'week' || period === 'month'
          ? Prisma.sql`to_char(a.date, 'YYYY-MM-DD')`
          : period === 'quarter'
            ? Prisma.sql`to_char(date_trunc('week', a.date), 'YYYY-MM-DD')`
            : Prisma.sql`to_char(a.date, 'YYYY-MM')`;
    const rows = await this.prisma.$queryRaw<{ g: string; total: bigint; present: bigint }[]>`
      SELECT ${groupExpr} g, count(*) total, count(*) FILTER (WHERE a.status IN ('P','K')) present
      FROM attendance a JOIN lessons l ON l.id = a.lesson_id
      WHERE a.school_id = ${schoolId} AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)}
      ${this.classFilter('l', s)} ${this.subjectFilter('l', s)}
      GROUP BY 1 ORDER BY 1`;
    return rows.map((r, i) => {
      let label = r.g;
      if (period === 'today') label = `${r.g}-сабақ`;
      else if (period === 'week') label = WD_SHORT[weekday(r.g) - 1];
      else if (period === 'month') label = r.g.slice(8);
      else if (period === 'quarter') label = `${i + 1}-апта`;
      else label = MONTHS_KK_SHORT[Number(r.g.slice(5, 7)) - 1];
      return { key: r.g, label, pct: round1((Number(r.present) / Number(r.total)) * 100), total: Number(r.total) };
    });
  }

  async dashboard(user: AuthUser, period: Period) {
    const year = (await this.scope.currentYear(user.schoolId)) as YearQ;
    const ids = await this.scope.classIds(user, year.id);
    const today = todayStr();
    return this.cache.wrap(user.schoolId, this.key(user, 'dash', [period, today, year.id], ids), 120, () => this.computeDashboard(user, year, ids, period, today));
  }

  private async computeDashboard(user: AuthUser, year: YearQ, ids: number[] | null, period: Period, today: string) {
    const s: ScopeSel = { classIds: ids };
    const lv = await this.levels.get(user.schoolId);
    const settings = await this.levels.settings(user.schoolId);
    const q = this.currentQuarter(year, today);
    const range = this.periodRange(period, year, today);
    const canNat = user.permissions.includes(P.NATIONALITY_VIEW);
    const studentWhere: Prisma.StudentWhereInput = {
      schoolId: user.schoolId,
      status: 'ACTIVE',
      deletedAt: null,
      class: { schoolYearId: year.id },
      ...(ids ? { classId: { in: ids } } : {}),
    };

    const [genders, classCount, att, attToday, series, movements, aRows, nat] = await Promise.all([
      this.prisma.student.groupBy({ by: ['gender'], where: studentWhere, _count: true }),
      ids ? Promise.resolve(ids.length) : this.prisma.class.count({ where: { schoolId: user.schoolId, schoolYearId: year.id } }),
      this.attendanceAgg(user.schoolId, s, range.from, range.to),
      this.attendanceAgg(user.schoolId, s, today, today),
      this.attendanceSeries(user.schoolId, s, period, range.from, range.to),
      this.prisma.studentMovement.findMany({
        where: {
          schoolId: user.schoolId,
          date: { gte: year.startDate, lte: year.endDate },
          ...(ids ? { OR: [{ fromClassId: { in: ids } }, { toClassId: { in: ids } }] } : {}),
        },
        select: { type: true, date: true, fromClassId: true, toClassId: true },
      }),
      this.assessmentRows(user.schoolId, s, year.quarters.map((x) => x.id)),
      canNat
        ? this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
            SELECT coalesce(n.name, 'Көрсетілмеген') name, count(*) count
            FROM students st JOIN classes c ON c.id = st.class_id LEFT JOIN nationalities n ON n.id = st.nationality_id
            WHERE st.school_id = ${user.schoolId} AND st.status = 'ACTIVE' AND st.deleted_at IS NULL AND c.school_year_id = ${year.id}
            ${ids ? (ids.length ? Prisma.sql`AND st.class_id IN (${Prisma.join(ids)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
            GROUP BY 1 ORDER BY 2 DESC`
        : Promise.resolve(null),
    ]);
    const boys = genders.find((g) => g.gender === 'M')?._count ?? 0;
    const girls = genders.find((g) => g.gender === 'F')?._count ?? 0;
    const total = boys + girls;

    const qFrom = fmtDate(q.startDate)!;
    const qTo = fmtDate(q.endDate)!;
    const inQ = movements.filter((m) => fmtDate(m.date)! >= qFrom && fmtDate(m.date)! <= qTo);
    const inScope = (cid: number | null) => cid != null && (!ids || ids.includes(cid));
    const arrived = (list: typeof movements) => list.filter((m) => (IN_TYPES.includes(m.type) || m.type === 'TRANSFERRED_CLASS') && inScope(m.toClassId) && (m.type !== 'TRANSFERRED_CLASS' || !inScope(m.fromClassId))).length;
    const left = (list: typeof movements) => list.filter((m) => (OUT_TYPES.includes(m.type) || m.type === 'TRANSFERRED_CLASS') && inScope(m.fromClassId) && (m.type !== 'TRANSFERRED_CLASS' || !inScope(m.toClassId))).length;

    // Айлар бойынша оқушы саны: қазіргі саннан кейінгі қозғалыстарды кері есептеу.
    const months: string[] = [];
    for (let m = startOfMonth(fmtDate(year.startDate)!); m <= minDate(today, fmtDate(year.endDate)!); m = addDays(endOfMonth(m), 1)) months.push(m);
    const studentsByMonth = months.map((m) => {
      const end = endOfMonth(m);
      let n = total;
      movements.forEach((mv) => {
        if (fmtDate(mv.date)! <= end) return;
        if (inScope(mv.toClassId)) n--;
        if (inScope(mv.fromClassId)) n++;
      });
      return { month: m.slice(0, 7), label: MONTHS_KK_SHORT[Number(m.slice(5, 7)) - 1], count: n };
    });
    const movementByMonth = months.map((m) => {
      const list = movements.filter((mv) => fmtDate(mv.date)!.slice(0, 7) === m.slice(0, 7));
      return { month: m.slice(0, 7), label: MONTHS_KK_SHORT[Number(m.slice(5, 7)) - 1], arrived: arrived(list), left: left(list), transferred: list.filter((x) => x.type === 'TRANSFERRED_CLASS').length };
    });

    const qstats = this.quarterStats(aRows, year.quarters, lv);
    // Алдыңғы оқу жылының IV тоқсаны салыстыру үшін.
    const prevYear = await this.prisma.schoolYear.findFirst({
      where: { schoolId: user.schoolId, startDate: { lt: year.startDate } },
      orderBy: { startDate: 'desc' },
      include: { quarters: true },
    });
    let prevQ: ReturnType<AnalyticsService['quarterStats']> = [];
    if (prevYear) {
      // Мұғалімнің өткен жылғы сыныптары басқа ID-мен сақталады — сондықтан мектеп деңгейінде немесе сынып атауымен салыстырамыз.
      const prevIds = ids ? (await this.scope.classIds(user, prevYear.id)) : null;
      const pr = await this.assessmentRows(user.schoolId, { classIds: prevIds }, prevYear.quarters.map((x) => x.id));
      prevQ = this.quarterStats(pr, prevYear.quarters, lv).map((x) => ({ ...x, label: `${prevYear.name.slice(2, 4)}–${prevYear.name.slice(7, 9)} · ${QUARTER_ROMAN[x.number - 1]}` }));
    }
    const curQ = qstats.find((x) => x.quarterId === q.id)!;

    // Қатысуы төмен оқушылар (оқу жылы бойынша).
    const low = await this.lowAttendance(user.schoolId, s, fmtDate(year.startDate)!, minDate(today, fmtDate(year.endDate)!), settings.attendanceThreshold, 50);

    // Бүгінгі белгіленбеген сабақтар (мұғалім үшін «Келесі әрекет»).
    return {
      period,
      range,
      today,
      quarter: { id: q.id, number: q.number },
      students: { total, boys, girls, classes: classCount },
      attendance: att,
      attendanceToday: attToday,
      attendanceSeries: series,
      movement: {
        quarter: {
          arrived: arrived(inQ),
          left: left(inQ),
          transferred: inQ.filter((m) => m.type === 'TRANSFERRED_CLASS').length,
          byType: ['ADMITTED', 'TRANSFERRED_CLASS', 'ARRIVED_FROM_SCHOOL', 'LEFT_TO_SCHOOL', 'EXPELLED', 'READMITTED'].map((t) => ({ code: t, count: inQ.filter((m) => m.type === t).length })),
        },
        byMonth: movementByMonth,
      },
      studentsByMonth,
      performance: {
        current: curQ,
        quarters: [...prevQ.filter((x) => x.number === 4 && (x.tjbAvg != null || x.bjbAvg != null)), ...qstats],
      },
      lowAttendance: low,
      attendanceThreshold: settings.attendanceThreshold,
      ...(nat ? { nationality: nat.map((n) => ({ name: n.name, count: Number(n.count) })) } : {}),
    };
  }

  async lowAttendance(schoolId: number, s: ScopeSel, from: string, to: string, threshold: number, limit = 100) {
    const rows = await this.prisma.$queryRaw<{ id: number; full_name: string; class_name: string; pct: number; total: bigint; n: bigint }[]>`
      SELECT st.id, st.full_name, c.name class_name,
        100.0 * count(*) FILTER (WHERE a.status IN ('P','K')) / count(*) pct, count(*) total,
        count(*) FILTER (WHERE a.status = 'N') n
      FROM attendance a JOIN students st ON st.id = a.student_id JOIN classes c ON c.id = st.class_id
      JOIN lessons l ON l.id = a.lesson_id
      WHERE a.school_id = ${schoolId} AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)}
        AND st.status = 'ACTIVE' AND st.deleted_at IS NULL
        ${s.classIds ? (s.classIds.length ? Prisma.sql`AND st.class_id IN (${Prisma.join(s.classIds)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
      GROUP BY st.id, c.name
      HAVING count(*) >= 5 AND 100.0 * count(*) FILTER (WHERE a.status IN ('P','K')) / count(*) < ${threshold}
      ORDER BY pct ASC LIMIT ${limit}`;
    return rows.map((r) => ({ id: r.id, fullName: r.full_name, className: r.class_name, pct: round1(Number(r.pct)), lessons: Number(r.total), unexcused: Number(r.n) }));
  }

  /** Аналитика бөлімі: сынып/оқушы/пән/ай/тоқсан бойынша қатысу. */
  async attendance(user: AuthUser, q: { schoolYearId?: number; classId?: number; studentId?: number; subjectId?: number }) {
    const year = (q.schoolYearId
      ? await this.prisma.schoolYear.findFirstOrThrow({ where: { id: q.schoolYearId, schoolId: user.schoolId }, include: { quarters: true } })
      : await this.scope.currentYear(user.schoolId)) as YearQ;
    const ids = await this.scope.classIds(user, year.id);
    if (q.classId) await this.scope.assertClass(user, q.classId);
    if (q.studentId) await this.scope.assertStudent(user, q.studentId);
    return this.cache.wrap(user.schoolId, this.key(user, 'att', [q, year.id, todayStr()], ids), 120, async () => {
      const today = todayStr();
      const from = fmtDate(year.startDate)!;
      const to = minDate(today, fmtDate(year.endDate)!);
      const s: ScopeSel = { classIds: q.classId ? [q.classId] : ids, subjectId: q.subjectId };
      const stu = q.studentId ? Prisma.sql`AND a.student_id = ${q.studentId}` : Prisma.empty;
      const byClass = await this.prisma.$queryRaw<{ id: number; name: string; total: bigint; present: bigint; s: bigint; n: bigint; k: bigint }[]>`
        SELECT c.id, c.name, count(a.id) total, count(a.id) FILTER (WHERE a.status IN ('P','K')) present,
          count(a.id) FILTER (WHERE a.status IN ('S','A','O')) s, count(a.id) FILTER (WHERE a.status = 'N') n, count(a.id) FILTER (WHERE a.status = 'K') k
        FROM classes c LEFT JOIN lessons l ON l.class_id = c.id ${q.subjectId ? Prisma.sql`AND l.subject_id = ${q.subjectId}` : Prisma.empty}
        LEFT JOIN attendance a ON a.lesson_id = l.id AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)}
        WHERE c.school_id = ${user.schoolId} AND c.school_year_id = ${year.id}
        ${ids ? (ids.length ? Prisma.sql`AND c.id IN (${Prisma.join(ids)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
        GROUP BY c.id ORDER BY c.grade, c.letter`;
      const bySubject = await this.prisma.$queryRaw<{ name: string; total: bigint; present: bigint }[]>`
        SELECT sub.name, count(*) total, count(*) FILTER (WHERE a.status IN ('P','K')) present
        FROM attendance a JOIN lessons l ON l.id = a.lesson_id JOIN subjects sub ON sub.id = l.subject_id
        WHERE a.school_id = ${user.schoolId} AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)} ${this.classFilter('l', s)} ${this.subjectFilter('l', s)} ${stu}
        GROUP BY 1 ORDER BY 1`;
      const byMonth = await this.prisma.$queryRaw<{ m: string; total: bigint; present: bigint; s: bigint; n: bigint }[]>`
        SELECT to_char(a.date, 'YYYY-MM') m, count(*) total, count(*) FILTER (WHERE a.status IN ('P','K')) present,
          count(*) FILTER (WHERE a.status IN ('S','A','O')) s, count(*) FILTER (WHERE a.status = 'N') n
        FROM attendance a JOIN lessons l ON l.id = a.lesson_id
        WHERE a.school_id = ${user.schoolId} AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)} ${this.classFilter('l', s)} ${this.subjectFilter('l', s)} ${stu}
        GROUP BY 1 ORDER BY 1`;
      const months: { month: string; label: string; pct: number | null; excused: number; unexcused: number }[] = [];
      for (let m = startOfMonth(fmtDate(year.startDate)!); m <= fmtDate(year.endDate)!; m = addDays(endOfMonth(m), 1)) {
        const r = byMonth.find((x) => x.m === m.slice(0, 7));
        months.push({
          month: m.slice(0, 7),
          label: MONTHS_KK_SHORT[Number(m.slice(5, 7)) - 1],
          pct: r ? round1((Number(r.present) / Number(r.total)) * 100) : null,
          excused: Number(r?.s ?? 0),
          unexcused: Number(r?.n ?? 0),
        });
      }
      const byQuarter = await Promise.all(
        [...year.quarters]
          .sort((a, b) => a.number - b.number)
          .map(async (qq) => {
            const qf = fmtDate(qq.startDate)!;
            const qt = minDate(fmtDate(qq.endDate)!, to);
            if (qf > to) return { number: qq.number, label: `${QUARTER_ROMAN[qq.number - 1]} тоқсан`, pct: null };
            const agg = q.studentId ? await this.studentAgg(q.studentId, qf, qt, q.subjectId) : await this.attendanceAgg(user.schoolId, s, qf, qt);
            return { number: qq.number, label: `${QUARTER_ROMAN[qq.number - 1]} тоқсан`, pct: agg.pct };
          }),
      );
      const yearAgg = q.studentId ? await this.studentAgg(q.studentId, from, to, q.subjectId) : await this.attendanceAgg(user.schoolId, s, from, to);
      return {
        schoolYearId: year.id,
        summary: yearAgg,
        byClass: byClass.map((r) => ({
          classId: r.id,
          className: r.name,
          pct: Number(r.total) ? round1((Number(r.present) / Number(r.total)) * 100) : null,
          lessons: Number(r.total),
          excused: Number(r.s),
          unexcused: Number(r.n),
          late: Number(r.k),
        })),
        bySubject: bySubject.map((r) => ({ subject: r.name, pct: round1((Number(r.present) / Number(r.total)) * 100), total: Number(r.total) })),
        byMonth: months,
        byQuarter,
      };
    });
  }

  private async studentAgg(studentId: number, from: string, to: string, subjectId?: number) {
    const r = await this.prisma.$queryRaw<{ total: bigint; present: bigint; s: bigint; a: bigint; n: bigint; k: bigint }[]>`
      SELECT count(*) total, count(*) FILTER (WHERE a.status IN ('P','K')) present, count(*) FILTER (WHERE a.status IN ('S','O')) s,
        count(*) FILTER (WHERE a.status = 'A') a, count(*) FILTER (WHERE a.status = 'N') n, count(*) FILTER (WHERE a.status = 'K') k
      FROM attendance a JOIN lessons l ON l.id = a.lesson_id
      WHERE a.student_id = ${studentId} AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)} ${subjectId ? Prisma.sql`AND l.subject_id = ${subjectId}` : Prisma.empty}`;
    const x = r[0];
    const total = Number(x.total);
    const present = Number(x.present);
    return {
      total,
      present,
      absent: total - present,
      excused: Number(x.s) + Number(x.a),
      sick: Number(x.a),
      unexcused: Number(x.n),
      late: Number(x.k),
      pct: total ? round1((present / total) * 100) : null,
    };
  }

  /** Оқу жылы бойынша I→IV тоқсан салыстыру. */
  async yearly(user: AuthUser, q: { schoolYearId?: number; classId?: number; subjectId?: number }) {
    const year = (q.schoolYearId
      ? await this.prisma.schoolYear.findFirstOrThrow({ where: { id: q.schoolYearId, schoolId: user.schoolId }, include: { quarters: true } })
      : await this.scope.currentYear(user.schoolId)) as YearQ;
    const ids = await this.scope.classIds(user, year.id);
    if (q.classId) await this.scope.assertClass(user, q.classId);
    return this.cache.wrap(user.schoolId, this.key(user, 'yearly', [q, year.id, todayStr()], ids), 300, async () => {
      const lv = await this.levels.get(user.schoolId);
      const s: ScopeSel = { classIds: q.classId ? [q.classId] : ids, subjectId: q.subjectId };
      const rows = await this.assessmentRows(user.schoolId, s, year.quarters.map((x) => x.id));
      const qs = this.quarterStats(rows, year.quarters, lv);
      const today = todayStr();
      const withAtt = await Promise.all(
        qs.map(async (x) => {
          const qq = year.quarters.find((y) => y.id === x.quarterId)!;
          const f = fmtDate(qq.startDate)!;
          const t = minDate(fmtDate(qq.endDate)!, today);
          const att = f <= t ? await this.attendanceAgg(user.schoolId, s, f, t) : null;
          return { ...x, attendancePct: att?.pct ?? null };
        }),
      );
      return { schoolYearId: year.id, name: year.name, quarters: withAtt };
    });
  }

  /** Ұлт бойынша статистика — тек рұқсаты бар рөлдерге (контроллерде тексеріледі). */
  async nationality(user: AuthUser, q: { classId?: number }) {
    const year = await this.scope.currentYear(user.schoolId);
    const rows = await this.prisma.$queryRaw<{ name: string; gender: string; class_name: string; count: bigint }[]>`
      SELECT coalesce(n.name, 'Көрсетілмеген') name, st.gender::text gender, c.name class_name, count(*) count
      FROM students st JOIN classes c ON c.id = st.class_id LEFT JOIN nationalities n ON n.id = st.nationality_id
      WHERE st.school_id = ${user.schoolId} AND st.status = 'ACTIVE' AND st.deleted_at IS NULL AND c.school_year_id = ${year.id}
      ${q.classId ? Prisma.sql`AND st.class_id = ${q.classId}` : Prisma.empty}
      GROUP BY 1, 2, 3`;
    const names = [...new Set(rows.map((r) => r.name))];
    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    const items = names
      .map((n) => {
        const list = rows.filter((r) => r.name === n);
        const count = list.reduce((s, r) => s + Number(r.count), 0);
        return {
          name: n,
          count,
          pct: total ? round1((count / total) * 100) : 0,
          boys: list.filter((r) => r.gender === 'M').reduce((s, r) => s + Number(r.count), 0),
          girls: list.filter((r) => r.gender === 'F').reduce((s, r) => s + Number(r.count), 0),
        };
      })
      .sort((a, b) => b.count - a.count);
    const classes = [...new Set(rows.map((r) => r.class_name))].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b, 'kk'));
    return {
      total,
      items,
      byClass: classes.map((c) => ({ className: c, ...Object.fromEntries(names.map((n) => [n, rows.filter((r) => r.class_name === c && r.name === n).reduce((s, r) => s + Number(r.count), 0)])) })),
      names,
    };
  }

  /** Тәуекел тобындағы оқушылар (InsightsProvider арқылы — кейін AI-мен ауыстыруға болады). */
  async risk(user: AuthUser, q: { classId?: number }) {
    const year = (await this.scope.currentYear(user.schoolId)) as YearQ;
    const ids = q.classId ? [q.classId] : await this.scope.classIds(user, year.id);
    if (q.classId) await this.scope.assertClass(user, q.classId);
    const today = todayStr();
    const quarter = this.currentQuarter(year, today);
    const lv = await this.levels.get(user.schoolId);
    const settings = await this.levels.settings(user.schoolId);
    const from = fmtDate(quarter.startDate)!;
    const to = minDate(today, fmtDate(quarter.endDate)!);
    const att = await this.prisma.$queryRaw<{ id: number; total: bigint; present: bigint; n: bigint }[]>`
      SELECT a.student_id id, count(*) total, count(*) FILTER (WHERE a.status IN ('P','K')) present, count(*) FILTER (WHERE a.status = 'N') n
      FROM attendance a JOIN lessons l ON l.id = a.lesson_id
      WHERE a.school_id = ${user.schoolId} AND a.date BETWEEN ${toDate(from)} AND ${toDate(to)} ${this.classFilter('l', { classIds: ids })}
      GROUP BY 1`;
    const ar = await this.assessmentRows(user.schoolId, { classIds: ids }, [quarter.id]);
    const students = await this.prisma.student.findMany({
      where: { schoolId: user.schoolId, status: 'ACTIVE', deletedAt: null, class: { schoolYearId: year.id }, ...(ids ? { classId: { in: ids } } : {}) },
      select: { id: true, fullName: true, parentPhone: true, class: { select: { name: true } } },
    });
    const input = students.map((st) => {
      const a = att.find((x) => x.id === st.id);
      const t = ar.find((x) => x.student_id === st.id && x.type === 'TJB');
      const b = ar.find((x) => x.student_id === st.id && x.type === 'BJB');
      return {
        studentId: st.id,
        fullName: st.fullName,
        attendancePct: a && Number(a.total) >= 5 ? round1((Number(a.present) / Number(a.total)) * 100) : null,
        unexcused: Number(a?.n ?? 0),
        tjbPct: t ? round1(t.pct) : null,
        bjbPct: b ? round1(b.pct) : null,
        lowLevel: t ? levelIndex(t.pct, lv) === 0 : false,
      };
    });
    const verdicts = await this.insights.risk(input, settings.attendanceThreshold);
    return verdicts.map((v) => {
      const st = students.find((x) => x.id === v.studentId)!;
      const i = input.find((x) => x.studentId === v.studentId)!;
      return { ...v, fullName: st.fullName, className: st.class?.name ?? null, parentPhone: st.parentPhone, attendancePct: i.attendancePct, tjbPct: i.tjbPct, bjbPct: i.bjbPct };
    });
  }

  avg = avg;
}
