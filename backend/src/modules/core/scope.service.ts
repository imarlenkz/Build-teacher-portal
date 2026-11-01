import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
    const [assign, home, groups] = await Promise.all([
      this.prisma.teachingAssignment.findMany({
        where: { teacherId: user.teacherId, schoolYearId: yearId },
        select: { classId: true },
      }),
      this.prisma.class.findMany({ where: { homeroomTeacherId: user.teacherId, schoolYearId: yearId }, select: { id: true } }),
      this.prisma.subjectGroup.findMany({ where: { teacherId: user.teacherId, class: { schoolYearId: yearId } }, select: { classId: true } }),
    ]);
    return [...new Set([...assign.map((a) => a.classId), ...home.map((c) => c.id), ...groups.map((g) => g.classId)])];
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

  /** Мектеп деңгейіндегі рұқсат, сынып жетекшісі немесе пәннің негізгі мұғалімі — барлық топқа қол жеткізеді. */
  private async teachesWhole(user: AuthUser, classId: number, subjectId: number) {
    if (this.isSchoolWide(user)) return true;
    const a = await this.prisma.teachingAssignment.findFirst({ where: { classId, subjectId, teacherId: user.teacherId ?? -1 } });
    if (a) return true;
    return !!(await this.prisma.class.findFirst({ where: { id: classId, homeroomTeacherId: user.teacherId ?? -1 } }));
  }

  /** Мұғалім осы сыныпта осы пәнді (немесе оның бір тобын) жүргізе ме. */
  async assertTeaches(user: AuthUser, classId: number, subjectId: number) {
    await this.assertClass(user, classId);
    if (await this.teachesWhole(user, classId, subjectId)) return;
    const g = await this.prisma.subjectGroup.findFirst({ where: { classId, subjectId, teacherId: user.teacherId ?? -1 } });
    if (!g) throw new ForbiddenException('Бұл пәнге рұқсат жоқ');
  }

  /** Бар жазбаны (баған, бағалау) өзгерту құқығы: топтыққа — сол топтың мұғалімі, ортаққа — пәннің негізгі мұғалімі. */
  async assertWriteScope(user: AuthUser, classId: number, subjectId: number, groupId: number | null) {
    await this.assertTeaches(user, classId, subjectId);
    if (groupId) {
      await this.resolveGroup(user, classId, subjectId, groupId, true);
      return;
    }
    if (await this.teachesWhole(user, classId, subjectId)) return;
    throw new ForbiddenException('Бұл жазба бүкіл сыныпқа ортақ: оны пәннің негізгі мұғалімі өзгертеді');
  }

  /**
   * Пән топтарға бөлінген болса, groupId міндетті және осы сынып-пәнге тиесілі болуы керек.
   * write=true кезінде топ мұғалімі тек өз тобын өзгерте алады.
   * Қайтарады: топ (немесе топтар жоқ болса null).
   */
  async resolveGroup(user: AuthUser, classId: number, subjectId: number, groupId: number | null | undefined, write = false) {
    const groups = await this.prisma.subjectGroup.findMany({ where: { classId, subjectId }, select: { id: true, name: true, teacherId: true } });
    if (!groups.length) {
      if (groupId) throw new BadRequestException('Бұл пән топтарға бөлінбеген');
      return null;
    }
    if (!groupId) throw new BadRequestException('Пән топтарға бөлінген: топты таңдаңыз');
    const g = groups.find((x) => x.id === groupId);
    if (!g) throw new BadRequestException('Топ осы сынып пәніне тиесілі емес');
    if (write && g.teacherId !== user.teacherId && !(await this.teachesWhole(user, classId, subjectId))) {
      throw new ForbiddenException('Бұл топқа рұқсат жоқ');
    }
    return g;
  }
}
