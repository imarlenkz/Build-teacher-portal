import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { StudentsService } from './students.service';
import { MonthQuery, StudentExportQuery, StudentInput, StudentListQuery, StudentUpdate } from './students.dto';
import { ExportService } from '../exports/export.service';
import { AuditService } from '../audit/audit.service';
import { todayStr } from '../../common/utils/dates';

@ApiTags('students')
@Controller('students')
@RequirePermissions(P.STUDENTS_READ)
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: StudentListQuery) {
    return this.students.list(user, q);
  }

  @Get('export')
  @RequirePermissions(P.REPORTS_EXPORT)
  async export(@CurrentUser() user: AuthUser, @Query() q: StudentExportQuery, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const { items } = await this.students.list(user, q, true);
    const canNat = user.permissions.includes(P.NATIONALITY_VIEW);
    const headers = ['№', 'ID', 'Аты-жөні', 'Сынып', 'Жынысы', 'Туған күні', ...(canNat ? ['Ұлты'] : []), 'Қатысу %', 'ТЖБ %', 'Деңгей'];
    const rows = items.map((s, i) => [
      i + 1,
      s.studentCode,
      s.fullName,
      s.className,
      s.gender === 'M' ? 'Ұл' : 'Қыз',
      s.birthDate,
      ...(canNat ? [s.nationality ?? ''] : []),
      s.attPct,
      s.tjbPct,
      s.level,
    ]);
    await this.audit.record(user, { action: 'Экспорт', entity: 'student', summary: `Оқушылар тізімі (${q.format.toUpperCase()}, ${items.length} жол)` }, meta);
    const name = `okushylar_${todayStr()}.${q.format}`;
    if (q.format === 'xlsx') return this.exporter.send(res, await this.exporter.xlsx([{ name: 'Оқушылар', title: 'Оқушылар тізімі', headers, rows }]), name, 'xlsx');
    return this.exporter.send(res, this.exporter.csv(headers, rows), name, 'csv');
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.students.get(user, id);
  }

  @Post(':id/iin/reveal')
  @HttpCode(200)
  @RequirePermissions(P.STUDENTS_IIN_VIEW)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  reveal(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() meta: RequestMeta) {
    return this.students.revealIin(user, id, meta);
  }

  @Get(':id/history')
  history(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.students.history(user, id);
  }

  @Get(':id/attendance')
  attendance(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() q: MonthQuery) {
    return this.students.attendanceMonth(user, id, q.month);
  }

  @Get(':id/assessments')
  assessments(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.students.assessments(user, id);
  }

  @Post()
  @RequirePermissions(P.STUDENTS_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: StudentInput, @ReqMeta() meta: RequestMeta) {
    return this.students.create(user, dto, meta);
  }

  @Put(':id')
  @RequirePermissions(P.STUDENTS_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: StudentUpdate, @ReqMeta() meta: RequestMeta) {
    return this.students.update(user, id, dto, meta);
  }

  @Delete(':id')
  @RequirePermissions(P.CLASSES_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() meta: RequestMeta) {
    return this.students.remove(user, id, meta);
  }
}
