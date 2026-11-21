// 资料核对第 5 步（K11）：专业项整步保存、复制缺项清单与自动取消「等客户补资料」
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, generationBatches, memberships, organizations, taskIntakes, tasks, taskWorkups, users } from '../db/schema.ts';
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
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
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
      { orgId: customer!.id, name: '飞宇电器', profile: feiyuProfile, createdBy: customerId },
      { orgId: customer!.id, name: '飞宇（表格）', createdBy: customerId },
    ])
    .returning();
  const base = {
    orgId: customer!.id,
    businessType: 'emergency_plan' as const,
    name: '2026 年应急预案',
    createdBy: customerId,
    status: 'submitted' as const,
    assignedExpertId: uid['zhou@test.cn']!,
  };
  const created = await db
    .insert(tasks)
    .values([
      { ...base, enterpriseId: ent!.id, number: 'GY-2026-201' },
      { ...base, enterpriseId: blankEnt!.id, number: 'GY-2026-202' },
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
const taskRow = async (taskId: string) => (await handle.db.select().from(tasks).where(eq(tasks.id, taskId)))[0]!;

describe('第 5 步专业项', () => {
  it('整步保存：存进专家那份、步数到 5；版本不对 409；别的专家不能存', async () => {
    const zhou = await as('zhou@test.cn');
    const opened = await zhou.get(`/api/tasks/${legacyTask}/workup`).expect(200);
    expect(opened.body.planCodeSuggestion).toMatch(/^([A-Z]{2}\d{4})?$/);
    const review = { planCode: 'FY2026', emergencyBudget: '5', fundingDepartment: '行政部', trainingBudget: '2.5' };
    const saved = await zhou.put(`/api/tasks/${legacyTask}/workup/steps/review`).send({ version: opened.body.version, review, stepsDone: 5 }).expect(200);
    expect(saved.body.version).toBe(opened.body.version + 1);
    const row = await stored(legacyTask);
    expect(row.data.review).toMatchObject(review);
    expect(row.data.stepsDone).toBe(5);
    expect(row.data.steps?.review?.byName).toBe('周工');

    await zhou.put(`/api/tasks/${legacyTask}/workup/steps/review`).send({ version: opened.body.version, review }).expect(409);
    const wu = await as('wu@test.cn');
    const denied = await wu.put(`/api/tasks/${legacyTask}/workup/steps/review`).send({ version: saved.body.version, review });
    expect([403, 404]).toContain(denied.status);
  });

  it('重大危险源改结论要写理由；改了记一条处理记录，改回系统结果也记', async () => {
    const zhou = await as('zhou@test.cn');
    let { body } = await zhou.get(`/api/tasks/${legacyTask}/workup`).expect(200);
    await zhou
      .put(`/api/tasks/${legacyTask}/workup/steps/review`)
      .send({ version: body.version, review: { majorHazard: { value: '构成', reason: '', substances: [{ name: '甲醇', storage: '600 t' }] } } })
      .expect(400);
    await zhou
      .put(`/api/tasks/${legacyTask}/workup/steps/review`)
      .send({ version: body.version, review: { majorHazard: { value: '构成', reason: '现场另有储罐' } } })
      .expect(400);
    ({ body } = await zhou
      .put(`/api/tasks/${legacyTask}/workup/steps/review`)
      .send({ version: body.version, review: { planCode: 'FY2026', majorHazard: { value: '构成', reason: '现场另有储罐', substances: [{ name: '甲醇', storage: '600 t' }] } } })
      .expect(200));
    let row = await stored(legacyTask);
    // 和系统算的一样时不存；飞宇按系统算不构成，这里改成构成
    expect(row.data.review?.majorHazard).toMatchObject({ value: '构成', reason: '现场另有储罐' });
    expect(row.data.events?.at(-1)?.what).toBe('重大危险源改为「构成」');

    await zhou.put(`/api/tasks/${legacyTask}/workup/steps/review`).send({ version: body.version, review: { planCode: 'FY2026' } }).expect(200);
    row = await stored(legacyTask);
    expect(row.data.review?.majorHazard).toBeUndefined();
    expect(row.data.events?.at(-1)?.what).toBe('重大危险源改回系统算的结果');
  });
});

describe('缺项清单', () => {
  it('逐项填写的老任务不标「等客户补资料」', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${legacyTask}/workup`).expect(200);
    await zhou.post(`/api/tasks/${legacyTask}/workup/missing-list`).send({ version: body.version }).expect(400);
    const list = await zhou.get(`/api/tasks/${legacyTask}/workup/missing-list`).expect(200);
    expect(list.body.list).toBeNull();
    expect((await taskRow(legacyTask)).awaitingCustomerSince).toBeNull();
  });

  it('资料表格任务：复制后记下清单、任务标为等客户补资料；运营能看，别的专家看不到', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${intakeTask}/workup`).expect(200);
    const copied = await zhou.post(`/api/tasks/${intakeTask}/workup/missing-list`).send({ version: body.version }).expect(201);
    expect(copied.body.awaiting).toBeTruthy();
    const row = await stored(intakeTask);
    const items = row.data.missingList!.items;
    expect(items.length).toBeGreaterThan(0);
    // 门槛缺的在前，客户未填在后
    const firstOptional = items.findIndex((i) => !i.required);
    if (firstOptional >= 0) expect(items.slice(firstOptional).every((i) => !i.required)).toBe(true);
    const t = await taskRow(intakeTask);
    expect(t.awaitingCustomerSince).not.toBeNull();
    expect(t.awaitingCustomerItems).toBe(items.length);
    expect(row.data.events?.at(-1)?.what).toContain('复制了缺项清单');

    const view = await (await as('ops@test.cn')).get(`/api/tasks/${intakeTask}/workup/missing-list`).expect(200);
    expect(view.body.list.items).toHaveLength(items.length);
    expect(view.body.taskNumber).toBe('GY-2026-202');
    expect((await (await as('wu@test.cn')).get(`/api/tasks/${intakeTask}/workup/missing-list`)).status).toBe(404);
    await zhou.post(`/api/tasks/${intakeTask}/workup/missing-list`).send({ version: body.version }).expect(409);
  });

  it('补上一部分：任务上的「缺 N 项」跟着变少（3 项补上 1 项 → 2），还标着等客户补资料', async () => {
    const zhou = await as('zhou@test.cn');
    const row = await stored(intakeTask);
    // 清单 3 项：两项现在还缺，一项现在已经不缺了（模拟客户发来后专家补上了 1 项）
    const [a, b] = row.data.missingList!.items;
    expect(b).toBeTruthy();
    const list = { ...row.data.missingList!, items: [a!, b!, { key: 'gone:item', label: '某项', customerLabel: '某项', step: 1 as const, required: false }] };
    await handle.db.update(taskWorkups).set({ data: { ...row.data, missingList: list } }).where(eq(taskWorkups.taskId, intakeTask));
    await handle.db.update(tasks).set({ awaitingCustomerItems: 3 }).where(eq(tasks.id, intakeTask));
    const res = await zhou.put(`/api/tasks/${intakeTask}/workup/steps/done`).send({ version: row.version, stepsDone: 1 }).expect(200);
    expect(res.body.awaitingCleared).toBeUndefined();
    const t = await taskRow(intakeTask);
    expect(t.awaitingCustomerSince).not.toBeNull();
    expect(t.awaitingCustomerItems).toBe(2);
    const after = await stored(intakeTask);
    expect(after.data.missingList!.items.filter((i) => !i.filledAt)).toHaveLength(2);
  });

  it('清单里的都补上了：下一次保存自动取消标记、回 awaitingCleared、记一条处理记录', async () => {
    const zhou = await as('zhou@test.cn');
    const row = await stored(intakeTask);
    // 只留一项现在已经不缺的，模拟客户发来后专家都补上了
    const list = { ...row.data.missingList!, items: [{ key: 'gone:item', label: '某项', customerLabel: '某项', step: 1 as const, required: false }] };
    await handle.db.update(taskWorkups).set({ data: { ...row.data, missingList: list } }).where(eq(taskWorkups.taskId, intakeTask));
    const res = await zhou.put(`/api/tasks/${intakeTask}/workup/steps/done`).send({ version: row.version, stepsDone: 1 }).expect(200);
    expect(res.body.awaitingCleared).toBe(true);
    const t = await taskRow(intakeTask);
    expect(t.awaitingCustomerSince).toBeNull();
    expect(t.awaitingCustomerItems).toBeNull();
    const after = await stored(intakeTask);
    expect(after.data.missingList!.items[0]!.filledAt).toBeTruthy();
    expect(after.data.events?.at(-1)?.what).toBe('「等客户补资料」自动取消');
    const again = await zhou.put(`/api/tasks/${intakeTask}/workup/steps/done`).send({ version: res.body.version, stepsDone: 1 }).expect(200);
    expect(again.body.awaitingCleared).toBeUndefined();
  });

  it('生成过以后再复制清单：409，不写清单、不标任务（只复制文字由页面自己做）', async () => {
    const zhou = await as('zhou@test.cn');
    const row = await stored(intakeTask);
    const before = await taskRow(intakeTask);
    const [me] = await handle.db.select({ id: users.id }).from(users).where(eq(users.email, 'zhou@test.cn'));
    await handle.db.insert(generationBatches).values({
      taskId: intakeTask,
      workupVersion: row.version,
      snapshotAt: row.snapshotAt,
      input: {} as never,
      materials: [],
      createdBy: me!.id,
    });
    const res = await zhou.post(`/api/tasks/${intakeTask}/workup/missing-list`).send({ version: row.version }).expect(409);
    expect(res.body.message).toContain('已经生成过初稿');
    const t = await taskRow(intakeTask);
    expect(t.awaitingCustomerSince).toEqual(before.awaitingCustomerSince);
    expect(t.awaitingCustomerItems).toEqual(before.awaitingCustomerItems);
    const after = await stored(intakeTask);
    expect(after.version).toBe(row.version);
    expect(after.data.missingList).toEqual(row.data.missingList);
  });
});
