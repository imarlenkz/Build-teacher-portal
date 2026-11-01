import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { ScopeService } from '../core/scope.service';
import { AuditService } from '../audit/audit.service';
import { fmtDate, minDate, todayStr, toDate } from '../../common/utils/dates';
import { round1 } from '../../common/utils/stats';

class YearQuery {
  @IsOptional() @Type(() => Number) @IsInt() schoolYearId?: number;
}

class ClassInput {
  @Type(() => Number) @IsInt() @Min(0) @Max(12) grade: number;
  @IsString() @MaxLength(3) @Matches(/^[А-ЯӘҒҚҢӨҰҮҺІA-Z]{1,3}$/u, { message: 'Литер бас әріп болуы керек (А, Ә, Б…)' }) letter: string;
  @IsOptional() @Type(() => Number) @IsInt() homeroomTeacherId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() schoolYearId?: number;
}

class HomeroomInput {
  @IsOptional() @Type(() => Number) @IsInt() teacherId: number | null;
}

class AssignmentInput {
  @Type(() => Number) @IsInt() subjectId: number;
  @Type(() => Number) @IsInt() teacherId: number;
}

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async list(user: AuthUser, schoolYearId?: number) {
    const year = schoolYearId ? await this.prisma.schoolYear.findFirstOrThrow({ where: { id: schoolYearId, schoolId: user.schoolId } }) : await this.scope.currentYear(user.schoolId);
    const ids = await this.scope.classIds(user, year.id);
    const to = toDate(minDate(fmtDate(year.endDate)!, todayStr()));
    const rows = await this.prisma.$queryRaw<
      { id: number; name: string; grade: number; letter: string; homeroom_teacher_id: number | null; homeroom: string | null; total: bigint; boys: bigint; girls: bigint; att: number | null }[]
    >`
      SELECT c.id, c.name, c.grade, c.letter, c.homeroom_teacher_id, u.full_name homeroom,
        count(s.id) FILTER (WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL) total,
        count(s.id) FILTER (WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL AND s.gender = 'M') boys,
        count(s.id) FILTER (WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL AND s.gender = 'F') girls,
        (SELECT 100.0 * count(*) FILTER (WHERE a.status IN ('P','K')) / NULLIF(count(*),0)
           FROM attendance a JOIN lessons l ON l.id = a.lesson_id
           WHERE l.class_id = c.id AND a.date BETWEEN ${year.startDate} AND ${to})::float att
      FROM classes c
      LEFT JOIN teachers t ON t.id = c.homeroom_teacher_id
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN students s ON s.class_id = c.id
      WHERE c.school_id = ${user.schoolId} AND c.school_year_id = ${year.id}
      GROUP BY c.id, u.full_name
      ORDER BY c.grade, c.letter`;
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { schoolYearId: year.id, schoolId: user.schoolId },
      include: { subject: true, teacher: { include: { user: { select: { fullName: true } } } } },
    });
    return rows
      .filter((r) => !ids || ids.includes(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        grade: r.grade,
        letter: r.letter,
        homeroomTeacherId: r.homeroom_teacher_id,
        homeroomTeacher: r.homeroom,
        students: Number(r.total),
        boys: Number(r.boys),
        girls: Number(r.girls),
        attendancePct: r.att != null ? round1(r.att) : null,
        subjects: assignments
          .filter((a) => a.classId === r.id)
          .map((a) => ({ id: a.id, subjectId: a.subjectId, subject: a.subject.name, teacherId: a.teacherId, teacher: a.teacher.user.fullName })),
      }));
  }

  async teachers(user: AuthUser) {
    const t = await this.prisma.teacher.findMany({
      where: { schoolId: user.schoolId, user: { deletedAt: null } },
      include: { user: { select: { fullName: true, status: true, title: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return t.map((x) => ({ id: x.id, fullName: x.user.fullName, title: x.user.title, active: x.user.status === 'ACTIVE' }));
  }

  async create(user: AuthUser, dto: ClassInput, meta: RequestMeta) {
    const year = dto.schoolYearId ? await this.prisma.schoolYear.findFirstOrThrow({ where: { id: dto.schoolYearId, schoolId: user.schoolId } }) : await this.scope.currentYear(user.schoolId);
    if (dto.homeroomTeacherId) await this.assertTeacher(user, dto.homeroomTeacherId);
    const name = `${dto.grade}${dto.letter}`;
    const c = await this.prisma.$transaction(async (tx) => {
      const c = await tx.class.create({ data: { schoolId: user.schoolId, schoolYearId: year.id, grade: dto.grade, letter: dto.letter, name, homeroomTeacherId: dto.homeroomTeacherId ?? null } });
      await this.audit.record(user, { action: 'Сынып қосты', entity: 'class', entityId: c.id, summary: name }, meta, tx);
      return c;
    });
    await this.cache.bump(user.schoolId);
    return c;
  }

  private async assertTeacher(user: AuthUser, teacherId: number) {
    const t = await this.prisma.teacher.findFirst({ where: { id: teacherId, schoolId: user.schoolId }, include: { user: true } });
    if (!t) throw new BadRequestException('Мұғалім табылмады');
    return t;
  }

  async setHomeroom(user: AuthUser, id: number, teacherId: number | null, meta: RequestMeta) {
    const c = await this.prisma.class.findFirst({ where: { id, schoolId: user.schoolId }, include: { homeroomTeacher: { include: { user: true } } } });
    if (!c) throw new NotFoundException('Сынып табылмады');
    const t = teacherId ? await this.assertTeacher(user, teacherId) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.class.update({ where: { id }, data: { homeroomTeacherId: teacherId } });
      await this.audit.record(
        user,
        { action: 'Сынып жетекшісін тағайындады', entity: 'class', entityId: id, summary: `${c.name} сыныбы`, before: c.homeroomTeacher?.user.fullName ?? '—', after: t?.user.fullName ?? '—' },
        meta,
        tx,
      );
    });
    await this.cache.bump(user.schoolId);
    return { ok: true };
  }

  async addAssignment(user: AuthUser, classId: number, dto: AssignmentInput, meta: RequestMeta) {
    const c = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } });
    if (!c) throw new NotFoundException('Сынып табылмады');
    const t = await this.assertTeacher(user, dto.teacherId);
    const s = await this.prisma.subject.findFirst({ where: { id: dto.subjectId, schoolId: user.schoolId } });
    if (!s) throw new BadRequestException('Пән табылмады');
    const a = await this.prisma.teachingAssignment.upsert({
      where: { classId_subjectId_schoolYearId: { classId, subjectId: dto.subjectId, schoolYearId: c.schoolYearId } },
      create: { schoolId: user.schoolId, schoolYearId: c.schoolYearId, classId, subjectId: dto.subjectId, teacherId: dto.teacherId },
      update: { teacherId: dto.teacherId },
    });
    await this.audit.record(user, { action: 'Пән мұғалімін тағайындады', entity: 'class', entityId: classId, summary: `${c.name} · ${s.name}`, after: t.user.fullName }, meta);
    await this.cache.bump(user.schoolId);
    return a;
  }
}

@ApiTags('classes')
@Controller('classes')
class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  @RequirePermissions(P.STUDENTS_READ)
  list(@CurrentUser() user: AuthUser, @Query() q: YearQuery) {
    return this.classes.list(user, q.schoolYearId);
  }

  @Get('teachers')
  @RequirePermissions(P.CLASSES_MANAGE)
  teachers(@CurrentUser() user: AuthUser) {
    return this.classes.teachers(user);
  }

  @Post()
  @RequirePermissions(P.CLASSES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: ClassInput, @ReqMeta() meta: RequestMeta) {
    return this.classes.create(user, dto, meta);
  }

  @Put(':id/homeroom')
  @RequirePermissions(P.CLASSES_MANAGE)
  homeroom(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HomeroomInput, @ReqMeta() meta: RequestMeta) {
    return this.classes.setHomeroom(user, id, dto.teacherId ?? null, meta);
  }

  @Post(':id/assignments')
  @RequirePermissions(P.CLASSES_MANAGE)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignmentInput, @ReqMeta() meta: RequestMeta) {
    return this.classes.addAssignment(user, id, dto, meta);
  }
}

@Module({ providers: [ClassesService], controllers: [ClassesController], exports: [ClassesService] })
export class ClassesModule {}
