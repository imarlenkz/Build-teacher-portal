import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { RoleCode } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../../common/auth-user';
import { ROLE_LABELS_KK } from '../../common/permissions';
import { ARGON_OPTS } from './auth.service';

/** iMARLEN ID (OpenID Connect) клейм-жиыны — INTEGRATION.md бойынша. */
export interface IdpClaims {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  role?: 'student' | 'teacher' | 'parent' | 'school_admin' | 'platform_owner';
  school?: { id: string; name: string; code: string } | null;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
}

/** Порталдағы рөл. Оқушы мен ата-ана бұл порталға кірмейді. */
const ROLE_MAP: Partial<Record<NonNullable<IdpClaims['role']>, RoleCode>> = {
  teacher: 'TEACHER',
  school_admin: 'SCHOOL_ADMIN',
  platform_owner: 'ADMIN',
};

export class IdpError extends Error {}

export const IDP_ROLE_MAP = ROLE_MAP;

const b64url = (b: Buffer) => b.toString('base64url');

/**
 * iMARLEN ID арқылы кіру: authorization code + PKCE (S256), state және nonce.
 * Пайдаланушы `idp_sub` бойынша табылады; болмаса — логин бойынша бір рет байланыстырылады;
 * болмаса — мұғалім/әкімші ретінде автоматты тіркеледі (мектеп `schools.idp_code` бойынша).
 */
@Injectable()
export class IdpService {
  private readonly log = new Logger('IdP');
  private discovery: { at: number; doc: Discovery } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  get enabled() {
    return !!(this.issuer && this.clientId && this.clientSecret && this.publicUrl);
  }
  get passwordLogin() {
    return this.config.get('IID_PASSWORD_LOGIN', 'true') !== 'false';
  }
  private get issuer() {
    return (this.config.get<string>('IID_ISSUER') ?? '').replace(/\/+$/, '');
  }
  private get clientId() {
    return this.config.get<string>('IID_CLIENT_ID') ?? '';
  }
  private get clientSecret() {
    return this.config.get<string>('IID_CLIENT_SECRET') ?? '';
  }
  private get publicUrl() {
    const domain = this.config.get<string>('DOMAIN');
    return (this.config.get<string>('PUBLIC_URL') ?? (domain ? `https://${domain}` : '')).replace(/\/+$/, '');
  }
  get redirectUri() {
    return `${this.publicUrl}/api/auth/callback`;
  }

  private async disco(): Promise<Discovery> {
    if (this.discovery && Date.now() - this.discovery.at < 3600_000) return this.discovery.doc;
    const r = await fetch(`${this.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new IdpError(`iMARLEN ID қолжетімсіз (${r.status})`);
    const doc = (await r.json()) as Discovery;
    if (doc.issuer.replace(/\/+$/, '') !== this.issuer) throw new IdpError('iMARLEN ID issuer сәйкес емес');
    this.discovery = { at: Date.now(), doc };
    return doc;
  }

  /** Кіру сілтемесі және қысқа мерзімді қолтаңбалы cookie (state, nonce, PKCE verifier). */
  async start(next: string) {
    const d = await this.disco();
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    const cookie = await this.jwt.signAsync({ state, nonce, verifier, next: safeNext(next) }, { secret: this.cookieSecret(), expiresIn: 600, algorithm: 'HS256' });
    return { url: u.toString(), cookie };
  }

  private cookieSecret() {
    return `${this.config.getOrThrow<string>('JWT_ACCESS_SECRET')}:idp`;
  }

  /** Callback: state/nonce тексеру, кодты токенге айырбастау, клеймдерді алу. */
  async callback(cookie: string | undefined, q: { code?: string; state?: string; error?: string; error_description?: string }) {
    if (q.error) throw new IdpError(q.error === 'access_denied' ? 'Кіруден бас тартылды' : `iMARLEN ID: ${q.error_description ?? q.error}`);
    if (!cookie) throw new IdpError('Кіру сессиясы табылмады немесе мерзімі өтті. Қайта көріңіз');
    let saved: { state: string; nonce: string; verifier: string; next: string };
    try {
      saved = await this.jwt.verifyAsync(cookie, { secret: this.cookieSecret(), algorithms: ['HS256'] });
    } catch {
      throw new IdpError('Кіру сессиясының мерзімі өтті. Қайта көріңіз');
    }
    if (!q.code || !q.state || q.state !== saved.state) throw new IdpError('Кіру сұрауы жарамсыз (state)');

    const d = await this.disco();
    const tr = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: this.redirectUri, code_verifier: saved.verifier }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tr.ok) {
      this.log.warn(`token endpoint ${tr.status}: ${(await tr.text()).slice(0, 200)}`);
      throw new IdpError('iMARLEN ID кодты қабылдамады. Қайта көріңіз');
    }
    const tok = (await tr.json()) as { access_token: string; id_token: string };
    // id_token тікелей /token-нан HTTPS арқылы алынды — қолтаңбаны тексеру міндетті емес (OIDC Core 3.1.3.7),
    // бірақ iss, aud, nonce және мерзімі тексеріледі.
    const idt = decodeJwt(tok.id_token);
    const aud = Array.isArray(idt.aud) ? idt.aud : [idt.aud];
    if (String(idt.iss).replace(/\/+$/, '') !== this.issuer) throw new IdpError('id_token: iss сәйкес емес');
    if (!aud.includes(this.clientId)) throw new IdpError('id_token: aud сәйкес емес');
    if (idt.nonce !== saved.nonce) throw new IdpError('id_token: nonce сәйкес емес');
    if (typeof idt.exp === 'number' && idt.exp * 1000 < Date.now() - 60_000) throw new IdpError('id_token мерзімі өткен');

    const ur = await fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(8000) });
    const info = ur.ok ? ((await ur.json()) as Partial<IdpClaims>) : {};
    if (info.sub && info.sub !== idt.sub) throw new IdpError('userinfo: sub сәйкес емес');
    return { claims: { ...(idt as unknown as IdpClaims), ...info, sub: String(idt.sub) } as IdpClaims, next: saved.next };
  }

  /** Жергілікті пайдаланушыны табу, байланыстыру немесе тіркеу. Әр кіруде аты мен рөлі жаңартылады. */
  async provision(c: IdpClaims, meta: RequestMeta) {
    const roleCode = c.role ? ROLE_MAP[c.role] : undefined;
    if (!roleCode) throw new IdpError('Бұл портал тек мұғалімдер мен мектеп әкімшілігіне арналған');
    const school = c.school?.code ? await this.prisma.school.findUnique({ where: { idpCode: c.school.code } }) : null;
    if (roleCode !== 'ADMIN' && !school) {
      throw new IdpError(`«${c.school?.name ?? 'мектеп көрсетілмеген'}» мектебі порталға қосылмаған. Әкімші «Басқару → Мектептер» бетінде iMARLEN ID кодын (${c.school?.code ?? '—'}) көрсетуі керек`);
    }
    if (school && !school.isActive) throw new IdpError('Мектеп порталда өшірілген');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const fullName = (c.name ?? c.preferred_username ?? 'Пайдаланушы').trim().slice(0, 120);

    let user = await this.prisma.user.findUnique({ where: { idpSub: c.sub }, include: { teacher: true, role: true } });
    let action = '';
    if (!user && c.preferred_username) {
      // Бұрыннан бар аккаунтты логин бойынша бір рет байланыстыру.
      const byLogin = await this.prisma.user.findFirst({ where: { login: c.preferred_username.toLowerCase(), idpSub: null, deletedAt: null }, include: { teacher: true, role: true } });
      // Тек сол мектептің аккаунты (немесе платформа әкімшісі) — басқа мектептің бос логинін иемденуге болмайды.
      if (byLogin && (roleCode === 'ADMIN' ? byLogin.role.code === 'ADMIN' : byLogin.schoolId === school!.id)) {
        user = byLogin;
        action = 'Аккаунтты iMARLEN ID-мен байланыстырды';
      }
    }
    if (user?.deletedAt) throw new IdpError('Аккаунт жойылған. Әкімшіге хабарласыңыз');
    if (user && user.status !== 'ACTIVE') throw new IdpError('Аккаунт бұғатталған. Әкімшіге хабарласыңыз');

    const schoolId = roleCode === 'ADMIN' ? (school?.id ?? null) : school!.id;
    const result = await this.prisma.$transaction(async (tx) => {
      if (!user) {
        const login = await uniqueLogin(tx, c.preferred_username ?? `iid_${c.sub.slice(0, 8)}`);
        const created = await tx.user.create({
          data: {
            login,
            idpSub: c.sub,
            fullName,
            email: c.email ?? null,
            roleId: role.id,
            schoolId,
            // SSO пайдаланушысында жергілікті құпиясөз жоқ (кездейсоқ, ешкімге белгісіз).
            passwordHash: await argon2.hash(randomBytes(32).toString('hex'), ARGON_OPTS),
            lastLoginAt: new Date(),
            ...(roleCode !== 'ADMIN' && schoolId ? { teacher: { create: { schoolId } } } : {}),
          },
        });
        await this.audit.record(null, { action: 'iMARLEN ID арқылы тіркелді', entity: 'user', entityId: created.id, summary: `${fullName} (${login})`, after: ROLE_LABELS_KK[roleCode] }, meta, tx);
        return created;
      }
      const changes: Record<string, unknown> = {};
      if (user.fullName !== fullName) changes.fullName = fullName;
      if (user.roleId !== role.id) changes.roleId = role.id;
      if (schoolId && user.schoolId !== schoolId) changes.schoolId = schoolId;
      const updated = await tx.user.update({ where: { id: user.id }, data: { ...changes, idpSub: c.sub, email: c.email ?? user.email, lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
      if (roleCode !== 'ADMIN' && schoolId && !user.teacher) await tx.teacher.create({ data: { userId: user.id, schoolId } });
      if (action || changes.roleId) {
        await this.audit.record(
          null,
          { action: action || 'Рөлі iMARLEN ID бойынша жаңартылды', entity: 'user', entityId: user.id, summary: `${fullName} (${user.login})`, before: changes.roleId ? ROLE_LABELS_KK[user.role.code] : undefined, after: changes.roleId ? ROLE_LABELS_KK[roleCode] : undefined },
          meta,
          tx,
        );
      }
      return updated;
    });
    return result;
  }

  async logoutUrl() {
    if (!this.enabled) return null;
    const d = await this.disco().catch(() => null);
    const base = d?.end_session_endpoint ?? `${this.issuer}/logout`;
    const u = new URL(base);
    u.search = new URLSearchParams({ client_id: this.clientId, post_logout_redirect_uri: `${this.publicUrl}/` }).toString();
    return u.toString();
  }
}

/** Ашық редиректтен қорғау: тек осы сайттың ішкі жолы. */
export function safeNext(next: unknown) {
  return typeof next === 'string' && /^\/(?!\/)[^\\\s]*$/.test(next) && !next.startsWith('/api/') ? next : '/';
}

export function decodeJwt(token: string): Record<string, unknown> & { sub?: string; iss?: string; aud?: string | string[]; nonce?: string; exp?: number } {
  const parts = token?.split('.') ?? [];
  if (parts.length !== 3) throw new IdpError('id_token қате');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new IdpError('id_token қате');
  }
}

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
async function uniqueLogin(tx: Tx, wanted: string) {
  const base = wanted.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 28) || 'user';
  for (let i = 0; i < 50; i++) {
    const login = i ? `${base}${i + 1}` : base.padEnd(3, '_');
    if (!(await tx.user.findUnique({ where: { login } }))) return login;
  }
  return `${base}_${randomBytes(3).toString('hex')}`;
}
