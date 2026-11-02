import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
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

class GroupInput {
  @IsOptional() @Type(() => Number) @IsInt() id?: number;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(1) @MaxLength(40) name: string;
  @IsOptional() @Type(() => Number) @IsInt() teacherId?: number | null;
  @IsArray() @ArrayMaxSize(60) @Type(() => Number) @IsInt({ each: true }) studentIds: number[];
}

class GroupsInput {
  @Type(() => Number) @IsInt() subjectId: number;
  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => GroupInput) groups: GroupInput[];
}

class SubjectQuery {
  @Type(() => Number) @IsInt() subjectId: number;
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
    const groups = await this.prisma.subjectGroup.findMany({
      where: { schoolId: user.schoolId, class: { schoolYearId: year.id } },
      include: { teacher: { include: { user: { select: { fullName: true } } } }, _count: { select: { members: true } } },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
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
          .map((a) => ({
            id: a.id,
            subjectId: a.subjectId,
            subject: a.subject.name,
            teacherId: a.teacherId,
            teacher: a.teacher.user.fullName,
            groups: groups.filter((g) => g.classId === r.id && g.subjectId === a.subjectId).map((g) => ({ id: g.id, name: g.name, teacherId: g.teacherId, teacher: g.teacher?.user.fullName ?? null, size: g._count.members })),
          })),
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

  /**
   * Жетекшісі жоқ сыныптарға «Сынып сағаты» пәнінің мұғалімін сынып жетекшісі етіп тағайындау.
   * BilimClass/Nexus импортында жетекші бөлек келмейді, ал сынып сағатын әдетте жетекші өткізеді.
   */
  async autoHomeroom(user: AuthUser, schoolYearId: number | undefined, meta: RequestMeta) {
    const year = schoolYearId ? await this.prisma.schoolYear.findFirstOrThrow({ where: { id: schoolYearId, schoolId: user.schoolId } }) : await this.scope.currentYear(user.schoolId);
    const classes = await this.prisma.class.findMany({ where: { schoolId: user.schoolId, schoolYearId: year.id, homeroomTeacherId: null }, orderBy: [{ grade: 'asc' }, { letter: 'asc' }] });
    if (!classes.length) return { updated: 0, missing: [] as string[] };
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { schoolId: user.schoolId, schoolYearId: year.id, classId: { in: classes.map((c) => c.id) } },
      include: { subject: true, teacher: { include: { user: { select: { fullName: true } } } } },
    });
    const isHomeroomSubject = (name: string) => /сынып\s+сағат|классн\S*\s+час/iu.test(name);
    const picks = classes
      .map((c) => ({ c, a: assignments.find((a) => a.classId === c.id && isHomeroomSubject(a.subject.name)) }))
      .filter((x): x is { c: (typeof classes)[number]; a: (typeof assignments)[number] } => !!x.a);
    const missing = classes.filter((c) => !picks.some((p) => p.c.id === c.id)).map((c) => c.name);
    if (picks.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const { c, a } of picks) await tx.class.update({ where: { id: c.id }, data: { homeroomTeacherId: a.teacherId } });
        await this.audit.record(
          user,
          { action: 'Сынып жетекшілерін «Сынып сағаты» бойынша тағайындады', entity: 'class', summary: `${picks.length} сынып`, after: picks.map(({ c, a }) => `${c.name}: ${a.teacher.user.fullName}`).join(', ') },
          meta,
          tx,
        );
      });
      await this.cache.bump(user.schoolId);
    }
    return { updated: picks.length, missing };
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

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  private async loadClass(user: AuthUser, classId: number, subjectId: number) {
    const c = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } });
    if (!c) throw new NotFoundException('Сынып табылмады');
    const s = await this.prisma.subject.findFirst({ where: { id: subjectId, schoolId: user.schoolId } });
    if (!s) throw new BadRequestException('Пән табылмады');
    return { c, s };
  }

  async get(user: AuthUser, classId: number, subjectId: number) {
    await this.loadClass(user, classId, subjectId);
    const [groups, students] = await Promise.all([
      this.prisma.subjectGroup.findMany({
        where: { classId, subjectId },
        include: { members: { select: { studentId: true } }, _count: { select: { gradeColumns: true, assessments: true } } },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.student.findMany({ where: { classId, status: 'ACTIVE', deletedAt: null }, select: { id: true, fullName: true, gender: true }, orderBy: { fullName: 'asc' } }),
    ]);
    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name, teacherId: g.teacherId, studentIds: g.members.map((m) => m.studentId), hasData: g._count.gradeColumns + g._count.assessments > 0 })),
      students,
    };
  }

  /** Топтарды толық ауыстыру. Бос тізім — бөлуді алып тастау. Деректері бар топты жоюға болмайды. */
  async save(user: AuthUser, classId: number, dto: GroupsInput, meta: RequestMeta) {
    const { c, s } = await this.loadClass(user, classId, dto.subjectId);
    if (dto.groups.length === 1) throw new BadRequestException('Кемінде екі топ болуы керек (немесе бөлуді алып тастаңыз)');
    const names = dto.groups.map((g) => g.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new BadRequestException('Топ атаулары қайталанбауы керек');
    const all = dto.groups.flatMap((g) => g.studentIds);
    if (new Set(all).size !== all.length) throw new BadRequestException('Оқушы тек бір топта болуы керек');
    const valid = new Set((await this.prisma.student.findMany({ where: { id: { in: all }, classId, deletedAt: null }, select: { id: true } })).map((x) => x.id));
    if (all.some((id) => !valid.has(id))) throw new BadRequestException('Тізімде басқа сыныптың оқушысы бар');
    const teacherIds = dto.groups.map((g) => g.teacherId).filter((x): x is number => !!x);
    if (teacherIds.length) {
      const n = await this.prisma.teacher.count({ where: { id: { in: teacherIds }, schoolId: user.schoolId } });
      if (n !== new Set(teacherIds).size) throw new BadRequestException('Мұғалім табылмады');
    }
    const existing = await this.prisma.subjectGroup.findMany({ where: { classId, subjectId: dto.subjectId }, include: { _count: { select: { gradeColumns: true, assessments: true } } } });
    const keep = new Set(dto.groups.map((g) => g.id).filter(Boolean));
    if (dto.groups.some((g) => g.id && !existing.some((e) => e.id === g.id))) throw new BadRequestException('Топ табылмады');
    const removed = existing.filter((e) => !keep.has(e.id));
    const blocked = removed.filter((e) => e._count.gradeColumns + e._count.assessments > 0);
    if (blocked.length) throw new BadRequestException(`«${blocked.map((b) => b.name).join('», «')}» тобында журнал бағалары немесе БЖБ/ТЖБ бар: оны жоюға болмайды`);

    await this.prisma.$transaction(async (tx) => {
      if (removed.length) await tx.subjectGroup.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      await tx.subjectGroupMember.deleteMany({ where: { classId, subjectId: dto.subjectId } });
      // Атаулар уникалды болғандықтан, алдымен уақытша атау беріп, кейін ауыстырамыз.
      for (const e of existing.filter((x) => keep.has(x.id))) await tx.subjectGroup.update({ where: { id: e.id }, data: { name: `__tmp_${e.id}` } });
      for (const [i, g] of dto.groups.entries()) {
        const data = { name: g.name, teacherId: g.teacherId ?? null, order: i };
        const row = g.id
          ? await tx.subjectGroup.update({ where: { id: g.id }, data })
          : await tx.subjectGroup.create({ data: { ...data, schoolId: user.schoolId, classId, subjectId: dto.subjectId } });
        if (g.studentIds.length) await tx.subjectGroupMember.createMany({ data: g.studentIds.map((studentId) => ({ groupId: row.id, studentId, classId, subjectId: dto.subjectId })) });
      }
      await this.audit.record(
        user,
        {
          action: dto.groups.length ? 'Сыныпты топқа бөлді' : 'Топқа бөлуді алып тастады',
          entity: 'class',
          entityId: classId,
          summary: `${c.name} · ${s.name}`,
          before: existing.length ? existing.map((e) => e.name).join(', ') : '—',
          after: dto.groups.length ? dto.groups.map((g) => `${g.name}: ${g.studentIds.length}`).join(', ') : '—',
        },
        meta,
        tx,
      );
    });
    await this.cache.bump(user.schoolId);
    return this.get(user, classId, dto.subjectId);
  }
}

@ApiTags('classes')
@Controller('classes')
class ClassesController {
  constructor(
    private readonly classes: ClassesService,
    private readonly groups: GroupsService,
  ) {}

  @Get(':id/groups')
  @RequirePermissions(P.CLASSES_MANAGE)
  getGroups(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() q: SubjectQuery) {
    return this.groups.get(user, id, q.subjectId);
  }

  @Put(':id/groups')
  @RequirePermissions(P.CLASSES_MANAGE)
  saveGroups(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: GroupsInput, @ReqMeta() meta: RequestMeta) {
    return this.groups.save(user, id, dto, meta);
  }

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

  @Post('homeroom/auto')
  @RequirePermissions(P.CLASSES_MANAGE)
  autoHomeroom(@CurrentUser() user: AuthUser, @Body() dto: YearQuery, @ReqMeta() meta: RequestMeta) {
    return this.classes.autoHomeroom(user, dto.schoolYearId, meta);
  }

  @Post(':id/assignments')
  @RequirePermissions(P.CLASSES_MANAGE)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignmentInput, @ReqMeta() meta: RequestMeta) {
    return this.classes.addAssignment(user, id, dto, meta);
  }
}

@Module({ providers: [ClassesService, GroupsService], controllers: [ClassesController], exports: [ClassesService] })
export class ClassesModule {}
