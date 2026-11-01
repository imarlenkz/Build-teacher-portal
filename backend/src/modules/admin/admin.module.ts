import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Prisma, RoleCode, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P, ROLE_LABELS_KK } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { IsDateStr } from '../../common/dto/validators';
import { AuditService } from '../audit/audit.service';
import { ARGON_OPTS } from '../auth/auth.service';
import { DEFAULT_LEVELS } from '../core/levels.service';
import { fmtDate, toDate } from '../../common/utils/dates';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const PASSWORD = /^(?=.*[A-Za-zА-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі])(?=.*\d).{8,128}$/;

class UserQuery extends PaginationQuery {
  @IsOptional() @IsEnum(RoleCode) role?: RoleCode;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}
class UserCreate {
  @Transform(trim) @IsString() @MinLength(5, { message: 'Аты-жөні кемінде 5 таңба' }) @MaxLength(120) fullName: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^[a-z0-9._]{3,32}$/, { message: 'Логин: латын кіші әріптері, сан, нүкте, астын сызу (3–32)' })
  login: string;
  @Matches(PASSWORD, { message: 'Құпиясөз кемінде 8 таңба, әріп пен сан болуы керек' }) password: string;
  @IsEnum(RoleCode) role: RoleCode;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) title?: string;
  @IsOptional() @Type(() => Number) @IsInt() schoolId?: number;
}
class UserUpdate {
  @IsOptional() @Transform(trim) @IsString() @MinLength(5) @MaxLength(120) fullName?: string;
  @IsOptional() @IsEnum(RoleCode) role?: RoleCode;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) title?: string;
}
class PasswordReset {
  @Matches(PASSWORD, { message: 'Құпиясөз кемінде 8 таңба, әріп пен сан болуы керек' }) password: string;
}
class SchoolInput {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) name: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(60) shortName: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) address?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  /** iMARLEN ID-дағы мектеп коды (мыс. s51). Бос жол — байланысты алып тастау. */
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^([a-z0-9][a-z0-9_-]{0,39})?$/, { message: 'iMARLEN ID коды: латын әріптері, сандар, - және _' })
  idpCode?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class SubjectInput {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name: string;
}
class QuarterInput {
  @IsDateStr() startDate: string;
  @IsDateStr() endDate: string;
  @IsOptional() @IsDateStr() reportDueDate?: string;
}
class YearInput {
  @Matches(/^\d{4}–\d{4}$/, { message: 'Формат: 2026–2027' }) name: string;
  @IsArray() @ArrayMinSize(4) @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => QuarterInput) quarters: QuarterInput[];
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

@Injectable()
class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async users(user: AuthUser, q: UserQuery) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      OR: [{ schoolId: user.schoolId }, { schoolId: null }],
      ...(q.role ? { role: { code: q.role } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { AND: [{ OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { login: { contains: q.search, mode: 'insensitive' } }] }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { role: true, teacher: { include: { homeroomOf: { select: { name: true } }, assignments: { select: { id: true } } } } },
        orderBy: q.sort === 'login' ? { login: q.dir } : q.sort === 'lastLogin' ? { lastLoginAt: q.dir } : { fullName: q.dir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: items.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        login: u.login,
        title: u.title,
        role: u.role.code,
        roleLabel: ROLE_LABELS_KK[u.role.code],
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        idp: !!u.idpSub,
        homeroom: u.teacher?.homeroomOf.map((c) => c.name) ?? [],
        lessons: u.teacher?.assignments.length ?? 0,
        isSelf: u.id === user.id,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async createUser(user: AuthUser, dto: UserCreate, meta: RequestMeta) {
    const schoolId = dto.role === 'ADMIN' ? (dto.schoolId ?? null) : (dto.schoolId ?? user.schoolId);
    if (await this.prisma.user.findUnique({ where: { login: dto.login } })) throw new BadRequestException('Бұл логин бос емес');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: dto.role } });
    const u = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          fullName: dto.fullName,
          login: dto.login,
          passwordHash: await argon2.hash(dto.password, ARGON_OPTS),
          roleId: role.id,
          schoolId,
          title: dto.title ?? null,
          ...(dto.role !== 'ADMIN' && schoolId ? { teacher: { create: { schoolId, position: dto.title ?? null } } } : {}),
        },
      });
      await this.audit.record(user, { action: 'Пайдаланушы қосты', entity: 'user', entityId: u.id, summary: `${u.fullName} (${u.login})`, after: ROLE_LABELS_KK[dto.role] }, meta, tx);
      return u;
    });
    return { id: u.id };
  }

  private async target(user: AuthUser, id: number) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null, OR: [{ schoolId: user.schoolId }, { schoolId: null }] }, include: { role: true, teacher: true } });
    if (!u) throw new NotFoundException('Пайдаланушы табылмады');
    return u;
  }

  private async assertNotLastAdmin(id: number) {
    const admins = await this.prisma.user.count({ where: { role: { code: 'ADMIN' }, status: 'ACTIVE', deletedAt: null, id: { not: id } } });
    if (!admins) throw new BadRequestException('Жүйеде кемінде бір белсенді Admin қалуы керек');
  }

  async updateUser(user: AuthUser, id: number, dto: UserUpdate, meta: RequestMeta) {
    const u = await this.target(user, id);
    if (id === user.id && ((dto.role && dto.role !== u.role.code) || dto.status === 'BLOCKED')) throw new ForbiddenException('Өз рөліңізді немесе күйіңізді өзгерте алмайсыз');
    if (u.role.code === 'ADMIN' && ((dto.role && dto.role !== 'ADMIN') || dto.status === 'BLOCKED')) await this.assertNotLastAdmin(id);
    const role = dto.role ? await this.prisma.role.findUniqueOrThrow({ where: { code: dto.role } }) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.fullName ? { fullName: dto.fullName } : {}),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(role ? { roleId: role.id } : {}),
          ...(dto.status ? { status: dto.status } : {}),
        },
      });
      if (dto.role && dto.role !== 'ADMIN' && !u.teacher && (u.schoolId ?? user.schoolId)) {
        await tx.teacher.create({ data: { userId: id, schoolId: u.schoolId ?? user.schoolId } });
        if (!u.schoolId) await tx.user.update({ where: { id }, data: { schoolId: user.schoolId } });
      }
      if (dto.status === 'BLOCKED') await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (dto.role && dto.role !== u.role.code) {
        await this.audit.record(user, { action: 'Пайдаланушы рөлін өзгертті', entity: 'user', entityId: id, summary: u.fullName, before: ROLE_LABELS_KK[u.role.code], after: ROLE_LABELS_KK[dto.role] }, meta, tx);
      }
      if (dto.status && dto.status !== u.status) {
        const lbl = { ACTIVE: 'Белсенді', BLOCKED: 'Бұғатталған' };
        await this.audit.record(user, { action: 'Пайдаланушы күйін өзгертті', entity: 'user', entityId: id, summary: u.fullName, before: lbl[u.status], after: lbl[dto.status] }, meta, tx);
      }
      if (dto.fullName && dto.fullName !== u.fullName) {
        await this.audit.record(user, { action: 'Пайдаланушы атын өзгертті', entity: 'user', entityId: id, summary: u.login, before: u.fullName, after: dto.fullName }, meta, tx);
      }
    });
    return { ok: true };
  }

  async resetPassword(user: AuthUser, id: number, dto: PasswordReset, meta: RequestMeta) {
    const u = await this.target(user, id);
    const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash: await argon2.hash(dto.password, ARGON_OPTS), passwordChangedAt: changedAt, failedLogins: 0, lockedUntil: null } });
      await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(user, { action: 'Құпиясөзді қалпына келтірді', entity: 'user', entityId: id, summary: u.fullName }, meta, tx);
    });
    return { ok: true };
  }

  async deleteUser(user: AuthUser, id: number, meta: RequestMeta) {
    if (id === user.id) throw new ForbiddenException('Өзіңізді жоя алмайсыз');
    const u = await this.target(user, id);
    if (u.role.code === 'ADMIN') await this.assertNotLastAdmin(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), status: 'BLOCKED', login: `deleted_${id}_${u.login}`.slice(0, 64) } });
      await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (u.teacher) await tx.class.updateMany({ where: { homeroomTeacherId: u.teacher.id }, data: { homeroomTeacherId: null } });
      await this.audit.record(user, { action: 'Пайдаланушыны жойды', entity: 'user', entityId: id, summary: `${u.fullName} (${u.login})`, before: ROLE_LABELS_KK[u.role.code], after: 'жойылды' }, meta, tx);
    });
    return { ok: true };
  }

  async schools() {
    const rows = await this.prisma.$queryRaw<{ id: number; name: string; short_name: string; city: string | null; address: string | null; is_active: boolean; idp_code: string | null; students: bigint; teachers: bigint; classes: bigint }[]>`
      SELECT s.id, s.name, s.short_name, s.city, s.address, s.is_active, s.idp_code,
        (SELECT count(*) FROM students st WHERE st.school_id = s.id AND st.status = 'ACTIVE' AND st.deleted_at IS NULL) students,
        (SELECT count(*) FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.school_id = s.id AND u.deleted_at IS NULL) teachers,
        (SELECT count(*) FROM classes c JOIN school_years y ON y.id = c.school_year_id AND y.is_current WHERE c.school_id = s.id) classes
      FROM schools s ORDER BY s.id`;
    return rows.map((r) => ({ id: r.id, name: r.name, shortName: r.short_name, city: r.city, address: r.address, idpCode: r.idp_code, isActive: r.is_active, students: Number(r.students), teachers: Number(r.teachers), classes: Number(r.classes) }));
  }

  /** Жаңа мектеп: базалық оқу жылы, тоқсандар, деңгейлер мен баптаулар бірге құрылады. */
  async createSchool(user: AuthUser, dto: SchoolInput, meta: RequestMeta) {
    const cur = await this.prisma.schoolYear.findFirst({ where: { schoolId: user.schoolId, isCurrent: true }, include: { quarters: true } });
    const idpCode = await this.checkIdpCode(dto.idpCode, null);
    const s = await this.prisma.$transaction(async (tx) => {
      const s = await tx.school.create({ data: { name: dto.name, shortName: dto.shortName, address: dto.address, city: dto.city, idpCode } });
      await tx.schoolSettings.create({ data: { schoolId: s.id } });
      await tx.levelRange.createMany({ data: DEFAULT_LEVELS.map((l) => ({ ...l, schoolId: s.id })) });
      if (cur) {
        await tx.schoolYear.create({
          data: {
            schoolId: s.id,
            name: cur.name,
            startDate: cur.startDate,
            endDate: cur.endDate,
            isCurrent: true,
            quarters: { create: cur.quarters.map((q) => ({ number: q.number, startDate: q.startDate, endDate: q.endDate, reportDueDate: q.reportDueDate })) },
          },
        });
      }
      await this.audit.record(user, { action: 'Мектеп қосты', entity: 'school', entityId: s.id, summary: s.name }, meta, tx);
      return s;
    });
    return { id: s.id };
  }

  private async checkIdpCode(code: string | undefined, selfId: number | null) {
    if (!code) return null;
    const other = await this.prisma.school.findUnique({ where: { idpCode: code } });
    if (other && other.id !== selfId) throw new BadRequestException(`«${code}» коды «${other.shortName}» мектебіне берілген`);
    return code;
  }

  async updateSchool(user: AuthUser, id: number, dto: SchoolInput, meta: RequestMeta) {
    const s = await this.prisma.school.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Мектеп табылмады');
    if (dto.isActive === false && id === user.homeSchoolId) throw new BadRequestException('Өз мектебіңізді өшіре алмайсыз');
    const idpCode = dto.idpCode === undefined ? s.idpCode : await this.checkIdpCode(dto.idpCode, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.school.update({ where: { id }, data: { name: dto.name, shortName: dto.shortName, address: dto.address, city: dto.city, idpCode, ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) } });
      await this.audit.record(user, { action: 'Мектеп деректерін өзгертті', entity: 'school', entityId: id, summary: dto.name, before: { name: s.name, isActive: s.isActive, idpCode: s.idpCode }, after: { name: dto.name, isActive: dto.isActive ?? s.isActive, idpCode } }, meta, tx);
    });
    return { ok: true };
  }

  async subjects(user: AuthUser) {
    const rows = await this.prisma.subject.findMany({ where: { schoolId: user.schoolId }, include: { _count: { select: { assignments: true, assessments: true } } }, orderBy: { name: 'asc' } });
    return rows.map((s) => ({ id: s.id, name: s.name, assignments: s._count.assignments, assessments: s._count.assessments }));
  }

  async createSubject(user: AuthUser, dto: SubjectInput, meta: RequestMeta) {
    const s = await this.prisma.subject.create({ data: { schoolId: user.schoolId, name: dto.name } });
    await this.audit.record(user, { action: 'Пән қосты', entity: 'subject', entityId: s.id, summary: s.name }, meta);
    return s;
  }

  async deleteSubject(user: AuthUser, id: number, meta: RequestMeta) {
    const s = await this.prisma.subject.findFirst({ where: { id, schoolId: user.schoolId }, include: { _count: { select: { assignments: true, assessments: true, lessons: true } } } });
    if (!s) throw new NotFoundException('Пән табылмады');
    if (s._count.assignments || s._count.assessments || s._count.lessons) throw new BadRequestException('Пән қолданылуда: алдымен сабақ кестесінен алып тастаңыз');
    await this.prisma.subject.delete({ where: { id } });
    await this.audit.record(user, { action: 'Пәнді жойды', entity: 'subject', entityId: id, summary: s.name }, meta);
    return { ok: true };
  }

  async years(user: AuthUser) {
    const ys = await this.prisma.schoolYear.findMany({ where: { schoolId: user.schoolId }, include: { quarters: { orderBy: { number: 'asc' } }, _count: { select: { classes: true } } }, orderBy: { startDate: 'desc' } });
    return ys.map((y) => ({
      id: y.id,
      name: y.name,
      isCurrent: y.isCurrent,
      startDate: fmtDate(y.startDate),
      endDate: fmtDate(y.endDate),
      classes: y._count.classes,
      quarters: y.quarters.map((q) => ({ id: q.id, number: q.number, startDate: fmtDate(q.startDate), endDate: fmtDate(q.endDate), reportDueDate: fmtDate(q.reportDueDate) })),
    }));
  }

  async createYear(user: AuthUser, dto: YearInput, meta: RequestMeta) {
    const qs = dto.quarters;
    for (let i = 0; i < 4; i++) {
      if (qs[i].startDate > qs[i].endDate) throw new BadRequestException(`${i + 1}-тоқсан: басы соңынан кейін`);
      if (i && qs[i].startDate <= qs[i - 1].endDate) throw new BadRequestException(`${i + 1}-тоқсан алдыңғы тоқсанмен қабаттасады`);
    }
    const y = await this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) await tx.schoolYear.updateMany({ where: { schoolId: user.schoolId }, data: { isCurrent: false } });
      const y = await tx.schoolYear.create({
        data: {
          schoolId: user.schoolId,
          name: dto.name,
          startDate: toDate(qs[0].startDate),
          endDate: toDate(qs[3].endDate),
          isCurrent: !!dto.isCurrent,
          quarters: { create: qs.map((q, i) => ({ number: i + 1, startDate: toDate(q.startDate), endDate: toDate(q.endDate), reportDueDate: q.reportDueDate ? toDate(q.reportDueDate) : null })) },
        },
      });
      await this.audit.record(user, { action: 'Оқу жылын қосты', entity: 'school_year', entityId: y.id, summary: y.name }, meta, tx);
      return y;
    });
    return { id: y.id };
  }

  async setCurrentYear(user: AuthUser, id: number, meta: RequestMeta) {
    const y = await this.prisma.schoolYear.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!y) throw new NotFoundException('Оқу жылы табылмады');
    await this.prisma.$transaction([
      this.prisma.schoolYear.updateMany({ where: { schoolId: user.schoolId }, data: { isCurrent: false } }),
      this.prisma.schoolYear.update({ where: { id }, data: { isCurrent: true } }),
    ]);
    await this.audit.record(user, { action: 'Ағымдағы оқу жылын ауыстырды', entity: 'school_year', entityId: id, summary: y.name }, meta);
    return { ok: true };
  }

  async stats() {
    const [schools, users, students, byRole, lastLogins] = await Promise.all([
      this.prisma.school.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.student.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.user.groupBy({ by: ['roleId'], where: { deletedAt: null }, _count: true }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
    ]);
    const roles = await this.prisma.role.findMany();
    return {
      schools,
      users,
      students,
      activeLast7d: lastLogins,
      byRole: roles.map((r) => ({ role: r.code, label: ROLE_LABELS_KK[r.code], count: byRole.find((b) => b.roleId === r.id)?._count ?? 0 })),
    };
  }

  async roles() {
    const roles = await this.prisma.role.findMany({ orderBy: { id: 'asc' } });
    return roles.map((r) => ({ code: r.code, label: ROLE_LABELS_KK[r.code], permissions: r.permissions }));
  }
}

@ApiTags('admin')
@Controller('admin')
class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Get('users') @RequirePermissions(P.USERS_MANAGE)
  users(@CurrentUser() u: AuthUser, @Query() q: UserQuery) { return this.svc.users(u, q); }

  @Post('users') @RequirePermissions(P.USERS_MANAGE)
  createUser(@CurrentUser() u: AuthUser, @Body() dto: UserCreate, @ReqMeta() m: RequestMeta) { return this.svc.createUser(u, dto, m); }

  @Put('users/:id') @RequirePermissions(P.USERS_MANAGE)
  updateUser(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UserUpdate, @ReqMeta() m: RequestMeta) { return this.svc.updateUser(u, id, dto, m); }

  @Post('users/:id/password') @RequirePermissions(P.USERS_MANAGE)
  resetPassword(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PasswordReset, @ReqMeta() m: RequestMeta) { return this.svc.resetPassword(u, id, dto, m); }

  @Delete('users/:id') @RequirePermissions(P.USERS_MANAGE)
  deleteUser(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() m: RequestMeta) { return this.svc.deleteUser(u, id, m); }

  @Get('roles') @RequirePermissions(P.SETTINGS_MANAGE)
  roles() { return this.svc.roles(); }

  @Get('schools') @RequirePermissions(P.SCHOOLS_MANAGE)
  schools() { return this.svc.schools(); }

  @Post('schools') @RequirePermissions(P.SCHOOLS_MANAGE)
  createSchool(@CurrentUser() u: AuthUser, @Body() dto: SchoolInput, @ReqMeta() m: RequestMeta) { return this.svc.createSchool(u, dto, m); }

  @Put('schools/:id') @RequirePermissions(P.SCHOOLS_MANAGE)
  updateSchool(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SchoolInput, @ReqMeta() m: RequestMeta) { return this.svc.updateSchool(u, id, dto, m); }

  @Get('subjects') @RequirePermissions(P.CLASSES_MANAGE)
  subjects(@CurrentUser() u: AuthUser) { return this.svc.subjects(u); }

  @Post('subjects') @RequirePermissions(P.CLASSES_MANAGE)
  createSubject(@CurrentUser() u: AuthUser, @Body() dto: SubjectInput, @ReqMeta() m: RequestMeta) { return this.svc.createSubject(u, dto, m); }

  @Delete('subjects/:id') @RequirePermissions(P.CLASSES_MANAGE)
  deleteSubject(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() m: RequestMeta) { return this.svc.deleteSubject(u, id, m); }

  @Get('years') @RequirePermissions(P.SETTINGS_MANAGE)
  years(@CurrentUser() u: AuthUser) { return this.svc.years(u); }

  @Post('years') @RequirePermissions(P.SETTINGS_MANAGE)
  createYear(@CurrentUser() u: AuthUser, @Body() dto: YearInput, @ReqMeta() m: RequestMeta) { return this.svc.createYear(u, dto, m); }

  @Put('years/:id/current') @RequirePermissions(P.SETTINGS_MANAGE)
  setCurrent(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() m: RequestMeta) { return this.svc.setCurrentYear(u, id, m); }

  @Get('stats') @RequirePermissions(P.USERS_MANAGE)
  stats() { return this.svc.stats(); }
}

@Module({ providers: [AdminService], controllers: [AdminController] })
export class AdminModule {}
