import { Body, Controller, Delete, Get, Module, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { fmtDot } from '../../common/utils/dates';
import { ExportService } from '../exports/export.service';
import { AuditService } from '../audit/audit.service';
import { JournalService } from './journal.service';
import { ColumnInput, CreateColumnInput, JournalExportQuery, JournalQuery, JournalYearQuery, SaveFinalsInput, SaveMarksInput } from './journal.dto';

@ApiTags('journal')
@Controller('journal')
@RequirePermissions(P.STUDENTS_READ)
class JournalController {
  constructor(
    private readonly svc: JournalService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Query() q: JournalQuery) {
    return this.svc.get(user, q);
  }

  @Get('year')
  year(@CurrentUser() user: AuthUser, @Query() q: JournalYearQuery) {
    return this.svc.year(user, q.classId, q.subjectId);
  }

  @Get('export')
  @RequirePermissions(P.REPORTS_EXPORT)
  async export(@CurrentUser() user: AuthUser, @Query() q: JournalExportQuery, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const j = await this.svc.get(user, q);
    const headers = [
      '№',
      'Оқушы',
      ...j.columns.map((c) => fmtDot(c.date).slice(0, 5)),
      'ФО орташа',
      'ФО %',
      ...j.bjb.map((b, i) => `БЖБ ${i + 1} (/${b.maxScore})`),
      'БЖБ %',
      ...(j.tjb ? [`ТЖБ (/${j.tjb.maxScore})`] : []),
      'ТЖБ %',
      'Тоқсан %',
      'Есептелген баға',
      'Қорытынды баға',
    ];
    const rows = j.rows.map((r, i) => [
      i + 1,
      r.fullName + (r.left ? ' (кетті)' : ''),
      ...r.marks,
      r.foAvg,
      r.computed.foPct,
      ...r.bjb.map((b) => (b == null ? null : b.absent ? 'жоқ' : b.score)),
      r.computed.bjbPct,
      ...(j.tjb ? [r.tjb == null ? null : r.tjb.absent ? 'жоқ' : r.tjb.score] : []),
      r.computed.tjbPct,
      r.computed.pct,
      r.computed.mark,
      r.final?.mark ?? null,
    ]);
    const title = `Журнал: ${j.className} · ${j.subject} · ${j.quarter}-тоқсан`;
    const subtitle = `Салмақтар: ФО ${j.weights.fo}% · БЖБ ${j.weights.bjb}% · ТЖБ ${j.weights.tjb}%`;
    await this.audit.record(user, { action: 'Экспорт', entity: 'journal', entityId: `${q.classId}:${q.subjectId}:${q.quarterId}`, summary: `${title} (${q.format.toUpperCase()})` }, meta);
    const name = `journal_${j.className}_${j.subject}_${j.quarter}.${q.format}`;
    if (q.format === 'csv') return this.exporter.send(res, this.exporter.csv(headers, rows), name, 'csv');
    const buf = await this.exporter.xlsx([
      { name: 'Журнал', title, subtitle, headers, rows },
      { name: 'Сабақтар', title, headers: ['Күні', 'Тақырып'], rows: j.columns.map((c) => [fmtDot(c.date), c.topic ?? '']), widths: [14, 80] },
    ]);
    return this.exporter.send(res, buf, name, 'xlsx');
  }

  @Post('columns')
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  createColumn(@CurrentUser() user: AuthUser, @Body() dto: CreateColumnInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.createColumn(user, dto, meta);
  }

  @Put('columns/:id')
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  updateColumn(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ColumnInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.updateColumn(user, id, dto, meta);
  }

  @Delete('columns/:id')
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  removeColumn(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() meta: RequestMeta) {
    return this.svc.removeColumn(user, id, meta);
  }

  @Put('marks')
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  marks(@CurrentUser() user: AuthUser, @Body() dto: SaveMarksInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.saveMarks(user, dto, meta);
  }

  @Put('finals')
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  finals(@CurrentUser() user: AuthUser, @Body() dto: SaveFinalsInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.saveFinals(user, dto, meta);
  }
}

@Module({ providers: [JournalService], controllers: [JournalController], exports: [JournalService] })
export class JournalModule {}
