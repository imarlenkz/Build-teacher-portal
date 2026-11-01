import { Body, Controller, Delete, Get, Module, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { AssessmentsService } from './assessments.service';
import { AnalysisExportQuery, AssessmentInput, AssessmentListQuery, SaveResultsInput } from './assessments.dto';
import { ExportService } from '../exports/export.service';
import { AuditService } from '../audit/audit.service';

@ApiTags('assessments')
@Controller('assessments')
@RequirePermissions(P.STUDENTS_READ)
class AssessmentsController {
  constructor(
    private readonly svc: AssessmentsService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: AssessmentListQuery) {
    return this.svc.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.get(user, id);
  }

  @Get(':id/export')
  @RequirePermissions(P.REPORTS_EXPORT)
  async export(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() q: AnalysisExportQuery, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const a = await this.svc.get(user, id);
    const t = a.type === 'TJB' ? 'ТЖБ' : 'БЖБ';
    const headers = ['№', 'Оқушы', ...a.criteria.map((c) => `${c.code} (/${c.maxScore})`), `Балл (/${a.maxScore})`, '%', 'Деңгей', 'Нәтиже'];
    const rows = a.rows.map((r, i) => [
      i + 1,
      r.fullName,
      ...r.criteria.map((v) => v),
      r.absent ? 'жоқ' : r.score,
      r.absent ? null : r.pct,
      r.level,
      r.absent ? 'Қатыспады' : r.levelIndex == null ? '' : r.levelIndex > 0 ? 'Меңгерді' : 'Меңгермеді',
    ]);
    const title = `${t}: ${a.title} · ${a.className} · ${a.subject} · ${a.quarter}-тоқсан`;
    await this.audit.record(user, { action: 'Экспорт', entity: 'assessment', entityId: id, summary: `${title} (${q.format.toUpperCase()})` }, meta);
    const name = `${a.type.toLowerCase()}_${a.className}_${a.quarter}.${q.format}`;
    if (q.format === 'csv') return this.exporter.send(res, this.exporter.csv(headers, rows), name, 'csv');
    const s = a.stats;
    const buf = await this.exporter.xlsx([
      { name: 'Нәтижелер', title, headers, rows },
      {
        name: 'Статистика',
        title,
        headers: ['Көрсеткіш', 'Мәні'],
        rows: [
          ['Оқушылар', s.count],
          ['Орташа балл', s.avgScore],
          ['Орташа %', s.avgPct],
          ['Ең жоғары %', s.maxPct],
          ['Ең төмен %', s.minPct],
          ['Сапа %', s.quality],
          ['Үлгерім %', s.progress],
          ...a.levels.map((l, i) => [`${l.name} (${l.fromPct}–${l.toPct}%)`, s.distribution[i]]),
        ],
      },
      ...(a.criteriaAnalysis.length
        ? [
            {
              name: 'Критерийлер',
              title,
              headers: ['Критерий', 'Тақырып', 'Макс', 'Орташа балл', 'Орташа %', '50%-дан төмен', 'Қорытынды'],
              rows: a.criteriaAnalysis.map((c) => [c.code, c.topic, c.maxScore, c.avgScore, c.avgPct, c.below50, c.verdict === 'weak' ? 'Әлсіз' : c.verdict === 'strong' ? 'Күшті' : '']),
            },
          ]
        : []),
      { name: 'Қорытынды', title, headers: ['Талдау'], rows: a.insight.map((x) => [x]), widths: [120] },
    ]);
    return this.exporter.send(res, buf, name, 'xlsx');
  }

  @Post()
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: AssessmentInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.create(user, dto, meta);
  }

  @Put(':id')
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AssessmentInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.update(user, id, dto, meta);
  }

  @Put(':id/results')
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  results(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SaveResultsInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.saveResults(user, id, dto, meta);
  }

  @Delete(':id')
  @RequirePermissions(P.ASSESSMENTS_WRITE)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() meta: RequestMeta) {
    return this.svc.remove(user, id, meta);
  }
}

@Module({ providers: [AssessmentsService], controllers: [AssessmentsController], exports: [AssessmentsService] })
export class AssessmentsModule {}
