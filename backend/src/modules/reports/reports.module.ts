import { Body, Controller, Get, HttpCode, Module, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { AuditService } from '../audit/audit.service';
import { ExportService } from '../exports/export.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ReportsService } from './reports.service';
import { ReportRenderers } from './report-renderers';

class QRQuery {
  @Type(() => Number) @IsInt() quarterId: number;
  @Type(() => Number) @IsInt() classId: number;
  @Type(() => Number) @IsInt() subjectId: number;
  @IsOptional() @Type(() => Number) @IsInt() groupId?: number;
}
class QRExport extends QRQuery {
  @IsIn(['pdf', 'xlsx', 'csv']) format: 'pdf' | 'xlsx' | 'csv';
}
class QRSubmit extends QRQuery {
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(4000) summary?: string;
}
class StatusQuery {
  @Type(() => Number) @IsInt() quarterId: number;
}

@ApiTags('reports')
@Controller('reports')
@RequirePermissions(P.REPORTS_READ)
class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly renderers: ReportRenderers,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get('quarter')
  quarter(@CurrentUser() user: AuthUser, @Query() q: QRQuery) {
    return this.reports.build(user, q);
  }

  @Get('quarter/status')
  status(@CurrentUser() user: AuthUser, @Query() q: StatusQuery) {
    return this.reports.status(user, q.quarterId);
  }

  @Post('quarter/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Body() dto: QRSubmit, @ReqMeta() meta: RequestMeta) {
    const { summary, ...q } = dto;
    return this.reports.submit(user, q, summary, meta);
  }

  @Get('quarter/export')
  @RequirePermissions(P.REPORTS_EXPORT)
  async export(@CurrentUser() user: AuthUser, @Query() q: QRExport, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const { format, ...query } = q;
    const d = await this.reports.build(user, query);
    const base = `toqsandyq_esep_${d.meta.className}_${d.meta.subject}_${d.meta.quarter}`;
    await this.audit.record(user, { action: 'Экспорт', entity: 'quarter_report', summary: `Тоқсандық есеп · ${d.meta.className} · ${d.meta.subject} · ${d.meta.quarterLabel} (${format.toUpperCase()})` }, meta);
    if (format === 'pdf') return this.exporter.send(res, await this.renderers.pdf(d), `${base}.pdf`, 'pdf');
    if (format === 'xlsx') return this.exporter.send(res, await this.renderers.xlsx(d), `${base}.xlsx`, 'xlsx');
    return this.exporter.send(res, this.renderers.csv(d), `${base}.csv`, 'csv');
  }
}

@Module({ imports: [AnalyticsModule], providers: [ReportsService, ReportRenderers], controllers: [ReportsController], exports: [ReportsService] })
export class ReportsModule {}
