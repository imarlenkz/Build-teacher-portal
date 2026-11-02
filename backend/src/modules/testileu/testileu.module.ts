import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { CurrentUser, Public, ReqMeta, RequirePermissions, SkipCsrf } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { toDate } from '../../common/utils/dates';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../core/scope.service';
import { dayOf, detectKind, foValue, Kind, kindForGrade, KIND_LABEL, nameMatcher, parseGroupName, percentOf, pickQuarter, subjectMatcher, TOPIC_PREFIX } from './testileu.plan';

const SOURCE = 'testileu';
const str = ({ value }: { value: unknown }) => (value == null ? null : String(value).trim());

/** Тестілеудің бір аяқталған (бағаланған) әрекеті. Өріс атаулары Тестілеудің Nexus-ке жіберетін пішімімен бірдей. */
class ResultInput {
  @Transform(str) @IsString() @MaxLength(80) source_attempt_id: string;
  @IsOptional() @Transform(str) @IsString() @MaxLength(80) test_id?: string | null;
  @Transform(str) @IsString() @MaxLength(300) test_title: string;
  @IsOptional() @Transform(str) @IsString() @MaxLength(160) subject_name?: string | null;
  /** FO | BJB | TJB | ARALYK — болмаса тест атауынан анықталады. */
  @IsOptional() @Transform(str) @IsString() @MaxLength(20) kind?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber() quarter?: number | null;
  /** «5-Ә» */
  @IsOptional() @Transform(str) @IsString() @MaxLength(40) group_name?: string | null;
  @IsOptional() @Transform(str) @IsString() @MaxLength(200) teacher_email?: string | null;
  @IsOptional() @Transform(str) @IsString() @MaxLength(200) student_email?: string | null;
  @Transform(str) @IsString() @MaxLength(200) student_name: string;
  @Type(() => Number) @IsNumber() score: number;
  @Type(() => Number) @IsNumber() @Min(0) max_score: number;
  @IsOptional() @Type(() => Number) @IsNumber() percent?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() grade?: number | null;
  @Transform(str) @IsString() @MaxLength(40) submitted_at: string;
  /** Nexus сабағынан тағайындалса (Ұстазда қолданылмайды, тек қабылданады). */
  @IsOptional() @Transform(str) @IsString() @MaxLength(80) lesson_id?: string | null;
  @IsOptional() @Transform(str) @IsString() @MaxLength(20) lesson_date?: string | null;
  @IsOptional() @Transform(str) @IsString() @MaxLength(120) student_idp_sub?: string | null;
}

class ResultsInput {
  /** iMARLEN ID мектеп коды (Ұстаздағы schools.idp_code, мыс. "s51"). */
  @Transform(str) @IsString() @MaxLength(64) school_code: string;
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ResultInput)
  results: ResultInput[];
}

class ListQuery {
  @IsOptional() @IsIn(['APPLIED', 'UNMATCHED', 'SKIPPED', 'SUPERSEDED']) status?: string;
}

type Outcome = { status: 'APPLIED' | 'UNMATCHED' | 'SKIPPED' | 'SUPERSEDED'; reason: string | null; studentId: number | null; kind: Kind | null; target: string | null; className: string | null };

/** Журналдағы орынды өшіру (кейінгі әрекет басқа бағанға түссе); бос қалған Тестілеу бағаны да жойылады. */
async function dropTarget(tx: Prisma.TransactionClient, target: string | null) {
  if (!target) return;
  const [t, raw] = target.split(':');
  const id = Number(raw);
  if (!id) return;
  if (t === 'grade') {
    const g = await tx.grade.findUnique({ where: { id }, select: { columnId: true } });
    if (!g) return;
    await tx.grade.delete({ where: { id } });
    await tx.gradeColumn.deleteMany({ where: { id: g.columnId, topic: { startsWith: TOPIC_PREFIX }, grades: { none: {} } } });
  } else if (t === 'result') {
    const r = await tx.assessmentResult.findUnique({ where: { id }, select: { assessmentId: true } });
    if (!r) return;
    await tx.assessmentResult.delete({ where: { id } });
    await tx.assessment.deleteMany({ where: { id: r.assessmentId, title: { startsWith: TOPIC_PREFIX }, results: { none: {} } } });
  }
}

/**
 * Тестілеу (test.imarlen.kz) → Ұстаз журналы.
 * Тестілеу әр бағаланған әрекетті серверден серверге жібереді (X-Integration-Key = TESTILEU_INTEGRATION_KEY).
 * ФО тесті — сабақ күнінің бағанына 1–10 балл; БЖБ/ТЖБ/аралық — жиынтық бағалау нәтижесі.
 */
@Injectable()
export class TestileuService {
  private readonly log = new Logger('Testileu');
  private readonly key: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {
    this.key = (config.get<string>('TESTILEU_INTEGRATION_KEY') || '').trim();
  }

  get configured() {
    return !!this.key;
  }

  checkKey(given: string | undefined) {
    if (!this.key) throw new ServiceUnavailableException('USTAZ-да TESTILEU_INTEGRATION_KEY орнатылмаған');
    const a = createHash('sha256').update(String(given ?? '')).digest();
    const b = createHash('sha256').update(this.key).digest();
    if (!given || !timingSafeEqual(a, b)) throw new UnauthorizedException('Интеграция кілті қате');
  }

  async receive(dto: ResultsInput, meta?: RequestMeta) {
    const school = await this.prisma.school.findFirst({
      where: { idpCode: { equals: dto.school_code, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!school) throw new NotFoundException(`USTAZ-да «${dto.school_code}» кодты мектеп жоқ (Әкімші > Мектептер > iMARLEN ID коды)`);
    const saved = await this.store(school.id, dto.results);
    const out = await this.process(school.id, saved);
    await this.audit.record(
      { schoolId: school.id, system: 'Тестілеу' },
      {
        action: 'Тестілеу нәтижелерін қабылдады',
        entity: 'external_result',
        summary: `${dto.results.length} нәтиже: ${out.applied} журналға түсті, ${out.unmatched} сәйкестенбеді, ${out.skipped} өткізілді`,
        after: out,
      },
      meta,
    );
    return out;
  }

  /** Келген нәтижелерді сақтау (қайта жіберілсе — жаңарту). */
  private async store(schoolId: number, results: ResultInput[]) {
    const ids: number[] = [];
    for (const r of results) {
      const submitted = new Date(r.submitted_at);
      const data = {
        schoolId,
        testId: r.test_id ?? null,
        testTitle: r.test_title,
        subjectName: r.subject_name ?? null,
        className: r.group_name ?? null,
        studentName: r.student_name,
        percent: Math.round(percentOf(r) * 100) / 100,
        submittedAt: Number.isNaN(submitted.getTime()) ? new Date() : submitted,
        payload: { ...r } as unknown as Prisma.InputJsonValue,
      };
      const row = await this.prisma.externalResult.upsert({
        where: { source_sourceId: { source: SOURCE, sourceId: r.source_attempt_id } },
        create: { source: SOURCE, sourceId: r.source_attempt_id, status: 'UNMATCHED', ...data },
        update: data,
        select: { id: true },
      });
      ids.push(row.id);
    }
    return ids;
  }

  /** Сақталған нәтижелерді журналға түсіру (ескі әрекеттер бірінші, кейінгісі алмастырады). */
  async process(schoolId: number, ids: number[]) {
    const rows = await this.prisma.externalResult.findMany({ where: { id: { in: ids }, schoolId }, orderBy: { submittedAt: 'asc' } });
    const year = await this.scope.currentYear(schoolId);
    const [classes, subjects, teachers] = await Promise.all([
      this.prisma.class.findMany({ where: { schoolId, schoolYearId: year.id }, select: { id: true, grade: true, letter: true, name: true } }),
      this.prisma.subject.findMany({ where: { schoolId }, select: { id: true, name: true } }),
      this.prisma.teacher.findMany({ where: { schoolId, user: { deletedAt: null, email: { not: null } } }, select: { id: true, user: { select: { email: true } } } }),
    ]);
    const subjectOf = subjectMatcher(subjects);
    const teacherByEmail = new Map(teachers.map((t) => [t.user.email!.toLowerCase(), t.id]));
    const studentCache = new Map<number, (n: string) => number | null>();
    const studentsOf = async (classId: number) => {
      if (!studentCache.has(classId)) {
        const list = await this.prisma.student.findMany({ where: { schoolId, classId, deletedAt: null }, select: { id: true, fullName: true } });
        studentCache.set(classId, nameMatcher(list));
      }
      return studentCache.get(classId)!;
    };
    let wholeSchool: ((n: string) => number | null) | null = null;
    const counts = { received: rows.length, applied: 0, unmatched: 0, skipped: 0, superseded: 0 };
    const results: { source_attempt_id: string; status: string; reason: string | null }[] = [];

    for (const row of rows) {
      const p = row.payload as unknown as ResultInput;
      let o: Outcome;
      try {
        o = await this.applyOne(schoolId, row, p, {
          year,
          classes,
          subjectOf,
          teacherByEmail,
          studentsOf,
          wholeSchool: async () => {
            if (!wholeSchool) {
              const list = await this.prisma.student.findMany({ where: { schoolId, deletedAt: null, status: 'ACTIVE', class: { schoolYearId: year.id } }, select: { id: true, fullName: true } });
              wholeSchool = nameMatcher(list);
            }
            return wholeSchool;
          },
        });
      } catch (e) {
        this.log.error(`apply ${row.sourceId} failed: ${(e as Error).message}`);
        o = { status: 'UNMATCHED', reason: 'Сақтау қатесі — кейін «Қайта өңдеу» батырмасымен қайталаңыз', studentId: null, kind: null, target: null, className: null };
      }
      await this.prisma.externalResult.update({
        where: { id: row.id },
        data: { status: o.status, reason: o.reason, studentId: o.studentId, kind: o.kind, ...(o.status === 'APPLIED' ? { target: o.target } : {}), ...(o.className ? { className: o.className } : {}) },
      });
      counts[o.status === 'APPLIED' ? 'applied' : o.status === 'UNMATCHED' ? 'unmatched' : o.status === 'SKIPPED' ? 'skipped' : 'superseded']++;
      results.push({ source_attempt_id: row.sourceId, status: o.status, reason: o.reason });
    }
    if (counts.applied) await this.cache.bump(schoolId);
    return { ...counts, results };
  }

  private async applyOne(
    schoolId: number,
    row: { id: number; testId: string | null; submittedAt: Date; target: string | null; status: string },
    p: ResultInput,
    ctx: {
      year: { id: number; name: string; quarters: { id: number; number: number; startDate: Date; endDate: Date }[] };
      classes: { id: number; grade: number; letter: string; name: string }[];
      subjectOf: (n: string | null | undefined) => number | null;
      teacherByEmail: Map<string, number>;
      studentsOf: (classId: number) => Promise<(n: string) => number | null>;
      wholeSchool: () => Promise<(n: string) => number | null>;
    },
  ): Promise<Outcome> {
    const fail = (reason: string, extra: Partial<Outcome> = {}): Outcome => ({ status: 'UNMATCHED', reason, studentId: null, kind: null, target: null, className: null, ...extra });
    const day = dayOf(p.submitted_at);
    if (!day) return fail('Тапсырылған уақыты танылмады');
    const quarter = pickQuarter(ctx.year.quarters, day, p.quarter ?? null);
    if (!quarter) return fail(`${day} күні ${ctx.year.name} оқу жылының тоқсандарына кірмейді`);

    // Оқушы: алдымен Тестілеудегі сыныбынан, болмаса бүкіл мектептен (аты-жөні бірегей болса).
    const g = parseGroupName(p.group_name);
    let cls = g ? ctx.classes.find((c) => c.grade === g.grade && c.letter.toUpperCase() === g.letter) : undefined;
    let studentId = cls ? (await ctx.studentsOf(cls.id))(p.student_name) : null;
    if (!studentId) {
      const any = (await ctx.wholeSchool())(p.student_name);
      if (any) {
        const st = await this.prisma.student.findUnique({ where: { id: any }, select: { classId: true } });
        const c2 = ctx.classes.find((c) => c.id === st?.classId);
        if (c2) (cls = c2), (studentId = any);
      }
    }
    if (!studentId || !cls) return fail(`Оқушы табылмады: ${p.student_name}${p.group_name ? ` (${p.group_name})` : ''}`);

    const subjectId = ctx.subjectOf(p.subject_name);
    if (!subjectId) return fail(p.subject_name ? `USTAZ-да «${p.subject_name}» пәні жоқ` : 'Тестте пән көрсетілмеген', { studentId, className: cls.name });

    const k = kindForGrade(detectKind(p.kind, p.test_title), cls.grade);
    if ('skip' in k) return { status: 'SKIPPED', reason: k.skip, studentId, kind: null, target: null, className: cls.name };
    const kind = k.kind;

    // Бір оқушының бір тестті қайта тапсыруы: тек ең соңғысы журналда қалады.
    if (row.testId) {
      const newer = await this.prisma.externalResult.findFirst({
        where: { schoolId, source: SOURCE, testId: row.testId, studentId, status: 'APPLIED', submittedAt: { gt: row.submittedAt }, id: { not: row.id } },
        select: { id: true },
      });
      if (newer) return { status: 'SUPERSEDED', reason: 'Оқушы бұл тестті кейін қайта тапсырды', studentId, kind, target: null, className: cls.name };
    }

    const member = await this.prisma.subjectGroupMember.findUnique({
      where: { classId_subjectId_studentId: { classId: cls.id, subjectId, studentId } },
      select: { groupId: true },
    });
    const groupId = member?.groupId ?? null;
    const teacherId = p.teacher_email ? ctx.teacherByEmail.get(p.teacher_email.toLowerCase()) ?? null : null;
    const title = `${TOPIC_PREFIX}${p.test_title}`.slice(0, 190);
    const percent = percentOf(p);

    const target = await this.prisma.$transaction(async (tx) => {
      let target: string;
      if (kind === 'FO') {
        let col = await tx.gradeColumn.findFirst({ where: { classId: cls!.id, subjectId, quarterId: quarter.id, groupId, date: toDate(day), topic: title }, select: { id: true } });
        col ??= await tx.gradeColumn.create({
          data: { schoolId, classId: cls!.id, subjectId, quarterId: quarter.id, groupId, teacherId, date: toDate(day), topic: title },
          select: { id: true },
        });
        const gr = await tx.grade.upsert({
          where: { columnId_studentId: { columnId: col.id, studentId: studentId! } },
          create: { columnId: col.id, studentId: studentId!, value: foValue(percent) },
          update: { value: foValue(percent) },
          select: { id: true },
        });
        target = `grade:${gr.id}`;
      } else {
        let a = await tx.assessment.findFirst({ where: { classId: cls!.id, subjectId, quarterId: quarter.id, groupId, type: kind, title }, select: { id: true, maxScore: true } });
        a ??= await tx.assessment.create({
          data: { schoolId, type: kind, classId: cls!.id, subjectId, quarterId: quarter.id, groupId, teacherId, title, maxScore: p.max_score, date: toDate(day) },
          select: { id: true, maxScore: true },
        });
        // Бағалаудың ең жоғары баллы басқаша болса (тест өзгертілген), балл пайыз бойынша қайта есептеледі.
        const max = Number(a.maxScore);
        const score = max === p.max_score ? p.score : Math.round(((percent * max) / 100) * 100) / 100;
        const res = await tx.assessmentResult.upsert({
          where: { assessmentId_studentId: { assessmentId: a.id, studentId: studentId! } },
          create: { assessmentId: a.id, studentId: studentId!, score, percent: Math.round(percent * 100) / 100 },
          update: { score, percent: Math.round(percent * 100) / 100, absent: false },
          select: { id: true },
        });
        target = `result:${res.id}`;
      }
      // Осы оқушының осы тестінің бұрынғы әрекеттері басқа орынға түскен болса — өшіріледі.
      if (row.testId) {
        const older = await tx.externalResult.findMany({
          where: { schoolId, source: SOURCE, testId: row.testId, studentId, status: 'APPLIED', id: { not: row.id } },
          select: { id: true, target: true },
        });
        for (const o of older) {
          if (o.target && o.target !== target) await dropTarget(tx, o.target);
          await tx.externalResult.update({ where: { id: o.id }, data: { status: 'SUPERSEDED', reason: 'Оқушы бұл тестті кейін қайта тапсырды', target: null } });
        }
      }
      if (row.target && row.target !== target && row.status === 'APPLIED') await dropTarget(tx, row.target);
      return target;
    });
    return { status: 'APPLIED', reason: `${KIND_LABEL[kind]} · ${quarter.number}-тоқсан`, studentId, kind, target, className: cls.name };
  }

  async list(user: AuthUser, q: ListQuery) {
    const where = { schoolId: user.schoolId, source: SOURCE, ...(q.status ? { status: q.status } : {}) };
    const [items, grouped] = await Promise.all([
      this.prisma.externalResult.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        take: 300,
        select: { id: true, testTitle: true, subjectName: true, className: true, studentName: true, kind: true, percent: true, submittedAt: true, status: true, reason: true, updatedAt: true },
      }),
      this.prisma.externalResult.groupBy({ by: ['status'], where: { schoolId: user.schoolId, source: SOURCE }, _count: true }),
    ]);
    const school = await this.prisma.school.findUnique({ where: { id: user.schoolId }, select: { idpCode: true } });
    return {
      configured: this.configured,
      schoolCode: school?.idpCode ?? null,
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count])),
      items: items.map((i) => ({ ...i, percent: Number(i.percent) })),
    };
  }

  /** Сәйкестенбеген / өткізілген нәтижелерді қайта өңдеу (оқушы, пән немесе сынып түзетілгеннен кейін). */
  async retry(user: AuthUser, meta: RequestMeta) {
    const rows = await this.prisma.externalResult.findMany({ where: { schoolId: user.schoolId, source: SOURCE, status: { in: ['UNMATCHED', 'SKIPPED'] } }, select: { id: true }, take: 5000 });
    const out = await this.process(user.schoolId, rows.map((r) => r.id));
    await this.audit.record(user, { action: 'Тестілеу нәтижелерін қайта өңдеді', entity: 'external_result', summary: `${out.received} нәтиже: ${out.applied} журналға түсті, ${out.unmatched} сәйкестенбеді`, after: { ...out, results: undefined } }, meta);
    return { ...out, results: undefined };
  }
}

/** Тестілеу серверінің шақыратын нүктесі: POST /api/integration/testileu/results */
@ApiTags('testileu')
@Controller('integration/testileu')
class TestileuIntegrationController {
  constructor(private readonly svc: TestileuService) {}

  @Public()
  @SkipCsrf()
  @Post('results')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async results(@Headers('x-integration-key') key: string | undefined, @Body() dto: ResultsInput, @ReqMeta() meta: RequestMeta) {
    this.svc.checkKey(key);
    return this.svc.receive(dto, meta);
  }
}

@ApiTags('testileu')
@Controller('testileu')
@RequirePermissions(P.CLASSES_MANAGE)
class TestileuAdminController {
  constructor(private readonly svc: TestileuService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    return this.svc.list(user, q);
  }

  @Post('retry')
  @HttpCode(200)
  retry(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.svc.retry(user, meta);
  }
}

@Module({ providers: [TestileuService], controllers: [TestileuIntegrationController, TestileuAdminController] })
export class TestileuModule {}
