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
      { name: '待开通咨询公司', kind: 'customer', contractStartsAt: '2026-11-01', contractEndsAt: '2027-10-31', createdAt: new Date(now.getTime() - 3 * DAY) },
      { name: '已到期咨询公司', kind: 'customer', contractStartsAt: '2024-01-01', contractEndsAt: '2025-12-31', activatedAt: new Date('2024-01-01') },
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
  const names = ['准备中', '待分派', '编制中', '超时', '已结束'];
  const ents = await db
    .insert(enterprises)
    .values(names.map((n) => ({ orgId: active!.id, name: `示例${n}有限公司`, createdBy: by })))
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
  // 超时：客户 10.27 请注安师电话联系，一直没联系
  await db.insert(checklistItems).values({
    taskId: id.overdue,
    itemKey: 'fire_pool',
    status: 'later',
    callRequested: true,
    updatedBy: by,
    updatedAt: new Date('2026-10-27T06:00:00Z'),
  });
  // 上门工单：一张新的，一张已转交
  const [order] = await db
    .insert(onSiteRequests)
    .values([
      { orgId: active!.id, enterpriseId: ents[0]!.id, contactName: '王建国', contactPhone: '13900000000', helpItems: ['消防水池'], createdBy: by },
      { orgId: active!.id, enterpriseId: ents[1]!.id, contactName: '李华', contactPhone: '13900000001', status: 'handed_over' as const, createdBy: by },
    ])
    .returning();
  id.order = order!.id;
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
      { ...invite, email: 'boss@pending.cn', name: '钱总', tokenHash: randomUUID(), createdAt: new Date(now.getTime() - 3 * DAY) },
      { ...invite, email: 'new@pending.cn', name: '孙总', tokenHash: randomUUID() },
      // 过期超过 14 天的不再放进今天先处理
      {
        ...invite,
        email: 'old@pending.cn',
        name: '老邀请',
        tokenHash: randomUUID(),
        createdAt: new Date(now.getTime() - 30 * DAY),
        expiresAt: new Date(now.getTime() - 23 * DAY),
      },
      // 客户管理员自己邀请的成员由客户跟进，不进运营待办
      {
        orgId: active!.id,
        role: 'customer_member' as const,
        invitedBy: by,
        email: 'member@active.cn',
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
    // 已结束的任务不算在办
    expect(body.tasks).toEqual({ open: 4, preparing: 1, unassigned: 1, drafting: 2 });
    expect(body.deliveries).toEqual({ thisMonth: 1 });
    expect(body.followUps).toEqual({ overdue: 1, onSiteNew: 1 });
  });

  it('今天先处理：待开通、邀请未接受、待分派、超时兜底、上门工单，等得最久的在前', async () => {
    const ops = await as('ops@test.cn');
    const { todos } = (await ops.get('/api/operator/overview').expect(200)).body as OperatorOverview;
    expect(todos.map((t) => t.kind).sort()).toEqual(['invitation', 'on_site', 'org_pending', 'overdue', 'unassigned']);
    // 只有运营发的、过期 14 天内的邀请
    expect(todos.filter((t) => t.kind === 'invitation').map((t) => t.title)).toEqual(['boss@pending.cn']);
    // 10.27 起等的超时在最前
    expect(todos[0]).toMatchObject({ kind: 'overdue', id: id.overdue, link: `/operator/tasks?tab=overdue&task=${id.overdue}` });
    const since = todos.map((t) => t.since);
    expect([...since].sort()).toEqual(since);
    expect(todos.find((t) => t.kind === 'org_pending')).toMatchObject({ title: '待开通咨询公司', link: `/operator/organizations?open=${id.pending}` });
    expect(todos.find((t) => t.kind === 'invitation')).toMatchObject({
      id: id.invitation,
      title: 'boss@pending.cn',
      link: `/operator/organizations/${id.pending}`,
    });
    expect(todos.find((t) => t.kind === 'unassigned')).toMatchObject({ link: `/operator/tasks?task=${id.unassigned}` });
    expect(todos.find((t) => t.kind === 'on_site')).toMatchObject({ link: `/operator/tasks?tab=onsite&order=${id.order}` });
  });

  it('客户年度服务不含已到期的；最近操作不含登录退出', async () => {
    const ops = await as('ops@test.cn');
    const body = (await ops.get('/api/operator/overview').expect(200)).body as OperatorOverview;
    expect(body.services.map((s) => [s.name, s.state])).toEqual([
      ['示例安全咨询机构', 'active'],
      ['待开通咨询公司', 'pending'],
    ]);
    expect(body.services[0]!.enterprises).toBe(5);
    expect(body.services[1]!.daysLeft).toBeNull();
    expect(body.recent.map((r) => r.action)).toEqual(['task_assign']);
    expect(body.recent[0]).toMatchObject({ actorName: '赵运营', target: 'GY-2026-003 · 周工' });
  });

  it('只有运营能看：客户、注安师 403，没登录 401', async () => {
    for (const email of ['admin@test.cn', 'zhou@test.cn']) {
      expect((await (await as(email)).get('/api/operator/overview')).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/api/operator/overview')).status).toBe(401);
  });
});
