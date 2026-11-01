import { Body, Controller, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser, Public, ReqMeta, SkipCsrf } from '../../common/decorators';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { AuthService, IssuedTokens } from './auth.service';
import { ChangePasswordDto, LoginDto } from './auth.dto';
import { IdpError, IdpService, safeNext } from './idp.service';
import { ACCESS_COOKIE, IDP_COOKIE, ACCESS_TTL_SEC, CSRF_COOKIE, REFRESH_COOKIE, REFRESH_TTL_SEC } from './auth.constants';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly idp: IdpService,
  ) {}

  private readonly log = new Logger('AuthController');

  private base(): CookieOptions {
    return { secure: this.config.get('COOKIE_SECURE', 'true') !== 'false', sameSite: 'strict', path: '/' };
  }

  private setCookies(res: Response, t: IssuedTokens) {
    const b = this.base();
    res.cookie(ACCESS_COOKIE, t.access, { ...b, httpOnly: true, maxAge: ACCESS_TTL_SEC * 1000 });
    res.cookie(REFRESH_COOKIE, t.refresh, { ...b, httpOnly: true, path: '/api/auth', maxAge: REFRESH_TTL_SEC * 1000 });
    // CSRF cookie JS-ке оқылады (double-submit), бірақ басқа доменнен оқылмайды.
    res.cookie(CSRF_COOKIE, t.csrf, { ...b, httpOnly: false, maxAge: REFRESH_TTL_SEC * 1000 });
  }

  private clearCookies(res: Response) {
    const b = this.base();
    res.clearCookie(ACCESS_COOKIE, b);
    res.clearCookie(REFRESH_COOKIE, { ...b, path: '/api/auth' });
    res.clearCookie(CSRF_COOKIE, b);
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.login(dto.login, dto.password, meta);
    this.setCookies(res, t);
    return { ok: true };
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    try {
      const t = await this.auth.refresh((req.cookies as Record<string, string>)[REFRESH_COOKIE], meta);
      this.setCookies(res, t);
      return { ok: true };
    } catch (e) {
      this.clearCookies(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies as Record<string, string>)[REFRESH_COOKIE]);
    this.clearCookies(res);
    return { ok: true };
  }

  /** Кіру бетіне: iMARLEN ID қосулы ма, құпиясөзбен кіруге бола ма. */
  @Public()
  @Get('idp/config')
  idpConfig() {
    return { enabled: this.idp.enabled, passwordLogin: !this.idp.enabled || this.idp.passwordLogin };
  }

  /** iMARLEN ID-ға бағыттау. State cookie SameSite=lax — қайта оралғанда (cross-site redirect) жіберілуі үшін. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('idp/start')
  async idpStart(@Query('next') next: string | undefined, @Res() res: Response) {
    if (!this.idp.enabled) return res.redirect(302, '/?sso_error=' + encodeURIComponent('iMARLEN ID қосылмаған'));
    try {
      const { url, cookie } = await this.idp.start(safeNext(next));
      res.cookie(IDP_COOKIE, cookie, { ...this.base(), sameSite: 'lax', httpOnly: true, path: '/api/auth', maxAge: 600_000 });
      return res.redirect(302, url);
    } catch (e) {
      return res.redirect(302, '/?sso_error=' + encodeURIComponent(this.ssoMessage(e)));
    }
  }

  /** iMARLEN ID-дан оралу: тексеру, тіркеу/байланыстыру, жеке сессия ашу. */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('callback')
  async idpCallback(
    @Req() req: Request,
    @Query() q: { code?: string; state?: string; error?: string; error_description?: string },
    @ReqMeta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    res.clearCookie(IDP_COOKIE, { ...this.base(), sameSite: 'lax', path: '/api/auth' });
    try {
      const { claims, next } = await this.idp.callback((req.cookies as Record<string, string>)[IDP_COOKIE], q);
      const user = await this.idp.provision(claims, meta);
      this.setCookies(res, await this.auth.issueFor(user, meta));
      return res.redirect(302, safeNext(next));
    } catch (e) {
      return res.redirect(302, '/?sso_error=' + encodeURIComponent(this.ssoMessage(e)));
    }
  }

  /** SSO арқылы кірген пайдаланушы шыққанда iMARLEN ID сессиясын да жабу сілтемесі. */
  @Public()
  @Get('idp/logout-url')
  async idpLogoutUrl() {
    return { url: await this.idp.logoutUrl() };
  }

  private ssoMessage(e: unknown) {
    if (e instanceof IdpError) return e.message;
    this.log.error(e instanceof Error ? e.stack ?? e.message : String(e));
    return 'iMARLEN ID арқылы кіру сәтсіз аяқталды. Кейінірек қайталаңыз';
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, meta);
    this.setCookies(res, t);
    return { ok: true };
  }
}
