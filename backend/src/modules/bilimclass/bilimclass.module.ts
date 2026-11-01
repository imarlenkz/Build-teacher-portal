import { BadRequestException, Body, Controller, HttpCode, Injectable, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { fmtDate, fmtDot, toDate } from '../../common/utils/dates';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../core/scope.service';
import { buildPlan, groupKey, normName, parseClassName, Plan } from './bilimclass.plan';

const str = ({ value }: { value: unknown }) => (value == null ? null : String(value).trim());

class GroupRowInput {
  @Transform(str) @IsString() @MaxLength(160) subject: string;
  @Transform(str) @IsString() @MaxLength(80) group: string;
  @IsOptional() @Transform(str) @IsString() @MaxLength(160) teacher?: string | null;
  @Transform(str) @IsString() @MaxLength(200) student: string;
}

class GradeRowInput {
  @Transform(str) @IsString() @MaxLength(160) subject: string;
  @Transform(str) @IsString() @MaxLength(80) group: string;
  @Transform(str) @IsString() @MaxLength(200) student: string;
  @IsOptional() @Transform(str) @IsString() @MaxLength(20) date?: string | null;
  @IsOptional() @Transform(str) @IsString() @MaxLength(30) type?: string | null;
  @IsOptional() @Transform(str) @IsString() @MaxLength(20) mark?: string | null;
  @IsOptional() @Transform(str) @IsString() @MaxLength(20) max?: string | null;
  @IsOptional() @Transform(str) @IsString() @MaxLength(20) quarterMark?: string | null;
}

/** Бір сыныптың BilimClass деректері (фронтенд CSV файлдарын сыныптарға бөліп, бір-бірлеп жібереді). */
class BilimClassClassInput {
  @Transform(str) @IsString() @MaxLength(40) className: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(4) quarter: number;
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => GroupRowInput)
  groups: GroupRowInput[];
  @IsArray()
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => GradeRowInput)
  grades: GradeRowInput[];
  /** Ұстазда жоқ пәндерді жасау (әдепкі: жоқ — ол пәндер өткізіледі). */
  @IsOptional() @IsBoolean() createSubjects?: boolean;
  @IsOptional() @IsBoolean() apply?: boolean;
}

export interface ClassImportResult {
  applied: boolean;
  className: string;
  portalClass: string | null;
  quarter: number;
  students: Plan['students'];
  subjects: string[];
  missingSubjects: string[];
  groups: { total: number; create: number; members: number };
  fo: { columns: number; create: number; marks: number };
  summative: { total: number; create: number; results: number };
  quarterMarks: number;
  skipped: number;
  warnings: string[];
}

@Injectable()
export class BilimClassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async importClass(user: AuthUser, dto: BilimClassClassInput, meta: RequestMeta): Promise<ClassImportResult> {
    const year = await this.scope.currentYear(user.schoolId);
    const quarter = year.quarters.find((q) => q.number === dto.quarter);
    if (!quarter) throw new BadRequestException(`${year.name} оқу жылында ${dto.quarter}-тоқсан бапталмаған`);
    const parsed = parseClassName(dto.className);
    const empty = (warnings: string[]): ClassImportResult => ({
      applied: false,
      className: dto.className,
      portalClass: null,
      quarter: dto.quarter,
      students: {
        file: new Set([...dto.groups, ...dto.grades].map((r) => normName(r.student))).size,
        matched: 0,
        unmatched: [],
      },
      subjects: [],
      missingSubjects: [],
      groups: { total: 0, create: 0, members: 0 },
      fo: { columns: 0, create: 0, marks: 0 },
      summative: { total: 0, create: 0, results: 0 },
      quarterMarks: 0,
      skipped: dto.groups.length + dto.grades.length,
      warnings,
    });
    if (!parsed) return empty([`«${dto.className}» сынып атауы танылмады — сынып өткізілді`]);
    const cls = await this.prisma.class.findFirst({
      where: {
        schoolId: user.schoolId,
        schoolYearId: year.id,
        grade: parsed.grade,
        letter: parsed.letter,
      },
    });
    if (!cls) return empty([`Ұстазда ${parsed.grade} ${parsed.letter} сыныбы жоқ (${year.name}) — сынып өткізілді`]);

    const [students, subjects, teachers, existingGroups] = await Promise.all([
      this.prisma.student.findMany({
        where: { schoolId: user.schoolId, classId: cls.id, deletedAt: null },
        select: { id: true, fullName: true },
      }),
      this.prisma.subject.findMany({
        where: { schoolId: user.schoolId },
        select: { id: true, name: true },
      }),
      this.prisma.teacher.findMany({
        where: { schoolId: user.schoolId, user: { deletedAt: null } },
        select: { id: true, user: { select: { fullName: true } } },
      }),
      this.prisma.subjectGroup.findMany({
        where: { classId: cls.id },
        select: { id: true, subjectId: true, name: true, teacherId: true },
      }),
    ]);
    const plan = buildPlan(dto.groups, dto.grades, {
      grade: cls.grade,
      students,
      subjects,
      teachers: teachers.map((t) => ({ id: t.id, fullName: t.user.fullName })),
    });
    const warnings = [...plan.warnings];
    const createSubjects = !!dto.createSubjects;
    const subjectId = new Map(subjects.map((s) => [normName(s.name), s.id]));
    const hasSubject = (name: string) => subjectId.has(normName(name)) || createSubjects;
    if (plan.missingSubjects.length && !createSubjects) warnings.unshift(`Ұстазда жоқ пәндер өткізіледі: ${plan.missingSubjects.join(', ')}`);

    const groups = plan.groups.filter((g) => hasSubject(g.subject));
    const fo = plan.fo.filter((c) => hasSubject(c.subject));
    const sums = plan.summatives.filter((s) => hasSubject(s.subject));
    const finals = plan.quarterMarks.filter((q) => hasSubject(q.subject));

    const existingGroup = (sid: number | undefined, key: string) => (sid == null ? undefined : existingGroups.find((g) => g.subjectId === sid && groupKey(g.name) === key));

    // Бар бағандар мен бағалауларды алдын ала жүктеу (preview санағы мен apply үшін).
    const [columns, assessments] = await Promise.all([
      this.prisma.gradeColumn.findMany({
        where: { classId: cls.id, quarterId: quarter.id },
        select: { id: true, subjectId: true, groupId: true, date: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.assessment.findMany({
        where: { classId: cls.id, quarterId: quarter.id },
        select: {
          id: true,
          subjectId: true,
          groupId: true,
          type: true,
          date: true,
          maxScore: true,
        },
      }),
    ]);
    const groupIdFor = (sid: number | undefined, key: string | null, created?: Map<string, number>) => {
      if (key == null) return null;
      return existingGroup(sid, key)?.id ?? created?.get(`${sid}|${key}`) ?? null;
    };
    const findColumn = (sid: number | undefined, gid: number | null, date: string, slot: number) =>
      columns.filter((c) => c.subjectId === sid && c.groupId === gid && fmtDate(c.date) === date)[slot];
    const findAssessment = (sid: number | undefined, gid: number | null, s: Plan['summatives'][number]) =>
      assessments.find((a) => a.subjectId === sid && a.groupId === gid && a.type === s.type && (fmtDate(a.date) ?? null) === s.date && Number(a.maxScore) === s.maxScore);

    const sidOf = (name: string) => subjectId.get(normName(name));
    const outside = fo.filter((c) => c.date < fmtDate(quarter.startDate)! || c.date > fmtDate(quarter.endDate)!).length;
    if (outside) warnings.push(`${outside} ФО бағаны ${dto.quarter}-тоқсан аралығынан тыс (${fmtDot(quarter.startDate)} – ${fmtDot(quarter.endDate)}), бірақ импортталады`);

    const result: ClassImportResult = {
      applied: false,
      className: dto.className,
      portalClass: cls.name,
      quarter: dto.quarter,
      students: plan.students,
      subjects: plan.subjects,
      missingSubjects: plan.missingSubjects,
      groups: {
        total: groups.length,
        create: groups.filter((g) => !existingGroup(sidOf(g.subject), g.key)).length,
        members: groups.reduce((n, g) => n + g.members.length, 0),
      },
      fo: {
        columns: fo.length,
        create: fo.filter((c) => {
          const sid = sidOf(c.subject);
          const g = c.groupKey == null ? null : existingGroup(sid, c.groupKey)?.id;
          return g === undefined || !findColumn(sid, g ?? null, c.date, c.slot);
        }).length,
        marks: fo.reduce((n, c) => n + c.marks.length, 0),
      },
      summative: {
        total: sums.length,
        create: sums.filter((s) => {
          const sid = sidOf(s.subject);
          const g = s.groupKey == null ? null : existingGroup(sid, s.groupKey)?.id;
          return g === undefined || !findAssessment(sid, g ?? null, s);
        }).length,
        results: sums.reduce((n, s) => n + s.results.length, 0),
      },
      quarterMarks: finals.length,
      skipped: plan.skipped,
      warnings,
    };
    if (!dto.apply) return result;

    await this.prisma.$transaction(
      async (tx) => {
        // Пәндер
        if (createSubjects) {
          for (const name of plan.missingSubjects) {
            const s = await tx.subject.upsert({
              where: { schoolId_name: { schoolId: user.schoolId, name } },
              create: { schoolId: user.schoolId, name },
              update: {},
            });
            subjectId.set(normName(name), s.id);
          }
        }
        // Топтар және мүшелері
        const createdGroups = new Map<string, number>();
        let order = existingGroups.length;
        for (const g of groups) {
          const sid = sidOf(g.subject)!;
          const ex = existingGroup(sid, g.key);
          let id: number;
          if (ex) {
            id = ex.id;
            if (g.teacherId && ex.teacherId !== g.teacherId)
              await tx.subjectGroup.update({
                where: { id },
                data: { teacherId: g.teacherId },
              });
          } else {
            const c = await tx.subjectGroup.create({
              data: {
                schoolId: user.schoolId,
                classId: cls.id,
                subjectId: sid,
                name: g.name,
                teacherId: g.teacherId,
                order: order++,
              },
            });
            id = c.id;
          }
          createdGroups.set(`${sid}|${g.key}`, id);
          if (g.members.length) {
            await tx.subjectGroupMember.deleteMany({
              where: {
                classId: cls.id,
                subjectId: sid,
                studentId: { in: g.members },
              },
            });
            await tx.subjectGroupMember.createMany({
              data: g.members.map((studentId) => ({
                groupId: id,
                studentId,
                classId: cls.id,
                subjectId: sid,
              })),
            });
          }
        }
        // ФО бағандары мен бағалары
        for (const c of fo) {
          const sid = sidOf(c.subject)!;
          const gid = groupIdFor(sid, c.groupKey, createdGroups);
          let col = findColumn(sid, gid, c.date, c.slot);
          if (!col) {
            const made = await tx.gradeColumn.create({
              data: {
                schoolId: user.schoolId,
                classId: cls.id,
                subjectId: sid,
                quarterId: quarter.id,
                groupId: gid,
                date: toDate(c.date),
                topic: 'BilimClass',
              },
              select: { id: true, subjectId: true, groupId: true, date: true },
            });
            columns.push(made);
            col = made;
          }
          const ids = c.marks.map((m) => m.studentId);
          await tx.grade.deleteMany({
            where: { columnId: col.id, studentId: { in: ids } },
          });
          await tx.grade.createMany({
            data: c.marks.map((m) => ({
              columnId: col!.id,
              studentId: m.studentId,
              value: m.value,
              updatedById: user.id,
            })),
          });
        }
        // БЖБ / ТЖБ / аралық бағалау
        for (const s of sums) {
          const sid = sidOf(s.subject)!;
          const gid = groupIdFor(sid, s.groupKey, createdGroups);
          let a = findAssessment(sid, gid, s);
          if (!a) {
            const made = await tx.assessment.create({
              data: {
                schoolId: user.schoolId,
                type: s.type,
                classId: cls.id,
                subjectId: sid,
                quarterId: quarter.id,
                groupId: gid,
                title: s.title,
                maxScore: s.maxScore,
                date: s.date ? toDate(s.date) : null,
              },
              select: {
                id: true,
                subjectId: true,
                groupId: true,
                type: true,
                date: true,
                maxScore: true,
              },
            });
            assessments.push(made);
            a = made;
          }
          await tx.assessmentResult.deleteMany({
            where: {
              assessmentId: a.id,
              studentId: { in: s.results.map((r) => r.studentId) },
            },
          });
          await tx.assessmentResult.createMany({
            data: s.results.map((r) => ({
              assessmentId: a!.id,
              studentId: r.studentId,
              score: r.score,
              percent: r.percent,
            })),
          });
        }
        // Тоқсандық бағалар
        const bySubject = new Map<number, { studentId: number; mark: number }[]>();
        for (const q of finals) {
          const sid = sidOf(q.subject)!;
          bySubject.set(sid, [...(bySubject.get(sid) ?? []), q]);
        }
        for (const [sid, list] of bySubject) {
          await tx.quarterGrade.deleteMany({
            where: {
              quarterId: quarter.id,
              classId: cls.id,
              subjectId: sid,
              studentId: { in: list.map((x) => x.studentId) },
            },
          });
          await tx.quarterGrade.createMany({
            data: list.map((x) => ({
              schoolId: user.schoolId,
              quarterId: quarter.id,
              classId: cls.id,
              subjectId: sid,
              studentId: x.studentId,
              mark: x.mark,
              updatedById: user.id,
            })),
          });
        }
        await this.audit.record(
          user,
          {
            action: 'BilimClass-тан импорттады',
            entity: 'class',
            entityId: cls.id,
            summary: `${cls.name} · ${dto.quarter}-тоқсан: ${result.groups.total} топ, ${result.fo.marks} ФО, ${result.summative.results} БЖБ/ТЖБ/аралық нәтиже, ${result.quarterMarks} тоқсандық баға`,
            after: {
              groups: result.groups,
              fo: result.fo,
              summative: result.summative,
              quarterMarks: result.quarterMarks,
              unmatchedStudents: result.students.unmatched.length,
              skipped: result.skipped,
            },
          },
          meta,
          tx,
        );
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    await this.cache.bump(user.schoolId);
    return { ...result, applied: true };
  }
}

@ApiTags('bilimclass')
@Controller('bilimclass')
@RequirePermissions(P.CLASSES_MANAGE)
class BilimClassController {
  constructor(private readonly svc: BilimClassService) {}

  /** Бір сыныптың топтары мен бағаларын импорттау: apply=false — алдын ала қарау, apply=true — сақтау. */
  @Post('import')
  @HttpCode(200)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  importClass(@CurrentUser() user: AuthUser, @Body() dto: BilimClassClassInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.importClass(user, dto, meta);
  }
}

@Module({ providers: [BilimClassService], controllers: [BilimClassController] })
export class BilimClassModule {}
