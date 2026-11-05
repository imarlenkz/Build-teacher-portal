import { Controller, Get, Headers, Injectable, Module, NotFoundException, Query, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public, SkipCsrf } from '../../common/decorators';
import { ScopeService } from '../core/scope.service';

class RosterQuery {
  /** iMARLEN ID мектеп коды (schools.idp_code, мыс. "s51"). */
  @Transform(({ value }) => (value == null ? value : String(value).trim()))
  @IsString()
  @MaxLength(64)
  school_code: string;
}

/**
 * Planit (checker.imarlen.kz) → Ұстаз: ағымдағы оқу жылының сыныптары мен белсенді оқушылары.
 * Тек оқу үшін. ЖСН, телефон, ата-ана деректері берілмейді.
 * Кілт: X-Integration-Key = PLANIT_INTEGRATION_KEY (Planit-тегі USTAZ_INTEGRATION_KEY-мен бірдей).
 */
@Injectable()
export class PlanitService {
  private readonly key: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {
    this.key = (config.get<string>('PLANIT_INTEGRATION_KEY') || '').trim();
  }

  checkKey(given: string | undefined) {
    if (!this.key) throw new ServiceUnavailableException('USTAZ-да PLANIT_INTEGRATION_KEY орнатылмаған');
    const a = createHash('sha256').update(String(given ?? '')).digest();
    const b = createHash('sha256').update(this.key).digest();
    if (!given || !timingSafeEqual(a, b)) throw new UnauthorizedException('Интеграция кілті қате');
  }

  async roster(schoolCode: string) {
    const school = await this.prisma.school.findFirst({
      where: { idpCode: { equals: schoolCode, mode: 'insensitive' } },
      select: { id: true, name: true, idpCode: true },
    });
    if (!school) throw new NotFoundException(`USTAZ-да «${schoolCode}» кодты мектеп жоқ (Әкімші > Мектептер > iMARLEN ID коды)`);
    const year = await this.scope.currentYear(school.id);
    const classes = await this.prisma.class.findMany({
      where: { schoolId: school.id, schoolYearId: year.id },
      orderBy: [{ grade: 'asc' }, { letter: 'asc' }],
      select: {
        id: true,
        grade: true,
        letter: true,
        name: true,
        students: {
          where: { deletedAt: null, status: 'ACTIVE' },
          orderBy: { fullName: 'asc' },
          select: { id: true, studentCode: true, fullName: true, gender: true },
        },
      },
    });
    return {
      school: { name: school.name, code: school.idpCode },
      year: year.name,
      classes: classes.map((c) => ({
        id: c.id,
        grade: c.grade,
        letter: c.letter,
        name: c.name,
        students: c.students.map((s) => ({ id: s.id, code: s.studentCode, full_name: s.fullName, gender: String(s.gender) })),
      })),
    };
  }
}

/** Planit серверінің шақыратын нүктесі: GET /api/integration/planit/roster?school_code=s51 */
@ApiTags('planit')
@Controller('integration/planit')
class PlanitIntegrationController {
  constructor(private readonly svc: PlanitService) {}

  @Public()
  @SkipCsrf()
  @Get('roster')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  roster(@Headers('x-integration-key') key: string | undefined, @Query() q: RosterQuery) {
    this.svc.checkKey(key);
    return this.svc.roster(q.school_code);
  }
}

@Module({ providers: [PlanitService], controllers: [PlanitIntegrationController] })
export class PlanitModule {}
