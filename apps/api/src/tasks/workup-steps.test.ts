// 资料核对向导第 1、2 步（K10）：快照从哪来、谁打开才写、两步的整步保存
import { effectiveSnapshot, workupFacts } from '@genyun/shared';
import { feiyuProfile, feiyuSnapshot } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, memberships, organizations, taskIntakes, tasks, taskWorkups, users } from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
let legacyTask = '';
let intakeTask = '';
let opsFirstTask = '';
let raceTask = '';

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
  const [ent, blankEnt, ent3, ent4] = await db
    .insert(enterprises)
    .values([
      { orgId: customer!.id, name: '飞宇电器', socialCreditCode: '91441300726483224B', legalRepresentative: '李文聪', registeredAddress: '惠州市仲恺高新区', profile: feiyuProfile, createdBy: customerId },
      // 新流程的企业：企业资料是空的，内容都在读表结果里
      { orgId: customer!.id, name: '飞宇（表格）', createdBy: customerId },
      { orgId: customer!.id, name: '飞宇电器', profile: feiyuProfile, createdBy: customerId },
      { orgId: customer!.id, name: '飞宇电器', profile: feiyuProfile, createdBy: customerId },
    ])
    .returning();
  const base = { orgId: customer!.id, businessType: 'emergency_plan' as const, name: '2026 年应急预案', createdBy: customerId, status: 'submitted' as const, assignedExpertId: uid['zhou@test.cn']! };
  const created = await db
    .insert(tasks)
    .values([
      { ...base, enterpriseId: ent!.id, number: 'GY-2026-101' },
      { ...base, enterpriseId: blankEnt!.id, number: 'GY-2026-102' },
      { ...base, enterpriseId: ent3!.id, number: 'GY-2026-103' },
      { ...base, enterpriseId: ent4!.id, number: 'GY-2026-104' },
    ])
    .returning();
  [legacyTask, intakeTask, opsFirstTask, raceTask] = created.map((t) => t.id) as [string, string, string, string];
  await db.insert(taskIntakes).values({
    taskId: intakeTask,
    parseResult: { templateVersion: null, identity: { ...feiyuSnapshot.identity, name: '飞宇（表格里读到的）' }, profile: feiyuProfile, parsedAt: '2026-11-20T08:00:00.000Z' },
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

const stored = async (taskId: string) => (await handle.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId)))[0];

describe('核对快照', () => {
  it('新流程从读表结果建快照', async () => {
    const res = await (await as('zhou@test.cn')).get(`/api/tasks/${intakeTask}/workup`).expect(200);
    expect(res.body.flow).toBe('intake');
    expect(res.body.snapshot.identity.name).toBe('飞宇（表格里读到的）');
    expect(res.body.snapshot.profile.basicStep.basic.employeeCount).toBe(86);
  });

  it('老流程复制企业资料', async () => {
    const res = await (await as('zhou@test.cn')).get(`/api/tasks/${legacyTask}/workup`).expect(200);
    expect(res.body.flow).toBe('legacy');
    expect(res.body.snapshot.identity.name).toBe('飞宇电器');
  });

  it('运营先打开只在内存里算，不写快照；负责专家打开才写', async () => {
    const ops = await (await as('ops@test.cn')).get(`/api/tasks/${opsFirstTask}/workup`).expect(200);
    expect(ops.body.snapshot.identity.name).toBe('飞宇电器');
    expect(await stored(opsFirstTask)).toBeUndefined();
    await (await as('zhou@test.cn')).get(`/api/tasks/${opsFirstTask}/workup`).expect(200);
    expect(await stored(opsFirstTask)).toBeDefined();
  });

  it('两个窗口同时打开只留一份', async () => {
    const zhou = await as('zhou@test.cn');
    const [a, b] = await Promise.all([zhou.get(`/api/tasks/${raceTask}/workup`), zhou.get(`/api/tasks/${raceTask}/workup`)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.version).toBe(1);
    expect(b.body.version).toBe(1);
    expect(await handle.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, raceTask))).toHaveLength(1);
  });
});

describe('第 1 步整步保存', () => {
  it('写进专家那份、删掉这一步的单项修改、留空按步替换、步数只增不减', async () => {
    const zhou = await as('zhou@test.cn');
    let { body } = await zhou.get(`/api/tasks/${legacyTask}/workup`).expect(200);
    // 老整理页留下的单项修改：一个第 1 步的、一个第 2 步的
    ({ body } = await zhou.put(`/api/tasks/${legacyTask}/workup/facts`).send({ version: body.version, key: 'employeeCount', value: 90 }).expect(200));
    ({ body } = await zhou.put(`/api/tasks/${legacyTask}/workup/facts`).send({ version: body.version, key: 'dutyPhone', value: '0752-7654321' }).expect(200));

    const basic = { ...feiyuProfile.basicStep!.basic, employeeCount: 120 };
    delete basic.technicalManagementCount;
    ({ body } = await zhou
      .put(`/api/tasks/${legacyTask}/workup/steps/basic`)
      .send({ version: body.version, identity: { ...body.snapshot.identity, legalRepresentative: '王五' }, basic, blank: ['technicalManagementCount'], stepsDone: 1 })
      .expect(200));
    expect(body.data.overrides.employeeCount).toBeUndefined();
    expect(body.data.overrides.dutyPhone).toBeDefined();
    expect(body.data.identity.legalRepresentative).toBe('王五');
    expect(body.data.blank).toEqual(['technicalManagementCount']);
    expect(body.data.stepsDone).toBe(1);
    expect(body.data.steps.basic.byName).toBe('周工');
    // 客户原表不动
    expect(body.snapshot.profile.basicStep.basic.employeeCount).toBe(86);
    const facts = workupFacts(body.snapshot, body.data);
    expect(facts.find((f) => f.key === 'employeeCount')).toMatchObject({ value: 120, source: 'expert' });
    expect(facts.find((f) => f.key === 'technicalManagementCount')?.status).toBe('blank');
    expect(effectiveSnapshot(body.snapshot, body.data).identity.legalRepresentative).toBe('王五');

    ({ body } = await zhou.put(`/api/tasks/${legacyTask}/workup/steps/done`).send({ version: body.version, stepsDone: 3 }).expect(200));
    expect(body.data.stepsDone).toBe(3);
    ({ body } = await zhou
      .put(`/api/tasks/${legacyTask}/workup/steps/basic`)
      .send({ version: body.version, identity: body.data.identity, basic, blank: [], stepsDone: 1 })
      .expect(200));
    expect(body.data.stepsDone).toBe(3);
    expect(body.data.blank).toEqual([]);
  });

  it('版本过期 409；企业名称空着 400；运营 403', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${legacyTask}/workup`).expect(200);
    const url = `/api/tasks/${legacyTask}/workup/steps/basic`;
    const ok = { identity: body.snapshot.identity, basic: feiyuProfile.basicStep!.basic, blank: [] };
    const stale = await zhou.put(url).send({ version: body.version - 1, ...ok }).expect(409);
    expect(stale.body).toMatchObject({ reason: 'stale', message: '资料刚被其他人修改过，已为您显示最新内容，请确认后再改' });
    await zhou.put(url).send({ version: body.version, ...ok, identity: { ...ok.identity, name: ' ' } }).expect(400);
    await (await as('ops@test.cn')).put(url).send({ version: body.version, ...ok }).expect(403);
  });
});

describe('第 2 步整步保存', () => {
  it('小组只能从五个预设里选、不能重复；少于 3 组也能保存', async () => {
    const zhou = await as('zhou@test.cn');
    let { body } = await zhou.get(`/api/tasks/${intakeTask}/workup`).expect(200);
    const url = `/api/tasks/${intakeTask}/workup/steps/organization`;
    const step = structuredClone(feiyuProfile.organizationStep!.step);
    const custom = { id: 'g-x', kind: 'custom', name: '设备组', members: [] };
    expect((await zhou.put(url).send({ version: body.version, step: { ...step, groups: [...step.groups, custom] }, blank: [] }).expect(400)).body.message).toBe('小组只能从预设的五个里选');
    const dup = { ...step.groups[0]!, id: 'g-dup' };
    expect((await zhou.put(url).send({ version: body.version, step: { ...step, groups: [...step.groups, dup] }, blank: [] }).expect(400)).body.message).toContain('不能添加两次');

    ({ body } = await zhou.put(url).send({ version: body.version, step: { ...step, groups: step.groups.slice(0, 2), dutyPhone: '0752-1111111' }, blank: ['paSystem'], stepsDone: 2 }).expect(200));
    expect(body.data.profile.organizationStep.step.groups).toHaveLength(2);
    expect(body.data.blank).toEqual(['paSystem']);
    expect(body.data.stepsDone).toBe(2);
    expect(effectiveSnapshot(body.snapshot, body.data).profile.organizationStep?.step.dutyPhone).toBe('0752-1111111');
    // 第 1 步没动
    expect(body.data.profile.basicStep).toBeUndefined();
  });
});
