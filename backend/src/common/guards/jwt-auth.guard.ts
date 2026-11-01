import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { IS_PUBLIC } from '../decorators';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth-user';
import { P } from '../permissions';
import { ACCESS_COOKIE } from '../../modules/auth/auth.constants';

interface AccessPayload {
  sub: number;
  pv: number; // password version (passwordChangedAt) — құпиясөз ауысса, ескі токендер жарамсыз
}

/**
 * Access JWT httpOnly cookie-ден (немесе Authorization: Bearer) оқылады.
 * Пайдаланушының күйі мен рөлі әр сұраныста дерекқордан тексеріледі,
 * сондықтан бұғатталған пайдаланушы бірден жүйеден шығады.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extract(req);
    if (!token) throw new UnauthorizedException('Жүйеге кіру қажет');
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Сессия мерзімі өтті');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      include: { role: true, teacher: { select: { id: true } } },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Пайдаланушы бұғатталған');
    if (Math.floor(user.passwordChangedAt.getTime() / 1000) !== payload.pv) {
      throw new UnauthorizedException('Сессия жарамсыз');
    }
    const permissions = user.role.permissions;
    let schoolId = user.schoolId;
    const header = req.headers['x-school-id'];
    if (header && permissions.includes(P.PLATFORM_WIDE)) {
      const requested = Number(header);
      if (!Number.isInteger(requested) || requested <= 0) throw new ForbiddenException('Мектеп қате');
      schoolId = requested;
    }
    if (!schoolId) {
      const first = await this.prisma.school.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
      if (!first) throw new ForbiddenException('Мектеп табылмады');
      schoolId = first.id;
    }
    req.user = {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      role: user.role.code,
      permissions,
      homeSchoolId: user.schoolId,
      schoolId,
      teacherId: user.teacher?.id ?? null,
    };
    return true;
  }

  private extract(req: Request): string | undefined {
    const c = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (c) return c;
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) return h.slice(7);
    return undefined;
  }
}
