import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  checklistItems,
  deliveries,
  enterprises,
  expertProfiles,
  generatedDrafts,
  generationBatches,
  memberships,
  organizations,
  taskIntakes,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
const task = { fresh: '', second: '', preparing: '', closed: '', busy: '' };

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, other, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例安全咨询机构', kind: 'customer', region: '广东省惠州市', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '另一家机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  for (const p of [
    { email: 'admin@test.cn', name: '陈经理', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
    // 客户组织里挂了 expert 角色的人：不是耕云的专家，不能被分配
    { email: 'fake@test.cn', name: '冒名专家', orgId: other!.id, role: 'expert' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const by = uid['admin@test.cn']!;
  const ents = await db
    .insert(enterprises)
    .values(
      ['示例制造', '示例电子', '示例精工', '示例包装', '示例化工'].map((name, i) => ({
        orgId: customer!.id,
        name,
        createdBy: by,
      })),
    )
    .returning();
  const submittedAt = new Date('2026-10-27T07:20:00Z');
  const base = { businessType: 'emergency_plan' as const, name: '2026 年应急预案', createdBy: by };
  const created = await db
    .insert(tasks)
    .values([
      { ...base, orgId: customer!.id, enterpriseId: ents[0]!.id, number: 'GY-2026-001', status: 'submitted' as const, submittedAt },
      { ...base, orgId: customer!.id, enterpriseId: ents[1]!.id, number: 'GY-2026-002', status: 'submitted' as const, submittedAt },
      { ...base, orgId: customer!.id, enterpriseId: ents[2]!.id, number: 'GY-2026-003' },
      { ...base, orgId: customer!.id, enterpriseId: ents[3]!.id, number: 'GY-2026-004', status: 'submitted' as const, submittedAt, closedAt: new Date() },
      // 吴工手上已有一个在办的任务
      { ...base, orgId: customer!.id, enterpriseId: ents[4]!.id, number: 'GY-2026-005', status: 'submitted' as const, submittedAt, assignedExpertId: uid['wu@test.cn']!, assignedAt: submittedAt },
    ])
    .returning();
  [task.fresh, task.second, task.preparing, task.closed, task.busy] = created.map((t) => t.id) as [string, string, string, string, string];
  // 客户在提交前就点了「请专家电话联系」
  await db.insert(checklistItems).values({
    taskId: task.fresh,
    itemKey: 'fire_pool',
    status: 'later',
    callRequested: true,
    updatedBy: by,
    updatedAt: new Date('2026-10-27T06:00:00Z'),
  });

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

interface TaskRow {
  id: string;
  number: string;
  view: { key: string; label: string };
  group: string;
  canReassign: boolean;
  needsAssignment: boolean;
  assignedExpertName: string | null;
  assignBlockedReason: string | null;
}

describe('运营任务中心', () => {
  it('列出全部客户任务，已提交且没有负责专家的是待分配专家', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.get('/api/operator/tasks');
    expect(res.status).toBe(200);
    const rows = res.body as TaskRow[];
    expect(rows.map((r) => r.number).sort()).toEqual(['GY-2026-001', 'GY-2026-002', 'GY-2026-003', 'GY-2026-004', 'GY-2026-005']);
    expect(rows.filter((r) => r.needsAssignment).map((r) => r.number).sort()).toEqual(['GY-2026-001', 'GY-2026-002']);
    expect(rows.find((r) => r.number === 'GY-2026-003')).toMatchObject({
      group: 'preparing',
      view: { label: '资料准备' },
      assignBlockedReason: '客户还没提交资料，提交后才能分配专家',
    });
    expect(rows.find((r) => r.number === 'GY-2026-005')).toMatchObject({ group: 'working', assignedExpertName: '吴工', canReassign: true });
    // 没有 stage 了
    expect(rows[0]).not.toHaveProperty('stage');
  });

  it('专家名单带在办数、头像和行业；只有耕云内部的专家', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.get(`/api/operator/tasks/${task.fresh}/experts`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ name: '吴工', openTasks: 1, current: false, avatar: null, industries: [], paused: false }),
      expect.objectContaining({ name: '周工', openTasks: 0, current: false }),
    ]);
    expect(res.body[0]).not.toHaveProperty('sameOrgEnterprises');
    // 运营、客户组织里挂了 expert 角色的人都不在里面
    const names = (res.body as { name: string }[]).map((e) => e.name);
    expect(names).not.toContain('赵运营');
    expect(names).not.toContain('冒名专家');
  });

  it('分配后任务进入专家任务中心，专家收到站内提醒（带运营说明）', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops
      .post(`/api/operator/tasks/${task.fresh}/assign`)
      .send({ expertId: uid['zhou@test.cn'], currentExpertId: null, note: '客户比较急，希望 11 月中交付' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ assignedExpertName: '周工', group: 'working', needsAssignment: false, canReassign: true });

    const zhou = await as('zhou@test.cn');
    const list = await zhou.get('/api/expert/tasks');
    expect((list.body.rows as { id: string }[]).map((t) => t.id)).toContain(task.fresh);
    expect((await zhou.get(`/api/tasks/${task.fresh}`)).status).toBe(200);
    const bell = await zhou.get('/api/notifications');
    expect(bell.body.items[0]).toMatchObject({ title: '分配给你的新任务', link: `/expert/tasks/${task.fresh}` });
    expect(bell.body.items[0].body).toContain('示例制造');
    // 运营说明放在第一句，铃铛里截断时也看得见
    expect(bell.body.items[0].body).toMatch(/^运营说明：客户比较急，希望 11 月中交付 /);

    // 客户看到的负责专家同步更新
    const admin = await as('admin@test.cn');
    expect((await admin.get(`/api/tasks/${task.fresh}`)).body.assignedExpertName).toBe('周工');
  });

  it('改派：任务带给新专家，原专家看不到这个任务，并收到改派提醒', async () => {
    const ops = await as('ops@test.cn');
    const detail = await ops.get(`/api/operator/tasks/${task.fresh}`);
    expect(detail.body).toMatchObject({ assignedExpertName: '周工' });

    const res = await ops
      .post(`/api/operator/tasks/${task.fresh}/assign`)
      .send({ expertId: uid['wu@test.cn'], currentExpertId: uid['zhou@test.cn'], reason: 'leave' });
    expect(res.status).toBe(201);
    expect(res.body.assignedExpertName).toBe('吴工');

    const wu = await as('wu@test.cn');
    expect((await wu.get(`/api/tasks/${task.fresh}`)).status).toBe(200);
    expect(((await wu.get('/api/expert/tasks')).body.rows as { id: string }[]).map((t) => t.id)).toContain(task.fresh);
    expect((await wu.get('/api/notifications')).body.items[0]).toMatchObject({ title: '改派给你的任务' });

    const zhou = await as('zhou@test.cn');
    // 原专家打开旧链接：说明已改派给谁
    const old = await zhou.get(`/api/tasks/${task.fresh}`);
    expect(old.status).toBe(404);
    expect(old.body.message).toBe('这个任务已改派给吴工');
    expect(((await zhou.get('/api/expert/tasks')).body.rows as { id: string }[]).map((t) => t.id)).not.toContain(task.fresh);
    const bell = (await zhou.get('/api/notifications')).body.items[0];
    expect(bell).toMatchObject({ title: '任务已改派', link: `/expert/tasks/${task.fresh}` });
    expect(bell.body).toMatch(/^改派理由：请假 /);
    expect(bell.body).toContain('已改派给吴工');

    // 从没负责过的人还是「找不到该任务」，不透露负责人
    const fake = await as('fake@test.cn');
    expect((await fake.get(`/api/tasks/${task.fresh}`)).body.message).toBe('找不到该任务');
  });

  it('改派记进运营记录；运营可以写内部备注，客户、专家看不到', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.post(`/api/operator/tasks/${task.fresh}/notes`).send({ body: '客户说周五前回电' });
    expect(res.status).toBe(201);
    expect(res.body[0]).toMatchObject({ kind: 'note', body: '客户说周五前回电', createdByName: '赵运营' });
    expect(res.body.map((n: { kind: string }) => n.kind)).toContain('reassign');
    expect((await ops.post(`/api/operator/tasks/${task.fresh}/notes`).send({ body: '  ' })).status).toBe(400);
    // 只能写备注；改派走分配接口
    expect((await ops.post(`/api/operator/tasks/${task.fresh}/notes`).send({ kind: 'reassign', body: 'x' })).status).toBe(400);

    for (const email of ['admin@test.cn', 'wu@test.cn']) {
      const other = await as(email);
      expect((await other.get(`/api/operator/tasks/${task.fresh}/notes`)).status).toBe(403);
      expect((await other.post(`/api/operator/tasks/${task.fresh}/notes`).send({ body: 'x' })).status).toBe(403);
    }
    // 客户看任务时没有内部备注
    const view = await (await as('admin@test.cn')).get(`/api/tasks/${task.fresh}`);
    expect(JSON.stringify(view.body)).not.toContain('客户说周五前回电');
  });

  it('打开弹窗后别人已分配过：拒绝并说明现在是谁', async () => {
    const ops = await as('ops@test.cn');
    // 页面上看到的还是「还没分配」，其实已经给了吴工
    const res = await ops
      .post(`/api/operator/tasks/${task.fresh}/assign`)
      .send({ expertId: uid['zhou@test.cn'], currentExpertId: null });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('这个任务刚被分配给吴工，请看最新情况再决定');
  });

  it('分配、改派记进操作日志：谁、从哪个 IP、哪个任务交给了谁；被拒绝的不记', async () => {
    const ops = await as('ops@test.cn');
    const assigned = await ops.get('/api/operator/audit-logs?action=task_assign');
    expect(assigned.status).toBe(200);
    expect(assigned.body.entries).toHaveLength(1);
    expect(assigned.body.entries[0]).toMatchObject({ actorEmail: 'ops@test.cn', actorName: '赵运营', target: 'GY-2026-001 · 周工' });
    expect(assigned.body.entries[0].ip).toBeTruthy();
    const reassigned = await ops.get('/api/operator/audit-logs?action=task_reassign');
    expect(reassigned.body.entries).toHaveLength(1);
    expect(reassigned.body.entries[0]).toMatchObject({ actorEmail: 'ops@test.cn', target: 'GY-2026-001 · 周工 → 吴工' });
  });

  it('两位运营同时分配同一任务：只有一个成功', async () => {
    const [a, b] = await Promise.all([as('ops@test.cn'), as('ops@test.cn')]);
    const results = await Promise.all([
      a.post(`/api/operator/tasks/${task.second}/assign`).send({ expertId: uid['zhou@test.cn'], currentExpertId: null }),
      b.post(`/api/operator/tasks/${task.second}/assign`).send({ expertId: uid['wu@test.cn'], currentExpertId: null }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('资料准备中、已结束、已是负责专家、选的不是耕云专家：都不能分配', async () => {
    const ops = await as('ops@test.cn');
    const send = (id: string, body: object) => ops.post(`/api/operator/tasks/${id}/assign`).send(body);
    const pre = await send(task.preparing, { expertId: uid['zhou@test.cn'], currentExpertId: null });
    expect(pre.status).toBe(409);
    expect(pre.body.message).toBe('客户还没提交资料，提交后才能分配专家');
    expect((await send(task.closed, { expertId: uid['zhou@test.cn'], currentExpertId: null })).body.message).toBe('任务已结束，不能再分配');
    const same = await send(task.busy, { expertId: uid['wu@test.cn'], currentExpertId: uid['wu@test.cn'] });
    expect(same.status).toBe(409);
    expect(same.body.message).toBe('吴工已经是负责专家');
    const notExpert = await send(task.busy, { expertId: uid['ops@test.cn'], currentExpertId: uid['wu@test.cn'] });
    expect(notExpert.status).toBe(400);
    expect(notExpert.body.message).toBe('请选择专家');
    // 客户组织里挂了 expert 角色也不行
    const outsider = await send(task.busy, { expertId: uid['fake@test.cn'], currentExpertId: uid['wu@test.cn'] });
    expect(outsider.status).toBe(400);
    expect((await ops.get(`/api/operator/tasks/${task.busy}`)).body.assignedExpertName).toBe('吴工');
    expect((await send(task.busy, { currentExpertId: null })).status).toBe(400);
  });

  it('客户、专家一律 403；未登录 401；任务不存在 404', async () => {
    for (const email of ['admin@test.cn', 'zhou@test.cn']) {
      const agent = await as(email);
      expect((await agent.get('/api/operator/tasks')).status).toBe(403);
      expect((await agent.get(`/api/operator/tasks/${task.second}`)).status).toBe(403);
      expect((await agent.get(`/api/operator/tasks/${task.second}/experts`)).status).toBe(403);
      const res = await agent.post(`/api/operator/tasks/${task.busy}/assign`).send({ expertId: uid['zhou@test.cn'], currentExpertId: uid['wu@test.cn'] });
      expect(res.status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/api/operator/tasks')).status).toBe(401);
    expect((await (await as('admin@test.cn')).post(`/api/operator/tasks/${task.busy}/assign`).send({})).body.message).toBe('只有耕云运营可以分配任务');
    const ops = await as('ops@test.cn');
    expect((await ops.get('/api/operator/tasks/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    // 越权请求没有改动任何东西
    expect((await ops.get(`/api/operator/tasks/${task.busy}`)).body.assignedExpertName).toBe('吴工');
  });
});

describe('暂停接单的专家', () => {
  it('名单里标出暂停的，审核状态不能派的不列；派给暂停的被拒，派给正常专家照常成功', async () => {
    const { db } = handle;
    const passwordHash = await hashPassword(PASSWORD);
    const [internal] = await db.select().from(organizations).where(eq(organizations.kind, 'internal'));
    const add = async (email: string, name: string, profile: { reviewStatus: 'approved' | 'pending' | 'delisted' | null; acceptingOrders: boolean }) => {
      const [u] = await db.insert(users).values({ email, name, passwordHash }).returning();
      await db.insert(memberships).values({ userId: u!.id, orgId: internal!.id, role: 'expert' });
      await db.insert(expertProfiles).values({ userId: u!.id, ...profile });
      uid[email] = u!.id;
    };
    await add('wang@test.cn', '王工', { reviewStatus: 'approved', acceptingOrders: false });
    await add('li@test.cn', '李工', { reviewStatus: 'pending', acceptingOrders: true });
    await add('qian@test.cn', '钱工', { reviewStatus: 'delisted', acceptingOrders: true });
    await add('sun@test.cn', '孙工', { reviewStatus: null, acceptingOrders: true });

    const ops = await as('ops@test.cn');
    const res = await ops.get(`/api/operator/tasks/${task.busy}/experts`);
    expect(res.status).toBe(200);
    const list = res.body as { name: string; paused: boolean }[];
    expect(list.map((e) => e.name).sort()).toEqual(['吴工', '周工', '孙工', '王工'].sort());
    expect(list.find((e) => e.name === '王工')!.paused).toBe(true);
    expect(list.filter((e) => e.paused).map((e) => e.name)).toEqual(['王工']);

    const send = (expertId: string) => ops.post(`/api/operator/tasks/${task.busy}/assign`).send({ expertId, currentExpertId: uid['wu@test.cn'] });
    const paused = await send(uid['wang@test.cn']!);
    expect(paused.status).toBe(409);
    expect(paused.body.message).toBe('王工已暂停接单，不能分配');
    // 不在名单里的（待审核）直接派也不行
    const pending = await send(uid['li@test.cn']!);
    expect(pending.status).toBe(409);
    expect(pending.body.message).toBe('这位专家现在不能接任务');
    expect((await ops.get(`/api/operator/tasks/${task.busy}`)).body.assignedExpertName).toBe('吴工');

    // 内部建的专家资料（审核状态为空）照常能派
    const ok = await send(uid['sun@test.cn']!);
    expect(ok.status).toBe(201);
    expect(ok.body.assignedExpertName).toBe('孙工');
  });

  it('名单里接单中的在前、暂停的在后，暂停的之间仍按名字', async () => {
    const { db } = handle;
    const passwordHash = await hashPassword(PASSWORD);
    const [internal] = await db.select().from(organizations).where(eq(organizations.kind, 'internal'));
    // 名字排在最前的一位也暂停：不该再排在第一
    const [u] = await db.insert(users).values({ email: 'ding@test.cn', name: '丁工', passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: internal!.id, role: 'expert' });
    await db.insert(expertProfiles).values({ userId: u!.id, reviewStatus: 'approved', acceptingOrders: false });

    const ops = await as('ops@test.cn');
    const list = (await ops.get(`/api/operator/tasks/${task.busy}/experts`).expect(200)).body as { name: string; paused: boolean }[];
    const firstPaused = list.findIndex((e) => e.paused);
    expect(firstPaused).toBeGreaterThan(0);
    expect(list.slice(0, firstPaused).every((e) => !e.paused)).toBe(true);
    expect(list.slice(firstPaused).map((e) => e.name)).toEqual(['丁工', '王工']);
  });
});

describe('任务中心的状态、抽屉和在办数', () => {
  it('等客户补资料：分组、等待起点、抽屉里的缺项和组织主联系人', async () => {
    const { db } = handle;
    const [org] = await db.select().from(organizations).where(eq(organizations.name, '示例安全咨询机构'));
    await db.update(organizations).set({ contactName: '示例联系人', contactPhone: '13800000000' }).where(eq(organizations.id, org!.id));
    const [ent] = await db.insert(enterprises).values({ orgId: org!.id, name: '示例补资料', createdBy: uid['admin@test.cn']! }).returning();
    const since = new Date('2026-11-10T02:00:00Z');
    const [t] = await db
      .insert(tasks)
      .values({
        orgId: org!.id,
        enterpriseId: ent!.id,
        number: 'GY-2026-101',
        businessType: 'emergency_plan',
        name: '2026 年应急预案',
        createdBy: uid['admin@test.cn']!,
        status: 'submitted',
        submittedAt: new Date('2026-11-09T02:00:00Z'),
        assignedExpertId: uid['zhou@test.cn']!,
        assignedAt: new Date('2026-11-09T03:00:00Z'),
        awaitingCustomerSince: since,
        awaitingCustomerItems: 3,
      })
      .returning();
    await db.insert(taskIntakes).values({ taskId: t!.id });

    const ops = await as('ops@test.cn');
    const row = ((await ops.get('/api/operator/tasks')).body as (TaskRow & { waitingSince: string | null })[]).find(
      (r) => r.number === 'GY-2026-101',
    )!;
    expect(row).toMatchObject({ group: 'awaiting', view: { key: 'awaiting_customer' }, waitingSince: since.toISOString(), canReassign: true });

    const detail = (await ops.get(`/api/operator/tasks/${t!.id}`)).body;
    expect(detail).toMatchObject({
      group: 'awaiting',
      region: '广东省惠州市',
      contactName: '示例联系人',
      contactPhone: '13800000000',
      awaitingCustomerSince: since.toISOString(),
      awaitingCustomerItems: 3,
      hasDraft: false,
    });
    expect(detail).not.toHaveProperty('workupStartedAt');

    // 在办数把这个任务算给周工
    const experts = (await ops.get(`/api/operator/tasks/${t!.id}/experts`)).body as { name: string; openTasks: number; current: boolean }[];
    expect(experts.find((e) => e.name === '周工')).toMatchObject({ current: true });
  });

  it('已交付：分在最后、带交付时间、不能改派；不算专家的在办数；正文可看', async () => {
    const { db } = handle;
    const [org] = await db.select().from(organizations).where(eq(organizations.name, '示例安全咨询机构'));
    const [ent] = await db.insert(enterprises).values({ orgId: org!.id, name: '示例已交付', createdBy: uid['admin@test.cn']! }).returning();
    const zhou = uid['zhou@test.cn']!;
    const ops = await as('ops@test.cn');
    const before = ((await ops.get(`/api/operator/tasks/${task.busy}/experts`)).body as { name: string; openTasks: number }[]).find(
      (e) => e.name === '周工',
    )!.openTasks;
    const at = new Date('2026-11-05T06:00:00Z');
    const [t] = await db
      .insert(tasks)
      .values({
        orgId: org!.id,
        enterpriseId: ent!.id,
        number: 'GY-2026-102',
        businessType: 'emergency_plan',
        name: '2026 年应急预案',
        createdBy: uid['admin@test.cn']!,
        status: 'submitted',
        submittedAt: at,
        assignedExpertId: zhou,
        assignedAt: at,
        closedAt: at,
      })
      .returning();
    await db.insert(taskIntakes).values({ taskId: t!.id });
    await db.insert(taskWorkups).values({ taskId: t!.id, snapshot: {} as never });
    const [b] = await db
      .insert(generationBatches)
      .values({ taskId: t!.id, workupVersion: 1, snapshotAt: at, input: {} as never, materials: [], createdBy: zhou })
      .returning();
    await db.insert(generatedDrafts).values(
      (['plan', 'risk', 'resource'] as const).map((kind) => ({ batchId: b!.id, kind, status: 'done' as const, finishedAt: at })),
    );
    await db.insert(deliveries).values({
      publishId: randomUUID(),
      taskId: t!.id,
      batchId: b!.id,
      version: 1,
      status: 'done',
      reviewedBy: zhou,
      reviewedAt: at,
      versions: { plan: 0, risk: 0, resource: 0 },
      publishedBy: zhou,
      publishedAt: at,
    });

    const rows = (await ops.get('/api/operator/tasks')).body as (TaskRow & { deliveredAt: string | null })[];
    const row = rows.find((r) => r.number === 'GY-2026-102')!;
    expect(row).toMatchObject({ group: 'delivered', canReassign: false, deliveredAt: at.toISOString() });
    // 已交付的排在所有在办任务后面
    expect(rows.slice(rows.indexOf(row)).every((r) => r.group === 'delivered')).toBe(true);
    expect((await ops.get(`/api/operator/tasks/${t!.id}`)).body.hasDraft).toBe(true);
    const after = ((await ops.get(`/api/operator/tasks/${task.busy}/experts`)).body as { name: string; openTasks: number }[]).find(
      (e) => e.name === '周工',
    )!.openTasks;
    expect(after).toBe(before);
  });
});
