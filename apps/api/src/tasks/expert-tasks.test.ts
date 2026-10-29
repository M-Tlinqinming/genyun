import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { checklistItems, enterprises, memberships, organizations, tasks, users } from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
const task: Record<'feiyu' | 'other' | 'preparing', string> = { feiyu: '', other: '', preparing: '' };

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例安全咨询机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  for (const p of [
    { email: 'admin@test.cn', name: '陈经理', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }

  const ents = await db
    .insert(enterprises)
    .values(['飞宇制造有限公司', '示例电子有限公司', '示例精工有限公司'].map((name) => ({ orgId: customer!.id, name, createdBy: uid['admin@test.cn']! })))
    .returning();
  const submittedAt = new Date('2026-10-27T07:20:00Z');
  const created = await db
    .insert(tasks)
    .values([
      { orgId: customer!.id, enterpriseId: ents[0]!.id, number: 'GY-2026-001', businessType: 'emergency_plan' as const, name: '2026 年应急预案', status: 'submitted' as const, submittedAt, assignedExpertId: uid['zhou@test.cn']!, createdBy: uid['admin@test.cn']! },
      { orgId: customer!.id, enterpriseId: ents[1]!.id, number: 'GY-2026-002', businessType: 'emergency_plan' as const, name: '2026 年应急预案', status: 'submitted' as const, submittedAt, assignedExpertId: uid['wu@test.cn']!, createdBy: uid['admin@test.cn']! },
      { orgId: customer!.id, enterpriseId: ents[2]!.id, number: 'GY-2026-003', businessType: 'emergency_plan' as const, name: '2026 年应急预案', assignedExpertId: uid['zhou@test.cn']!, createdBy: uid['admin@test.cn']! },
    ])
    .returning();
  [task.feiyu, task.other, task.preparing] = created.map((t) => t.id) as [string, string, string];

  const item = (taskId: string, itemKey: string, extra: object) => ({
    taskId,
    itemKey,
    status: 'later' as const,
    updatedBy: uid['admin@test.cn']!,
    updatedAt: new Date('2026-10-27T06:00:00Z'),
    ...extra,
  });
  await db.insert(checklistItems).values([
    item(task.feiyu, 'fire_pool', { callRequested: true }),
    item(task.feiyu, 'duty_phone', { callRequested: true }),
    item(task.feiyu, 'special_equipment', { status: 'photo_for_expert' }),
    // 专家已判定的不再算待核实
    item(task.feiyu, 'materials', { status: 'photo_for_expert', expertResult: 'no' }),
    item(task.feiyu, 'basic_info', { status: 'provided' }),
    item(task.other, 'fire_pool', { callRequested: true }),
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

interface Row {
  id: string;
  number: string;
  orgName: string;
  verifyItems: { key: string; kind: string }[];
  contact: { requestedAt: string; requestedBy: string; labels: string[]; deadline: string } | null;
}

describe('专家任务中心', () => {
  it('只列分派给自己的任务', async () => {
    const res = await (await as('zhou@test.cn')).get('/api/expert/tasks').expect(200);
    const rows = res.body.tasks as Row[];
    expect(rows.map((r) => r.number).sort()).toEqual(['GY-2026-001', 'GY-2026-003']);
    expect(rows[0]!.orgName).toBe('示例安全咨询机构');
  });

  it('待核实项只算专家还没判定的拍照项与请联系项', async () => {
    const res = await (await as('zhou@test.cn')).get('/api/expert/tasks').expect(200);
    const feiyu = (res.body.tasks as Row[]).find((r) => r.id === task.feiyu)!;
    expect(feiyu.verifyItems.map((v) => `${v.key}:${v.kind}`).sort()).toEqual([
      'duty_phone:call',
      'fire_pool:call',
      'special_equipment:photo',
    ]);
  });

  it('请求联系从提交时起算 2 个工作日，记下是谁请求的', async () => {
    const res = await (await as('zhou@test.cn')).get('/api/expert/tasks').expect(200);
    const { contact } = (res.body.tasks as Row[]).find((r) => r.id === task.feiyu)!;
    // 10-27（周二）15:20 北京时间提交，客户更早就点了请联系
    expect(contact).toMatchObject({ requestedAt: '2026-10-27T07:20:00.000Z', deadline: '2026-10-29T07:20:00.000Z', requestedBy: '陈经理' });
    expect(contact!.labels).toHaveLength(2);
    expect((res.body.tasks as Row[]).find((r) => r.id === task.preparing)!.contact).toBeNull();
  });

  it('最近处理只含自己任务的动态', async () => {
    const res = await (await as('zhou@test.cn')).get('/api/expert/tasks').expect(200);
    const events = res.body.events as { taskId: string; text: string }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.taskId === task.feiyu || e.taskId === task.preparing)).toBe(true);
    expect(events.map((e) => e.text)).toContain('飞宇制造有限公司请专家电话联系');
  });

  it('看不到也打不开别的专家的任务', async () => {
    const zhou = await as('zhou@test.cn');
    await zhou.get(`/api/tasks/${task.other}`).expect(404);
    await zhou.get(`/api/tasks/${task.feiyu}`).expect(200);
    const res = await (await as('wu@test.cn')).get('/api/expert/tasks').expect(200);
    expect((res.body.tasks as Row[]).map((r) => r.id)).toEqual([task.other]);
  });

  it('客户和运营不能用专家任务中心', async () => {
    await (await as('admin@test.cn')).get('/api/expert/tasks').expect(403);
    await (await as('ops@test.cn')).get('/api/expert/tasks').expect(403);
  });
});
