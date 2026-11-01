import { Body, Controller, Get, Module, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { AttendanceService } from './attendance.service';
import { CalendarQuery, DayQuery, SaveSheetInput, SheetQuery } from './attendance.dto';

@ApiTags('attendance')
@Controller('attendance')
class AttendanceController {
  constructor(private readonly att: AttendanceService) {}

  @Get('lessons')
  @RequirePermissions(P.STUDENTS_READ)
  lessons(@CurrentUser() user: AuthUser, @Query() q: DayQuery) {
    return this.att.lessonsOfDay(user, q.date);
  }

  @Get('sheet')
  @RequirePermissions(P.ATTENDANCE_WRITE)
  sheet(@CurrentUser() user: AuthUser, @Query() q: SheetQuery) {
    return this.att.sheet(user, q);
  }

  @Put('sheet')
  @RequirePermissions(P.ATTENDANCE_WRITE)
  save(@CurrentUser() user: AuthUser, @Body() dto: SaveSheetInput, @ReqMeta() meta: RequestMeta) {
    return this.att.save(user, dto, meta);
  }

  @Get('calendar')
  @RequirePermissions(P.STUDENTS_READ)
  calendar(@CurrentUser() user: AuthUser, @Query() q: CalendarQuery) {
    return this.att.calendar(user, q);
  }
}

@Module({ providers: [AttendanceService], controllers: [AttendanceController], exports: [AttendanceService] })
export class AttendanceModule {}
