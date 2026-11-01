import type { INestApplication } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { memberships, organizations, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';
import { SimulatedMailer } from './mailer.ts';
import { recoveryCodeMail } from './templates.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let mockApp: INestApplication;
let liveApp: INestApplication;
let dir: string;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  handle = await openDatabase('memory://');
  const { db } = handle;
  dir = await mkdtemp(join(tmpdir(), 'genyun-outbox-'));
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: 'A 安全咨询', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: new Date() },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  for (const p of [
    { email: 'a-admin@test.cn', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'a-member@test.cn', orgId: customer!.id, role: 'customer_member' as const },
    { email: 'expert@test.cn', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.email.split('@')[0]!, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
  }
  const mailer = new SimulatedMailer(join(dir, 'outbox'));
  await mailer.send(recoveryCodeMail({ to: 'lin@example.cn', name: '林管理员', code: '482913', validMinutes: 10 }));
  const storage = new LocalDiskStorage(join(dir, 'files'), 'test-secret');
  // 模拟发信（预览环境）和真实发信（正式环境）各起一个
  mockApp = await createApp(db, { loginLimitPerMinute: 1000, storage, mailer, mailOutbox: true });
  liveApp = await createApp(db, { loginLimitPerMinute: 1000, storage, mailer, mailOutbox: false });
  await mockApp.init();
  await liveApp.init();
});

afterAll(async () => {
  await mockApp?.close();
  await liveApp?.close();
  await handle?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function as(app: INestApplication, email: string) {
  const agent = request.agent(app.getHttpServer());
  expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  return agent;
}

describe('模拟发件箱', () => {
  it('运营能看到发出的邮件（含验证码、HTML）', async () => {
    const res = await (await as(mockApp, 'ops@test.cn')).get('/api/dev/outbox');
    expect(res.status).toBe(200);
    expect(res.body.mails).toHaveLength(1);
    expect(res.body.mails[0]).toMatchObject({ to: 'lin@example.cn', kind: 'recovery_code', subject: '重设耕云登录密码的验证码' });
    expect(res.body.mails[0].text).toContain('482913');
    expect(res.body.mails[0].html).toContain('482913');
  });

  it('客户管理员、客户成员、专业人员都是 403', async () => {
    for (const email of ['a-admin@test.cn', 'a-member@test.cn', 'expert@test.cn']) {
      const res = await (await as(mockApp, email)).get('/api/dev/outbox');
      expect(res.status, email).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('482913');
    }
  });

  it('没登录是 401', async () => {
    expect((await request(mockApp.getHttpServer()).get('/api/dev/outbox')).status).toBe(401);
  });

  it('正式环境（不是模拟发信）一律 404：运营、其他身份、没登录都一样', async () => {
    for (const email of ['ops@test.cn', 'a-admin@test.cn']) {
      expect((await (await as(liveApp, email)).get('/api/dev/outbox')).status, email).toBe(404);
    }
    expect((await request(liveApp.getHttpServer()).get('/api/dev/outbox')).status).toBe(404);
  });
});
