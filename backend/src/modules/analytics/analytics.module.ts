import { Controller, Get, Module, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { AnalyticsService, Period } from './analytics.service';
import { SubjectAnalysisService } from './subject-analysis.service';
import { ExportService, SheetSpec } from '../exports/export.service';
import { AuditService } from '../audit/audit.service';
import { todayStr } from '../../common/utils/dates';

class DashQuery {
  @IsOptional() @IsIn(['today', 'week', 'month', 'quarter', 'year']) period: Period = 'today';
}
class AnQuery {
  @IsOptional() @Type(() => Number) @IsInt() schoolYearId?: number;
  @IsOptional() @Type(() => Number) @IsInt() classId?: number;
  @IsOptional() @Type(() => Number) @IsInt() studentId?: number;
  @IsOptional() @Type(() => Number) @IsInt() subjectId?: number;
}

class SubjQuery {
  @IsOptional() @Type(() => Number) @IsInt() schoolYearId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) quarterId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(11) grade?: number;
  @IsOptional() @Type(() => Number) @IsInt() classId?: number;
  @IsOptional() @Type(() => Number) @IsInt() subjectId?: number;
}
class SubjExportQuery extends SubjQuery {
  @IsOptional() @IsIn(['xlsx', 'csv']) format: 'xlsx' | 'csv' = 'xlsx';
}

@ApiTags('analytics')
@Controller('analytics')
@RequirePermissions(P.ANALYTICS_READ)
class AnalyticsController {
  constructor(
    private readonly an: AnalyticsService,
    private readonly subj: SubjectAnalysisService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get('subjects')
  subjects(@CurrentUser() user: AuthUser, @Query() q: SubjQuery) {
    return this.subj.build(user, q);
  }

  @Get('subjects/export')
  @RequirePermissions(P.REPORTS_EXPORT)
  async subjectsExport(@CurrentUser() user: AuthUser, @Query() q: SubjExportQuery, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const d = await this.subj.build(user, q);
    const head = ['5', '4', '3', '2', 'Сапа %', 'Үлгерім %', 'Орташа баға', 'СОУ %', 'БЖБ %', 'ТЖБ / аралық %', 'Қатысу %'];
    const nums = (r: { d5: number; d4: number; d3: number; d2: number; quality: number | null; progress: number | null; avgMark: number | null; sou: number | null; bjbAvg?: number | null; tjbAvg?: number | null; attendancePct?: number | null }) => [
      r.d5, r.d4, r.d3, r.d2, r.quality, r.progress, r.avgMark, r.sou, r.bjbAvg ?? null, r.tjbAvg ?? null, r.attendancePct ?? null,
    ];
    const subtitle = `${d.yearName} оқу жылы · ${d.periodLabel}${q.grade ? ` · ${q.grade}-сыныптар` : ''}`;
    const sheets: SheetSpec[] = [
      {
        name: 'Пәндер',
        title: 'Пәндер бойынша талдау',
        subtitle,
        headers: ['№', 'Пән', 'Сынып саны', 'Бағалар саны', ...head],
        rows: [
          ...d.subjects.map((s, i) => [i + 1, s.name, s.classes, s.count, ...nums(s)]),
          ['', 'Барлығы', '', d.totals.count, ...nums(d.totals)],
        ],
      },
    ];
    if (d.detail) {
      sheets.push({
        name: 'Сыныптар',
        title: `${d.detail.name} · сыныптар бойынша`,
        subtitle,
        headers: ['№', 'Сынып', 'Мұғалім', 'Бағалар саны', ...head],
        rows: d.detail.byClass.map((r, i) => [i + 1, r.className, r.teacher ?? '', r.count, ...nums(r)]),
      });
      sheets.push({
        name: 'Үлгермейтіндер',
        title: `${d.detail.name} · «2» алғандар`,
        subtitle,
        headers: ['№', 'Оқушы', 'Сынып'],
        rows: d.detail.failing.map((r, i) => [i + 1, r.fullName, r.className]),
      });
    }
    await this.audit.record(user, { action: 'Экспорт', entity: 'analytics', summary: `Пәндер талдауы (${q.format.toUpperCase()}, ${d.periodLabel}${d.detail ? `, ${d.detail.name}` : ''})` }, meta);
    const name = `pander_taldau_${todayStr()}.${q.format}`;
    if (q.format === 'csv') return this.exporter.send(res, this.exporter.csv(sheets[0].headers, sheets[0].rows), name, 'csv');
    return this.exporter.send(res, await this.exporter.xlsx(sheets), name, 'xlsx');
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser, @Query() q: DashQuery) {
    return this.an.dashboard(user, q.period);
  }

  @Get('attendance')
  attendance(@CurrentUser() user: AuthUser, @Query() q: AnQuery) {
    return this.an.attendance(user, q);
  }

  @Get('yearly')
  yearly(@CurrentUser() user: AuthUser, @Query() q: AnQuery) {
    return this.an.yearly(user, q);
  }

  @Get('nationality')
  @RequirePermissions(P.NATIONALITY_VIEW)
  nationality(@CurrentUser() user: AuthUser, @Query() q: AnQuery) {
    return this.an.nationality(user, q);
  }

  @Get('risk')
  risk(@CurrentUser() user: AuthUser, @Query() q: AnQuery) {
    return this.an.risk(user, q);
  }
}

@Module({ providers: [AnalyticsService, SubjectAnalysisService], controllers: [AnalyticsController], exports: [AnalyticsService] })
export class AnalyticsModule {}
