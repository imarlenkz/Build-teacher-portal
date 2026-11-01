import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { SKIP_CSRF } from '../decorators';
import { CSRF_COOKIE, CSRF_HEADER } from '../../modules/auth/auth.constants';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF қорғанысы: өзгертетін әр сұраныста X-CSRF-Token тақырыбы
 * ustaz_csrf cookie мәнімен сәйкес болуы керек. Bearer токенмен келген (cookie жоқ)
 * API клиенттері CSRF-ке осал емес, сондықтан оларға тексеріс қолданылмайды.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()])) return true;
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    const usesCookieAuth = Object.keys(cookies).some((k) => k.startsWith('ustaz_'));
    if (!usesCookieAuth && req.headers.authorization?.startsWith('Bearer ')) return true;
    const a = cookies[CSRF_COOKIE];
    const b = req.headers[CSRF_HEADER];
    if (!a || typeof b !== 'string' || a.length !== b.length || !timingSafeEqual(Buffer.from(a), Buffer.from(b))) {
      throw new ForbiddenException('CSRF токені жарамсыз. Бетті жаңартыңыз.');
    }
    return true;
  }
}
