import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser } from '../../common/auth-user';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { IsDateStr } from '../../common/dto/validators';
import { AuditService } from './audit.service';

class AuditQuery extends PaginationQuery {
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
}
