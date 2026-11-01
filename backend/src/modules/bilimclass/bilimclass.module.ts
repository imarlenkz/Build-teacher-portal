import { BadRequestException, Body, Controller, HttpCode, Injectable, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
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
  /** BilimClass пәнінің атауы → Ұстаздағы пәннің id-і, немесе 'new' (жаңа пән жасау). */
  @IsOptional() @IsObject() subjectMap?: Record<string, number | 'new'>;
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
    // Пәндерді сәйкестендіру: BilimClass атауы → Ұстаздағы пән (немесе жаңа пән).
    const byId = new Map(subjects.map((s) => [s.id, s.name]));
    const mapTo = new Map<string, string>();
    const toCreate = new Set<string>();
    for (const [from, to] of Object.entries(dto.subjectMap ?? {})) {
      if (to === 'new') toCreate.add(normName(from));
      else if (typeof to === 'number' && byId.has(to)) mapTo.set(normName(from), byId.get(to)!);
    }
    const remap = <T extends { subject: string }>(rows: T[]) => (mapTo.size ? rows.map((r) => ({ ...r, subject: mapTo.get(normName(r.subject)) ?? r.subject })) : rows);
    const plan = buildPlan(remap(dto.groups), remap(dto.grades), {
      grade: cls.grade,
      students,
      subjects,
      teachers: teachers.map((t) => ({ id: t.id, fullName: t.user.fullName })),
    });
    const warnings = [...plan.warnings];
    const createSubjects = !!dto.createSubjects;
    const subjectId = new Map(subjects.map((s) => [normName(s.name), s.id]));
    const creates = (name: string) => createSubjects || toCreate.has(normName(name));
    const hasSubject = (name: string) => subjectId.has(normName(name)) || creates(name);
    const skippedSubjects = plan.missingSubjects.filter((n) => !creates(n));
    if (skippedSubjects.length) warnings.unshift(`Ұстазда жоқ пәндер өткізіледі: ${skippedSubjects.join(', ')}`);

    const groups = plan.groups.filter((g) => hasSubject(g.subject));
    const fo = plan.fo.filter((c) => hasSubject(c.subject));
    const sums = plan.summatives.filter((s) => hasSubject(s.subject));
    const finals = plan.quarterMarks.filter((q) => hasSubject(q.subject));

    const sidOf = (name: string) => subjectId.get(normName(name));
    /**
     * BilimClass тобын Ұстаздағы топпен сәйкестендіру. BilimClass — топтардың негізгі дереккөзі:
     * 1) нөмірі бар топ («1 топ» = «1-топ») — нөмірі бойынша; мұғалімі BilimClass-тағыға ауыстырылады;
     * 2) нөмірсіз топ («Қыздар», «Ұлдар») — мұғалімі бірдей топ (мысалы Nexus-тің «1-топ · Тынышбай»),
     *    егер ол мұғалім бұл пәнде екі жақта да бір ғана топты жүргізсе; топ атауы BilimClass-тағыға ауысады;
     * 3) атауы бірдей топ.
     */
    const resolved = new Map<string, (typeof existingGroups)[number]>();
    for (const g of groups) {
      const sid = sidOf(g.subject);
      if (sid == null) continue;
      const same = existingGroups.filter((x) => x.subjectId === sid);
      const byKey = same.filter((x) => groupKey(x.name) === g.key);
      let hit: (typeof existingGroups)[number] | undefined = /^\d+$/.test(g.key) ? byKey[0] : undefined;
      if (!hit && g.teacherId) {
        const mine = same.filter((x) => x.teacherId === g.teacherId);
        const imported = groups.filter((y) => sidOf(y.subject) === sid && y.teacherId === g.teacherId);
        if (mine.length === 1 && imported.length === 1 && !groups.some((y) => y !== g && sidOf(y.subject) === sid && groupKey(mine[0].name) === y.key)) hit = mine[0];
      }
      hit ??= byKey[0];
      if (hit) resolved.set(`${sid}|${g.key}`, hit);
    }
    const existingGroup = (sid: number | undefined, key: string) => (sid == null ? undefined : resolved.get(`${sid}|${key}`));
    // Бұрынғы импортта мұғалімсіз жасалған («Қыздар») топ енді басқа топқа сәйкестенсе — біріктіріледі.
    const merges: { from: (typeof existingGroups)[number]; to: (typeof existingGroups)[number]; subject: string }[] = [];
    for (const g of groups) {
      const sid = sidOf(g.subject);
      const to = existingGroup(sid, g.key);
      if (!to || groupKey(to.name) === g.key) continue;
      for (const from of existingGroups.filter((x) => x.subjectId === sid && x.id !== to.id && !x.teacherId && groupKey(x.name) === g.key))
        merges.push({ from, to, subject: g.subject });
    }
    for (const m of merges) warnings.push(`${m.subject}: «${m.from.name}» тобы «${m.to.name}» тобымен біріктіріледі (мұғалімі бірдей)`);

    // Бар бағандар мен бағалауларды алдын ала жүктеу (preview санағы мен apply үшін).
    const [columns, assessments] = await Promise.all([
      this.prisma.gradeColumn.findMany({
        where: { classId: cls.id, quarterId: quarter.id },
        select: { id: true, subjectId: true, groupId: true, date: true, topic: true },
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
        {
          for (const name of plan.missingSubjects.filter(creates)) {
            const s = await tx.subject.upsert({
              where: { schoolId_name: { schoolId: user.schoolId, name } },
              create: { schoolId: user.schoolId, name },
              update: {},
            });
            subjectId.set(normName(name), s.id);
          }
        }
        // Қайталанған топтарды біріктіру (бағандар, бағалаулар, мүшелер көшіріледі)
        for (const { from, to } of merges) {
          await tx.gradeColumn.updateMany({ where: { groupId: from.id }, data: { groupId: to.id } });
          await tx.assessment.updateMany({ where: { groupId: from.id }, data: { groupId: to.id } });
          await tx.subjectGroupMember.updateMany({ where: { groupId: from.id }, data: { groupId: to.id } });
          await tx.subjectGroup.delete({ where: { id: from.id } });
          for (const c of columns) if (c.groupId === from.id) c.groupId = to.id;
          for (const a of assessments) if (a.groupId === from.id) a.groupId = to.id;
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
            if (groupKey(ex.name) !== g.key) await tx.subjectGroup.update({ where: { id }, data: { name: g.name } });
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
        // Оқушы басқа топқа ауысса (мысалы бұрын топ нөмірі бойынша қате сәйкестенсе), оның бұрынғы топтағы
        // BilimClass бағалары өшіріледі; бос қалған BilimClass бағандары мен бағалаулары жойылады.
        const targetOf = new Map<string, number>(); // sid|studentId → groupId
        for (const g of groups) {
          const sid = sidOf(g.subject)!;
          const gid = groupIdFor(sid, g.key, createdGroups);
          if (gid != null) for (const st of g.members) targetOf.set(`${sid}|${st}`, gid);
        }
        if (targetOf.size) {
          const moved = (sid: number, gid: number | null) => (st: number) => {
            const t = targetOf.get(`${sid}|${st}`);
            return t != null && gid != null && t !== gid;
          };
          for (const c of columns.filter((x) => x.groupId != null && x.topic === 'BilimClass')) {
            const wrong = [...targetOf.keys()]
              .filter((k) => k.startsWith(`${c.subjectId}|`))
              .map((k) => Number(k.split('|')[1]))
              .filter(moved(c.subjectId, c.groupId));
            if (wrong.length) await tx.grade.deleteMany({ where: { columnId: c.id, studentId: { in: wrong } } });
          }
          for (const a of assessments.filter((x) => x.groupId != null)) {
            const wrong = [...targetOf.keys()]
              .filter((k) => k.startsWith(`${a.subjectId}|`))
              .map((k) => Number(k.split('|')[1]))
              .filter(moved(a.subjectId, a.groupId));
            if (wrong.length) await tx.assessmentResult.deleteMany({ where: { assessmentId: a.id, studentId: { in: wrong } } });
          }
          const emptyCols = await tx.gradeColumn.findMany({
            where: { classId: cls.id, quarterId: quarter.id, topic: 'BilimClass', groupId: { not: null }, grades: { none: {} } },
            select: { id: true },
          });
          if (emptyCols.length) {
            await tx.gradeColumn.deleteMany({ where: { id: { in: emptyCols.map((x) => x.id) } } });
            const gone = new Set(emptyCols.map((x) => x.id));
            columns.splice(0, columns.length, ...columns.filter((x) => !gone.has(x.id)));
          }
          // Бос бағалау тек импорттағы БЖБ/ТЖБ/аралыққа сәйкес келсе ғана жойылады (мұғалім алдын ала жасағанына тимейміз).
          const planned = new Set(sums.map((x) => `${sidOf(x.subject)}|${x.type}|${x.date ?? ''}|${x.maxScore}`));
          const emptyAs = (
            await tx.assessment.findMany({
              where: { classId: cls.id, quarterId: quarter.id, groupId: { not: null }, results: { none: {} } },
              select: { id: true, subjectId: true, type: true, date: true, maxScore: true },
            })
          ).filter((a) => planned.has(`${a.subjectId}|${a.type}|${fmtDate(a.date) ?? ''}|${Number(a.maxScore)}`));
          if (emptyAs.length) {
            await tx.assessment.deleteMany({ where: { id: { in: emptyAs.map((x) => x.id) } } });
            const gone = new Set(emptyAs.map((x) => x.id));
            assessments.splice(0, assessments.length, ...assessments.filter((x) => !gone.has(x.id)));
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
              select: { id: true, subjectId: true, groupId: true, date: true, topic: true },
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
