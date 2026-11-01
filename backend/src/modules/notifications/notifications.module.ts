import { Controller, Get, HttpCode, Injectable, Logger, Module, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { NotificationSeverity, Prisma } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ScopeService } from '../core/scope.service';
import { LevelsService } from '../core/levels.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { OUT_TYPES } from '../movements/movements.module';
import { addDays, fmtDate, fmtDot, minDate, QUARTER_ROMAN, todayStr, toDate } from '../../common/utils/dates';
import { levelIndex } from '../../common/utils/stats';

interface Rule {
  type: string;
  key: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  link: Prisma.InputJsonValue;
  count: number;
}

class ListQuery {
  @IsOptional() @Type(() => Boolean) @IsBoolean() unreadOnly?: boolean;
}

/**
 * Ережеге негізделген хабарламалар. Әр пайдаланушы үшін өз аясында есептеледі (cron + сұраныс бойынша).
 * dedupeKey бір ескертудің қайталанбауын қамтамасыз етеді; сан өссе, ескерту қайта «оқылмаған» болады.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly levels: LevelsService,
    private readonly analytics: AnalyticsService,
  ) {}

  private async userAsAuth(userId: number, schoolId: number): Promise<AuthUser | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true, teacher: true } });
    if (!u || u.status !== 'ACTIVE' || u.deletedAt) return null;
    return { id: u.id, login: u.login, fullName: u.fullName, role: u.role.code, permissions: u.role.permissions, homeSchoolId: u.schoolId, schoolId, teacherId: u.teacher?.id ?? null };
  }

  async rulesFor(user: AuthUser): Promise<Rule[]> {
    const year = await this.scope.currentYear(user.schoolId);
    const today = todayStr();
    const q = this.analytics.currentQuarter(year, today);
    const qFrom = fmtDate(q.startDate)!;
    const qTo = minDate(today, fmtDate(q.endDate)!);
    const ids = await this.scope.classIds(user, year.id);
    const settings = await this.levels.settings(user.schoolId);
    const lv = await this.levels.get(user.schoolId);
    const rules: Rule[] = [];
    const qn = QUARTER_ROMAN[q.number - 1];

    const low = qFrom <= qTo ? await this.analytics.lowAttendance(user.schoolId, { classIds: ids }, qFrom, qTo, settings.attendanceThreshold, 500) : [];
    if (low.length) {
      rules.push({
        type: 'low_attendance',
        key: `low_attendance:${q.id}`,
        severity: 'WARNING',
        title: `${low.length} оқушының қатысуы ${settings.attendanceThreshold}%-дан төмен`,
        body: `Қатысу · ${qn} тоқсан`,
        link: { screen: 'analytics', params: { tab: 'low' } },
        count: low.length,
      });
    }

    const tjb = await this.prisma.$queryRaw<{ student_id: number; pct: number; subject: string }[]>`
      SELECT r.student_id, avg(r.percent)::float pct, min(sub.name) subject
      FROM assessment_results r JOIN assessments a ON a.id = r.assessment_id JOIN subjects sub ON sub.id = a.subject_id
      JOIN students st ON st.id = r.student_id AND st.status = 'ACTIVE' AND st.deleted_at IS NULL
      WHERE a.school_id = ${user.schoolId} AND a.type = 'TJB' AND a.quarter_id = ${q.id} AND NOT r.absent
      ${ids ? (ids.length ? Prisma.sql`AND a.class_id IN (${Prisma.join(ids)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
      ${!this.scope.isSchoolWide(user) ? Prisma.sql`AND (a.teacher_id = ${user.teacherId ?? -1} OR a.class_id IN (SELECT id FROM classes WHERE homeroom_teacher_id = ${user.teacherId ?? -1}))` : Prisma.empty}
      GROUP BY 1`;
    const lowT = tjb.filter((r) => levelIndex(r.pct, lv) === 0);
    if (lowT.length) {
      rules.push({
        type: 'low_tjb',
        key: `low_tjb:${q.id}`,
        severity: 'WARNING',
        title: `${lowT.length} оқушы ТЖБ бойынша төмен нәтиже көрсетті`,
        body: `ТЖБ · ${qn} тоқсан`,
        link: { screen: 'tjb-analysis', params: { quarterId: q.id } },
        count: lowT.length,
      });
    }

    const left = await this.prisma.studentMovement.count({
      where: {
        schoolId: user.schoolId,
        type: { in: OUT_TYPES },
        date: { gte: toDate(qFrom), lte: toDate(fmtDate(q.endDate)!) },
        ...(ids ? { fromClassId: { in: ids } } : {}),
      },
    });
    if (left) {
      rules.push({
        type: 'students_left',
        key: `students_left:${q.id}`,
        severity: 'INFO',
        title: `${left} оқушы осы тоқсанда мектептен шықты`,
        body: 'Оқушы қозғалысы',
        link: { screen: 'movements', params: { quarterId: q.id, dir: 'out' } },
        count: left,
      });
    }

    // Тоқсандық есеп: мерзімге 10 күн қалғанда немесе мерзімі өтсе.
    const due = q.reportDueDate ? fmtDate(q.reportDueDate)! : fmtDate(q.endDate)!;
    if (today >= addDays(due, -10)) {
      const assignments = await this.prisma.teachingAssignment.findMany({
        where: { schoolYearId: year.id, ...(this.scope.isSchoolWide(user) ? {} : { teacherId: user.teacherId ?? -1 }) },
        include: { class: true, subject: true },
      });
      const submitted = await this.prisma.quarterReport.findMany({ where: { quarterId: q.id, status: 'SUBMITTED' }, select: { classId: true, subjectId: true } });
      const pending = assignments.filter((a) => !submitted.some((s) => s.classId === a.classId && s.subjectId === a.subjectId));
      if (pending.length) {
        const first = pending[0];
        rules.push({
          type: 'report_pending',
          key: `report_pending:${q.id}`,
          severity: today > due ? 'CRITICAL' : 'WARNING',
          title:
            pending.length === 1
              ? `Тоқсандық есеп толық толтырылмаған · ${first.class.name} ${first.subject.name}`
              : `${pending.length} тоқсандық есеп тапсырылмаған`,
          body: `Мерзімі: ${fmtDot(due)}`,
          link: { screen: 'report', params: { quarterId: q.id, classId: first.classId, subjectId: first.subjectId } },
          count: pending.length,
        });
      }
    }
    return rules;
  }

  async refreshFor(user: AuthUser) {
    const rules = await this.rulesFor(user);
    const existing = await this.prisma.notification.findMany({ where: { userId: user.id, schoolId: user.schoolId } });
    for (const r of rules) {
      const e = existing.find((x) => x.dedupeKey === r.key);
      if (!e) {
        await this.prisma.notification.create({
          data: { schoolId: user.schoolId, userId: user.id, type: r.type, severity: r.severity, title: r.title, body: r.body, link: r.link, dedupeKey: r.key },
        });
      } else if (e.title !== r.title || e.body !== r.body || e.severity !== r.severity) {
        const prevCount = Number(/\d+/.exec(e.title)?.[0] ?? 0);
        await this.prisma.notification.update({
          where: { id: e.id },
          data: { title: r.title, body: r.body, severity: r.severity, link: r.link, ...(r.count > prevCount || r.severity !== e.severity ? { readAt: null, createdAt: new Date() } : {}) },
        });
      }
    }
    // Өзекті емес ескертулер (мысалы, барлық есеп тапсырылды) жойылады.
    const keys = new Set(rules.map((r) => r.key));
    const stale = existing.filter((e) => !keys.has(e.dedupeKey) && e.type !== 'system').map((e) => e.id);
    if (stale.length) await this.prisma.notification.deleteMany({ where: { id: { in: stale } } });
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async refreshAll() {
    const users = await this.prisma.user.findMany({ where: { status: 'ACTIVE', deletedAt: null, schoolId: { not: null } }, select: { id: true, schoolId: true } });
    for (const u of users) {
      try {
        const auth = await this.userAsAuth(u.id, u.schoolId!);
        if (auth) await this.refreshFor(auth);
      } catch (e) {
        this.log.warn(`refresh failed for user ${u.id}: ${(e as Error).message}`);
      }
    }
  }

  async list(user: AuthUser, unreadOnly = false) {
    const items = await this.prisma.notification.findMany({
      where: { userId: user.id, schoolId: user.schoolId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 100,
    });
    const unread = await this.prisma.notification.count({ where: { userId: user.id, schoolId: user.schoolId, readAt: null } });
    return { items, unread };
  }

  async read(user: AuthUser, id: number) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async readAll(user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.id, schoolId: user.schoolId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}

@ApiTags('notifications')
@Controller('notifications')
class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    return this.svc.list(user, q.unreadOnly);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async refresh(@CurrentUser() user: AuthUser) {
    if (user.permissions.includes(P.STUDENTS_READ)) await this.svc.refreshFor(user);
    return this.svc.list(user);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.svc.readAll(user);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.read(user, id);
  }
}

@Module({ imports: [AnalyticsModule], providers: [NotificationsService], controllers: [NotificationsController] })
export class NotificationsModule {}
