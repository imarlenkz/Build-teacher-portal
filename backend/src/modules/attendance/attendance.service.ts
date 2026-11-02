import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { ScopeService } from '../core/scope.service';
import { AuditService } from '../audit/audit.service';
import { ATTENDANCE_STATUSES } from '../reference/reference.module';
import { addDays, endOfMonth, fmtDate, todayStr, toDate, weekday } from '../../common/utils/dates';
import { CalendarQuery, SaveSheetInput, SheetQuery } from './attendance.dto';

export const DEFAULT_TIMES = ['08:30', '09:25', '10:30', '11:25', '12:20', '13:15', '14:10', '15:05'];
const statusName = (s: string) => ATTENDANCE_STATUSES.find((x) => x.code === s)?.name ?? s;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Берілген күнгі сабақтар (мұғалімнің кестесі; әкімшілік үшін бүкіл мектеп).
   * Пән топтарға бөлінсе, сабақ әр топқа жеке жол болып шығады; топ мұғалімі тек өз тобын көреді.
   */
  async lessonsOfDay(user: AuthUser, date = todayStr()) {
    const wd = weekday(date);
    const year = await this.scope.currentYear(user.schoolId);
    const wide = this.scope.isSchoolWide(user) && !user.teacherId;
    const myGroups = wide || !user.teacherId ? [] : await this.prisma.subjectGroup.findMany({ where: { teacherId: user.teacherId, class: { schoolYearId: year.id } }, select: { classId: true, subjectId: true } });
    const slots = await this.prisma.timetableSlot.findMany({
      where: {
        schoolId: user.schoolId,
        weekday: wd,
        assignment: {
          schoolYearId: year.id,
          ...(wide ? {} : { OR: [{ teacherId: user.teacherId ?? -1 }, ...myGroups.map((g) => ({ classId: g.classId, subjectId: g.subjectId }))] }),
        },
      },
      include: { assignment: { include: { class: true, subject: true, teacher: { include: { user: { select: { fullName: true } } } } } } },
      orderBy: [{ period: 'asc' }, { startTime: 'asc' }],
    });
    const inQuarter = year.quarters.some((q) => fmtDate(q.startDate)! <= date && date <= fmtDate(q.endDate)!);
    if (!inQuarter) return { date, holiday: true, lessons: [] };
    const classIds = [...new Set(slots.map((s) => s.assignment.classId))];
    const [lessons, students, groups] = await Promise.all([
      this.prisma.lesson.findMany({ where: { classId: { in: classIds }, date: toDate(date) }, include: { attendance: { select: { studentId: true, status: true } } } }),
      this.prisma.student.findMany({ where: { classId: { in: classIds }, status: 'ACTIVE', deletedAt: null }, select: { id: true, classId: true } }),
      this.prisma.subjectGroup.findMany({
        where: { classId: { in: classIds } },
        select: { id: true, classId: true, subjectId: true, name: true, order: true, teacherId: true, teacher: { select: { user: { select: { fullName: true } } } }, members: { select: { studentId: true } } },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      }),
    ]);
    const classStudents = new Map<number, number[]>();
    for (const st of students) classStudents.set(st.classId!, [...(classStudents.get(st.classId!) ?? []), st.id]);
    const whole = new Map<string, boolean>(); // мұғалім бұл сынып-пәннің негізгі мұғалімі ме
    const out = [];
    for (const s of slots) {
      const { classId, subjectId } = s.assignment;
      const l = lessons.find((x) => x.classId === classId && x.period === s.period);
      const sameSubject = !l || l.subjectId === subjectId;
      const marks = new Map(sameSubject ? (l?.attendance ?? []).map((a) => [a.studentId, a.status] as const) : []);
      const base = {
        period: s.period,
        startTime: s.startTime,
        endTime: s.endTime,
        classId,
        className: s.assignment.class.name,
        subjectId,
        subject: s.assignment.subject.name,
      };
      const row = (ids: number[], teacher: string, extra: { groupId: number | null; groupName: string | null }) => {
        const st = (codes: AttendanceStatus[]) => ids.filter((id) => codes.includes(marks.get(id) as AttendanceStatus)).length;
        const marked = !!l?.markedAt && sameSubject && ids.length > 0 && ids.every((id) => marks.has(id));
        return {
          ...base,
          ...extra,
          teacher,
          students: ids.length,
          marked,
          present: marked ? st(['P', 'K']) : 0,
          absent: marked ? st(['N', 'S', 'A', 'O']) : 0,
          excused: marked ? st(['S', 'A', 'O']) : 0,
          unexcused: marked ? st(['N']) : 0,
        };
      };
      const all = classStudents.get(classId) ?? [];
      const gs = groups.filter((g) => g.classId === classId && g.subjectId === subjectId);
      if (!gs.length) {
        out.push(row(all, s.assignment.teacher.user.fullName, { groupId: null, groupName: null }));
        continue;
      }
      const key = `${classId}|${subjectId}`;
      if (!whole.has(key)) whole.set(key, wide || s.assignment.teacherId === user.teacherId || (await this.scope.teachesWhole(user, classId, subjectId)));
      const inOther = (gid: number) => new Set(gs.filter((g) => g.id !== gid).flatMap((g) => g.members.map((m) => m.studentId)));
      for (const g of gs) {
        if (!whole.get(key) && g.teacherId !== user.teacherId) continue;
        const other = inOther(g.id);
        out.push(row(all.filter((id) => !other.has(id)), g.teacher?.user.fullName ?? s.assignment.teacher.user.fullName, { groupId: g.id, groupName: g.name }));
      }
    }
    return { date, holiday: false, lessons: out };
  }

  private async slotTime(classId: number, subjectId: number, date: string, period: number) {
    const slot = await this.prisma.timetableSlot.findFirst({ where: { period, weekday: weekday(date), assignment: { classId, subjectId } } });
    return slot?.startTime ?? DEFAULT_TIMES[period - 1] ?? null;
  }

  /** Оқушылар тізімі сабақ күніндегі құрам бойынша: сол күні сыныпта болған белсенді оқушылар. */
  private async roster(classId: number, subjectId?: number, groupId?: number | null) {
    // Топ таңдалса: топ мүшелері + басқа топқа кірмеген оқушылар (журналдағыдай).
    const other = groupId
      ? (await this.prisma.subjectGroupMember.findMany({ where: { classId, subjectId, groupId: { not: groupId } }, select: { studentId: true } })).map((m) => m.studentId)
      : [];
    return this.prisma.student.findMany({
      where: { classId, status: 'ACTIVE', deletedAt: null, ...(other.length ? { id: { notIn: other } } : {}) },
      select: { id: true, fullName: true, studentCode: true, gender: true },
      orderBy: { fullName: 'asc' },
    });
  }

  /** Топ: берілсе — тексеріледі; берілмесе — пән топқа бөлінген болса, тек негізгі мұғалім бүкіл сыныпты белгілей алады. */
  private async group(user: AuthUser, q: SheetQuery, write: boolean) {
    if (q.groupId) return this.scope.resolveGroup(user, q.classId, q.subjectId, q.groupId, write);
    if (await this.scope.teachesWhole(user, q.classId, q.subjectId)) return null;
    return this.scope.resolveGroup(user, q.classId, q.subjectId, null, write);
  }

  async sheet(user: AuthUser, q: SheetQuery) {
    await this.scope.assertTeaches(user, q.classId, q.subjectId);
    const group = await this.group(user, q, false);
    const lesson = await this.prisma.lesson.findUnique({
      where: { classId_date_period: { classId: q.classId, date: toDate(q.date), period: q.period } },
      include: { attendance: true, subject: true },
    });
    const students = await this.roster(q.classId, q.subjectId, group?.id);
    const marks = new Map(lesson?.attendance.map((a) => [a.studentId, a]) ?? []);
    // Бұрын сабақта болып, кейін кеткен оқушылар да көрсетіледі (тарихи дұрыстық үшін); топта — тек сыныптан кеткендері.
    const active = group ? new Set((await this.roster(q.classId)).map((s) => s.id)) : new Set<number>();
    const extraIds = [...marks.keys()].filter((id) => !students.some((s) => s.id === id) && !active.has(id));
    const extra = extraIds.length
      ? await this.prisma.student.findMany({ where: { id: { in: extraIds } }, select: { id: true, fullName: true, studentCode: true, gender: true } })
      : [];
    const conflict = lesson && lesson.subjectId !== q.subjectId ? lesson.subject.name : null;
    const groupMarked = students.length > 0 && students.every((s) => marks.has(s.id));
    return {
      lessonId: lesson?.id ?? null,
      markedAt: group ? (groupMarked ? (lesson?.markedAt ?? null) : null) : (lesson?.markedAt ?? null),
      groupId: group?.id ?? null,
      startTime: lesson?.startTime ?? (await this.slotTime(q.classId, q.subjectId, q.date, q.period)),
      conflictSubject: conflict,
      students: [...students, ...extra].map((s) => {
        const m = marks.get(s.id);
        return { id: s.id, fullName: s.fullName, studentCode: s.studentCode, gender: s.gender, status: conflict ? null : (m?.status ?? null), reasonId: m?.reasonId ?? null, note: m?.note ?? null };
      }),
    };
  }

  async save(user: AuthUser, dto: SaveSheetInput, meta: RequestMeta) {
    await this.scope.assertTeaches(user, dto.classId, dto.subjectId);
    const group = await this.group(user, dto, true);
    const today = todayStr();
    if (dto.date > today) throw new BadRequestException('Болашақ күнге қатысу белгіленбейді');
    if (weekday(dto.date) === 7) throw new BadRequestException('Жексенбі — демалыс күні');
    const year = await this.scope.currentYear(user.schoolId);
    if (!year.quarters.some((q) => fmtDate(q.startDate)! <= dto.date && dto.date <= fmtDate(q.endDate)!)) {
      throw new BadRequestException('Бұл күн тоқсан аралығына кірмейді (каникул)');
    }
    const roster = await this.roster(dto.classId, dto.subjectId, group?.id);
    const byId = new Map(dto.marks.map((m) => [m.studentId, m]));
    if (byId.size !== dto.marks.length) throw new BadRequestException('Бір оқушы екі рет белгіленген');
    const missing = roster.filter((s) => !byId.has(s.id));
    if (missing.length) {
      throw new BadRequestException({ message: `${missing.length} оқушы белгіленбеген`, details: missing.map((s) => s.id) });
    }
    const existing = await this.prisma.lesson.findUnique({
      where: { classId_date_period: { classId: dto.classId, date: toDate(dto.date), period: dto.period } },
      include: { attendance: true },
    });
    const allowed = new Set(roster.map((s) => s.id));
    // Сыныптан кеткен оқушының бұрынғы белгісі өзгертіле алады; топта — басқа топтың оқушысы емес.
    const classNow = group ? new Set((await this.roster(dto.classId)).map((s) => s.id)) : new Set<number>();
    existing?.attendance.forEach((a) => !classNow.has(a.studentId) && allowed.add(a.studentId));
    const foreign = dto.marks.filter((m) => !allowed.has(m.studentId));
    if (foreign.length) throw new BadRequestException('Тізімде басқа сыныптың оқушысы бар');
    if (existing && existing.subjectId !== dto.subjectId) {
      throw new BadRequestException('Бұл сабақ нөміріне басқа пән белгіленген. Сабақ нөмірін тексеріңіз');
    }
    const cls = await this.prisma.class.findUniqueOrThrow({ where: { id: dto.classId } });
    const subj = await this.prisma.subject.findUniqueOrThrow({ where: { id: dto.subjectId } });
    const names = new Map(roster.map((s) => [s.id, s.fullName]));

    await this.prisma.$transaction(async (tx) => {
      const lesson = existing
        ? await tx.lesson.update({ where: { id: existing.id }, data: { markedAt: new Date(), markedById: user.id } })
        : await tx.lesson.create({
            data: {
              schoolId: user.schoolId,
              classId: dto.classId,
              subjectId: dto.subjectId,
              teacherId: user.teacherId,
              date: toDate(dto.date),
              period: dto.period,
              startTime: await this.slotTime(dto.classId, dto.subjectId, dto.date, dto.period),
              markedAt: new Date(),
              markedById: user.id,
            },
          });
      const prev = new Map(existing?.attendance.map((a) => [a.studentId, a]) ?? []);
      const changes: { studentId: number; from: string; to: string }[] = [];
      for (const m of dto.marks) {
        const p = prev.get(m.studentId);
        if (p) {
          if (p.status !== m.status || (p.reasonId ?? null) !== (m.reasonId ?? null) || (p.note ?? null) !== (m.note ?? null)) {
            await tx.attendance.update({ where: { id: p.id }, data: { status: m.status, reasonId: m.reasonId ?? null, note: m.note ?? null, updatedById: user.id } });
            if (p.status !== m.status) changes.push({ studentId: m.studentId, from: p.status, to: m.status });
          }
        }
      }
      const fresh = dto.marks.filter((m) => !prev.has(m.studentId));
      if (fresh.length) {
        await tx.attendance.createMany({
          data: fresh.map((m) => ({
            schoolId: user.schoolId,
            lessonId: lesson.id,
            studentId: m.studentId,
            date: toDate(dto.date),
            status: m.status,
            reasonId: m.reasonId ?? null,
            note: m.note ?? null,
            updatedById: user.id,
          })),
        });
      }
      const where = `${subj.name}, ${cls.name}${group ? ` (${group.name})` : ''}, ${dto.period}-сабақ, ${dto.date.split('-').reverse().join('.')}`;
      for (const c of changes) {
        await this.audit.record(
          user,
          { action: 'Қатысу статусын өзгертті', entity: 'attendance', entityId: lesson.id, summary: `${names.get(c.studentId) ?? c.studentId} · ${where}`, before: statusName(c.from), after: statusName(c.to) },
          meta,
          tx,
        );
      }
      const count = (s: string) => dto.marks.filter((m) => m.status === s).length;
      await this.audit.record(
        user,
        {
          action: existing?.markedAt ? 'Қатысуды қайта сақтады' : 'Қатысуды сақтады',
          entity: 'attendance',
          entityId: lesson.id,
          summary: where,
          after: { P: count('P'), N: count('N'), S: count('S'), A: count('A'), K: count('K'), O: count('O') },
        },
        meta,
        tx,
      );
    });
    await this.cache.bump(user.schoolId);
    return { ok: true, saved: dto.marks.length };
  }

  /** Ай күнтізбесі: әр күн бойынша сабақ саны, қатысқан, себепті, себепсіз. */
  async calendar(user: AuthUser, q: CalendarQuery) {
    await this.scope.assertClass(user, q.classId);
    const from = `${q.month}-01`;
    const to = endOfMonth(from);
    const rows = await this.prisma.$queryRaw<{ d: Date; lessons: bigint; present: bigint; excused: bigint; unexcused: bigint; total: bigint }[]>`
      SELECT l.date d, count(DISTINCT l.id) lessons,
        count(a.id) FILTER (WHERE a.status IN ('P','K')) present,
        count(a.id) FILTER (WHERE a.status IN ('S','A','O')) excused,
        count(a.id) FILTER (WHERE a.status = 'N') unexcused,
        count(a.id) total
      FROM lessons l LEFT JOIN attendance a ON a.lesson_id = l.id
      WHERE l.class_id = ${q.classId} AND l.date BETWEEN ${toDate(from)} AND ${toDate(to)} AND l.marked_at IS NOT NULL
        ${q.subjectId ? Prisma.sql`AND l.subject_id = ${q.subjectId}` : Prisma.empty}
      GROUP BY l.date ORDER BY l.date`;
    const year = await this.scope.currentYear(user.schoolId);
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const r = rows.find((x) => fmtDate(x.d) === d);
      const inQ = year.quarters.some((qq) => fmtDate(qq.startDate)! <= d && d <= fmtDate(qq.endDate)!);
      days.push({
        date: d,
        weekday: weekday(d),
        off: weekday(d) === 7 || !inQ,
        lessons: Number(r?.lessons ?? 0),
        present: Number(r?.present ?? 0),
        excused: Number(r?.excused ?? 0),
        unexcused: Number(r?.unexcused ?? 0),
        total: Number(r?.total ?? 0),
      });
    }
    return { month: q.month, today: todayStr(), days };
  }
}
