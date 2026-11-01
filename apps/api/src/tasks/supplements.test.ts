import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, memberships, organizations, tasks, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';

const PASSWORD = 'correct horse battery staple';
const PDF = Buffer.from('%PDF-1.7\n% 应急联系人名单\n');

let handle: DatabaseHandle;
let app: INestApplication;
let storageDir: string;
let customerOrg = '';
let taskId = '';

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
  customerOrg = customer!.id;
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
  const [ent] = await db
    .insert(enterprises)
    .values({ orgId: customer!.id, name: '惠阳飞宇电器有限公司', profile: feiyuProfile, createdBy: uid['feiyu@test.cn']! })
    .returning();
  const [t] = await db
    .insert(tasks)
    .values({
      orgId: customer!.id,
      enterpriseId: ent!.id,
      businessType: 'emergency_plan',
      name: '2026 年应急预案',
      status: 'submitted',
      submittedAt: new Date('2026-10-27T07:20:00Z'),
      number: 'GY-2026-001',
      assignedExpertId: uid['zhou@test.cn']!,
      createdBy: uid['feiyu@test.cn']!,
    })
    .returning();
  taskId = t!.id;

  storageDir = mkdtempSync(join(tmpdir(), 'genyun-supplements-'));
  app = await createApp(db, { loginLimitPerMinute: 1000, storage: new LocalDiskStorage(storageDir, 'test-secret') });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

async function as(email: string) {
  const agent = request.agent(app.getHttpServer());
  expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  return agent;
}

const ask = {
  title: '请确认应急联系人',
  message: '本任务目前使用的联系人为陈志刚。请确认企业当前实际情况，并提供有效资料。',
  factKeys: ['contactPerson', 'contactPhone'],
  needsFile: true,
  itemKey: 'basic_info',
};

describe('事实补件', () => {
  it('只有负责专家能发起；客户、别的专家看不到这一轮', async () => {
    expect((await (await as('wu@test.cn')).post(`/api/tasks/${taskId}/supplements`).send(ask)).status).toBe(404);
    expect((await (await as('ops@test.cn')).post(`/api/tasks/${taskId}/supplements`).send(ask)).status).toBe(403);
    expect((await (await as('feiyu@test.cn')).get(`/api/tasks/${taskId}/supplements`)).status).toBe(404);
    // 要文件就得说是哪一项资料；系统按规则算的事实不能补件
    const zhou = await as('zhou@test.cn');
    expect((await zhou.post(`/api/tasks/${taskId}/supplements`).send({ ...ask, itemKey: null })).status).toBe(400);
    expect((await zhou.post(`/api/tasks/${taskId}/supplements`).send({ ...ask, factKeys: ['totalFloorArea'] })).status).toBe(400);
  });

  it('专家发起：记下本任务原来用的值，客户工作台出现「去回应」，客户收到通知', async () => {
    const zhou = await as('zhou@test.cn');
    const workup = await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
    const res = await zhou.post(`/api/tasks/${taskId}/supplements`).send(ask).expect(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ round: 1, status: 'awaiting_customer', createdByName: '周工', needsFile: true, response: null });
    expect(res.body[0].facts.map((f: { key: string }) => f.key)).toEqual(['contactPerson', 'contactPhone']);
    expect(res.body[0].facts[0].before).toBe('李文聪');

    // 同一时间只能有一轮
    expect((await zhou.post(`/api/tasks/${taskId}/supplements`).send(ask)).status).toBe(409);

    const feiyu = await as('feiyu@test.cn');
    const list = await feiyu.get(`/api/orgs/${customerOrg}/tasks`).expect(200);
    const mine = (list.body as { id: string; supplement: string | null }[]).find((t) => t.id === taskId)!;
    expect(mine.supplement).toBe('请确认应急联系人');
    const asked = await feiyu.get(`/api/tasks/${taskId}/supplement-requests`).expect(200);
    expect(asked.body[0]).toMatchObject({ round: 1, status: 'awaiting_customer', labels: ['联系人', '联系电话'] });
    // 客户看不到本任务原来用的值
    expect(asked.body[0].facts).toBeUndefined();
    const notes = await feiyu.get('/api/notifications').expect(200);
    expect(JSON.stringify(notes.body)).toContain('请确认应急联系人');
  });

  it('客户回应：要文件的一轮不上传不能交；交了以后企业事实不变，等专家核实', async () => {
    const feiyu = await as('feiyu@test.cn');
    const [round] = (await feiyu.get(`/api/tasks/${taskId}/supplement-requests`).expect(200)).body as { id: string }[];
    const url = `/api/tasks/${taskId}/supplement-requests/${round!.id}/response`;
    expect((await feiyu.post(url).send({ note: '换人了', confirmed: true })).status).toBe(400);
    const upload = await feiyu.post(`/api/orgs/${customerOrg}/files?rule=material`).attach('file', PDF, '应急联系人名单.pdf').expect(201);
    expect((await feiyu.post(url).send({ fileIds: [upload.body.id] })).status).toBe(400);
    const res = await feiyu.post(url).send({ fileIds: [upload.body.id], note: '应急联系人改为王建国', confirmed: true }).expect(201);
    expect(res.body[0]).toMatchObject({ status: 'awaiting_expert', response: { note: '应急联系人改为王建国', byName: '陈志刚' } });
    expect((await feiyu.post(url).send({ fileIds: [upload.body.id], confirmed: true })).status).toBe(409);
    expect((await feiyu.get(`/api/orgs/${customerOrg}/tasks`).expect(200)).body[0].supplement).toBeNull();

    const zhou = await as('zhou@test.cn');
    const workup = await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
    expect(workup.body.data.overrides.contactPerson).toBeUndefined();
    // 客户的文件挂到任务上，确认采用页能看到是第几轮补件、还没采用
    const materials = await zhou.get(`/api/tasks/${taskId}/generation/materials`).expect(200);
    const row = (materials.body.rows as { fileId: string; supplement?: unknown }[]).find((r) => r.fileId === upload.body.id);
    expect(row?.supplement).toEqual({ round: 1, adopted: false });
    const [mine] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body;
    expect(mine.files).toMatchObject([{ id: upload.body.id }]);
  });

  it('仍需客户补充：这一轮退回，另起第 2 轮', async () => {
    const zhou = await as('zhou@test.cn');
    const [round] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body;
    const res = await zhou
      .post(`/api/tasks/${taskId}/supplements/${round.id}/return`)
      .send({ message: '名单上没有王建国的电话，请补一份带电话的名单。' })
      .expect(201);
    expect(res.body.map((s: { round: number; status: string }) => [s.round, s.status])).toEqual([
      [2, 'awaiting_customer'],
      [1, 'returned'],
    ]);
    // 客户再交一次
    const feiyu = await as('feiyu@test.cn');
    const upload = await feiyu.post(`/api/orgs/${customerOrg}/files?rule=material`).attach('file', PDF, '应急联系人名单（含电话）.pdf').expect(201);
    await feiyu
      .post(`/api/tasks/${taskId}/supplement-requests/${res.body[0].id}/response`)
      .send({ fileIds: [upload.body.id], confirmed: true })
      .expect(201);
  });

  it('专家核实采用：企业事实改为本轮采用的值，来源记为客户确认 · 事实补件', async () => {
    const zhou = await as('zhou@test.cn');
    const [round] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body;
    const url = `/api/tasks/${taskId}/supplements/${round.id}/adopt`;
    expect((await (await as('ops@test.cn')).post(url).send({})).status).toBe(403);
    // 每一项都要写
    expect((await zhou.post(url).send({ facts: [{ key: 'contactPerson', value: '王建国' }], confirmed: true })).status).toBe(400);
    const facts = [
      { key: 'contactPerson', value: '王建国', basis: '应急联系人名单（含电话）' },
      { key: 'contactPhone', value: '13900002071' },
    ];
    expect((await zhou.post(url).send({ facts })).status).toBe(400);
    const res = await zhou.post(url).send({ facts, confirmed: true }).expect(201);
    expect(res.body[0]).toMatchObject({ status: 'adopted', adoptedByName: '周工', regenerated: false });
    expect(res.body[0].facts[0]).toMatchObject({ after: '王建国', basis: '应急联系人名单（含电话）' });
    expect((await zhou.post(url).send({ facts, confirmed: true })).status).toBe(409);

    const workup = await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
    expect(workup.body.data.overrides.contactPerson).toMatchObject({
      value: '王建国',
      source: 'customer',
      via: 'supplement',
      supplementId: round.id,
      byName: '周工',
    });
    expect(workup.body.data.overrides.contactPhone).toMatchObject({ value: '13900002071', via: 'supplement' });
    // 已采用的文件不再算变化
    const materials = await zhou.get(`/api/tasks/${taskId}/generation/materials`).expect(200);
    const row = (materials.body.rows as { supplement?: { round: number }; change: unknown }[]).find((r) => r.supplement?.round === 2);
    expect(row).toMatchObject({ supplement: { round: 2, adopted: true }, change: null });
    // 上一轮已经采用，可以再发起新的一轮
    const again = await zhou.post(`/api/tasks/${taskId}/supplements`).send({ ...ask, needsFile: false, itemKey: null }).expect(201);
    expect(again.body[0]).toMatchObject({ round: 3, status: 'awaiting_customer' });
    expect(again.body[0].facts[0].before).toBe('王建国');
  });
});
