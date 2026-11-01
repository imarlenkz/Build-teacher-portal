import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { ACCESS_TTL_SEC, LOCK_MINUTES, MAX_FAILED_LOGINS, REFRESH_TTL_SEC } from './auth.constants';
import { ROLE_LABELS_KK } from '../../common/permissions';

export const ARGON_OPTS: argon2.HashOptions & { raw: false } = { type: 2, memoryCost: 19456, timeCost: 2, parallelism: 1, raw: false };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface IssuedTokens {
  access: string;
  refresh: string;
  csrf: string;
}

@Injectable()
export class AuthService {
  // Пайдаланушы жоқ болса да уақыт бірдей болуы үшін (user enumeration-нан қорғау).
  private dummyHash = argon2.hash('dummy-password-for-timing', ARGON_OPTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(login: string, password: string, meta: RequestMeta): Promise<IssuedTokens> {
    const user = await this.prisma.user.findFirst({
      where: { login: login.trim().toLowerCase(), deletedAt: null },
      include: { role: true },
    });
    if (!user) {
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      throw new UnauthorizedException('Логин немесе құпиясөз қате');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(`Тым көп сәтсіз әрекет. ${mins} минуттан кейін қайталаңыз`);
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60000) : user.lockedUntil,
        },
      });
      if (failed >= MAX_FAILED_LOGINS) {
        await this.audit.record(null, {
          action: 'Аккаунт уақытша бұғатталды (сәтсіз кірулер)',
          entity: 'user',
          entityId: user.id,
          summary: `${user.fullName}: ${MAX_FAILED_LOGINS} рет қате құпиясөз`,
        }, meta);
      }
      throw new UnauthorizedException('Логин немесе құпиясөз қате');
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Аккаунт бұғатталған. Әкімшіге хабарласыңыз');
    if (this.config.get('IID_PASSWORD_LOGIN', 'true') === 'false' && user.role.code !== 'ADMIN') {
      throw new UnauthorizedException('Құпиясөзбен кіру өшірілген. «iMARLEN ID арқылы кіру» батырмасын қолданыңыз');
    }

    if (argon2.needsRehash(user.passwordHash, ARGON_OPTS)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(password, ARGON_OPTS) } });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return this.issue(user.id, user.passwordChangedAt, randomUUID(), meta);
  }

  /** Сыртқы провайдер (iMARLEN ID) арқылы расталған пайдаланушыға жаңа сессия ашу. */
  issueFor(user: { id: number; passwordChangedAt: Date }, meta: RequestMeta): Promise<IssuedTokens> {
    return this.issue(user.id, user.passwordChangedAt, randomUUID(), meta);
  }

  private async issue(userId: number, pwChangedAt: Date, family: string, meta: RequestMeta): Promise<IssuedTokens> {
    const access = await this.jwt.signAsync(
      { sub: userId, pv: Math.floor(pwChangedAt.getTime() / 1000) },
      { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: ACCESS_TTL_SEC, algorithm: 'HS256' },
    );
    const refresh = randomBytes(48).toString('base64url');
    await this.prisma.refreshSession.create({
      data: {
        userId,
        family,
        tokenHash: sha256(refresh),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
      },
    });
    return { access, refresh, csrf: randomBytes(24).toString('base64url') };
  }

  /**
   * Refresh token rotation: әр жаңартуда ескі токен жойылады. Бұрын қолданылған токен қайта
   * келсе (ұрлану белгісі), бүкіл «отбасы» сессиялары жабылады.
   */
  async refresh(token: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    if (!token) throw new UnauthorizedException('Сессия жоқ');
    const s = await this.prisma.refreshSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!s) throw new UnauthorizedException('Сессия жарамсыз');
    if (s.revokedAt) {
      await this.prisma.refreshSession.updateMany({ where: { family: s.family, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Сессия жарамсыз');
    }
    if (s.expiresAt < new Date() || s.user.status !== 'ACTIVE' || s.user.deletedAt) {
      throw new UnauthorizedException('Сессия мерзімі өтті');
    }
    await this.prisma.refreshSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    return this.issue(s.userId, s.user.passwordChangedAt, s.family, meta);
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const s = await this.prisma.refreshSession.findUnique({ where: { tokenHash: sha256(token) } });
    if (s) await this.prisma.refreshSession.updateMany({ where: { family: s.family, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { school: true, teacher: { include: { homeroomOf: { select: { id: true, name: true } } } } },
    });
    const school = await this.prisma.school.findUnique({ where: { id: user.schoolId } });
    const schools = user.permissions.includes('platform.wide')
      ? await this.prisma.school.findMany({ where: { isActive: true }, select: { id: true, name: true, shortName: true }, orderBy: { id: 'asc' } })
      : school
        ? [{ id: school.id, name: school.name, shortName: school.shortName }]
        : [];
    return {
      id: u.id,
      login: u.login,
      fullName: u.fullName,
      title: u.title,
      role: user.role,
      roleLabel: ROLE_LABELS_KK[user.role],
      permissions: user.permissions,
      locale: u.locale,
      idp: !!u.idpSub,
      teacherId: user.teacherId,
      homeroomClasses: u.teacher?.homeroomOf ?? [],
      school: school ? { id: school.id, name: school.name, shortName: school.shortName } : null,
      schools,
    };
  }

  async changePassword(user: AuthUser, current: string, next: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await argon2.verify(u.passwordHash, current).catch(() => false))) {
      throw new BadRequestException('Ағымдағы құпиясөз қате');
    }
    const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { passwordHash: await argon2.hash(next, ARGON_OPTS), passwordChangedAt: changedAt } });
      await tx.refreshSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(user, { action: 'Құпиясөзді өзгертті', entity: 'user', entityId: u.id, summary: u.fullName }, meta, tx);
    });
    return this.issue(u.id, changedAt, randomUUID(), meta);
  }
}
