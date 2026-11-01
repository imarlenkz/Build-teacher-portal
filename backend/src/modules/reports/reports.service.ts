import { usesInterim } from '../../common/utils/grades';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ScopeService } from '../core/scope.service';
import { LevelsService } from '../core/levels.service';
import { AuditService } from '../audit/audit.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { INSIGHTS_PROVIDER, InsightsProvider } from '../insights/insights';
import { IN_TYPES, OUT_TYPES } from '../movements/movements.module';
import { MOVEMENT_TYPES } from '../reference/reference.module';
import { fmtDate, minDate, QUARTER_ROMAN, todayStr, toDate } from '../../common/utils/dates';
import { avg, levelIndex, round1, scoreStats } from '../../common/utils/stats';

export interface QuarterReportQuery {
  quarterId: number;
  classId: number;
  subjectId: number;
  /** Пән топтарға бөлінсе — бір топтың есебі (оқушылары, БЖБ/ТЖБ, мұғалімі). */
  groupId?: number | null;
}

export type QuarterReportData = Awaited<ReturnType<ReportsService['build']>>;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly levels: LevelsService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    @Inject(INSIGHTS_PROVIDER) private readonly insights: InsightsProvider,
  ) {}

  async build(user: AuthUser, q: QuarterReportQuery) {
    const cls = await this.scope.assertClass(user, q.classId);
    const quarter = await this.prisma.quarter.findFirst({ where: { id: q.quarterId, schoolYearId: cls.schoolYearId }, include: { schoolYear: { include: { quarters: true } } } });
    if (!quarter) throw new NotFoundException('Тоқсан табылмады');
    const subject = await this.prisma.subject.findFirst({ where: { id: q.subjectId, schoolId: user.schoolId } });
    if (!subject) throw new NotFoundException('Пән табылмады');
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
    const assignment = await this.prisma.teachingAssignment.findFirst({
      where: { classId: q.classId, subjectId: q.subjectId },
      include: { teacher: { include: { user: { select: { fullName: true } } } } },
    });
    const groups = await this.prisma.subjectGroup.findMany({
      where: { classId: q.classId, subjectId: q.subjectId },
      include: { teacher: { include: { user: { select: { fullName: true } } } }, members: { select: { studentId: true } } },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    const group = q.groupId ? groups.find((g) => g.id === q.groupId) : undefined;
    if (q.groupId && !group) throw new NotFoundException('Топ табылмады');
    const memberIds = group ? new Set(group.members.map((m) => m.studentId)) : null;
    // Топқа бөлінген пәнде: топ таңдалса — сол топтың мұғалімі, әйтпесе барлық топ мұғалімдері.
    const mainTeacher = assignment?.teacher.user.fullName ?? user.fullName;
    const groupTeachers = groups.filter((g) => g.teacher).map((g) => `${g.teacher!.user.fullName} (${g.name})`);
    const teacher = group ? (group.teacher?.user.fullName ?? mainTeacher) : groupTeachers.length ? groupTeachers.join(', ') : mainTeacher;
    const lv = await this.levels.get(user.schoolId);
    const canNat = user.permissions.includes(P.NATIONALITY_VIEW);
    const today = todayStr();
    const qFrom = fmtDate(quarter.startDate)!;
    const qTo = fmtDate(quarter.endDate)!;
    const attTo = minDate(qTo, today);

    const students = await this.prisma.student.findMany({
      where: { classId: q.classId, status: 'ACTIVE', deletedAt: null, ...(memberIds ? { id: { in: [...memberIds] } } : {}) },
      select: { id: true, fullName: true, gender: true, nationality: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    const sel = { classIds: [q.classId], subjectId: q.subjectId };
    const attendance = qFrom <= attTo ? await this.analytics.attendanceAgg(user.schoolId, sel, qFrom, attTo) : null;
    const perStudentAtt = await this.prisma.$queryRaw<{ id: number; total: bigint; present: bigint; n: bigint }[]>`
      SELECT a.student_id id, count(*) total, count(*) FILTER (WHERE a.status IN ('P','K')) present, count(*) FILTER (WHERE a.status = 'N') n
      FROM attendance a JOIN lessons l ON l.id = a.lesson_id
      WHERE l.class_id = ${q.classId} AND l.subject_id = ${q.subjectId} AND a.date BETWEEN ${toDate(qFrom)} AND ${toDate(attTo)}
      GROUP BY 1`;

    const assessments = await this.prisma.assessment.findMany({
      where: { classId: q.classId, subjectId: q.subjectId, quarterId: q.quarterId, ...(group ? { OR: [{ groupId: group.id }, { groupId: null }] } : {}) },
      include: { results: true, criteria: { orderBy: { order: 'asc' } } },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
    const summative = usesInterim(cls.grade) ? 'Аралық' : 'ТЖБ';
    const bjb = assessments.filter((a) => a.type === 'BJB');
    // Пән топтарға бөлінсе, әр топтың өз ТЖБ-сы болады: есепте барлығының нәтижелері біріктіріледі.
    const tjbs = assessments.filter((a) => a.type === 'TJB' || a.type === 'ARALYK'); // 2–4 сыныптарда ТЖБ орнына аралық бағалау
    const tjb = tjbs.length ? { ...tjbs[0], title: tjbs.map((a) => a.title).join(' / '), results: tjbs.flatMap((a) => a.results) } : undefined;
    const bjbStats = bjb.map((a) => {
      const rows = a.results.filter((r) => !r.absent).map((r) => ({ score: Number(r.score), pct: Number(r.percent) }));
      return { id: a.id, title: a.title, section: a.section, ...scoreStats(rows, lv), maxScore: Number(a.maxScore) };
    });
    const tjbRows = tjb ? tjb.results.filter((r) => !r.absent).map((r) => ({ score: Number(r.score), pct: Number(r.percent), studentId: r.studentId })) : [];
    const tjbStats = tjb ? scoreStats(tjbRows, lv) : null;

    // Оқушы бойынша жиынтық кесте.
    const perStudent = students.map((s) => {
      const bj = bjb.map((a) => a.results.find((r) => r.studentId === s.id && !r.absent)).filter(Boolean).map((r) => Number(r!.percent));
      const tj = tjbRows.find((r) => r.studentId === s.id);
      const at = perStudentAtt.find((x) => x.id === s.id);
      const attPct = at && Number(at.total) ? round1((Number(at.present) / Number(at.total)) * 100) : null;
      const bjAvg = bj.length ? round1(avg(bj)) : null;
      const basis = tj ? tj.pct : bjAvg;
      const li = basis != null ? levelIndex(basis, lv) : null;
      return {
        id: s.id,
        fullName: s.fullName,
        gender: s.gender,
        attendancePct: attPct,
        unexcused: Number(at?.n ?? 0),
        bjbPct: bjAvg,
        tjbPct: tj ? round1(tj.pct) : null,
        tjbScore: tj ? tj.score : null,
        level: li != null ? lv[li].name : null,
        levelIndex: li,
      };
    });
    const threshold = (await this.levels.settings(user.schoolId)).attendanceThreshold;
    const top = perStudent.filter((s) => s.levelIndex === lv.length - 1).sort((a, b) => (b.tjbPct ?? b.bjbPct ?? 0) - (a.tjbPct ?? a.bjbPct ?? 0));
    const struggling = perStudent
      .filter((s) => s.levelIndex === 0 || (s.attendancePct != null && s.attendancePct < threshold))
      .map((s) => ({
        ...s,
        reasons: [
          s.levelIndex === 0 ? (s.tjbPct != null ? `${summative} ${s.tjbPct}%` : `БЖБ ${s.bjbPct}%`) : null,
          s.attendancePct != null && s.attendancePct < threshold ? `қатысу ${s.attendancePct}%` : null,
          s.unexcused >= 3 ? `${s.unexcused} себепсіз` : null,
        ].filter(Boolean) as string[],
      }));

    const movements = await this.prisma.studentMovement.findMany({
      where: { date: { gte: quarter.startDate, lte: quarter.endDate }, OR: [{ fromClassId: q.classId }, { toClassId: q.classId }] },
      include: { student: { select: { fullName: true } }, fromClass: true, toClass: true },
      orderBy: { date: 'asc' },
    });
    const arrived = movements.filter((m) => m.toClassId === q.classId && (IN_TYPES.includes(m.type) || m.type === 'TRANSFERRED_CLASS')).length;
    const left = movements.filter((m) => m.fromClassId === q.classId && (OUT_TYPES.includes(m.type) || m.type === 'TRANSFERRED_CLASS')).length;

    const nat: Record<string, number> = {};
    if (canNat) students.forEach((s) => (nat[s.nationality?.name ?? 'Көрсетілмеген'] = (nat[s.nationality?.name ?? 'Көрсетілмеген'] ?? 0) + 1));

    // I–IV тоқсан динамикасы (осы сынып, осы пән).
    const yearly = await this.analytics.yearly(user, { schoolYearId: cls.schoolYearId, classId: q.classId, subjectId: q.subjectId });
    const prev = yearly.quarters.find((x) => x.number === quarter.number - 1);
    const stored = await this.prisma.quarterReport.findUnique({ where: { quarterId_classId_subjectId: { quarterId: q.quarterId, classId: q.classId, subjectId: q.subjectId } } });

    const summary =
      (group ? null : stored?.summary) ??
      (await this.insights.quarterSummary({
        className: cls.name,
        subject: subject.name,
        quarter: quarter.number,
        students: students.length,
        attendancePct: attendance?.pct ?? null,
        tjbAvg: tjbStats?.avgPct ?? null,
        summative,
        quality: tjbStats?.quality ?? null,
        progress: tjbStats?.progress ?? null,
        prevTjbAvg: prev?.tjbAvg ?? null,
        struggling: struggling.length,
        topCount: top.length,
        arrived,
        left,
      }));

    const allPct = perStudent.map((s) => s.tjbPct ?? s.bjbPct).filter((x): x is number => x != null);
    const overall = scoreStats(allPct.map((p) => ({ score: p, pct: p })), lv);
    return {
      meta: {
        school: school.name,
        schoolYear: quarter.schoolYear.name,
        quarter: quarter.number,
        quarterLabel: `${QUARTER_ROMAN[quarter.number - 1]} тоқсан`,
        period: { from: qFrom, to: qTo },
        className: group ? `${cls.name} · ${group.name}` : cls.name,
        subject: subject.name,
        teacher,
        groupId: group?.id ?? null,
        groups: groups.map((g) => ({ id: g.id, name: g.name, teacher: g.teacher?.user.fullName ?? null, size: g.members.length })),
        generatedAt: new Date().toISOString(),
        generatedBy: user.fullName,
        status: stored?.status ?? 'DRAFT',
        // 2–4 сыныптарда жиынтық бағалау — аралық бағалау.
        summative,
        submittedAt: stored?.submittedAt ?? null,
        dueDate: fmtDate(quarter.reportDueDate),
      },
      levels: lv,
      counts: { students: students.length, boys: students.filter((s) => s.gender === 'M').length, girls: students.filter((s) => s.gender === 'F').length },
      nationality: canNat ? Object.entries(nat).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) : null,
      movement: {
        arrived,
        left,
        transferred: movements.filter((m) => m.type === 'TRANSFERRED_CLASS').length,
        items: movements.map((m) => ({
          date: fmtDate(m.date),
          student: m.student.fullName,
          type: MOVEMENT_TYPES.find((t) => t.code === m.type)!.name,
          from: m.fromClass?.name ?? m.fromSchool ?? '—',
          to: m.toClass?.name ?? m.toSchool ?? '—',
          order: m.orderNumber,
        })),
      },
      attendance,
      bjb: bjbStats,
      tjb: tjbStats ? { title: tjb!.title, ...tjbStats, maxScore: Number(tjb!.maxScore) } : null,
      overall: allPct.length ? { avgPct: overall.avgPct, quality: tjbStats?.quality ?? overall.quality, progress: tjbStats?.progress ?? overall.progress, avgScore: tjbStats?.avgScore ?? null } : { avgPct: null, quality: null, progress: null, avgScore: null },
      top: top.slice(0, 5),
      struggling,
      students: perStudent,
      dynamics: yearly.quarters,
      summary,
      completeness: {
        hasTjb: !!tjb && tjbRows.length > 0,
        hasBjb: bjb.some((b) => b.results.length > 0),
        hasAttendance: !!attendance && attendance.total > 0,
      },
    };
  }

  async submit(user: AuthUser, query: QuarterReportQuery, summary: string | undefined, meta: RequestMeta) {
    // Есеп пән бойынша тапсырылады (топқа бөлінсе де — бүкіл сынып).
    const q = { quarterId: query.quarterId, classId: query.classId, subjectId: query.subjectId };
    const data = await this.build(user, q);
    if (!data.completeness.hasTjb && !data.completeness.hasBjb) throw new BadRequestException('Есепті тапсыру үшін БЖБ немесе ТЖБ нәтижелері болуы керек');
    const snapshot = JSON.parse(JSON.stringify({ ...data, summary: summary ?? data.summary })) as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.quarterReport.upsert({
        where: { quarterId_classId_subjectId: { quarterId: q.quarterId, classId: q.classId, subjectId: q.subjectId } },
        create: { schoolId: user.schoolId, ...q, teacherId: user.teacherId, status: 'SUBMITTED', snapshot, summary: summary ?? data.summary, submittedAt: new Date() },
        update: { status: 'SUBMITTED', snapshot, summary: summary ?? data.summary, submittedAt: new Date() },
      });
      await this.audit.record(user, { action: 'Тоқсандық есепті тапсырды', entity: 'quarter_report', summary: `${data.meta.className} · ${data.meta.subject} · ${data.meta.quarterLabel}` }, meta, tx);
    });
    return { ok: true };
  }

  /** Тапсырылмаған есептер тізімі (әкімшілік үшін және хабарламалар үшін). */
  async status(user: AuthUser, quarterId: number) {
    const quarter = await this.prisma.quarter.findFirst({ where: { id: quarterId, schoolYear: { schoolId: user.schoolId } } });
    if (!quarter) throw new NotFoundException('Тоқсан табылмады');
    const ids = await this.scope.classIds(user, quarter.schoolYearId);
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { schoolId: user.schoolId, schoolYearId: quarter.schoolYearId, ...(ids ? { classId: { in: ids } } : {}), ...(this.scope.isSchoolWide(user) ? {} : { teacherId: user.teacherId ?? -1 }) },
      include: { class: true, subject: true, teacher: { include: { user: { select: { fullName: true } } } } },
      orderBy: [{ class: { grade: 'asc' } }, { class: { letter: 'asc' } }],
    });
    const reports = await this.prisma.quarterReport.findMany({ where: { quarterId, schoolId: user.schoolId } });
    return assignments.map((a) => {
      const r = reports.find((x) => x.classId === a.classId && x.subjectId === a.subjectId);
      return { classId: a.classId, className: a.class.name, subjectId: a.subjectId, subject: a.subject.name, teacher: a.teacher.user.fullName, status: r?.status ?? 'DRAFT', submittedAt: r?.submittedAt ?? null };
    });
  }
}
