import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';

/**
 * Деректерге қол жеткізу аясы. Мұғалім тек өзі сабақ беретін немесе жетекшісі болып
 * табылатын сыныптарды көреді; әкімшілік пен admin — бүкіл мектепті.
 * Барлық сервистер сыныпқа/оқушыға қол жеткізуді осы жерден тексереді (API деңгейіндегі RBAC).
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isSchoolWide(user: AuthUser) {
    return user.permissions.includes(P.SCHOOL_WIDE);
  }

  can(user: AuthUser, perm: string) {
    return user.permissions.includes(perm);
  }

  async currentYear(schoolId: number) {
    const y =
      (await this.prisma.schoolYear.findFirst({ where: { schoolId, isCurrent: true }, include: { quarters: { orderBy: { number: 'asc' } } } })) ??
      (await this.prisma.schoolYear.findFirst({ where: { schoolId }, orderBy: { startDate: 'desc' }, include: { quarters: { orderBy: { number: 'asc' } } } }));
    if (!y) throw new NotFoundException('Оқу жылы бапталмаған');
    return y;
  }

  /** null = шектеусіз (бүкіл мектеп). */
  async classIds(user: AuthUser, schoolYearId?: number): Promise<number[] | null> {
    if (this.isSchoolWide(user)) return null;
    if (!user.teacherId) return [];
    const yearId = schoolYearId ?? (await this.currentYear(user.schoolId)).id;
    const [assign, home] = await Promise.all([
      this.prisma.teachingAssignment.findMany({
        where: { teacherId: user.teacherId, schoolYearId: yearId },
        select: { classId: true },
      }),
      this.prisma.class.findMany({ where: { homeroomTeacherId: user.teacherId, schoolYearId: yearId }, select: { id: true } }),
    ]);
    return [...new Set([...assign.map((a) => a.classId), ...home.map((c) => c.id)])];
  }

  async assertClass(user: AuthUser, classId: number) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } });
    if (!cls) throw new NotFoundException('Сынып табылмады');
    const ids = await this.classIds(user, cls.schoolYearId);
    if (ids && !ids.includes(classId)) throw new ForbiddenException('Бұл сыныпқа рұқсат жоқ');
    return cls;
  }

  async assertStudent(user: AuthUser, studentId: number) {
    const s = await this.prisma.student.findFirst({ where: { id: studentId, schoolId: user.schoolId, deletedAt: null } });
    if (!s) throw new NotFoundException('Оқушы табылмады');
    if (!this.isSchoolWide(user)) {
      const ids = await this.classIds(user);
      // Мұғалім өз сыныбынан кеткен оқушының тарихын көре алады (қозғалыс арқылы байланысқан).
      if (!s.classId || !ids!.includes(s.classId)) {
        const linked = await this.prisma.studentMovement.findFirst({
          where: { studentId, OR: [{ fromClassId: { in: ids! } }, { toClassId: { in: ids! } }] },
        });
        if (!linked) throw new ForbiddenException('Бұл оқушыға рұқсат жоқ');
      }
    }
    return s;
  }

  /** Мұғалім осы сыныпта осы пәнді жүргізе ме (немесе мектеп деңгейіндегі рұқсат). */
  async assertTeaches(user: AuthUser, classId: number, subjectId: number) {
    await this.assertClass(user, classId);
    if (this.isSchoolWide(user)) return;
    const a = await this.prisma.teachingAssignment.findFirst({ where: { classId, subjectId, teacherId: user.teacherId ?? -1 } });
    const home = await this.prisma.class.findFirst({ where: { id: classId, homeroomTeacherId: user.teacherId ?? -1 } });
    if (!a && !home) throw new ForbiddenException('Бұл пәнге рұқсат жоқ');
  }
}
