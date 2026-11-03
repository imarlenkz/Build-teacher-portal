import { Body, Controller, Get, HttpCode, Module, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { fmtDot } from '../../common/utils/dates';
import { ExportService } from '../exports/export.service';
import { AuditService } from '../audit/audit.service';
import { PlanService } from './plan.service';
import { CopyPlanInput, PlanExportQuery, PlanImportInput, PlanQuery, PlanToJournalInput, SavePlanInput } from './plan.dto';

const HEADERS = ['№', 'Бөлім / ортақ тақырып', 'Сабақ тақырыбы', 'Оқу мақсаттары', 'Сағат саны', 'Күні', 'Ескерту'];

@ApiTags('plan')
@Controller('plan')
@RequirePermissions(P.STUDENTS_READ)
class PlanController {
  constructor(
    private readonly svc: PlanService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Query() q: PlanQuery) {
    return this.svc.get(user, q);
  }

  @Put()
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  save(@CurrentUser() user: AuthUser, @Body() dto: SavePlanInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.save(user, dto, meta);
  }

  @Post('import')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  import(@CurrentUser() user: AuthUser, @Body() dto: PlanImportInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.importFile(user, dto, meta);
  }

  @Post('copy')
  @HttpCode(200)
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  copy(@CurrentUser() user: AuthUser, @Body() dto: CopyPlanInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.copy(user, dto, meta);
  }

  @Post('journal')
  @HttpCode(200)
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  toJournal(@CurrentUser() user: AuthUser, @Body() dto: PlanToJournalInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.toJournal(user, dto, meta);
  }

  /** Бос үлгі: импорттауға арналған Excel пішімі. */
  @Get('template')
  async template(@Res() res: Response) {
    const buf = await this.exporter.xlsx([
      {
        name: 'КТЖ',
        headers: HEADERS,
        rows: [
          ['', '1-тоқсан', '', '', '', '', ''],
          [1, '1-бөлім. Бөлімнің атауы', 'Бірінші сабақтың тақырыбы', '7.1.1.1 оқу мақсаты', 1, '02.09.2026', ''],
          [2, '1-бөлім. Бөлімнің атауы', 'Екінші сабақтың тақырыбы', '7.1.1.2 оқу мақсаты', 1, '04.09.2026', ''],
          ['', '2-тоқсан', '', '', '', '', ''],
          [1, '2-бөлім. Бөлімнің атауы', 'Тақырып', '', 1, '', ''],
        ],
        widths: [6, 30, 50, 50, 10, 12, 20],
      },
    ]);
    return this.exporter.send(res, buf, 'ktzh_ulgi.xlsx', 'xlsx');
  }

  @Get('export')
  @RequirePermissions(P.REPORTS_EXPORT)
  async export(@CurrentUser() user: AuthUser, @Query() q: PlanExportQuery, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const p = await this.svc.get(user, q);
    const headers = [...HEADERS, 'Журналда'];
    const rows = p.lessons.map((l, i) => [i + 1, l.section, l.topic, l.objectives, l.hours, l.date ? fmtDot(l.date) : '', l.notes, l.columnId ? 'иә' : '']);
    const total = p.lessons.reduce((a, l) => a + l.hours, 0);
    const title = `Күнтізбелік-тақырыптық жоспар: ${p.className}${p.groupName ? ` (${p.groupName})` : ''} · ${p.subject}`;
    const subtitle = `${p.quarter}-тоқсан · ${p.schoolYear} оқу жылы · ${p.lessons.length} сабақ, ${total} сағат`;
    await this.audit.record(user, { action: 'Экспорт', entity: 'plan', entityId: `${q.classId}:${q.subjectId}:${q.quarterId}`, summary: `${title} (${q.format.toUpperCase()})` }, meta);
    const name = `KTZh_${p.className}${p.groupName ? `_${p.groupName}` : ''}_${p.subject}_${p.quarter}.${q.format}`;
    if (q.format === 'csv') return this.exporter.send(res, this.exporter.csv(headers, rows), name, 'csv');
    const buf = await this.exporter.xlsx([{ name: `${p.quarter}-тоқсан`, title, subtitle, headers, rows, widths: [6, 30, 50, 50, 10, 12, 20, 10] }]);
    return this.exporter.send(res, buf, name, 'xlsx');
  }
}

@Module({ providers: [PlanService], controllers: [PlanController] })
export class PlanModule {}
