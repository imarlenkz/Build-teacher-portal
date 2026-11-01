import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser } from '../../common/auth-user';
import { AnalyticsService, Period } from './analytics.service';

class DashQuery {
  @IsOptional() @IsIn(['today', 'week', 'month', 'quarter', 'year']) period: Period = 'today';
}
class AnQuery {
  @IsOptional() @Type(() => Number) @IsInt() schoolYearId?: number;
  @IsOptional() @Type(() => Number) @IsInt() classId?: number;
  @IsOptional() @Type(() => Number) @IsInt() studentId?: number;
  @IsOptional() @Type(() => Number) @IsInt() subjectId?: number;
}

@ApiTags('analytics')
@Controller('analytics')
@RequirePermissions(P.ANALYTICS_READ)
class AnalyticsController {
  constructor(private readonly an: AnalyticsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser, @Query() q: DashQuery) {
    return this.an.dashboard(user, q.period);
  }

  @Get('attendance')
  attendance(@CurrentUser() user: AuthUser, @Query() q: AnQuery) {
    return this.an.attendance(user, q);
  }

  @Get('yearly')
  yearly(@CurrentUser() user: AuthUser, @Query() q: AnQuery) {
    return this.an.yearly(user, q);
  }

  @Get('nationality')
  @RequirePermissions(P.NATIONALITY_VIEW)
  nationality(@CurrentUser() user: AuthUser, @Query() q: AnQuery) {
    return this.an.nationality(user, q);
  }

  @Get('risk')
  risk(@CurrentUser() user: AuthUser, @Query() q: AnQuery) {
    return this.an.risk(user, q);
  }
}

@Module({ providers: [AnalyticsService], controllers: [AnalyticsController], exports: [AnalyticsService] })
export class AnalyticsModule {}
