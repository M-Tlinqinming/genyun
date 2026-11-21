// 运营任务中心抽屉的缺项清单和联系记录里专家复制清单的那几条
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, memberships, organizations, taskIntakes, tasks, taskWorkups, users } from '../db/schema.ts';
import { buildParseResult } from '../intake/profile.ts';
import { loadWorkbook, readWorkbook } from '../intake/read.ts';
import { newNormal } from '../intake/test-workbooks.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
let legacyTask = '';
let intakeTask = '';

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: '飞宇演示客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  const uid: Record<string, string> = {};
  for (const p of [
    { email: 'feiyu@test.cn', name: '陈志刚', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const customerId = uid['feiyu@test.cn']!;
  const [ent, blankEnt] = await db
    .insert(enterprises)
    .values([
      { orgId: customer!.id, name: '飞宇电器', createdBy: customerId },
      { orgId: customer!.id, name: '飞宇（表格）', createdBy: customerId },
    ])
    .returning();
  const base = {
    orgId: customer!.id,
    businessType: 'emergency_plan' as const,
    name: '2026 年应急预案',
    createdBy: customerId,
    status: 'submitted' as const,
    submittedAt: new Date('2026-11-10T02:00:00Z'),
    assignedExpertId: uid['zhou@test.cn']!,
    assignedAt: new Date('2026-11-10T03:00:00Z'),
  };
  const created = await db
    .insert(tasks)
    .values([
      { ...base, enterpriseId: ent!.id, number: 'GY-2026-301' },
      { ...base, enterpriseId: blankEnt!.id, number: 'GY-2026-302' },
    ])
    .returning();
  [legacyTask, intakeTask] = created.map((t) => t.id) as [string, string];
  const read = readWorkbook(await loadWorkbook(await newNormal()));
  if (read.kind !== 'read') throw new Error('样例表格没读出来');
  await db.insert(taskIntakes).values({ taskId: intakeTask, parseResult: buildParseResult(read.read) });

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

const stored = async (taskId: string) => (await handle.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId)))[0]!;

interface Item {
  key: string;
  label: string;
  required: boolean;
  filledAt?: string;
}

describe('运营看缺项清单', () => {
  it('没复制过清单、逐项填写的老任务：list 为空', async () => {
    const ops = await as('ops@test.cn');
    const zhou = await as('zhou@test.cn');
    await zhou.get(`/api/tasks/${legacyTask}/workup`).expect(200);
    const legacy = await ops.get(`/api/operator/tasks/${legacyTask}/missing-list`).expect(200);
    expect(legacy.body.list).toBeNull();
    expect(legacy.body.taskNumber).toBe('GY-2026-301');
    const fresh = await ops.get(`/api/operator/tasks/${intakeTask}/missing-list`).expect(200);
    expect(fresh.body.list).toBeNull();
  });

  it('专家复制后运营取得到；补上一项后再取，这一项有补上的时间', async () => {
    const zhou = await as('zhou@test.cn');
    const ops = await as('ops@test.cn');
    const { body } = await zhou.get(`/api/tasks/${intakeTask}/workup`).expect(200);
    await zhou.post(`/api/tasks/${intakeTask}/workup/missing-list`).send({ version: body.version }).expect(201);

    const first = await ops.get(`/api/operator/tasks/${intakeTask}/missing-list`).expect(200);
    const items = first.body.list.items as Item[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => !i.filledAt)).toBe(true);
    expect(first.body.list.byName).toBe('周工');
    expect(first.body.taskNumber).toBe('GY-2026-302');
    expect(first.body.awaitingSince).toBeTruthy();
    expect(first.body.awaitingItems).toBe(items.length);
    // 和专家接口同一个形状、同样的内容
    const expertView = await zhou.get(`/api/tasks/${intakeTask}/workup/missing-list`).expect(200);
    expect(first.body).toEqual(expertView.body);

    // 专家代客户填上技术管理人员人数（第 1 步必需项），走真实的保存
    const target = items.find((i) => i.key === 'field:basic.technicalManagementCount');
    expect(target).toBeTruthy();
    const row = await stored(intakeTask);
    await zhou
      .put(`/api/tasks/${intakeTask}/workup/facts`)
      .send({ version: row.version, key: 'technicalManagementCount', value: 6, source: 'customer' })
      .expect(200);
    const after = await ops.get(`/api/operator/tasks/${intakeTask}/missing-list`).expect(200);
    const filled = (after.body.list.items as Item[]).find((i) => i.key === target!.key);
    expect(filled?.filledAt).toBeTruthy();
    expect((after.body.list.items as Item[]).filter((i) => i.filledAt)).toHaveLength(1);
  });

  it('专家、客户调运营接口被拦（403）；不存在的任务 404', async () => {
    for (const email of ['zhou@test.cn', 'feiyu@test.cn']) {
      const res = await (await as(email)).get(`/api/operator/tasks/${intakeTask}/missing-list`);
      expect(res.status).toBe(403);
    }
    await (await as('ops@test.cn')).get(`/api/operator/tasks/00000000-0000-4000-8000-000000000000/missing-list`).expect(404);
  });
});

describe('联系记录里专家复制清单的那条', () => {
  it('专家复制一次、运营写一条：两条，新的在前；专家那条写的人是专家', async () => {
    const ops = await as('ops@test.cn');
    await ops.post(`/api/operator/tasks/${intakeTask}/notes`).send({ body: '已电话联系客户，答应周五给图' }).expect(201);
    const notes = await ops.get(`/api/operator/tasks/${intakeTask}/notes`).expect(200);
    expect(notes.body).toHaveLength(2);
    expect(notes.body[0]).toMatchObject({ kind: 'note', body: '已电话联系客户，答应周五给图', createdByName: '赵运营' });
    expect(notes.body[1]).toMatchObject({ kind: 'note', body: '复制了缺项清单，任务标为「等客户补资料」。', createdByName: '周工' });
    expect(notes.body[1].id).toMatch(/^missing-list-/);
    expect(notes.body[0].createdAt > notes.body[1].createdAt).toBe(true);
  });

  it('专家再复制一次就多一条；自动取消等别的事件不进联系记录', async () => {
    const zhou = await as('zhou@test.cn');
    const row = await stored(intakeTask);
    await zhou.post(`/api/tasks/${intakeTask}/workup/missing-list`).send({ version: row.version }).expect(201);
    const after = await stored(intakeTask);
    expect(after.data.events?.at(-1)?.kind).toBe('missing_list');
    const notes = await (await as('ops@test.cn')).get(`/api/operator/tasks/${intakeTask}/notes`).expect(200);
    const copied = (notes.body as { body: string; createdByName: string }[]).filter((n) => n.body.startsWith('复制了缺项清单'));
    expect(copied).toHaveLength(2);
    expect(notes.body).toHaveLength(3);
    // 最新的是第二次复制
    expect(notes.body[0].body).toBe('复制了缺项清单，任务标为「等客户补资料」。');
    // 别的事件（如改重大危险源、自动取消）不带 kind，不进联系记录
    expect(after.data.events!.filter((e) => e.kind === 'missing_list')).toHaveLength(2);
  });
});
