import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { memberships, organizations, passwordRecoveryCodes, users } from '../db/schema.ts';
import { MemoryMailer } from '../mail/mailer.ts';
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
  const code = mail?.text.match(/验证码是：(\d{6})/)?.[1];
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
      expect(res.body.message).toMatch(/秒后再试/);
    }
  });

  it('新密码不符合规则时不重设', async () => {
    const res = await reset('reset@test.cn', '123456', 'short');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('至少 8 位，含字母和数字');
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
