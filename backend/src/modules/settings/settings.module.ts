import { BadRequestException, Body, Controller, Get, Injectable, Module, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { LevelsService } from '../core/levels.service';
import { AuditService } from '../audit/audit.service';
import { validateLevels } from '../../common/utils/stats';

class LevelInput {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(1) @MaxLength(30) name: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) fromPct: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) toPct: number;
}
class LevelsInput {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => LevelInput) levels: LevelInput[];
}
class SchoolSettingsInput {
  @Type(() => Number) @IsInt() @Min(50) @Max(100) attendanceThreshold: number;
}
class MeInput {
  @IsOptional() @IsIn(['kk', 'ru', 'en']) locale?: string;
}

@Injectable()
class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly levels: LevelsService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async get(user: AuthUser) {
    return { levels: await this.levels.get(user.schoolId), settings: await this.levels.settings(user.schoolId) };
  }

  async setLevels(user: AuthUser, dto: LevelsInput, meta: RequestMeta) {
    const err = validateLevels(dto.levels);
    if (err) throw new BadRequestException(err);
    const before = await this.levels.get(user.schoolId);
    const sorted = [...dto.levels].sort((a, b) => a.fromPct - b.fromPct);
    const fmt = (l: { name: string; fromPct: number; toPct: number }) => `${l.name} ${l.fromPct}–${l.toPct}%`;
    const changed = sorted.filter((l, i) => !before[i] || before[i].name !== l.name || before[i].fromPct !== l.fromPct || before[i].toPct !== l.toPct);
    await this.prisma.$transaction(async (tx) => {
      await tx.levelRange.deleteMany({ where: { schoolId: user.schoolId } });
      await tx.levelRange.createMany({ data: sorted.map((l, i) => ({ schoolId: user.schoolId, name: l.name, fromPct: l.fromPct, toPct: l.toPct, order: i })) });
      await this.audit.record(
        user,
        {
          action: 'Деңгей диапазонын өзгертті',
          entity: 'level_ranges',
          summary: changed.length ? `«${changed.map((c) => c.name).join('», «')}»` : 'өзгеріссіз',
          before: before.map(fmt).join('; '),
          after: sorted.map(fmt).join('; '),
        },
        meta,
        tx,
      );
    });
    await this.cache.bump(user.schoolId);
    return this.get(user);
  }

  async setSchool(user: AuthUser, dto: SchoolSettingsInput, meta: RequestMeta) {
    const before = await this.levels.settings(user.schoolId);
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolSettings.upsert({ where: { schoolId: user.schoolId }, create: { schoolId: user.schoolId, attendanceThreshold: dto.attendanceThreshold }, update: { attendanceThreshold: dto.attendanceThreshold } });
      await this.audit.record(user, { action: 'Қатысу шегін өзгертті', entity: 'school_settings', summary: 'Ескерту шегі', before: `${before.attendanceThreshold}%`, after: `${dto.attendanceThreshold}%` }, meta, tx);
    });
    await this.cache.bump(user.schoolId);
    return this.get(user);
  }

  async setMe(user: AuthUser, dto: MeInput) {
    if (dto.locale) await this.prisma.user.update({ where: { id: user.id }, data: { locale: dto.locale } });
    return { ok: true };
  }
}

@ApiTags('settings')
@Controller('settings')
class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.svc.get(user);
  }

  @Put('levels')
  @RequirePermissions(P.LEVELS_MANAGE)
  levels(@CurrentUser() user: AuthUser, @Body() dto: LevelsInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.setLevels(user, dto, meta);
  }

  @Put('school')
  @RequirePermissions(P.SETTINGS_MANAGE)
  school(@CurrentUser() user: AuthUser, @Body() dto: SchoolSettingsInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.setSchool(user, dto, meta);
  }

  @Put('me')
  me(@CurrentUser() user: AuthUser, @Body() dto: MeInput) {
    return this.svc.setMe(user, dto);
  }
}

@Module({ providers: [SettingsService], controllers: [SettingsController] })
export class SettingsModule {}
