import { randomUUID } from 'node:crypto';
import type { OperatorOverview } from '@genyun/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  auditLogs,
  checklistItems,
  deliveries,
  enterprises,
  generationBatches,
  memberships,
  onSiteRequests,
  organizationInvitations,
  organizations,
  tasks,
  users,
} from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';
const DAY = 86_400_000;

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
const id: Record<string, string> = {};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  const [active, pending, expired, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例安全咨询机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: now },
      { name: '示例待开通机构', kind: 'customer', contractStartsAt: '2026-11-01', contractEndsAt: '2027-10-31', createdAt: new Date(now.getTime() - 3 * DAY) },
      { name: '示例已到期机构', kind: 'customer', contractStartsAt: '2024-01-01', contractEndsAt: '2025-12-31', activatedAt: new Date('2024-01-01') },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  id.pending = pending!.id;
  id.expired = expired!.id;
  for (const p of [
    { email: 'admin@test.cn', name: '陈经理', orgId: active!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const by = uid['admin@test.cn']!;
  const zhou = uid['zhou@test.cn']!;
  const names = ['准备中', '待分配', '编制中', '超时', '已结束'];
  const ents = await db
    .insert(enterprises)
    .values(names.map((n) => ({ orgId: active!.id, name: `示例${n}`, createdBy: by })))
    .returning();
  const long = new Date('2026-10-27T07:20:00Z');
  const base = { orgId: active!.id, businessType: 'emergency_plan' as const, name: '2026 年应急预案', createdBy: by };
  const rows = await db
    .insert(tasks)
    .values([
      { ...base, enterpriseId: ents[0]!.id, number: 'GY-2026-001', status: 'preparing' as const },
      { ...base, enterpriseId: ents[1]!.id, number: 'GY-2026-002', status: 'submitted' as const, submittedAt: new Date(now.getTime() - 2 * DAY) },
      { ...base, enterpriseId: ents[2]!.id, number: 'GY-2026-003', status: 'submitted' as const, submittedAt: now, assignedExpertId: zhou, assignedAt: now },
      { ...base, enterpriseId: ents[3]!.id, number: 'GY-2026-004', status: 'submitted' as const, submittedAt: long, assignedExpertId: zhou, assignedAt: long },
      { ...base, enterpriseId: ents[4]!.id, number: 'GY-2026-005', status: 'submitted' as const, submittedAt: long, assignedExpertId: zhou, assignedAt: long, closedAt: now },
    ])
    .returning();
  id.unassigned = rows[1]!.id;
  id.overdue = rows[3]!.id;
  // 客户 10.27 请专家电话联系，一直没联系：超时兜底已下线，不再算进待办
  await db.insert(checklistItems).values({
    taskId: id.overdue,
    itemKey: 'fire_pool',
    status: 'later',
    callRequested: true,
    updatedBy: by,
    updatedAt: new Date('2026-10-27T06:00:00Z'),
  });
  // 上门工单：一张新的，一张已转交（上门已下线，不再算进待办）
  await db
    .insert(onSiteRequests)
    .values([
      { orgId: active!.id, enterpriseId: ents[0]!.id, contactName: '王建国', contactPhone: '13900000000', helpItems: ['消防水池'], createdBy: by },
      { orgId: active!.id, enterpriseId: ents[1]!.id, contactName: '李华', contactPhone: '13900000001', status: 'handed_over' as const, createdBy: by },
    ]);
  // 本月交付 1 个任务（发了两版也只算一次）；上个月的不算
  const done = rows[4]!.id;
  const [batch] = await db
    .insert(generationBatches)
    .values({ taskId: done, workupVersion: 1, snapshotAt: now, input: {} as never, materials: [], createdBy: zhou })
    .returning();
  const delivery = {
    taskId: done,
    batchId: batch!.id,
    status: 'done' as const,
    reviewedBy: zhou,
    reviewedAt: now,
    versions: { plan: 0, risk: 0, resource: 0 },
    publishedBy: zhou,
  };
  const [batch2, batch3] = await db
    .insert(generationBatches)
    .values([
      { taskId: done, workupVersion: 1, snapshotAt: now, input: {} as never, materials: [], createdBy: zhou },
      { taskId: rows[3]!.id, workupVersion: 1, snapshotAt: now, input: {} as never, materials: [], createdBy: zhou },
    ])
    .returning();
  await db.insert(deliveries).values([
    { ...delivery, publishId: randomUUID(), version: 1, publishedAt: now },
    { ...delivery, publishId: randomUUID(), batchId: batch2!.id, version: 2, publishedAt: now },
    { ...delivery, publishId: randomUUID(), taskId: rows[3]!.id, batchId: batch3!.id, version: 1, publishedAt: new Date('2025-06-01T00:00:00Z') },
  ]);
  // 邀请：3 天前发给待开通组织的、没接受；今天刚发的不算待办
  const invite = { orgId: pending!.id, role: 'customer_admin' as const, invitedBy: uid['ops@test.cn']!, expiresAt: new Date(now.getTime() + 4 * DAY) };
  const [inv] = await db
    .insert(organizationInvitations)
    .values([
      { ...invite, email: 'boss@example.com', name: '钱总', tokenHash: randomUUID(), createdAt: new Date(now.getTime() - 3 * DAY) },
      { ...invite, email: 'new@example.com', name: '孙总', tokenHash: randomUUID() },
      // 过期超过 14 天的不再放进今天先处理
      {
        ...invite,
        email: 'old@example.com',
        name: '老邀请',
        tokenHash: randomUUID(),
        createdAt: new Date(now.getTime() - 30 * DAY),
        expiresAt: new Date(now.getTime() - 23 * DAY),
      },
      // 客户管理员邀请的成员也进运营待办（运营可提醒或协助重发）
      {
        orgId: active!.id,
        role: 'customer_member' as const,
        invitedBy: by,
        email: 'member@example.com',
        name: '客户成员',
        tokenHash: randomUUID(),
        createdAt: new Date(now.getTime() - 5 * DAY),
        expiresAt: new Date(now.getTime() + 2 * DAY),
      },
    ])
    .returning();
  id.invitation = inv!.id;
  await db.insert(auditLogs).values([
    { action: 'task_assign' as const, actorId: uid['ops@test.cn'], actorEmail: 'ops@test.cn', target: 'GY-2026-003 · 周工', at: new Date(now.getTime() - 60_000) },
  ]);

  app = await createApp(db, { loginLimitPerMinute: 1000 });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

async function as(email: string) {
  const agent = request.agent(app.getHttpServer());
  expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  return agent;
}

describe('运营概览', () => {
  it('四个统计按真实数据算', async () => {
    const ops = await as('ops@test.cn');
    const body = (await ops.get('/api/operator/overview').expect(200)).body as OperatorOverview;
    expect(body.orgs).toEqual({ total: 3, active: 1, pending: 1, expired: 1 });
    // 已交付的不算在办；待分配专家、等客户补资料和任务中心的分组一致
    const center = (await ops.get('/api/operator/tasks').expect(200)).body as { group: string }[];
    expect(body.tasks).toEqual({
      open: center.filter((t) => t.group !== 'delivered').length,
      toAssign: center.filter((t) => t.group === 'to_assign').length,
      awaiting: center.filter((t) => t.group === 'awaiting').length,
    });
    expect(body.tasks.toAssign).toBe(1);
    expect(body.deliveries).toEqual({ thisMonth: 1 });
    expect(body).not.toHaveProperty('followUps');
    expect(body.feedback).toEqual({ new: 0, processing: 0 });
  });

  it('今天先处理：待开通、邀请未接受（运营和客户管理员发的），等得最久的在前；待分配的任务不在这里', async () => {
    const ops = await as('ops@test.cn');
    const { todos } = (await ops.get('/api/operator/overview').expect(200)).body as OperatorOverview;
    expect(todos.map((t) => t.kind).sort()).toEqual(['invitation', 'invitation', 'org_pending']);
    // 过期 14 天内的邀请；客户管理员发的也在
    expect(todos.filter((t) => t.kind === 'invitation').map((t) => t.title)).toEqual(['member@example.com', 'boss@example.com']);
    const since = todos.map((t) => t.since);
    expect([...since].sort()).toEqual(since);
    expect(todos.find((t) => t.kind === 'org_pending')).toMatchObject({
      title: '示例待开通机构',
      note: '核对合同后开通，系统自动邀请管理员',
      link: `/operator/organizations?open=${id.pending}`,
    });
    expect(todos.find((t) => t.title === 'boss@example.com')).toMatchObject({
      id: id.invitation,
      note: '邀请已发出，对方还没有设置密码加入',
      link: `/operator/organizations/${id.pending}`,
    });
    expect(todos.find((t) => t.title === 'member@example.com')).toMatchObject({
      subtitle: '示例安全咨询机构 · 组织成员',
      note: '由客户管理员发出，可提醒对方或协助重发',
      action: '查看组织',
    });
  });

  it('续约与次数：已到期 30 天以上的不放，待开通的在后；最近操作写成一句话并带身份', async () => {
    const ops = await as('ops@test.cn');
    const body = (await ops.get('/api/operator/overview').expect(200)).body as OperatorOverview;
    expect(body.renewals.map((r) => r.name)).toEqual(['示例安全咨询机构', '示例待开通机构']);
    expect(body.renewals[1]).toMatchObject({ sub: '待开通 · 合同 2026.11.01 起', action: { text: '开通' } });
    expect(body.recent.map((r) => r.action)).toEqual(['task_assign']);
    expect(body.recent[0]).toMatchObject({
      actorName: '赵运营',
      actorIdentity: 'operator',
      target: 'GY-2026-003 · 周工',
      sentence: '示例编制中已分配给周工',
    });
  });

  it('只有运营能看：客户、专家 403，没登录 401', async () => {
    for (const email of ['admin@test.cn', 'zhou@test.cn']) {
      expect((await (await as(email)).get('/api/operator/overview')).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/api/operator/overview')).status).toBe(401);
  });
});
