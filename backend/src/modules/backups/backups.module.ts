import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, NotFoundException, OnModuleInit, Param, ParseIntPipe, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { BackupKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, ReqMeta, RequirePermissions } from '../../common/decorators';
import { P } from '../../common/permissions';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { AuditService } from '../audit/audit.service';
import { APP_TZ } from '../../common/utils/dates';

class BackupSettingsInput {
  @IsBoolean() autoEnabled: boolean;
  @Type(() => Number) @IsInt() @Min(1) @Max(365) retentionDays: number;
}

const SETTINGS_KEY = 'backup';
interface BackupSettings {
  autoEnabled: boolean;
  retentionDays: number;
}

/**
 * pg_dump негізіндегі backup. Файлдар BACKUP_DIR томында (custom формат, сығылған) сақталады.
 * Қалпына келтіру: deploy/scripts/restore.sh (pg_restore) — жүйені тоқтатып, әкімші қолмен орындайды.
 */
@Injectable()
export class BackupsService implements OnModuleInit {
  private readonly log = new Logger('Backups');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get dir() {
    return this.config.get<string>('BACKUP_DIR', '/var/backups/ustaz');
  }

  async onModuleInit() {
    await fs.mkdir(this.dir, { recursive: true }).catch(() => undefined);
    // Сервер қайта іске қосылса, аяқталмаған backup-тар қате деп белгіленеді.
    await this.prisma.backup.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', error: 'Сервер қайта іске қосылды', finishedAt: new Date() } }).catch(() => undefined);
  }

  async settings(): Promise<BackupSettings> {
    const s = await this.prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
    return { autoEnabled: true, retentionDays: Number(this.config.get('BACKUP_RETENTION_DAYS', 30)), ...((s?.value as Partial<BackupSettings>) ?? {}) };
  }

  async setSettings(user: AuthUser, dto: BackupSettingsInput, meta: RequestMeta) {
    const before = await this.settings();
    await this.prisma.systemSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value: { ...dto } }, update: { value: { ...dto } } });
    await this.audit.record(user, { action: 'Backup баптауын өзгертті', entity: 'backup', summary: 'Автоматты backup', before, after: dto }, meta);
    return this.settings();
  }

  async list() {
    const rows = await this.prisma.backup.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { createdBy: { select: { fullName: true } } } });
    return { items: rows.map((b) => ({ ...b, sizeBytes: Number(b.sizeBytes), createdBy: b.createdBy?.fullName ?? 'Жүйе' })), settings: await this.settings() };
  }

  private pgEnv() {
    const url = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    return {
      args: ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1), '--format=custom', '--compress=6', '--no-owner'],
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    };
  }

  async create(kind: BackupKind, user: AuthUser | null, meta?: RequestMeta) {
    if (this.running) throw new BadRequestException('Backup қазір жасалып жатыр');
    this.running = true;
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .format(new Date())
      .replace(' ', '_')
      .replace(/:/g, '');
    const fileName = `ustaz_${stamp}_${kind.toLowerCase()}.dump`;
    const rec = await this.prisma.backup.create({ data: { fileName, kind, createdById: user?.id ?? null } });
    const target = path.join(this.dir, fileName);
    const { args, env } = this.pgEnv();
    const run = new Promise<void>((resolve, reject) => {
      const out = createWriteStream(target, { mode: 0o600 });
      const p = spawn('pg_dump', args, { env });
      let err = '';
      p.stdout.pipe(out);
      p.stderr.on('data', (d: Buffer) => (err += d.toString()));
      p.on('error', reject);
      p.on('close', (code) => {
        out.close();
        if (code === 0) resolve();
        else reject(new Error(err.trim().slice(0, 500) || `pg_dump exited with ${code}`));
      });
    });
    try {
      await run;
      const st = await fs.stat(target);
      await this.prisma.backup.update({ where: { id: rec.id }, data: { status: 'SUCCESS', sizeBytes: BigInt(st.size), finishedAt: new Date() } });
      await this.audit.record(user, { action: kind === 'AUTO' ? 'Автоматты backup' : 'Backup жасады', entity: 'backup', entityId: rec.id, summary: fileName, before: '—', after: fileName }, meta);
      this.log.log(`backup ok: ${fileName} (${st.size} bytes)`);
    } catch (e) {
      await fs.rm(target, { force: true });
      await this.prisma.backup.update({ where: { id: rec.id }, data: { status: 'FAILED', error: (e as Error).message, finishedAt: new Date() } });
      this.log.error(`backup failed: ${(e as Error).message}`);
      throw new BadRequestException(`Backup сәтсіз: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return this.prisma.backup.findUniqueOrThrow({ where: { id: rec.id } }).then((b) => ({ ...b, sizeBytes: Number(b.sizeBytes) }));
  }

  async file(id: number) {
    const b = await this.prisma.backup.findUnique({ where: { id } });
    if (!b || b.status !== 'SUCCESS') throw new NotFoundException('Backup табылмады');
    const p = path.join(this.dir, path.basename(b.fileName));
    await fs.access(p).catch(() => {
      throw new NotFoundException('Backup файлы дискіде жоқ');
    });
    return { b, p };
  }

  async remove(user: AuthUser, id: number, meta: RequestMeta) {
    const b = await this.prisma.backup.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Backup табылмады');
    await fs.rm(path.join(this.dir, path.basename(b.fileName)), { force: true });
    await this.prisma.backup.delete({ where: { id } });
    await this.audit.record(user, { action: 'Backup жойды', entity: 'backup', entityId: id, summary: b.fileName }, meta);
    return { ok: true };
  }

  async prune(retentionDays: number) {
    const old = await this.prisma.backup.findMany({ where: { createdAt: { lt: new Date(Date.now() - retentionDays * 864e5) } } });
    for (const b of old) {
      await fs.rm(path.join(this.dir, path.basename(b.fileName)), { force: true });
      await this.prisma.backup.delete({ where: { id: b.id } });
    }
    if (old.length) this.log.log(`pruned ${old.length} old backups`);
  }

  @Cron('0 0 2 * * *', { timeZone: APP_TZ })
  async nightly() {
    if (process.env.BACKUP_CRON_DISABLED === 'true') return;
    const s = await this.settings();
    if (!s.autoEnabled) return;
    try {
      await this.create('AUTO', null);
    } catch {
      /* қате журналға жазылды */
    }
    await this.prune(s.retentionDays);
  }
}

@ApiTags('backups')
@Controller('backups')
@RequirePermissions(P.BACKUP_MANAGE)
class BackupsController {
  constructor(
    private readonly svc: BackupsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.svc.create('MANUAL', user, meta);
  }

  @Put('settings')
  settings(@CurrentUser() user: AuthUser, @Body() dto: BackupSettingsInput, @ReqMeta() meta: RequestMeta) {
    return this.svc.setSettings(user, dto, meta);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const { b, p } = await this.svc.file(id);
    await this.audit.record(user, { action: 'Backup жүктеп алды', entity: 'backup', entityId: id, summary: b.fileName }, meta);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${b.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(p).pipe(res);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @ReqMeta() meta: RequestMeta) {
    return this.svc.remove(user, id, meta);
  }
}

@Module({ providers: [BackupsService], controllers: [BackupsController] })
export class BackupsModule {}
