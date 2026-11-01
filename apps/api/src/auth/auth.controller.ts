import { loginSchema } from '@genyun/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService, clientIp } from '../audit/audit.ts';
import { AuthService, SESSION_TTL_MS, type SessionUser } from './auth.service.ts';
import { CurrentUser, Public, SESSION_COOKIE } from './session.guard.ts';

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');

    const result = await this.auth.login(parsed.data);
    // 操作日志：失败时记下输入的邮箱（可能不是任何账号），不记密码
    const ip = clientIp(req);
    if (!result) {
      await this.audit.record({ action: 'login_failure', actorEmail: parsed.data.email.trim().toLowerCase(), ip });
      throw new UnauthorizedException('邮箱或密码不正确');
    }
    await this.audit.record({ action: 'login_success', actorId: result.user.id, actorEmail: result.user.email, ip });

    setSessionCookie(res, result.token);
    return result.user;
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): SessionUser {
    return user;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: SessionUser, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) await this.auth.logout(token);
    await this.audit.record({ action: 'logout', actorId: user.id, actorEmail: user.email, ip: clientIp(req) });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
