import { CHECKLIST_ITEMS } from '@genyun/shared';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterpriseAssignments, memberships, organizations, tasks, users } from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';
const MISSING = '00000000-0000-4000-8000-000000000000';

let handle: DatabaseHandle;
let app: INestApplication;
const org: Record<'a' | 'b' | 'expired' | 'internal', string> = { a: '', b: '', expired: '', internal: '' };
const uid: Record<string, string> = {};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);

  const created = await db
    .insert(organizations)
    .values([
      { name: 'A 安全咨询', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: 'B 制造', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: 'C 已到期', kind: 'customer', contractStartsAt: '2024-01-01', contractEndsAt: '2025-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  [org.a, org.b, org.expired, org.internal] = created.map((o) => o.id) as [string, string, string, string];

  const people = [
    { email: 'a-admin@test.cn', orgId: org.a, role: 'customer_admin' as const },
    { email: 'a-member@test.cn', orgId: org.a, role: 'customer_member' as const },
    { email: 'b-admin@test.cn', orgId: org.b, role: 'customer_admin' as const },
    { email: 'c-admin@test.cn', orgId: org.expired, role: 'customer_admin' as const },
    { email: 'expert@test.cn', orgId: org.internal, role: 'expert' as const },
    { email: 'expert2@test.cn', orgId: org.internal, role: 'expert' as const },
    { email: 'ops@test.cn', orgId: org.internal, role: 'operator' as const },
  ];
  for (const p of people) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.email, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }

  app = await createApp(db, { loginLimitPerMinute: 1000 });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function as(email: string) {
  let agent = agents.get(email);
  if (!agent) {
    agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    agents.set(email, agent);
  }
  return agent;
}

async function createEnterprise(email: string, orgId: string, body: object) {
  const res = await (await as(email)).post(`/api/orgs/${orgId}/enterprises`).send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string; orgId: string };
}

async function createTask(email: string, enterpriseId: string, name = '2026 年应急预案编制') {
  const res = await (await as(email)).post(`/api/enterprises/${enterpriseId}/tasks`).send({ name });
  expect(res.status).toBe(201);
  return res.body as { id: string; number: string };
}

describe('企业档案', () => {
  it('只填企业名称就能建档，并出现在本组织的企业列表里', async () => {
    const ent = await createEnterprise('a-admin@test.cn', org.a, { name: '飞宇制造有限公司' });
    const list = await (await as('a-admin@test.cn')).get(`/api/orgs/${org.a}/enterprises`).expect(200);
    expect(list.body.map((e: { id: string }) => e.id)).toContain(ent.id);
  });

  it('只有机构管理员能新建企业，成员不能（成员只处理分配给自己的企业）', async () => {
    const res = await (await as('a-member@test.cn')).post(`/api/orgs/${org.a}/enterprises`).send({ name: '成员建的企业' });
    expect(res.status).toBe(403);
  });

  it('修改时只改传入的字段', async () => {
    const ent = await createEnterprise('a-admin@test.cn', org.a, { name: '待修改企业', registeredAddress: '惠州' });
    const res = await (await as('a-admin@test.cn'))
      .patch(`/api/enterprises/${ent.id}`)
      .send({ legalRepresentative: '李文聪' })
      .expect(200);
    expect(res.body).toMatchObject({ name: '待修改企业', registeredAddress: '惠州', legalRepresentative: '李文聪' });
  });

  it('同一组织不能有两家统一社会信用代码相同的企业，不同组织互不影响', async () => {
    const code = '91441300726483224B';
    await createEnterprise('a-admin@test.cn', org.a, { name: '甲', socialCreditCode: code });
    const dup = await (await as('a-admin@test.cn')).post(`/api/orgs/${org.a}/enterprises`).send({ name: '乙', socialCreditCode: code });
    expect(dup.status).toBe(409);
    await createEnterprise('b-admin@test.cn', org.b, { name: '丙', socialCreditCode: code });
  });

  it('企业名称必填', async () => {
    await (await as('a-admin@test.cn')).post(`/api/orgs/${org.a}/enterprises`).send({ name: '' }).expect(400);
  });
});

describe('越权：企业档案', () => {
  let entA: string;
  beforeAll(async () => {
    entA = (await createEnterprise('a-admin@test.cn', org.a, { name: 'A 的企业' })).id;
  });

  it('B 组织看不到 A 的企业，且无法判断它是否存在', async () => {
    const b = await as('b-admin@test.cn');
    const other = await b.get(`/api/enterprises/${entA}`);
    const missing = await b.get(`/api/enterprises/${MISSING}`);
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(other.body.message).toBe(missing.body.message);
  });

  it('B 组织不能列出、修改 A 的企业，也不能在 A 组织下建档', async () => {
    const b = await as('b-admin@test.cn');
    await b.get(`/api/orgs/${org.a}/enterprises`).expect(404);
    await b.patch(`/api/enterprises/${entA}`).send({ name: '改名' }).expect(404);
    await b.post(`/api/orgs/${org.a}/enterprises`).send({ name: '冒建' }).expect(404);
    const after = await (await as('a-admin@test.cn')).get(`/api/enterprises/${entA}`).expect(200);
    expect(after.body.name).toBe('A 的企业');
  });

  it('B 组织的列表里只有自己的企业', async () => {
    const list = await (await as('b-admin@test.cn')).get(`/api/orgs/${org.b}/enterprises`).expect(200);
    expect(list.body.every((e: { orgId: string }) => e.orgId === org.b)).toBe(true);
  });

  it('专业人员不能直接浏览企业', async () => {
    const e = await as('expert@test.cn');
    await e.get(`/api/enterprises/${entA}`).expect(404);
    await e.get(`/api/orgs/${org.a}/enterprises`).expect(404);
  });

  it('运营可以查看，但不替客户建档或修改', async () => {
    const ops = await as('ops@test.cn');
    await ops.get(`/api/enterprises/${entA}`).expect(200);
    await ops.get(`/api/orgs/${org.a}/enterprises`).expect(200);
    await ops.post(`/api/orgs/${org.a}/enterprises`).send({ name: '运营建的' }).expect(403);
    await ops.patch(`/api/enterprises/${entA}`).send({ name: '运营改的' }).expect(403);
  });
});

describe('编制任务', () => {
  it('新建任务自动编号，状态为资料准备中，还没选开始方式', async () => {
    const ent = await createEnterprise('a-admin@test.cn', org.a, { name: '任务企业一' });
    const res = await (await as('a-admin@test.cn')).get(`/api/tasks/${(await createTask('a-admin@test.cn', ent.id)).id}`);
    expect(res.body).toMatchObject({
      enterpriseName: '任务企业一',
      businessType: 'emergency_plan',
      name: '2026 年应急预案编制',
      status: 'preparing',
      startMethod: null,
      assignedExpertId: null,
    });
    expect(res.body.number).toMatch(/^GY-\d{4}-\d{3,}$/);
  });

  it('编号全平台连续，不分组织', async () => {
    const t1 = await createTask('a-admin@test.cn', (await createEnterprise('a-admin@test.cn', org.a, { name: '编号甲' })).id);
    const t2 = await createTask('b-admin@test.cn', (await createEnterprise('b-admin@test.cn', org.b, { name: '编号乙' })).id);
    const seq = (n: string) => Number(n.split('-')[2]);
    expect(seq(t2.number)).toBe(seq(t1.number) + 1);
  });

  it('同一家企业再建同类任务，被带到已有任务', async () => {
    const ent = await createEnterprise('a-admin@test.cn', org.a, { name: '重复创建企业' });
    const first = await createTask('a-admin@test.cn', ent.id);
    const again = await (await as('a-admin@test.cn')).post(`/api/enterprises/${ent.id}/tasks`).send({ name: '再来一个' });
    expect(again.status).toBe(409);
    expect(again.body.existingTask).toMatchObject({ id: first.id, number: first.number });
  });

  it('选择开始方式', async () => {
    const t = await createTask('a-admin@test.cn', (await createEnterprise('a-admin@test.cn', org.a, { name: '选方式' })).id);
    const res = await (await as('a-admin@test.cn')).patch(`/api/tasks/${t.id}`).send({ startMethod: 'self_fill' }).expect(200);
    expect(res.body.startMethod).toBe('self_fill');
  });

  it('合同不在有效期内不能新建任务', async () => {
    const ent = await createEnterprise('c-admin@test.cn', org.expired, { name: '到期组织的企业' });
    const res = await (await as('c-admin@test.cn')).post(`/api/enterprises/${ent.id}/tasks`).send({ name: '新任务' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/合同/);
  });
});

describe('越权：编制任务与资料项', () => {
  let entA: string;
  let taskA: string;
  beforeAll(async () => {
    entA = (await createEnterprise('a-admin@test.cn', org.a, { name: 'A 的任务企业' })).id;
    taskA = (await createTask('a-admin@test.cn', entA)).id;
  });

  it('B 组织读不到 A 的任务、任务列表和资料清单，且无法判断任务是否存在', async () => {
    const b = await as('b-admin@test.cn');
    const other = await b.get(`/api/tasks/${taskA}`);
    const missing = await b.get(`/api/tasks/${MISSING}`);
    expect(other.status).toBe(404);
    expect(other.body.message).toBe(missing.body.message);
    await b.get(`/api/orgs/${org.a}/tasks`).expect(404);
    await b.get(`/api/tasks/${taskA}/checklist`).expect(404);
  });

  it('B 组织改不了 A 的任务和资料项，也不能给 A 的企业建任务', async () => {
    const b = await as('b-admin@test.cn');
    await b.patch(`/api/tasks/${taskA}`).send({ name: '改名' }).expect(404);
    await b.put(`/api/tasks/${taskA}/checklist/business_license`).send({ status: 'provided' }).expect(404);
    await b.post(`/api/enterprises/${entA}/tasks`).send({ name: '冒建' }).expect(404);
    const list = await (await as('a-admin@test.cn')).get(`/api/tasks/${taskA}/checklist`).expect(200);
    expect(list.body.items).toEqual({});
  });

  it('B 组织的任务列表里只有自己的任务', async () => {
    const list = await (await as('b-admin@test.cn')).get(`/api/orgs/${org.b}/tasks`).expect(200);
    expect(list.body.every((t: { orgId: string }) => t.orgId === org.b)).toBe(true);
  });

  it('专业人员只能看分派给自己的任务，且不能替客户填资料', async () => {
    const e1 = await as('expert@test.cn');
    await e1.get(`/api/tasks/${taskA}`).expect(404);

    await handle.db.update(tasks).set({ assignedExpertId: uid['expert@test.cn'] }).where(eq(tasks.id, taskA));
    const res = await e1.get(`/api/tasks/${taskA}`).expect(200);
    expect(res.body.assignedExpertName).toBe('expert@test.cn');
    await e1.get(`/api/tasks/${taskA}/checklist`).expect(200);
    await e1.put(`/api/tasks/${taskA}/checklist/business_license`).send({ status: 'provided' }).expect(403);
    await e1.get(`/api/orgs/${org.a}/tasks`).expect(404);

    await (await as('expert2@test.cn')).get(`/api/tasks/${taskA}`).expect(404);
  });

  it('运营可以查看任务，但不替客户建任务或填资料', async () => {
    const ops = await as('ops@test.cn');
    await ops.get(`/api/tasks/${taskA}`).expect(200);
    await ops.get(`/api/orgs/${org.a}/tasks`).expect(200);
    await ops.put(`/api/tasks/${taskA}/checklist/business_license`).send({ status: 'provided' }).expect(403);
    await ops.post(`/api/enterprises/${entA}/tasks`).send({ name: '运营建的' }).expect(403);
  });
});

describe('资料项', () => {
  let taskId: string;
  beforeAll(async () => {
    const ent = await createEnterprise('a-admin@test.cn', org.a, { name: '资料项企业' });
    taskId = (await createTask('a-admin@test.cn', ent.id)).id;
    // 成员处理分配给自己的企业
    await handle.db.insert(enterpriseAssignments).values({ enterpriseId: ent.id, userId: uid['a-member@test.cn']!, orgId: org.a });
  });

  it('标为已提供时记录确认人和时间', async () => {
    const res = await (await as('a-member@test.cn'))
      .put(`/api/tasks/${taskId}/checklist/business_license`)
      .send({ status: 'provided' })
      .expect(200);
    expect(res.body.items.business_license).toMatchObject({ status: 'provided', confirmedBy: uid['a-member@test.cn'] });
    expect(res.body.items.business_license.confirmedAt).toBeTruthy();
    expect(res.body.check.blocking.map((b: { key: string }) => b.key)).not.toContain('business_license');
  });

  it('套用资料清单规则：开始编制必需的项不能稍后补', async () => {
    const res = await (await as('a-admin@test.cn')).put(`/api/tasks/${taskId}/checklist/duty_phone`).send({ status: 'later' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/不能稍后补/);
  });

  it('拍照给耕云看的项等专家判断', async () => {
    const res = await (await as('a-admin@test.cn'))
      .put(`/api/tasks/${taskId}/checklist/special_equipment`)
      .send({ status: 'photo_for_expert' })
      .expect(200);
    expect(res.body.items.special_equipment.expertJudgement).toEqual({ result: 'pending' });
    expect(res.body.check.awaitingExpert).toContain('special_equipment');
  });

  it('没有这一项资料时返回找不到', async () => {
    await (await as('a-admin@test.cn')).put(`/api/tasks/${taskId}/checklist/land_certificate`).send({ status: 'provided' }).expect(404);
  });

  it('开始编制必需的项都处理后可以提交', async () => {
    const a = await as('a-admin@test.cn');
    for (const def of CHECKLIST_ITEMS.filter((d) => d.requirement === 'start')) {
      await a.put(`/api/tasks/${taskId}/checklist/${def.key}`).send({ status: 'provided' }).expect(200);
    }
    const res = await a.get(`/api/tasks/${taskId}/checklist`).expect(200);
    expect(res.body.check).toMatchObject({ canSubmit: true, blocking: [] });
  });
});
