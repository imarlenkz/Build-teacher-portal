import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { ScopeService } from '../core/scope.service';
import { LevelsService } from '../core/levels.service';
import { P } from '../../common/permissions';
import { fmtDate, todayStr, weekday } from '../../common/utils/dates';

export const MOVEMENT_TYPES = [
  { code: 'ADMITTED', name: 'Қабылданды', dir: 'in' },
  { code: 'TRANSFERRED_CLASS', name: 'Басқа сыныпқа ауысты', dir: 'move' },
  { code: 'ARRIVED_FROM_SCHOOL', name: 'Басқа мектептен келді', dir: 'in' },
  { code: 'LEFT_TO_SCHOOL', name: 'Басқа мектепке кетті', dir: 'out' },
  { code: 'EXPELLED', name: 'Мектептен шығарылды', dir: 'out' },
  { code: 'READMITTED', name: 'Қайта қабылданды', dir: 'in' },
] as const;

export const ATTENDANCE_STATUSES = [
  { code: 'P', short: '✓', name: 'Қатысты' },
  { code: 'N', short: 'Н', name: 'Себепсіз' },
  { code: 'S', short: 'С', name: 'Себепті' },
  { code: 'A', short: 'А', name: 'Ауру' },
  { code: 'K', short: 'К', name: 'Кешікті' },
  { code: 'O', short: 'Б', name: 'Басқа' },
] as const;

class YearQuery {
  @IsOptional() @Type(() => Number) @IsInt() schoolYearId?: number;
}

@Injectable()
export class ReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly levels: LevelsService,
  ) {}

  async bootstrap(user: AuthUser, schoolYearId?: number) {
    const current = await this.scope.currentYear(user.schoolId);
    const yearId = schoolYearId ?? current.id;
    const today = todayStr();
    const ids = await this.scope.classIds(user, yearId);
    const [years, classes, subjects, nationalities, reasons, levels, settings, assignments] = await Promise.all([
      this.prisma.schoolYear.findMany({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, include: { quarters: { orderBy: { number: 'asc' } } } }),
      this.prisma.class.findMany({
        where: { schoolId: user.schoolId, schoolYearId: yearId, ...(ids ? { id: { in: ids } } : {}) },
        orderBy: [{ grade: 'asc' }, { letter: 'asc' }],
        select: { id: true, name: true, grade: true, homeroomTeacherId: true },
      }),
      this.prisma.subject.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } }),
      user.permissions.includes(P.NATIONALITY_VIEW) ? this.prisma.nationality.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }) : Promise.resolve(null),
      this.prisma.attendanceReason.findMany({ where: { OR: [{ schoolId: null }, { schoolId: user.schoolId }] } }),
      this.levels.get(user.schoolId),
      this.levels.settings(user.schoolId),
      this.prisma.teachingAssignment.findMany({
        where: { schoolId: user.schoolId, schoolYearId: yearId, ...(ids ? { classId: { in: ids } } : {}), ...(user.permissions.includes(P.SCHOOL_WIDE) ? {} : { teacherId: user.teacherId ?? -1 }) },
        select: { classId: true, subjectId: true, teacherId: true },
      }),
    ]);
    const homeroom = new Set(classes.filter((c) => c.homeroomTeacherId && c.homeroomTeacherId === user.teacherId).map((c) => c.id));
    // Сынып жетекшісі өз сыныбының барлық пәнін көре алады.
    const extra = homeroom.size
      ? await this.prisma.teachingAssignment.findMany({ where: { classId: { in: [...homeroom] } }, select: { classId: true, subjectId: true, teacherId: true } })
      : [];
    const pairs = new Map<string, { classId: number; subjectId: number }>();
    [...assignments, ...extra].forEach((a) => pairs.set(`${a.classId}:${a.subjectId}`, { classId: a.classId, subjectId: a.subjectId }));

    const year = years.find((y) => y.id === yearId) ?? current;
    const cq =
      year.quarters.find((q) => fmtDate(q.startDate)! <= today && today <= fmtDate(q.endDate)!) ??
      [...year.quarters].reverse().find((q) => fmtDate(q.startDate)! <= today) ??
      year.quarters[0];
    return {
      today,
      weekday: weekday(today),
      currentYearId: current.id,
      currentQuarterId: cq?.id ?? null,
      years: years.map((y) => ({
        id: y.id,
        name: y.name,
        isCurrent: y.isCurrent,
        startDate: fmtDate(y.startDate),
        endDate: fmtDate(y.endDate),
        quarters: y.quarters.map((q) => ({ id: q.id, number: q.number, startDate: fmtDate(q.startDate), endDate: fmtDate(q.endDate), reportDueDate: fmtDate(q.reportDueDate) })),
      })),
      classes: classes.map((c) => ({ id: c.id, name: c.name, grade: c.grade, isHomeroom: homeroom.has(c.id) })),
      subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
      classSubjects: [...pairs.values()],
      nationalities,
      reasons,
      levels,
      attendanceThreshold: settings.attendanceThreshold,
      movementTypes: MOVEMENT_TYPES,
      attendanceStatuses: ATTENDANCE_STATUSES,
    };
  }
}

@ApiTags('reference')
@Controller('reference')
class ReferenceController {
  constructor(private readonly ref: ReferenceService) {}

  /** Фронтендке қажет анықтамалықтар бір сұраныспен. */
  @Get()
  get(@CurrentUser() user: AuthUser, @Query() q: YearQuery) {
    return this.ref.bootstrap(user, q.schoolYearId);
  }
}

@Module({ providers: [ReferenceService], controllers: [ReferenceController], exports: [ReferenceService] })
export class ReferenceModule {}
