import { loginSchema, recoveryResetSchema, recoverySendSchema } from '@genyun/shared';
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
import { AuthService, SESSION_TTL_MS, type SessionUser } from './auth.service.ts';
import { RecoveryService } from './recovery.service.ts';
import { CurrentUser, Public, SESSION_COOKIE } from './session.guard.ts';

function setSessionCookie(res: Response, token: string) {
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
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');

    const result = await this.auth.login(parsed.data);
    if (!result) throw new UnauthorizedException('邮箱或密码不正确');

    setSessionCookie(res, result.token);
    return result.user;
  }

  // A03 第 1 步：发验证码。不论邮箱是否注册，返回都一样
  @Public()
  @Post('recover/send')
  @HttpCode(204)
  async sendRecoveryCode(@Body() body: unknown): Promise<void> {
    const parsed = recoverySendSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    await this.recovery.send(parsed.data.email);
  }

  // A03 第 2 步：验证码 + 新密码，成功后直接登录
  @Public()
  @Post('recover/reset')
  @HttpCode(200)
  async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const parsed = recoveryResetSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const result = await this.recovery.reset(parsed.data);
    if (!result) throw new BadRequestException('验证码不正确或已失效，请检查或重新获取');
    setSessionCookie(res, result.token);
    return result.user;
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): SessionUser {
    return user;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
