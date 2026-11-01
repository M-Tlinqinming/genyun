import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { memberships, organizations, passwordRecoveryCodes, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';
import { MemoryMailer, SimulatedMailer } from '../mail/mailer.ts';
import { hashPassword } from './auth.service.ts';
import { RecoveryService } from './recovery.service.ts';

const PASSWORD = 'old-password-1';
const NEW_PASSWORD = 'new-password-2';

let handle: DatabaseHandle;
let app: INestApplication;
let mailer: MemoryMailer;
const ids: Record<string, string> = {};

// 每个测试用自己的账号，互不影响（按邮箱限流 60 秒一次）
const EMAILS = [
  'reset@test.cn',
  'reuse@test.cn',
  'notify@test.cn',
  'notify-wrong@test.cn',
  'expired@test.cn',
  'wrong@test.cn',
  'resend@test.cn',
  'throttle@test.cn',
  'time1@test.cn',
  'time2@test.cn',
  'time3@test.cn',
  'me@test.cn',
  'pw@test.cn',
  'other@test.cn',
  'devices@test.cn',
  'burst@test.cn',
  'pwcode@test.cn',
  'prodlog@test.cn',
];

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [org] = await db.insert(organizations).values({ name: 'A 安全咨询', kind: 'customer' }).returning();
  for (const email of EMAILS) {
    const [u] = await db.insert(users).values({ email, name: email.split('@')[0]!, passwordHash }).returning();
    ids[email] = u!.id;
    await db.insert(memberships).values({ userId: u!.id, orgId: org!.id, role: 'customer_admin' });
  }
  mailer = new MemoryMailer();
  app = await createApp(db, { loginLimitPerMinute: 1000, recoverySendLimitPer10Min: 1000, recoveryResetLimitPer10Min: 1000, mailer });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

const http = () => request(app.getHttpServer());

async function loginAs(email: string, password = PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

async function sendCode(email: string): Promise<string> {
  const before = mailer.sent.length;
  await http().post('/api/auth/recover/send').send({ email }).expect(204);
  await new Promise((r) => setImmediate(r));
  const mail = mailer.sent.slice(before).find((m) => m.to === email);
  const code = mail?.text.match(/验证码：(\d{6})/)?.[1];
  expect(code, '邮件里有 6 位验证码').toBeTruthy();
  // 主题会出现在日志和收件箱列表里：不放验证码
  expect(mail!.subject).not.toContain(code!);
  expect(mail!.subject).not.toMatch(/\d{6}/);
  return code!;
}

const reset = (email: string, code: string, password = NEW_PASSWORD) =>
  http().post('/api/auth/recover/reset').send({ email, code, password });

const FAILED = '验证码不正确或已失效，请检查或重新获取';

describe('找回密码：邮箱验证码', () => {
  it('验证码只存哈希；重设成功后直接登录，旧密码失效，其他会话全部退出', async () => {
    const email = 'reset@test.cn';
    const before = await loginAs(email);
    const code = await sendCode(email);

    const [row] = await handle.db.select().from(passwordRecoveryCodes).where(eq(passwordRecoveryCodes.userId, ids[email]!));
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash.startsWith('$argon2')).toBe(true);

    const res = await reset(email, code);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
    expect(String(res.headers['set-cookie'])).toMatch(/gy_session=.*HttpOnly/i);

    await before.get('/api/auth/me').expect(401);
    await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    await loginAs(email, NEW_PASSWORD);
  });

  it('验证码邮件和「密码已重设」通知都用统一模板：有称呼、落款，主题里没有验证码', async () => {
    const email = 'notify@test.cn';
    const sentBefore = mailer.sent.length;
    const code = await sendCode(email);
    const codeMail = mailer.sent.slice(sentBefore).find((m) => m.to === email)!;
    expect(codeMail.kind).toBe('recovery_code');
    expect(codeMail.html).toContain(code);
    expect(codeMail.text.trimEnd().endsWith('耕云 · 0752-5200831')).toBe(true);

    const before = mailer.sent.length;
    await reset(email, code).expect(200);
    await new Promise((r) => setImmediate(r));
    const notice = mailer.sent.slice(before).filter((m) => m.to === email);
    expect(notice).toHaveLength(1);
    expect(notice[0]!.kind).toBe('password_reset');
    expect(notice[0]!.subject).toBe('您的耕云登录密码已重设');
    expect(notice[0]!.text).toContain('其他设备上的登录都已退出');
    expect(`${notice[0]!.subject}${notice[0]!.text}`).not.toContain(code);
  });

  it('验证码不对时不发「密码已重设」通知', async () => {
    const email = 'notify-wrong@test.cn';
    const code = await sendCode(email);
    const before = mailer.sent.length;
    await reset(email, code === '000000' ? '111111' : '000000').expect(400);
    await new Promise((r) => setImmediate(r));
    expect(mailer.sent.length).toBe(before);
  });

  it('同一个验证码用过一次就作废', async () => {
    const email = 'reuse@test.cn';
    const code = await sendCode(email);
    await reset(email, code).expect(200);
    const again = await reset(email, code, 'another-pass-3');
    expect(again.status).toBe(400);
    expect(again.body.message).toBe(FAILED);
    await loginAs(email, NEW_PASSWORD);
  });

  it('过了 10 分钟的验证码不能用', async () => {
    const email = 'expired@test.cn';
    const code = await sendCode(email);
    await handle.db
      .update(passwordRecoveryCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordRecoveryCodes.userId, ids[email]!));
    const res = await reset(email, code);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(FAILED);
    await loginAs(email, PASSWORD);
  });

  it('错 5 次后验证码作废，正确的也不能用了', async () => {
    const email = 'wrong@test.cn';
    const code = await sendCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await reset(email, wrong).expect(400);
    const res = await reset(email, code);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(FAILED);
    await loginAs(email, PASSWORD);
  });

  it('错 4 次后正确的仍可用', async () => {
    const email = 'resend@test.cn';
    const code = await sendCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) await reset(email, wrong).expect(400);
    await reset(email, code).expect(200);
  });

  it('重新发送后旧验证码作废', async () => {
    const email = 'throttle@test.cn';
    const first = await sendCode(email);
    // 跳过 60 秒的发送间隔：把上一次的发送时间往前挪
    const recovery = app.get(RecoveryService) as unknown as { sends: Map<string, number[]> };
    recovery.sends.set(email, [Date.now() - 61_000]);
    const second = await sendCode(email);
    if (first !== second) await reset(email, first).expect(400);
    await reset(email, second).expect(200);
  });

  it('不论邮箱是否注册，发送接口的返回都一样；没注册的不发信', async () => {
    const before = mailer.sent.length;
    const missing = await http().post('/api/auth/recover/send').send({ email: 'nobody@test.cn' });
    expect(missing.status).toBe(204);
    expect(missing.text).toBe('');
    await new Promise((r) => setImmediate(r));
    expect(mailer.sent.length).toBe(before);
  });

  it('没注册的邮箱提交重设，提示和验证码错误时一样', async () => {
    const res = await reset('nobody2@test.cn', '123456');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(FAILED);
  });

  it('已注册和没注册的邮箱，发送接口耗时差不多', async () => {
    const time = async (email: string) => {
      const start = performance.now();
      await http().post('/api/auth/recover/send').send({ email }).expect(204);
      return performance.now() - start;
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (const n of [1, 2, 3]) {
      known.push(await time(`time${n}@test.cn`));
      unknown.push(await time(`ghost${n}@test.cn`));
    }
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[1]!;
    const ratio = median(known) / median(unknown);
    expect(ratio, `已注册 ${median(known).toFixed(0)}ms，没注册 ${median(unknown).toFixed(0)}ms`).toBeLessThan(3);
    expect(ratio).toBeGreaterThan(1 / 3);
  });

  it('同一邮箱 60 秒内只能发一次，注册与否都一样', async () => {
    for (const email of ['time1@test.cn', 'ghost1@test.cn']) {
      const res = await http().post('/api/auth/recover/send').send({ email });
      expect(res.status, email).toBe(429);
      // 前端照常进入第 2 步，按剩余秒数倒计时
      expect(res.body).toMatchObject({ reason: 'resend', message: '验证码刚刚发过，请使用邮箱里最新的一封' });
      expect(res.body.retryAfter).toBeGreaterThan(0);
      expect(res.body.retryAfter).toBeLessThanOrEqual(60);
    }
  });

  it('一小时内超过 5 次：429，reason 为 hourly', async () => {
    const email = 'hourly@test.cn';
    const recovery = app.get(RecoveryService) as unknown as { sends: Map<string, number[]> };
    recovery.sends.set(email, [1, 2, 3, 4, 5].map((m) => Date.now() - m * 61_000));
    const res = await http().post('/api/auth/recover/send').send({ email });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ reason: 'hourly', message: '这个邮箱发送次数过多，请一小时后再试' });
  });

  it('同时提交很多个错误验证码，最多比对 5 次，之后正确的也不能用', async () => {
    const email = 'burst@test.cn';
    const code = await sendCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    const results = await Promise.all(Array.from({ length: 12 }, () => reset(email, wrong)));
    expect(results.every((r) => r.status === 400)).toBe(true);
    const [row] = await handle.db.select().from(passwordRecoveryCodes).where(eq(passwordRecoveryCodes.userId, ids[email]!));
    expect(row!.attempts).toBe(5);
    expect(row!.voidedAt).not.toBeNull();
    await reset(email, code).expect(400);
  });

  it('在个人账户改了密码后，之前发的验证码作废', async () => {
    const email = 'pwcode@test.cn';
    const code = await sendCode(email);
    const agent = await loginAs(email);
    await agent.post('/api/account/password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(204);
    await reset(email, code, 'another-pass-3').expect(400);
    await loginAs(email, NEW_PASSWORD);
  });

  it('新密码不符合规则时不重设', async () => {
    const res = await reset('reset@test.cn', '123456', 'short');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('至少 8 位，含字母和数字');
  });
});

describe('找回密码：验证码不进日志', () => {
  it('正式环境模拟发信时，服务日志里没有验证码；发件箱文件里有', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gy-recover-outbox-'));
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const env = process.env.NODE_ENV;
    const prod = await createApp(handle.db, { mailer: new SimulatedMailer(dir), storage: new LocalDiskStorage(dir, 'test-secret') });
    await prod.init();
    // 模拟发信按 NODE_ENV 决定日志写多少；只在发送这一下设成 production
    process.env.NODE_ENV = 'production';
    try {
      await request(prod.getHttpServer()).post('/api/auth/recover/send').send({ email: 'prodlog@test.cn' }).expect(204);
      let files: string[] = [];
      // 发信不等结果：等文件出现
      for (let i = 0; i < 50 && files.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
        files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
      }
      const mail = JSON.parse(await readFile(join(dir, files[0]!), 'utf8')) as { text: string };
      const code = mail.text.match(/验证码：(\d{6})/)?.[1];
      expect(code).toBeTruthy();
      // 日志里的收件人打码
      expect(logs.join('\n')).toContain('pr****@test.cn');
      expect(logs.join('\n')).not.toContain(code!);
      expect(logs.join('\n')).not.toMatch(/\b\d{6}\b/);
    } finally {
      process.env.NODE_ENV = env;
      spy.mockRestore();
      await prod.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('找回密码：按 IP 限流', () => {
  it('同一 IP 发送超过限制后返回 429', async () => {
    const limited = await createApp(handle.db, { recoverySendLimitPer10Min: 2, mailer: new MemoryMailer() });
    await limited.init();
    try {
      const server = limited.getHttpServer();
      await request(server).post('/api/auth/recover/send').send({ email: 'ip1@test.cn' }).expect(204);
      await request(server).post('/api/auth/recover/send').send({ email: 'ip2@test.cn' }).expect(204);
      await request(server).post('/api/auth/recover/send').send({ email: 'ip3@test.cn' }).expect(429);
    } finally {
      await limited.close();
    }
  });
});

describe('个人账户', () => {
  it('没登录不能访问', async () => {
    await http().get('/api/account').expect(401);
    await http().patch('/api/account').send({ name: 'x' }).expect(401);
    await http().post('/api/account/password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(401);
    await http().post('/api/account/sign-out-others').expect(401);
  });

  it('改姓名只改自己；请求里带别人的 id、邮箱也没用', async () => {
    const agent = await loginAs('me@test.cn');
    const res = await agent
      .patch('/api/account')
      .send({ name: '  林管理员 ', id: ids['other@test.cn'], email: 'other@test.cn' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ids['me@test.cn'], email: 'me@test.cn', name: '林管理员' });
    const [other] = await handle.db.select().from(users).where(eq(users.id, ids['other@test.cn']!));
    expect(other!.name).toBe('other');
    expect(other!.email).toBe('other@test.cn');
    await agent.patch('/api/account').send({ name: '   ' }).expect(400);
  });

  it('改密码要当前密码；改完其他设备退出、这台保留，别人的账号不受影响', async () => {
    const email = 'pw@test.cn';
    const other = await loginAs(email);
    const agent = await loginAs(email);

    const wrong = await agent.post('/api/account/password').send({ currentPassword: 'nope', newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe('当前密码不正确');

    await agent.post('/api/account/password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(204);
    await agent.get('/api/auth/me').expect(200);
    await other.get('/api/auth/me').expect(401);
    const view = await agent.get('/api/account');
    expect(view.body.passwordChangedAt).toBeTruthy();

    await loginAs(email, NEW_PASSWORD);
    await loginAs('other@test.cn', PASSWORD);
  });

  it('退出其他设备：只退本人的其他会话', async () => {
    const email = 'devices@test.cn';
    const phone = await loginAs(email);
    const agent = await loginAs(email);
    const someoneElse = await loginAs('other@test.cn');

    expect((await agent.get('/api/account')).body.otherSessions).toBe(1);
    await agent.post('/api/account/sign-out-others').expect(204);
    await phone.get('/api/auth/me').expect(401);
    await agent.get('/api/auth/me').expect(200);
    await someoneElse.get('/api/auth/me').expect(200);
    expect((await agent.get('/api/account')).body.otherSessions).toBe(0);
  });
});
