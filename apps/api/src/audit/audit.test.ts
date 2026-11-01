import type { INestApplication } from '@nestjs/common';
import { AUDIT_PAGE_SIZE } from '@genyun/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { auditLogs, memberships, organizations, users } from '../db/schema.ts';
import { MemoryMailer } from '../mail/mailer.ts';

const PASSWORD = 'correct horse battery staple';
let handle: DatabaseHandle;
let app: INestApplication;
const ids: Record<string, string> = {};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: 'A 安全咨询', kind: 'customer', activatedAt: new Date() },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  for (const p of [
    { email: 'admin@test.cn', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'member@test.cn', orgId: customer!.id, role: 'customer_member' as const },
    { email: 'expert@test.cn', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', orgId: internal!.id, role: 'operator' as const },
    { email: 'user@test.cn', orgId: customer!.id, role: 'customer_member' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.email.split('@')[0]!, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    ids[p.email] = u!.id;
  }
  app = await createApp(db, { loginLimitPerMinute: 1000, mailer: new MemoryMailer() });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

const http = () => request(app.getHttpServer());
async function as(email: string) {
  const agent = request.agent(app.getHttpServer());
  expect((await agent.post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ email, password: PASSWORD })).status).toBe(200);
  return agent;
}
const logsOf = (email: string) =>
  handle.db.select().from(auditLogs).where(eq(auditLogs.actorEmail, email)).orderBy(auditLogs.at);

describe('记操作日志', () => {
  it('登录成功：操作人、IP（经过代理时取转发来的地址）', async () => {
    await as('user@test.cn');
    const [log] = await logsOf('user@test.cn');
    expect(log).toMatchObject({ action: 'login_success', actorId: ids['user@test.cn'], ip: '203.0.113.9' });
  });

  it('登录失败：记输入的邮箱（统一小写），不记密码；没有这个账号也记', async () => {
    await http().post('/api/auth/login').send({ email: 'User@Test.cn', password: 'wrong-password-1' }).expect(401);
    await http().post('/api/auth/login').send({ email: 'nobody@test.cn', password: 'wrong-password-2' }).expect(401);
    const fails = (await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'login_failure')));
    expect(fails.map((f) => f.actorEmail).sort()).toEqual(['nobody@test.cn', 'user@test.cn']);
    expect(fails.every((f) => f.actorId === null)).toBe(true);
    expect(JSON.stringify(fails)).not.toContain('wrong-password');
  });

  it('退出登录', async () => {
    const agent = await as('member@test.cn');
    await agent.post('/api/auth/logout').expect(204);
    const logs = await logsOf('member@test.cn');
    expect(logs.map((l) => l.action)).toEqual(['login_success', 'logout']);
    expect(logs[1]!.actorId).toBe(ids['member@test.cn']);
  });
});

describe('运营查看操作日志', () => {
  it('没登录 401；客户管理员、客户成员、专业人员 403', async () => {
    await http().get('/api/operator/audit-logs').expect(401);
    for (const who of ['admin@test.cn', 'member@test.cn', 'expert@test.cn']) {
      const res = await (await as(who)).get('/api/operator/audit-logs');
      expect(res.status, who).toBe(403);
    }
  });

  it('运营能看：新的在前，带操作人姓名和邮箱', async () => {
    const res = await (await as('ops@test.cn')).get('/api/operator/audit-logs').expect(200);
    expect(res.body.pageSize).toBe(AUDIT_PAGE_SIZE);
    expect(res.body.page).toBe(1);
    const [first] = res.body.entries;
    // 最新一条是运营自己这次登录
    expect(first).toMatchObject({ action: 'login_success', actorName: 'ops', actorEmail: 'ops@test.cn' });
    const times = res.body.entries.map((e: { at: string }) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('按动作筛选；不认识的动作 400', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.get('/api/operator/audit-logs?action=login_failure').expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.entries.every((e: { action: string }) => e.action === 'login_failure')).toBe(true);
    await ops.get('/api/operator/audit-logs?action=drop_table').expect(400);
    await ops.get('/api/operator/audit-logs?page=0').expect(400);
  });

  it('分页：每页 50 条，第 2 页接着第 1 页', async () => {
    await handle.db.insert(auditLogs).values(
      Array.from({ length: 60 }, (_, i) => ({ action: 'login_failure' as const, actorEmail: `bulk${i}@test.cn`, at: new Date(Date.UTC(2026, 0, 1, 0, i)) })),
    );
    const ops = await as('ops@test.cn');
    const p1 = (await ops.get('/api/operator/audit-logs?action=login_failure').expect(200)).body;
    const p2 = (await ops.get('/api/operator/audit-logs?action=login_failure&page=2').expect(200)).body;
    expect(p1.total).toBe(62);
    expect(p1.entries).toHaveLength(50);
    expect(p2.entries).toHaveLength(12);
    const seen = new Set([...p1.entries, ...p2.entries].map((e: { id: string }) => e.id));
    expect(seen.size).toBe(62);
  });

  it('只读：没有新增、修改、删除的接口', async () => {
    const ops = await as('ops@test.cn');
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      expect((await ops[method]('/api/operator/audit-logs')).status, method).toBe(404);
    }
  });
});
