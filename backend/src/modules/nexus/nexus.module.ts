import { BadGatewayException, BadRequestException, Body, Controller, Get, Injectable, Logger, Module, Post, Put, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import type { SystemActor } from '../audit/audit.service';
import { addDays, APP_TZ, fmtDate, todayStr } from '../../common/utils/dates';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../core/scope.service';
import { ARGON_OPTS } from '../auth/auth.service';
import { buildPlan, NexusLesson, Plan } from './nexus.plan';
import { groupKey } from '../bilimclass/bilimclass.plan';

class InstitutionInput {
  @IsString() @MinLength(1) @MaxLength(64) institutionId: string;
}

/** Автосинхрондау уақыты (әдепкі: күн сайын 03:30, APP_TZ). NEXUS_AUTO_SYNC=false болса өшеді. */
const AUTO_SYNC_CRON = process.env.NEXUS_SYNC_CRON || '0 30 3 * * *';
const autoSyncEnabled = () => process.env.NEXUS_AUTO_SYNC !== 'false';
const lastSyncKey = (schoolId: number) => `nexus:autosync:${schoolId}`;

/** Кесте жасалатын «кім»: адам (AuthUser) немесе жүйе (түнгі автосинхрондау). */
type Actor = AuthUser | SystemActor;

/** Nexus API терезесі: бір сұраныста 62 күннен аспайды; апталық кесте үшін 3 апта жеткілікті. */
const WINDOW_DAYS = 20;

/**
 * Nexus (сабақ кестесі жүйесі, nesus_new) интеграциясы.
 * Nexus-тің серверлер арасындағы API-і қолданылады: X-Integration-Key тақырыбы
 * (NEXUS_INTEGRATION_KEY, Nexus-тегі INTEGRATION_KEY-мен бірдей; тек сервердің .env файлында).
 */
@Injectable()
export class NexusService {
  private readonly log = new Logger('Nexus');
  private readonly apiUrl: string;
  private readonly key: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {
    this.apiUrl = (config.get<string>('NEXUS_API_URL') || 'https://nexus.imarlen.kz/api').replace(/\/+$/, '');
    this.key = config.get<string>('NEXUS_INTEGRATION_KEY') || '';
  }

  private async call<T>(path: string): Promise<T> {
    if (!this.key) throw new ServiceUnavailableException('Nexus интеграциясы бапталмаған: серверде NEXUS_INTEGRATION_KEY орнатыңыз');
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}${path}`, { headers: { 'X-Integration-Key': this.key, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      this.log.warn(`Nexus unreachable: ${(e as Error).message}`);
      throw new BadGatewayException(`Nexus-ке қосылу мүмкін болмады (${this.apiUrl})`);
    }
    if (res.status === 401) throw new BadGatewayException('Nexus интеграция кілті қате (NEXUS_INTEGRATION_KEY)');
    if (res.status === 503) throw new BadGatewayException('Nexus-те интеграция қосылмаған (INTEGRATION_KEY бос)');
    if (!res.ok) throw new BadGatewayException(`Nexus қатесі: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async status(user: AuthUser) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
    const base = { configured: !!this.key, apiUrl: this.apiUrl, institutionId: school.nexusInstitutionId, autoSync: { enabled: autoSyncEnabled(), last: await this.lastSync(user.schoolId) } };
    if (!this.key) return { ...base, institutions: [], error: 'Серверде NEXUS_INTEGRATION_KEY орнатылмаған' };
    try {
      return { ...base, institutions: await this.call<{ id: string; name: string }[]>('/integration/institutions'), error: null };
    } catch (e) {
      return { ...base, institutions: [], error: (e as Error).message };
    }
  }

  async setInstitution(user: AuthUser, dto: InstitutionInput, meta: RequestMeta) {
    const list = await this.call<{ id: string; name: string }[]>('/integration/institutions');
    const inst = list.find((i) => i.id === dto.institutionId);
    if (!inst) throw new BadRequestException('Nexus-те мұндай мекеме жоқ');
    const school = await this.prisma.school.update({ where: { id: user.schoolId }, data: { nexusInstitutionId: inst.id } });
    await this.audit.record(user, { action: 'Nexus мекемесін байланыстырды', entity: 'school', entityId: school.id, summary: `${school.shortName} ↔ ${inst.name}` }, meta);
    return this.status(user);
  }

  /** Ағымдағы жылдың күндері бойынша сабақтар: алдымен бүгіннен бастап, бос болса — ағымдағы тоқсан басынан. */
  private async lessons(user: Actor) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
    if (!school.nexusInstitutionId) throw new BadRequestException('Алдымен Nexus мекемесін таңдаңыз');
    const year = await this.scope.currentYear(user.schoolId);
    const today = todayStr();
    const starts = [today, ...year.quarters.map((q) => fmtDate(q.startDate)!).filter((d) => d >= fmtDate(year.startDate)!)];
    for (const from of [...new Set(starts)]) {
      const q = new URLSearchParams({ institution_id: school.nexusInstitutionId, date_from: from, date_to: addDays(from, WINDOW_DAYS) });
      const rows = await this.call<NexusLesson[]>(`/integration/lessons?${q}`);
      if (rows.length) return { rows, from, to: addDays(from, WINDOW_DAYS) };
    }
    throw new BadRequestException('Nexus-те жарияланған сабақ кестесі табылмады');
  }

  private async plan(user: Actor) {
    const year = await this.scope.currentYear(user.schoolId);
    const { rows, from, to } = await this.lessons(user);
    const [teachers, classes, subjects] = await Promise.all([
      this.prisma.teacher.findMany({ where: { schoolId: user.schoolId, user: { deletedAt: null } }, include: { user: { select: { fullName: true, email: true } } } }),
      this.prisma.class.findMany({ where: { schoolId: user.schoolId, schoolYearId: year.id }, select: { id: true, grade: true, letter: true } }),
      this.prisma.subject.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
    ]);
    const plan = buildPlan(rows, { teachers: teachers.map((t) => ({ id: t.id, fullName: t.user.fullName, email: t.user.email })), classes, subjects });
    return { plan, year, from, to, lessons: rows.length };
  }

  private summary(p: Plan) {
    return {
      teachers: { total: p.teachers.length, new: p.teachers.filter((t) => !t.existingId).length, list: p.teachers },
      classes: { total: p.classes.length, new: p.classes.filter((c) => !c.existingId).map((c) => c.name) },
      subjects: { total: p.subjects.length, new: p.subjects.filter((s) => !s.existingId).map((s) => s.name) },
      assignments: p.assignments.length,
      groups: p.groups.length,
      // Ұстаз кестесінде топ сабақтары бір сабақ орнына біріктіріледі.
      slots: new Set(p.slots.map((x) => `${x.classKey}|${x.subject}|${x.weekday}|${x.period}`)).size,
      warnings: p.warnings,
    };
  }

  async preview(user: AuthUser) {
    const { plan, from, to, lessons } = await this.plan(user);
    return { from, to, lessons, ...this.summary(plan) };
  }

  /** Импорт: мұғалімдер, пәндер, сыныптар, пән мұғалімдері, пән топтары және апталық кесте (ағымдағы жыл кестесі толық ауыстырылады). */
  async import(user: Actor, meta: RequestMeta) {
    const { plan, year, from, to, lessons } = await this.plan(user);
    const r = await this.apply(user, meta, plan, year, from, to, lessons);
    // Қолмен импорттан кейін түнгі синхрондау сол кестені қайта жазбауы үшін хэш сақталады.
    await this.saveSync(user.schoolId, { ok: true, result: `Қолмен импорт: ${r.slots} сабақ орны`, hash: this.planHash(plan) });
    return r;
  }

  private async apply(user: Actor, meta: RequestMeta, plan: Plan, year: Awaited<ReturnType<ScopeService['currentYear']>>, from: string, to: string, lessons: number) {
    const teacherRole = await this.prisma.role.findUniqueOrThrow({ where: { code: 'TEACHER' } });
    // Жаңа мұғалімдерге кездейсоқ құпиясөз: олар iMARLEN ID арқылы кіреді немесе әкімші құпиясөз береді.
    const newTeachers = await Promise.all(
      plan.teachers.filter((t) => !t.existingId).map(async (t) => ({ ...t, hash: await argon2.hash(randomBytes(24).toString('base64url'), ARGON_OPTS) })),
    );
    const result = await this.prisma.$transaction(
      async (tx) => {
        const teacherId = new Map<string, number>();
        let createdTeachers = 0;
        for (const t of plan.teachers.filter((x) => x.existingId)) {
          teacherId.set(t.email, t.existingId!);
          if (t.email) {
            const u = await tx.teacher.findUniqueOrThrow({ where: { id: t.existingId! }, include: { user: true } });
            if (!u.user.email) await tx.user.update({ where: { id: u.userId }, data: { email: t.email } });
          }
        }
        for (const t of newTeachers) {
          let login = (t.email.split('@')[0] || 'teacher').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'teacher';
          for (let i = 2; await tx.user.findUnique({ where: { login } }); i++) login = `${login.replace(/\d+$/, '')}${i}`;
          const u = await tx.user.create({
            data: { login, fullName: t.fullName, email: t.email || null, passwordHash: t.hash, roleId: teacherRole.id, schoolId: user.schoolId, teacher: { create: { schoolId: user.schoolId } } },
            include: { teacher: true },
          });
          teacherId.set(t.email, u.teacher!.id);
          createdTeachers++;
        }

        const subjectId = new Map<string, number>();
        for (const s of plan.subjects) {
          subjectId.set(s.name, s.existingId ?? (await tx.subject.create({ data: { schoolId: user.schoolId, name: s.name } })).id);
        }
        const classId = new Map<string, number>();
        for (const c of plan.classes) {
          classId.set(c.key, c.existingId ?? (await tx.class.create({ data: { schoolId: user.schoolId, schoolYearId: year.id, grade: c.grade, letter: c.letter, name: c.name } })).id);
        }

        const assignmentId = new Map<string, number>();
        for (const a of plan.assignments) {
          const row = await tx.teachingAssignment.upsert({
            where: { classId_subjectId_schoolYearId: { classId: classId.get(a.classKey)!, subjectId: subjectId.get(a.subject)!, schoolYearId: year.id } },
            create: { schoolId: user.schoolId, schoolYearId: year.id, classId: classId.get(a.classKey)!, subjectId: subjectId.get(a.subject)!, teacherId: teacherId.get(a.teacherEmail)! },
            update: { teacherId: teacherId.get(a.teacherEmail)! },
          });
          assignmentId.set(`${a.classKey}|${a.subject}`, row.id);
        }

        // Топтар. Топтардың негізгі дереккөзі — BilimClass импорты мен әкімші, сондықтан Nexus:
        //  - топты аты немесе нөмірі бойынша табады («1-топ» = «1 топ») және мұғалімі бос болса ғана толтырады;
        //  - жаңа топты тек сыныптың бұл пәні әлі топқа бөлінбеген болса жасайды (қайталанған топ шықпауы үшін).
        // Оқушылар құрамын Nexus бермейді — оны BilimClass импорты не әкімші бөледі.
        let createdGroups = 0;
        const hadGroups = new Set<string>();
        for (const g of plan.groups) {
          const where = { classId: classId.get(g.classKey)!, subjectId: subjectId.get(g.subject)! };
          if (await tx.subjectGroup.count({ where })) hadGroups.add(`${where.classId}|${where.subjectId}`);
        }
        for (const g of plan.groups) {
          const where = { classId: classId.get(g.classKey)!, subjectId: subjectId.get(g.subject)! };
          const existing = await tx.subjectGroup.findMany({ where });
          const ex = existing.find((x) => x.name === g.name) ?? existing.find((x) => groupKey(x.name) === groupKey(g.name));
          if (ex) {
            if (!ex.teacherId) await tx.subjectGroup.update({ where: { id: ex.id }, data: { teacherId: teacherId.get(g.teacherEmail)! } });
          } else if (!hadGroups.has(`${where.classId}|${where.subjectId}`)) {
            await tx.subjectGroup.create({ data: { ...where, schoolId: user.schoolId, name: g.name, order: existing.length, teacherId: teacherId.get(g.teacherEmail)! } });
            createdGroups++;
          }
        }

        await tx.timetableSlot.deleteMany({ where: { schoolId: user.schoolId, assignment: { schoolYearId: year.id } } });
        const seen = new Set<string>();
        const slotRows = plan.slots
          .map((s) => ({ schoolId: user.schoolId, assignmentId: assignmentId.get(`${s.classKey}|${s.subject}`)!, weekday: s.weekday, period: s.period, startTime: s.startTime, endTime: s.endTime }))
          .filter((s) => {
            const k = `${s.assignmentId}|${s.weekday}|${s.period}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        await tx.timetableSlot.createMany({ data: slotRows });

        const res = {
          teachers: { total: plan.teachers.length, created: createdTeachers },
          subjects: plan.subjects.filter((s) => !s.existingId).length,
          classes: plan.classes.filter((c) => !c.existingId).length,
          assignments: plan.assignments.length,
          groups: { total: plan.groups.length, created: createdGroups },
          slots: slotRows.length,
          warnings: plan.warnings,
          from,
          to,
          lessons,
        };
        await this.audit.record(
          user,
          {
            action: 'Nexus-тен кесте импорттады',
            entity: 'timetable',
            summary: `${from} – ${to}: ${lessons} сабақ`,
            after: `мұғалім ${res.teachers.total} (жаңа ${res.teachers.created}), сынып +${res.classes}, пән +${res.subjects}, топ ${res.groups.total}, кесте ${res.slots} слот`,
          },
          meta,
          tx,
        );
        return res;
      },
      { timeout: 60_000 },
    );
    await this.cache.bump(user.schoolId);
    return result;
  }

  /** Жоспардың мазмұн хэші: түнде Nexus-те ештеңе өзгермесе, импорт пен аудит жазбасы өткізіліп жіберіледі. */
  private planHash(p: Plan) {
    const sorted = <T>(xs: T[]) => xs.map((x) => JSON.stringify(x)).sort();
    const data = {
      teachers: sorted(p.teachers.map((t) => [t.email, t.fullName])),
      classes: sorted(p.classes.map((c) => c.key)),
      subjects: sorted(p.subjects.map((x) => x.name)),
      assignments: sorted(p.assignments),
      groups: sorted(p.groups),
      slots: sorted(p.slots.map((x) => [x.classKey, x.subject, x.subgroup, x.teacherEmail, x.weekday, x.period, x.startTime, x.endTime])),
    };
    return createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  private async lastSync(schoolId: number): Promise<{ at: string; result: string; ok: boolean } | null> {
    if (!this.cache.isHealthy) return null;
    try {
      const raw = await this.cache.redis.get(lastSyncKey(schoolId));
      if (!raw) return null;
      const { at, result, ok } = JSON.parse(raw) as { at: string; result: string; ok: boolean };
      return { at, result, ok };
    } catch {
      return null;
    }
  }

  private async saveSync(schoolId: number, v: { ok: boolean; result: string; hash?: string; prevHash?: string | null }) {
    if (!this.cache.isHealthy) return;
    const hash = v.hash ?? v.prevHash ?? null;
    await this.cache.redis.set(lastSyncKey(schoolId), JSON.stringify({ at: new Date().toISOString(), ok: v.ok, result: v.result, hash })).catch(() => undefined);
  }

  /**
   * Түнгі автосинхрондау: Nexus мекемесі байланыстырылған әр мектептің кестесін Nexus-тен қайта алады.
   * Қауіпсіздік: Nexus бос жауап берсе (қате/демалыс) немесе сабақ саны күрт азайса, кесте өзгертілмейді.
   */
  @Cron(AUTO_SYNC_CRON, { name: 'nexus-auto-sync', timeZone: APP_TZ })
  async autoSyncAll() {
    if (!autoSyncEnabled() || !this.key) return;
    const schools = await this.prisma.school.findMany({ where: { nexusInstitutionId: { not: null } }, select: { id: true } });
    for (const { id } of schools) {
      try {
        this.log.log(`auto-sync school ${id}: ${await this.autoSync(id)}`);
      } catch (e) {
        const msg = (e as Error).message;
        this.log.warn(`auto-sync school ${id} failed: ${msg}`);
        await this.saveSync(id, { ok: false, result: msg, prevHash: (await this.lastHash(id)) ?? null });
      }
    }
  }

  private async lastHash(schoolId: number): Promise<string | null> {
    if (!this.cache.isHealthy) return null;
    try {
      const raw = await this.cache.redis.get(lastSyncKey(schoolId));
      return raw ? ((JSON.parse(raw) as { hash?: string | null }).hash ?? null) : null;
    } catch {
      return null;
    }
  }

  async autoSync(schoolId: number): Promise<string> {
    const actor: SystemActor = { schoolId, system: 'Nexus автосинхрондау' };
    const { plan, year, from, to, lessons } = await this.plan(actor);
    const hash = this.planHash(plan);
    const prevHash = await this.lastHash(schoolId);
    if (prevHash === hash) {
      await this.saveSync(schoolId, { ok: true, result: 'Өзгеріс жоқ', hash });
      return 'unchanged';
    }
    const slots = new Set(plan.slots.map((x) => `${x.classKey}|${x.subject}|${x.weekday}|${x.period}`)).size;
    const current = await this.prisma.timetableSlot.count({ where: { schoolId, assignment: { schoolYearId: year.id } } });
    if (current > 0 && slots < current * 0.5) {
      const msg = `Өткізілді: Nexus-те ${slots} сабақ орны, Ұстазда ${current} — тым аз, кесте өзгертілмеді`;
      await this.saveSync(schoolId, { ok: false, result: msg, prevHash });
      return msg;
    }
    const r = await this.apply(actor, {}, plan, year, from, to, lessons);
    await this.saveSync(schoolId, { ok: true, result: `Жаңартылды: ${r.slots} сабақ орны, жаңа мұғалім ${r.teachers.created}`, hash });
    return 'updated';
  }
}

@ApiTags('nexus')
@Controller('nexus')
@RequirePermissions(P.CLASSES_MANAGE)
class NexusController {
  constructor(private readonly svc: NexusService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.svc.status(user);
  }

  @Put('institution')
  institution(@CurrentUser() user: AuthUser, @Body() dto: InstitutionInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.setInstitution(user, dto, meta);
  }

  @Post('preview')
  preview(@CurrentUser() user: AuthUser) {
    return this.svc.preview(user);
  }

  @Post('import')
  import(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.svc.import(user, meta);
  }
}

@Module({ providers: [NexusService], controllers: [NexusController] })
export class NexusModule {}
