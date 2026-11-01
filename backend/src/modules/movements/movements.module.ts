import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Gender, MovementType, Prisma, StudentStatus } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { IsDateStr } from '../../common/dto/validators';
import { ScopeService } from '../core/scope.service';
import { AuditService } from '../audit/audit.service';
import { ExportService } from '../exports/export.service';
import { MOVEMENT_TYPES } from '../reference/reference.module';
import { fmtDate, fmtDot, todayStr, toDate } from '../../common/utils/dates';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
export const IN_TYPES: MovementType[] = ['ADMITTED', 'ARRIVED_FROM_SCHOOL', 'READMITTED'];
export const OUT_TYPES: MovementType[] = ['LEFT_TO_SCHOOL', 'EXPELLED'];

class MovementQuery extends PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() classId?: number;
  @IsOptional() @IsEnum(MovementType) type?: MovementType;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @Type(() => Number) @IsInt() nationalityId?: number;
  @IsOptional() @Type(() => Number) @IsInt() quarterId?: number;
  @IsOptional() @Type(() => Number) @IsInt() schoolYearId?: number;
  @IsOptional() @IsDateStr() from?: string;
  @IsOptional() @IsDateStr() to?: string;
}

class MovementExportQuery extends MovementQuery {
  @IsOptional() @IsIn(['csv', 'xlsx']) format: 'csv' | 'xlsx' = 'xlsx';
}

class MovementInput {
  @Type(() => Number) @IsInt() studentId: number;
  @IsEnum(MovementType) type: MovementType;
  @IsDateStr() date: string;
  @IsOptional() @Type(() => Number) @IsInt() toClassId?: number | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) fromSchool?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) toSchool?: string | null;
  @Transform(trim) @IsString({ message: 'Себебі міндетті' }) @MinLength(2, { message: 'Себебі міндетті' }) @MaxLength(300) reason: string;
  @Transform(trim) @IsString({ message: 'Бұйрық нөмірі міндетті' }) @MinLength(1, { message: 'Бұйрық нөмірі міндетті' }) @MaxLength(40) orderNumber: string;
  @IsOptional() @IsDateStr() orderDate?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) comment?: string | null;
}

@Injectable()
export class MovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  private async range(user: AuthUser, q: MovementQuery) {
    const year = q.schoolYearId ? await this.prisma.schoolYear.findFirstOrThrow({ where: { id: q.schoolYearId, schoolId: user.schoolId }, include: { quarters: true } }) : await this.scope.currentYear(user.schoolId);
    let from = fmtDate(year.startDate)!;
    let to = fmtDate(year.endDate)!;
    if (q.quarterId) {
      const qq = year.quarters.find((x) => x.id === q.quarterId);
      if (qq) {
        from = fmtDate(qq.startDate)!;
        to = fmtDate(qq.endDate)!;
      }
    }
    return { from: q.from ?? from, to: q.to ?? to, yearId: year.id };
  }

  private async where(user: AuthUser, q: MovementQuery): Promise<Prisma.StudentMovementWhereInput> {
    const { from, to, yearId } = await this.range(user, q);
    const ids = await this.scope.classIds(user, yearId);
    const canNat = user.permissions.includes(P.NATIONALITY_VIEW);
    return {
      schoolId: user.schoolId,
      date: { gte: toDate(from), lte: toDate(to) },
      ...(ids ? { OR: [{ fromClassId: { in: ids } }, { toClassId: { in: ids } }] } : {}),
      ...(q.classId ? { AND: [{ OR: [{ fromClassId: q.classId }, { toClassId: q.classId }] }] } : {}),
      ...(q.type ? { type: q.type } : {}),
      student: {
        deletedAt: null,
        ...(q.gender ? { gender: q.gender } : {}),
        ...(q.nationalityId && canNat ? { nationalityId: q.nationalityId } : {}),
        ...(q.search ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' as const } }, { studentCode: { contains: q.search, mode: 'insensitive' as const } }] } : {}),
      },
    };
  }

  async list(user: AuthUser, q: MovementQuery, unpaged = false) {
    const where = await this.where(user, q);
    const dir = q.dir === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.StudentMovementOrderByWithRelationInput[] =
      q.sort === 'student' ? [{ student: { fullName: dir } }] : q.sort === 'type' ? [{ type: dir }, { date: 'desc' }] : [{ date: q.sort === 'date' ? dir : 'desc' }, { id: 'desc' }];
    const [rows, total] = await Promise.all([
      this.prisma.studentMovement.findMany({
        where,
        orderBy,
        include: { student: { select: { id: true, fullName: true, studentCode: true, gender: true } }, fromClass: true, toClass: true, createdBy: { select: { fullName: true } } },
        ...(unpaged ? {} : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      }),
      this.prisma.studentMovement.count({ where }),
    ]);
    return {
      items: rows.map((m) => ({
        id: m.id,
        date: fmtDate(m.date),
        type: m.type,
        typeName: MOVEMENT_TYPES.find((t) => t.code === m.type)!.name,
        student: m.student,
        fromClass: m.fromClass?.name ?? null,
        toClass: m.toClass?.name ?? null,
        fromSchool: m.fromSchool,
        toSchool: m.toSchool,
        reason: m.reason,
        orderNumber: m.orderNumber,
        orderDate: fmtDate(m.orderDate),
        comment: m.comment,
        createdBy: m.createdBy?.fullName ?? null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async stats(user: AuthUser, q: MovementQuery) {
    const where = await this.where(user, q);
    const rows = await this.prisma.studentMovement.findMany({
      where,
      select: { type: true, date: true, student: { select: { gender: true, nationality: { select: { name: true } } } } },
    });
    const canNat = user.permissions.includes(P.NATIONALITY_VIEW);
    const nat: Record<string, number> = {};
    if (canNat) rows.forEach((r) => (nat[r.student.nationality?.name ?? 'Көрсетілмеген'] = (nat[r.student.nationality?.name ?? 'Көрсетілмеген'] ?? 0) + 1));
    const byMonth: Record<string, { in: number; out: number; move: number }> = {};
    rows.forEach((r) => {
      const m = fmtDate(r.date)!.slice(0, 7);
      byMonth[m] ??= { in: 0, out: 0, move: 0 };
      if (IN_TYPES.includes(r.type)) byMonth[m].in++;
      else if (OUT_TYPES.includes(r.type)) byMonth[m].out++;
      else byMonth[m].move++;
    });
    return {
      total: rows.length,
      arrived: rows.filter((r) => IN_TYPES.includes(r.type)).length,
      left: rows.filter((r) => OUT_TYPES.includes(r.type)).length,
      transferred: rows.filter((r) => r.type === 'TRANSFERRED_CLASS').length,
      boys: rows.filter((r) => r.student.gender === 'M').length,
      girls: rows.filter((r) => r.student.gender === 'F').length,
      byType: MOVEMENT_TYPES.map((t) => ({ code: t.code, name: t.name, dir: t.dir, count: rows.filter((r) => r.type === t.code).length })),
      byMonth: Object.entries(byMonth)
        .sort()
        .map(([month, v]) => ({ month, ...v })),
      ...(canNat ? { byNationality: Object.entries(nat).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) } : {}),
    };
  }

  async create(user: AuthUser, dto: MovementInput, meta: RequestMeta) {
    const student = await this.prisma.student.findFirst({ where: { id: dto.studentId, schoolId: user.schoolId, deletedAt: null }, include: { class: true } });
    if (!student) throw new BadRequestException('Оқушы табылмады');
    if (dto.date > todayStr()) throw new BadRequestException('Қозғалыс күні болашақта болмайды');
    if (dto.orderDate && dto.orderDate > todayStr()) throw new BadRequestException('Бұйрық күні болашақта болмайды');
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });

    const isIn = IN_TYPES.includes(dto.type);
    const isOut = OUT_TYPES.includes(dto.type);
    if (isIn || dto.type === 'TRANSFERRED_CLASS') {
      if (!dto.toClassId) throw new BadRequestException('Жаңа сыныпты таңдаңыз');
      await this.scope.assertClass(user, dto.toClassId);
    }
    // Мұғалім тек өз сыныбындағы оқушыға (немесе өз сыныбына келетін оқушыға) қозғалыс енгізеді.
    if (!this.scope.isSchoolWide(user)) {
      const ids = (await this.scope.classIds(user))!;
      const ok = (student.classId && ids.includes(student.classId)) || (dto.toClassId && ids.includes(dto.toClassId));
      if (!ok) throw new BadRequestException('Бұл оқушыға қозғалыс енгізуге рұқсат жоқ');
    }
    if (dto.type === 'TRANSFERRED_CLASS') {
      if (student.status !== 'ACTIVE') throw new BadRequestException('Оқушы қазір мектепте оқымайды');
      if (student.classId === dto.toClassId) throw new BadRequestException('Жаңа сынып бұрынғысымен бірдей');
    }
    if (isOut && student.status !== 'ACTIVE') throw new BadRequestException('Оқушы мектептен бұрын шыққан');
    if (dto.type === 'READMITTED' && student.status === 'ACTIVE') throw new BadRequestException('Оқушы қазір мектепте оқиды — қайта қабылдау мүмкін емес');
    if (dto.type === 'LEFT_TO_SCHOOL' && !dto.toSchool) throw new BadRequestException('Жаңа мектепті көрсетіңіз');
    if (dto.type === 'ARRIVED_FROM_SCHOOL' && !dto.fromSchool) throw new BadRequestException('Бұрынғы мектепті көрсетіңіз');

    const fromClassId = isIn && student.status !== 'ACTIVE' ? null : (student.classId ?? null);
    const toClassId = isOut ? null : (dto.toClassId ?? null);
    const newStatus: StudentStatus = dto.type === 'LEFT_TO_SCHOOL' ? 'LEFT' : dto.type === 'EXPELLED' ? 'EXPELLED' : 'ACTIVE';
    const toCls = toClassId ? await this.prisma.class.findUnique({ where: { id: toClassId } }) : null;

    const m = await this.prisma.$transaction(async (tx) => {
      const m = await tx.studentMovement.create({
        data: {
          schoolId: user.schoolId,
          studentId: student.id,
          type: dto.type,
          date: toDate(dto.date),
          fromClassId,
          toClassId,
          fromSchool: dto.type === 'ARRIVED_FROM_SCHOOL' ? dto.fromSchool : dto.type === 'LEFT_TO_SCHOOL' ? school.shortName : (dto.fromSchool ?? null),
          toSchool: dto.type === 'LEFT_TO_SCHOOL' ? dto.toSchool : dto.type === 'ARRIVED_FROM_SCHOOL' ? school.shortName : (dto.toSchool ?? null),
          reason: dto.reason,
          orderNumber: dto.orderNumber,
          orderDate: dto.orderDate ? toDate(dto.orderDate) : null,
          comment: dto.comment ?? null,
          createdById: user.id,
        },
      });
      await tx.student.update({
        where: { id: student.id },
        data: {
          status: newStatus,
          ...(toClassId ? { classId: toClassId } : {}),
          ...(dto.type === 'ARRIVED_FROM_SCHOOL' ? { previousSchool: dto.fromSchool, enrolledAt: toDate(dto.date) } : {}),
          ...(dto.type === 'ADMITTED' || dto.type === 'READMITTED' ? { enrolledAt: toDate(dto.date) } : {}),
        },
      });
      const tname = MOVEMENT_TYPES.find((t) => t.code === dto.type)!.name;
      await this.audit.record(
        user,
        {
          action: 'Оқушы қозғалысын енгізді',
          entity: 'movement',
          entityId: m.id,
          summary: `${student.fullName} · ${tname} · бұйрық ${dto.orderNumber}`,
          before: student.status === 'ACTIVE' ? (student.class?.name ?? '—') : '—',
          after: toCls?.name ?? (dto.toSchool || tname),
        },
        meta,
        tx,
      );
      return m;
    });
    await this.cache.bump(user.schoolId);
    return { id: m.id };
  }
}

@ApiTags('movements')
@Controller('movements')
@RequirePermissions(P.STUDENTS_READ)
class MovementsController {
  constructor(
    private readonly movements: MovementsService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: MovementQuery) {
    return this.movements.list(user, q);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query() q: MovementQuery) {
    return this.movements.stats(user, q);
  }

  @Get('export')
  @RequirePermissions(P.REPORTS_EXPORT)
  async export(@CurrentUser() user: AuthUser, @Query() q: MovementExportQuery, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const { items } = await this.movements.list(user, q, true);
    const headers = ['Күні', 'Оқушы', 'ID', 'Түрі', 'Бұрынғы сынып', 'Жаңа сынып', 'Бұрынғы мектеп', 'Жаңа мектеп', 'Себебі', 'Бұйрық №', 'Бұйрық күні', 'Түсініктеме'];
    const rows = items.map((m) => [fmtDot(m.date), m.student.fullName, m.student.studentCode, m.typeName, m.fromClass, m.toClass, m.fromSchool, m.toSchool, m.reason, m.orderNumber, fmtDot(m.orderDate), m.comment]);
    await this.audit.record(user, { action: 'Экспорт', entity: 'movement', summary: `Оқушы қозғалысы (${q.format.toUpperCase()}, ${items.length} жол)` }, meta);
    const name = `qozgalys_${todayStr()}.${q.format}`;
    if (q.format === 'csv') return this.exporter.send(res, this.exporter.csv(headers, rows), name, 'csv');
    return this.exporter.send(res, await this.exporter.xlsx([{ name: 'Қозғалыс', title: 'Оқушы қозғалысы', headers, rows }]), name, 'xlsx');
  }

  @Post()
  @RequirePermissions(P.MOVEMENTS_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: MovementInput, @ReqMeta() meta: RequestMeta) {
    return this.movements.create(user, dto, meta);
  }
}

@Module({ providers: [MovementsService], controllers: [MovementsController], exports: [MovementsService] })
export class MovementsModule {}
