import { hash, verify } from '@node-rs/argon2';
import {
  RECOVERY_CODE_MAX_ATTEMPTS,
  RECOVERY_CODE_TTL_MINUTES,
  RECOVERY_RESEND_SECONDS,
  type RecoveryResetInput,
} from '@genyun/shared';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { DATABASE, type Database } from '../db/client.ts';
import { passwordRecoveryCodes, sessions, users } from '../db/schema.ts';
import { MAILER, type Mailer } from '../mail/mailer.ts';
import { AuthService, hashPassword, type SessionUser } from './auth.service.ts';

// 同一邮箱一小时内最多发几次（不论邮箱是否注册都一样计数，免得通过限流判断是否注册）
const SENDS_PER_HOUR = 5;

// 账号不存在、验证码已作废时也做一次同样耗时的校验，响应时间和正常情况差不多
const DUMMY_CODE_HASH = hash('000000');

export class TooManyRequests extends HttpException {
  // reason：resend = 60 秒内重复发送（前端照常进入第 2 步，按 retryAfter 倒计时）；hourly = 一小时内发太多次
  constructor(message: string, extra: { reason: 'resend'; retryAfter: number } | { reason: 'hourly' }) {
    super({ statusCode: 429, message, ...extra }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

// A03 账号恢复：邮箱验证码重设密码。
// - 验证码 6 位数字，只存 argon2 哈希；10 分钟有效，错 5 次或用过一次即作废，重新发送时旧的作废
// - 不论邮箱是否注册，发送接口的提示和耗时都一样；重设失败的提示也只有一种
// - 重设成功后，这个账号的所有会话退出，再给当前浏览器开一个新会话（「重设并登录」）
@Injectable()
export class RecoveryService {
  // 按邮箱限流：邮箱 → 最近一小时内的发送时间。只在本进程内，预览环境只有一个应用容器
  private readonly sends = new Map<string, number[]>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async send(rawEmail: string): Promise<void> {
    const email = normalize(rawEmail);
    this.throttle(email);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await hash(code);
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!user) return;

    await this.db.transaction(async (tx) => {
      await tx
        .update(passwordRecoveryCodes)
        .set({ voidedAt: new Date() })
        .where(and(eq(passwordRecoveryCodes.userId, user.id), isNull(passwordRecoveryCodes.voidedAt)));
      await tx.insert(passwordRecoveryCodes).values({
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + RECOVERY_CODE_TTL_MINUTES * 60_000),
      });
    });

    // 不等发信结果：发信慢会让「已注册」的响应明显变慢
    this.mailer
      .send({
        to: email,
        // 主题会出现在服务日志和收件箱列表里，不放验证码
        subject: '重设耕云登录密码的验证码',
        text: [
          '您好：',
          '',
          `您正在重设耕云账号的登录密码，验证码是：${code}`,
          '',
          `验证码 ${RECOVERY_CODE_TTL_MINUTES} 分钟内有效，只能用一次。如果不是您本人操作，请忽略这封邮件，您的密码不会改变。`,
          '如有疑问请致电耕云 0752-5200831。',
        ].join('\n'),
      })
      // 只记错误说明，不记邮件内容
      .catch((err: unknown) => console.error(`重设密码验证码邮件发送失败：${err instanceof Error ? err.message : 'unknown'}`));
  }

  async reset(input: RecoveryResetInput): Promise<{ token: string; user: SessionUser } | null> {
    const email = normalize(input.email);
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    // 先占一次机会再比对：用一条条件更新把次数加 1，只有拿到机会的请求才比对散列。
    // 同时发很多个请求也最多比对 5 次。发新验证码时旧的都已作废，所以一个账号最多一条可用的
    const [claimed] = user
      ? await this.db
          .update(passwordRecoveryCodes)
          .set({ attempts: sql`${passwordRecoveryCodes.attempts} + 1` })
          .where(
            and(
              eq(passwordRecoveryCodes.userId, user.id),
              isNull(passwordRecoveryCodes.voidedAt),
              lt(passwordRecoveryCodes.attempts, RECOVERY_CODE_MAX_ATTEMPTS),
              gt(passwordRecoveryCodes.expiresAt, new Date()),
            ),
          )
          .returning({ id: passwordRecoveryCodes.id, codeHash: passwordRecoveryCodes.codeHash, attempts: passwordRecoveryCodes.attempts })
      : [];
    // 没拿到机会（账号不存在、没有可用的验证码）也做一次同样耗时的比对
    const ok = await verify(claimed ? claimed.codeHash : await DUMMY_CODE_HASH, input.code);
    if (!user || !claimed) return null;
    if (!ok) {
      // 第 5 次也错了：作废
      if (claimed.attempts >= RECOVERY_CODE_MAX_ATTEMPTS) {
        await this.db.update(passwordRecoveryCodes).set({ voidedAt: new Date() }).where(eq(passwordRecoveryCodes.id, claimed.id));
      }
      return null;
    }

    const passwordHash = await hashPassword(input.password);
    const done = await this.db.transaction(async (tx) => {
      // 用掉这个验证码：同一个验证码同时提交两次，只有一次能成功
      const used = await tx
        .update(passwordRecoveryCodes)
        .set({ voidedAt: new Date() })
        .where(and(eq(passwordRecoveryCodes.id, claimed.id), isNull(passwordRecoveryCodes.voidedAt)))
        .returning({ id: passwordRecoveryCodes.id });
      if (used.length === 0) return false;
      await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, user.id));
      await voidRecoveryCodes(tx, user.id);
      await tx.delete(sessions).where(eq(sessions.userId, user.id));
      return true;
    });
    return done ? this.auth.startSession(user.id) : null;
  }

  private throttle(email: string) {
    const now = Date.now();
    const recent = (this.sends.get(email) ?? []).filter((t) => now - t < 3_600_000);
    const last = recent.at(-1);
    if (last !== undefined && now - last < RECOVERY_RESEND_SECONDS * 1000) {
      const wait = Math.ceil((RECOVERY_RESEND_SECONDS * 1000 - (now - last)) / 1000);
      throw new TooManyRequests('验证码刚刚发过，请使用邮箱里最新的一封', { reason: 'resend', retryAfter: wait });
    }
    if (recent.length >= SENDS_PER_HOUR) throw new TooManyRequests('这个邮箱发送次数过多，请一小时后再试', { reason: 'hourly' });
    recent.push(now);
    this.sends.set(email, recent);
    // 顺手清掉一小时前的记录，Map 不会一直变大
    if (this.sends.size > 1000) {
      for (const [k, v] of this.sends) if (v.every((t) => now - t >= 3_600_000)) this.sends.delete(k);
    }
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// 密码改过之后（找回重设、个人账户改密码），这个账号还没用过的验证码全部作废
export async function voidRecoveryCodes(db: Database | Tx, userId: string): Promise<void> {
  await db
    .update(passwordRecoveryCodes)
    .set({ voidedAt: new Date() })
    .where(and(eq(passwordRecoveryCodes.userId, userId), isNull(passwordRecoveryCodes.voidedAt)));
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}
