import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AssessmentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { ScopeService } from '../core/scope.service';
import { LevelsService } from '../core/levels.service';
import { AuditService } from '../audit/audit.service';
import { INSIGHTS_PROVIDER, InsightsProvider } from '../insights/insights';
import { fmtDate, toDate } from '../../common/utils/dates';
import { levelIndex, round1, scoreStats } from '../../common/utils/stats';
import { usesInterim } from '../../common/utils/grades';
import { AssessmentInput, AssessmentListQuery, SaveResultsInput } from './assessments.dto';

const TYPE_KK = { BJB: 'БЖБ', TJB: 'ТЖБ', ARALYK: 'Аралық бағалау' } as const;

@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly levels: LevelsService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    @Inject(INSIGHTS_PROVIDER) private readonly insights: InsightsProvider,
  ) {}

  async list(user: AuthUser, q: AssessmentListQuery) {
    const ids = await this.scope.classIds(user);
    const rows = await this.prisma.assessment.findMany({
      where: {
        schoolId: user.schoolId,
        ...(q.type ? { type: q.type } : {}),
        ...(q.classId ? { classId: q.classId } : {}),
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(q.quarterId ? { quarterId: q.quarterId } : {}),
        ...(q.groupId ? { OR: [{ groupId: q.groupId }, { groupId: null }] } : {}),
        ...(ids ? { classId: q.classId ? (ids.includes(q.classId) ? q.classId : -1) : { in: ids } } : {}),
      },
      include: { class: true, subject: true, quarter: true, group: { select: { name: true } }, _count: { select: { results: true, criteria: true } } },
      orderBy: [{ quarter: { number: 'asc' } }, { type: 'asc' }, { createdAt: 'asc' }],
    });
    const avgs = rows.length
      ? await this.prisma.assessmentResult.groupBy({ by: ['assessmentId'], where: { assessmentId: { in: rows.map((r) => r.id) }, absent: false }, _avg: { percent: true } })
      : [];
    return rows.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      section: a.section,
      classId: a.classId,
      className: a.class.name,
      subjectId: a.subjectId,
      subject: a.subject.name,
      quarterId: a.quarterId,
      quarter: a.quarter.number,
      groupId: a.groupId,
      groupName: a.group?.name ?? null,
      maxScore: Number(a.maxScore),
      date: fmtDate(a.date),
      results: a._count.results,
      criteria: a._count.criteria,
      avgPct: round1(Number(avgs.find((x) => x.assessmentId === a.id)?._avg.percent ?? 0)),
    }));
  }

  private async load(user: AuthUser, id: number) {
    const a = await this.prisma.assessment.findFirst({
      where: { id, schoolId: user.schoolId },
      include: { criteria: { orderBy: { order: 'asc' } }, class: true, subject: true, quarter: true, group: { select: { name: true } } },
    });
    if (!a) throw new NotFoundException('Бағалау табылмады');
    await this.scope.assertClass(user, a.classId);
    return a;
  }

  /** Енгізу кестесі: сыныптың барлық белсенді оқушылары + бар нәтижелер + автоматты есеп. */
  async get(user: AuthUser, id: number) {
    const a = await this.load(user, id);
    const [students, results] = await Promise.all([
      this.prisma.student.findMany({ where: this.rosterWhere(a), select: { id: true, fullName: true, studentCode: true }, orderBy: { fullName: 'asc' } }),
      this.prisma.assessmentResult.findMany({ where: { assessmentId: id }, include: { criterionResults: true, student: { select: { id: true, fullName: true, studentCode: true } } } }),
    ]);
    const lv = await this.levels.get(user.schoolId);
    const byStudent = new Map(results.map((r) => [r.studentId, r]));
    const all = [...students, ...results.filter((r) => !students.some((s) => s.id === r.studentId)).map((r) => r.student)];
    const rows = all.map((s) => {
      const r = byStudent.get(s.id);
      const pct = r ? Number(r.percent) : null;
      const li = pct != null && !r!.absent ? levelIndex(pct, lv) : null;
      return {
        studentId: s.id,
        fullName: s.fullName,
        studentCode: s.studentCode,
        entered: !!r,
        absent: r?.absent ?? false,
        score: r ? Number(r.score) : null,
        pct: pct != null ? round1(pct) : null,
        criteria: a.criteria.map((c) => {
          const cr = r?.criterionResults.find((x) => x.criterionId === c.id);
          return cr ? Number(cr.score) : null;
        }),
        level: li != null ? lv[li].name : null,
        levelIndex: li,
      };
    });
    return {
      id: a.id,
      type: a.type,
      title: a.title,
      section: a.section,
      classId: a.classId,
      className: a.class.name,
      subjectId: a.subjectId,
      subject: a.subject.name,
      quarterId: a.quarterId,
      quarter: a.quarter.number,
      groupId: a.groupId,
      groupName: a.group?.name ?? null,
      maxScore: Number(a.maxScore),
      date: fmtDate(a.date),
      criteria: a.criteria.map((c) => ({ id: c.id, code: c.code, topic: c.topic, maxScore: Number(c.maxScore) })),
      levels: lv,
      rows,
      ...(await this.computeAnalysis(a, rows, lv)),
    };
  }

  private async computeAnalysis(
    a: { type: AssessmentType; title: string; class: { name: string }; subject: { name: string }; criteria: { id: number; code: string; topic: string; maxScore: Prisma.Decimal }[] },
    rows: { entered: boolean; absent: boolean; score: number | null; pct: number | null; criteria: (number | null)[]; levelIndex: number | null; fullName: string; studentId: number }[],
    lv: Awaited<ReturnType<LevelsService['get']>>,
  ) {
    const done = rows.filter((r) => r.entered && !r.absent && r.pct != null);
    const stats = scoreStats(done.map((r) => ({ score: r.score!, pct: r.pct! })), lv);
    const criteria = a.criteria.map((c, j) => {
      const vals = done.map((r) => r.criteria[j]).filter((v): v is number => v != null);
      const max = Number(c.maxScore);
      const pcts = vals.map((v) => (v / max) * 100);
      return {
        code: c.code,
        topic: c.topic,
        maxScore: max,
        avgScore: vals.length ? round1(vals.reduce((s, x) => s + x, 0) / vals.length) : 0,
        avgPct: pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length) : 0,
        below50: pcts.filter((p) => p < 50).length,
        struggling: done.filter((r) => r.criteria[j] != null && (r.criteria[j]! / max) * 100 < 50).map((r) => r.fullName),
      };
    });
    const insight = await this.insights.assessment({
      type: a.type,
      title: a.title,
      subject: a.subject.name,
      className: a.class.name,
      avgPct: stats.avgPct,
      quality: stats.quality,
      progress: stats.progress,
      count: stats.count,
      lowCount: stats.distribution[0] ?? 0,
      criteria: criteria.map((c) => ({ code: c.code, topic: c.topic, avgPct: c.avgPct, below50: c.below50 })),
    });
    const sorted = [...done].sort((x, y) => y.pct! - x.pct!);
    return {
      stats,
      entered: rows.filter((r) => r.entered).length,
      criteriaAnalysis: criteria.map((c) => ({ ...c, verdict: insight.verdicts.find((v) => v.code === c.code)?.verdict ?? 'normal' })),
      insight: insight.text,
      top: sorted.filter((r) => r.levelIndex === lv.length - 1).slice(0, 10).map((r) => ({ studentId: r.studentId, fullName: r.fullName, pct: r.pct })),
      low: sorted.filter((r) => r.levelIndex === 0).reverse().map((r) => ({ studentId: r.studentId, fullName: r.fullName, pct: r.pct })),
    };
  }

  /** Енгізу тізімі: топқа арналса — топ мүшелері, әйтпесе сыныптың белсенді оқушылары. */
  private rosterWhere(a: { classId: number; groupId: number | null }): Prisma.StudentWhereInput {
    return a.groupId
      ? { groupMemberships: { some: { groupId: a.groupId } }, status: 'ACTIVE', deletedAt: null }
      : { classId: a.classId, status: 'ACTIVE', deletedAt: null };
  }

  private validateCriteria(dto: AssessmentInput) {
    if (dto.type === 'TJB' && dto.criteria?.length) {
      const sum = dto.criteria.reduce((s, c) => s + c.maxScore, 0);
      if (Math.abs(sum - dto.maxScore) > 0.001) throw new BadRequestException(`Критерийлер балының қосындысы (${sum}) максималды балға (${dto.maxScore}) тең болуы керек`);
      const codes = new Set(dto.criteria.map((c) => c.code));
      if (codes.size !== dto.criteria.length) throw new BadRequestException('Критерий кодтары қайталанбауы керек');
    }
    if (dto.type === 'BJB' && dto.criteria?.length) {
      const sum = dto.criteria.reduce((s, c) => s + c.maxScore, 0);
      if (Math.abs(sum - dto.maxScore) > 0.001) throw new BadRequestException('Критерийлер балының қосындысы максималды балға тең болуы керек');
    }
  }

  async create(user: AuthUser, dto: AssessmentInput, meta: RequestMeta) {
    await this.scope.assertTeaches(user, dto.classId, dto.subjectId);
    const group = await this.scope.resolveGroup(user, dto.classId, dto.subjectId, dto.groupId, true);
    this.validateCriteria(dto);
    const cls = await this.prisma.class.findUniqueOrThrow({ where: { id: dto.classId } });
    if (usesInterim(cls.grade) && dto.type !== 'ARALYK') throw new BadRequestException('2–4 сыныптарда БЖБ/ТЖБ орнына аралық бағалау алынады');
    if (!usesInterim(cls.grade) && dto.type === 'ARALYK') throw new BadRequestException('Аралық бағалау тек 2–4 сыныптарда алынады');
    const quarter = await this.prisma.quarter.findFirst({ where: { id: dto.quarterId, schoolYearId: cls.schoolYearId } });
    if (!quarter) throw new BadRequestException('Тоқсан сынып оқу жылына сәйкес емес');
    if (dto.type === 'TJB') {
      const dup = await this.prisma.assessment.findFirst({ where: { type: 'TJB', classId: dto.classId, subjectId: dto.subjectId, quarterId: dto.quarterId, groupId: group?.id ?? null } });
      if (dup) throw new BadRequestException(group ? `${group.name} үшін бұл тоқсанға ТЖБ бұрын құрылған` : 'Бұл тоқсанға ТЖБ бұрын құрылған');
    }
    const a = await this.prisma.$transaction(async (tx) => {
      const a = await tx.assessment.create({
        data: {
          schoolId: user.schoolId,
          type: dto.type,
          classId: dto.classId,
          subjectId: dto.subjectId,
          quarterId: dto.quarterId,
          groupId: group?.id ?? null,
          teacherId: user.teacherId,
          section: dto.section ?? null,
          title: dto.title,
          maxScore: dto.maxScore,
          date: dto.date ? toDate(dto.date) : null,
          criteria: { create: (dto.criteria ?? []).map((c, i) => ({ code: c.code, topic: c.topic, maxScore: c.maxScore, order: i })) },
        },
      });
      await this.audit.record(user, { action: `${TYPE_KK[dto.type]} құрды`, entity: 'assessment', entityId: a.id, summary: `${cls.name}${group ? ` (${group.name})` : ''} · ${dto.title} · /${dto.maxScore}` }, meta, tx);
      return a;
    });
    return this.get(user, a.id);
  }

  async update(user: AuthUser, id: number, dto: AssessmentInput, meta: RequestMeta) {
    const a = await this.load(user, id);
    await this.scope.assertWriteScope(user, a.classId, a.subjectId, a.groupId);
    this.validateCriteria({ ...dto, type: a.type });
    const hasResults = (await this.prisma.assessmentResult.count({ where: { assessmentId: id } })) > 0;
    const structureChanged =
      Number(a.maxScore) !== dto.maxScore ||
      (dto.criteria ?? []).length !== a.criteria.length ||
      (dto.criteria ?? []).some((c, i) => Number(a.criteria[i]?.maxScore) !== c.maxScore);
    if (hasResults && structureChanged) {
      throw new BadRequestException('Нәтижелер енгізілген: максималды балл мен критерийлер құрылымын өзгертуге болмайды. Тек атауларды өзгертіңіз');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.assessment.update({
        where: { id },
        data: { title: dto.title, section: dto.section ?? null, date: dto.date ? toDate(dto.date) : null, maxScore: dto.maxScore },
      });
      if (!hasResults) {
        await tx.assessmentCriterion.deleteMany({ where: { assessmentId: id } });
        if (dto.criteria?.length) {
          await tx.assessmentCriterion.createMany({ data: dto.criteria.map((c, i) => ({ assessmentId: id, code: c.code, topic: c.topic, maxScore: c.maxScore, order: i })) });
        }
      } else {
        for (const [i, c] of (dto.criteria ?? []).entries()) {
          await tx.assessmentCriterion.update({ where: { id: a.criteria[i].id }, data: { topic: c.topic, code: c.code } });
        }
      }
      await this.audit.record(user, { action: `${TYPE_KK[a.type]} баптауын өзгертті`, entity: 'assessment', entityId: id, summary: `${a.class.name} · ${dto.title}`, before: { title: a.title, maxScore: Number(a.maxScore) }, after: { title: dto.title, maxScore: dto.maxScore } }, meta, tx);
    });
    await this.cache.bump(user.schoolId);
    return this.get(user, id);
  }

  async saveResults(user: AuthUser, id: number, dto: SaveResultsInput, meta: RequestMeta) {
    const a = await this.load(user, id);
    await this.scope.assertWriteScope(user, a.classId, a.subjectId, a.groupId);
    const max = Number(a.maxScore);
    const allowedStudents = new Set(
      (await this.prisma.student.findMany({ where: { OR: [this.rosterWhere(a), { assessmentResults: { some: { assessmentId: id } } }], deletedAt: null }, select: { id: true } })).map((s) => s.id),
    );
    const prepared = dto.results.map((r) => {
      if (!allowedStudents.has(r.studentId)) throw new BadRequestException('Тізімде басқа сыныптың оқушысы бар');
      if (r.absent) return { ...r, total: 0, crit: [] as { criterionId: number; score: number }[] };
      let total: number;
      let crit: { criterionId: number; score: number }[] = [];
      if (a.criteria.length) {
        if (!r.criteria || r.criteria.length !== a.criteria.length) throw new BadRequestException('Әр критерий бойынша балл енгізіңіз');
        crit = r.criteria.map((c) => {
          const def = a.criteria.find((x) => x.id === c.criterionId);
          if (!def) throw new BadRequestException('Критерий қате');
          if (c.score > Number(def.maxScore)) throw new BadRequestException(`${def.code}: балл ${Number(def.maxScore)}-дан аспауы керек`);
          return c;
        });
        total = crit.reduce((s, c) => s + c.score, 0);
      } else {
        if (r.score == null) throw new BadRequestException('Балл енгізіңіз');
        total = r.score;
      }
      if (total > max) throw new BadRequestException(`Балл ${max}-дан аспауы керек`);
      return { ...r, total, crit };
    });

    const before = await this.prisma.assessmentResult.findMany({ where: { assessmentId: id } });
    const changed: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const r of prepared) {
        const pct = r.absent ? 0 : (r.total / max) * 100;
        const prev = before.find((b) => b.studentId === r.studentId);
        if (prev && (Number(prev.score) !== r.total || prev.absent !== !!r.absent)) changed.push(`${r.studentId}: ${Number(prev.score)}→${r.total}`);
        const res = await tx.assessmentResult.upsert({
          where: { assessmentId_studentId: { assessmentId: id, studentId: r.studentId } },
          create: { assessmentId: id, studentId: r.studentId, score: r.total, percent: round1(pct), absent: !!r.absent },
          update: { score: r.total, percent: round1(pct), absent: !!r.absent },
        });
        if (a.criteria.length) {
          await tx.assessmentCriterionResult.deleteMany({ where: { resultId: res.id } });
          if (r.crit.length) await tx.assessmentCriterionResult.createMany({ data: r.crit.map((c) => ({ resultId: res.id, criterionId: c.criterionId, score: c.score })) });
        }
      }
      await this.audit.record(
        user,
        {
          action: `${TYPE_KK[a.type]} нәтижесін енгізді`,
          entity: 'assessment',
          entityId: id,
          summary: `${a.class.name} · ${a.subject.name} · ${a.title}`,
          before: before.length ? `${before.length} оқушы${changed.length ? ` (${changed.length} өзгерді)` : ''}` : '—',
          after: `${prepared.length} оқушы`,
        },
        meta,
        tx,
      );
    });
    await this.cache.bump(user.schoolId);
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: number, meta: RequestMeta) {
    const a = await this.load(user, id);
    await this.scope.assertWriteScope(user, a.classId, a.subjectId, a.groupId);
    await this.prisma.$transaction(async (tx) => {
      await tx.assessment.delete({ where: { id } });
      await this.audit.record(user, { action: `${TYPE_KK[a.type]} жойды`, entity: 'assessment', entityId: id, summary: `${a.class.name} · ${a.subject.name} · ${a.title}` }, meta, tx);
    });
    await this.cache.bump(user.schoolId);
    return { ok: true };
  }
}
