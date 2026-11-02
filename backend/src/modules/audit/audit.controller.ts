import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { IsDateStr } from '../../common/dto/validators';
import { AuditService } from './audit.service';

class AuditQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(40) entity?: string;
  @IsOptional() @IsDateStr() from?: string;
  @IsOptional() @IsDateStr() to?: string;
}

class AuditClearInput {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(40) entity?: string;
  @IsOptional() @IsDateStr() from?: string;
  @IsOptional() @IsDateStr() to?: string;
}

@ApiTags('audit')
@Controller('audit')
@RequirePermissions(P.AUDIT_READ)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: AuditQuery) {
    return this.audit.list(user.schoolId, q);
  }

  /** Аудитті тазалау — тек Admin (пайдаланушыларды басқара алатын рөл). */
  @Post('clear')
  @HttpCode(200)
  @RequirePermissions(P.USERS_MANAGE)
  clear(@CurrentUser() user: AuthUser, @Body() body: AuditClearInput, @ReqMeta() meta: RequestMeta) {
    return this.audit.clear(user, { search: body.search, entity: body.entity, from: body.from, to: body.to }, meta);
  }
}
