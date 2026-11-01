import { verify } from '@node-rs/argon2';
import { accountNameSchema, changePasswordSchema, type AccountView } from '@genyun/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { and, count, eq, gt, ne } from 'drizzle-orm';
import type { Request } from 'express';
import { DATABASE, type Database } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';
import { hashPassword, hashToken, type SessionUser } from './auth.service.ts';
import { voidRecoveryCodes } from './recovery.service.ts';
import { CurrentUser, SESSION_COOKIE } from './session.guard.ts';

// A04 个人账户：只改登录人自己的账号。接口里没有用户 id 参数，改谁只看会话，所以改不了别人的账号。
@Injectable()
export class AccountService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async view(userId: string, token: string): Promise<AccountView> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new BadRequestException('账号不存在');
    const [others] = await this.db
      .select({ n: count() })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      otherSessions: others?.n ?? 0,
    };
  }

  async rename(userId: string, name: string): Promise<void> {
    await this.db.update(users).set({ name }).where(eq(users.id, userId));
  }

  // 改密码后，这个账号在其他设备上的登录全部退出，当前这台保留
  async changePassword(userId: string, token: string, current: string, next: string): Promise<void> {
    const [user] = await this.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !(await verify(user.passwordHash, current))) throw new BadRequestException('当前密码不正确');
    const passwordHash = await hashPassword(next);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, userId));
      // 改过密码，之前发的找回密码验证码不能再用
      await voidRecoveryCodes(tx, userId);
      await tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(token))));
    });
  }

  async signOutOthers(userId: string, token: string): Promise<void> {
    await this.db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(token))));
  }
}

function sessionToken(req: Request): string {
  return (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? '';
}

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
  return parsed.data;
}

@Controller('account')
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Get()
  view(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<AccountView> {
    return this.account.view(user.id, sessionToken(req));
  }

  @Patch()
  async rename(@CurrentUser() user: SessionUser, @Req() req: Request, @Body() body: unknown): Promise<AccountView> {
    const { name } = parse(accountNameSchema, body);
    await this.account.rename(user.id, name);
    return this.account.view(user.id, sessionToken(req));
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: SessionUser, @Req() req: Request, @Body() body: unknown): Promise<void> {
    const input = parse(changePasswordSchema, body);
    await this.account.changePassword(user.id, sessionToken(req), input.currentPassword, input.newPassword);
  }

  @Post('sign-out-others')
  @HttpCode(204)
  async signOutOthers(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<void> {
    await this.account.signOutOthers(user.id, sessionToken(req));
  }
}
