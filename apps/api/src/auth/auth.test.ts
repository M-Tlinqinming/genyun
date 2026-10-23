import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { memberships, organizations, users } from '../db/schema.ts';
import { hashPassword } from './auth.service.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const orgs: Record<'a' | 'b' | 'internal', string> = { a: '', b: '', internal: '' };

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);

  const created = await db
    .insert(organizations)
    .values([
      { name: 'A 安全咨询', kind: 'customer' },
      { name: 'B 制造', kind: 'customer' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  [orgs.a, orgs.b, orgs.internal] = created.map((o) => o.id) as [string, string, string];

  const people = [
    { email: 'a-admin@test.cn', orgId: orgs.a, role: 'customer_admin' as const },
    { email: 'a-member@test.cn', orgId: orgs.a, role: 'customer_member' as const },
    { email: 'b-admin@test.cn', orgId: orgs.b, role: 'customer_admin' as const },
    { email: 'expert@test.cn', orgId: orgs.internal, role: 'expert' as const },
    { email: 'ops@test.cn', orgId: orgs.internal, role: 'operator' as const },
  ];
  for (const p of people) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.email, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
  }

  app = await createApp(db, { loginLimitPerMinute: 1000 });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

async function loginAs(email: string) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

describe('登录', () => {
  it('正确的邮箱和密码可以登录，并返回所属组织', async () => {
    const agent = await loginAs('a-admin@test.cn');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.memberships).toEqual([{ orgId: orgs.a, orgName: 'A 安全咨询', role: 'customer_admin' }]);
  });

  it('邮箱大小写不影响登录', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'A-Admin@Test.cn', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('密码错误与账号不存在返回同样的提示', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'a-admin@test.cn', password: 'nope' });
    const missing = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@test.cn', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.message).toBe(missing.body.message);
  });

  it('会话令牌放在 httpOnly cookie 里', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'a-admin@test.cn', password: PASSWORD });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/gy_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('退出登录后会话失效', async () => {
    const agent = await loginAs('a-admin@test.cn');
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('未登录不能访问需要登录的接口', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get(`/api/orgs/${orgs.a}`).expect(401);
  });

  it('伪造的会话令牌无效', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', 'gy_session=forged').expect(401);
  });
});

describe('越权：组织之间的数据隔离', () => {
  it('客户管理员和成员能看自己的组织', async () => {
    await (await loginAs('a-admin@test.cn')).get(`/api/orgs/${orgs.a}`).expect(200);
    await (await loginAs('a-member@test.cn')).get(`/api/orgs/${orgs.a}`).expect(200);
  });

  it('A 组织的账号看不到 B 组织，且无法判断 B 是否存在', async () => {
    const agent = await loginAs('a-admin@test.cn');
    const other = await agent.get(`/api/orgs/${orgs.b}`);
    const missing = await agent.get('/api/orgs/00000000-0000-4000-8000-000000000000');
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(other.body.message).toBe(missing.body.message);
  });

  it('专业人员不能直接浏览客户组织', async () => {
    await (await loginAs('expert@test.cn')).get(`/api/orgs/${orgs.a}`).expect(404);
  });

  it('运营管理员可以查看所有客户组织', async () => {
    const agent = await loginAs('ops@test.cn');
    await agent.get(`/api/orgs/${orgs.a}`).expect(200);
    await agent.get(`/api/orgs/${orgs.b}`).expect(200);
  });
});

describe('登录限流', () => {
  it('同一 IP 一分钟内尝试过多会被暂时拒绝', async () => {
    const limited = await createApp(handle.db, { loginLimitPerMinute: 3 });
    await limited.init();
    try {
      const attempt = () =>
        request(limited.getHttpServer()).post('/api/auth/login').send({ email: 'x@test.cn', password: 'nope' });
      for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
