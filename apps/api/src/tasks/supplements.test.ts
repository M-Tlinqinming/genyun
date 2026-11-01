import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { reviewValid } from '@genyun/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  deliveries,
  draftChecks,
  draftReviews,
  enterprises,
  generatedDrafts,
  generationBatches,
  memberships,
  organizations,
  tasks,
  users,
} from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';
import { WorkupService } from './workup.service.ts';

const PASSWORD = 'correct horse battery staple';
const PDF = Buffer.from('%PDF-1.7\n% 应急联系人名单\n');

let handle: DatabaseHandle;
let app: INestApplication;
let storageDir: string;
let customerOrg = '';
let taskId = '';
// 同一机构的另一个任务：拿它的补件编号访问本任务，当作不存在
let otherTaskId = '';
let expertId = '';
// 并发发起用的第三家企业（一家企业同一业务只能有一个进行中的任务）
let spareEnterprise = '';
let db: DatabaseHandle['db'];

beforeAll(async () => {
  handle = await openDatabase('memory://');
  db = handle.db;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal, other] = await db
    .insert(organizations)
    .values([
      { name: '飞宇演示客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
      { name: '别家客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
    ])
    .returning();
  customerOrg = customer!.id;
  const uid: Record<string, string> = {};
  for (const p of [
    { email: 'feiyu@test.cn', name: '陈志刚', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
    { email: 'other@test.cn', name: '别家管理员', orgId: other!.id, role: 'customer_admin' as const },
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
  expertId = uid['zhou@test.cn']!;
  const [ent2, ent3] = await db
    .insert(enterprises)
    .values([
      { orgId: customer!.id, name: '惠阳飞宇二厂', profile: feiyuProfile, createdBy: uid['feiyu@test.cn']! },
      { orgId: customer!.id, name: '惠阳飞宇三厂', profile: feiyuProfile, createdBy: uid['feiyu@test.cn']! },
    ])
    .returning();
  spareEnterprise = ent3!.id;
  const [t2] = await db
    .insert(tasks)
    .values({
      orgId: customer!.id,
      enterpriseId: ent2!.id,
      businessType: 'emergency_plan',
      name: '2026 年应急预案（另一个）',
      status: 'submitted',
      submittedAt: new Date('2026-10-27T07:20:00Z'),
      number: 'GY-2026-002',
      assignedExpertId: uid['zhou@test.cn']!,
      createdBy: uid['feiyu@test.cn']!,
    })
    .returning();
  otherTaskId = t2!.id;

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

  it('越权：别家客户、注安师、运营调用客户接口，吴工采用或退回，补件编号不属于这个任务，都当作不存在', async () => {
    const zhou = await as('zhou@test.cn');
    const [round] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body as { id: string }[];
    const respond = `/api/tasks/${taskId}/supplement-requests/${round!.id}/response`;
    const reply = { note: '替别人回应', confirmed: true };
    const other = await as('other@test.cn');
    expect((await other.get(`/api/tasks/${taskId}/supplement-requests`)).status).toBe(404);
    expect((await other.post(respond).send(reply)).status).toBe(404);
    expect((await other.get(`/api/tasks/${taskId}/supplements`)).status).toBe(404);
    // 负责注安师、运营都不能替客户回应
    const ops = await as('ops@test.cn');
    for (const agent of [zhou, ops]) {
      expect((await agent.get(`/api/tasks/${taskId}/supplement-requests`)).status).toBe(404);
      expect((await agent.post(respond).send(reply)).status).toBe(404);
    }
    // 不负责的注安师采用、退回：看不到这个任务；运营退回：没有权限
    const wu = await as('wu@test.cn');
    const facts = { facts: [{ key: 'contactPerson', value: '王建国' }], confirmed: true };
    expect((await wu.post(`/api/tasks/${taskId}/supplements/${round!.id}/adopt`).send(facts)).status).toBe(404);
    expect((await wu.post(`/api/tasks/${taskId}/supplements/${round!.id}/return`).send({ message: '再补' })).status).toBe(404);
    expect((await ops.post(`/api/tasks/${taskId}/supplements/${round!.id}/return`).send({ message: '再补' })).status).toBe(403);
    // 另一个任务的补件编号拿到本任务来用
    const [elsewhere] = (await zhou.post(`/api/tasks/${otherTaskId}/supplements`).send(ask).expect(201)).body as { id: string }[];
    const feiyu = await as('feiyu@test.cn');
    expect((await feiyu.post(`/api/tasks/${taskId}/supplement-requests/${elsewhere!.id}/response`).send(reply)).status).toBe(404);
    expect((await zhou.post(`/api/tasks/${taskId}/supplements/${elsewhere!.id}/adopt`).send(facts)).status).toBe(404);
    expect((await zhou.post(`/api/tasks/${taskId}/supplements/${elsewhere!.id}/return`).send({ message: '再补' })).status).toBe(404);
    // 这一轮还在等客户
    const [still] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body;
    expect(still).toMatchObject({ status: 'awaiting_customer', response: null });
  });

  it('两个窗口同时发起：只有一个成功，另一个答复已有一轮在进行（不是服务出错）', async () => {
    const zhou = await as('zhou@test.cn');
    const fresh = await db
      .insert(tasks)
      .values({
        orgId: customerOrg,
        enterpriseId: spareEnterprise,
        businessType: 'emergency_plan',
        name: '并发发起',
        status: 'submitted',
        number: 'GY-2026-003',
        assignedExpertId: expertId,
        createdBy: expertId,
      })
      .returning();
    const url = `/api/tasks/${fresh[0]!.id}/supplements`;
    const results = await Promise.all([zhou.post(url).send(ask), zhou.post(url).send(ask), zhou.post(url).send(ask)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await zhou.get(url).expect(200)).body).toHaveLength(1);
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
    const listed = (await feiyu.get(`/api/orgs/${customerOrg}/tasks`).expect(200)).body as { id: string; supplement: string | null }[];
    expect(listed.find((t) => t.id === taskId)!.supplement).toBeNull();

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

  it('写回企业事实失败：这一轮不算采用，仍是待采用，提示重试', async () => {
    const zhou = await as('zhou@test.cn');
    const [round] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body;
    const spy = vi.spyOn(app.get(WorkupService), 'applySupplement').mockRejectedValueOnce(new Error('connection reset'));
    try {
      const res = await zhou.post(`/api/tasks/${taskId}/supplements/${round.id}/adopt`).send({
        facts: [
          { key: 'contactPerson', value: '王建国' },
          { key: 'contactPhone', value: '13900002071' },
        ],
        confirmed: true,
      });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('没能写入，请重试');
    } finally {
      spy.mockRestore();
    }
    const [after] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body;
    expect(after).toMatchObject({ id: round.id, status: 'awaiting_expert', adoptedAt: null, adoptedByName: null });
    expect(after.facts[0].after).toBeUndefined();
    const workup = await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
    expect(workup.body.data.overrides.contactPerson).toBeUndefined();
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

  it('审核通过后采用补件：原审核结论作废，不能再确认；按新事实重新生成后才算完成', async () => {
    const zhou = await as('zhou@test.cn');
    // 一批已生成、三份已核对、审核已通过的草稿（直接写库，不跑生成）
    const kinds = ['plan', 'risk', 'resource'] as const;
    const batchOf = async (createdAt: Date) => {
      const [batch] = await db
        .insert(generationBatches)
        .values({ taskId, workupVersion: 1, snapshotAt: createdAt, input: {} as never, materials: [], createdBy: expertId, createdAt })
        .returning();
      await db.insert(generatedDrafts).values(kinds.map((kind) => ({ batchId: batch!.id, kind, status: 'done' as const, finishedAt: createdAt })));
      return batch!.id;
    };
    const batchId = await batchOf(new Date());
    await db.insert(draftChecks).values(kinds.map((kind) => ({ batchId, kind, version: 0, checkedBy: expertId })));
    await db.insert(draftReviews).values({ batchId, note: '通过', versions: { plan: 0, risk: 0, resource: 0 }, reviewedBy: expertId });
    const passed = await zhou.get(`/api/tasks/${taskId}/draft-review`).expect(200);
    expect(passed.body.factsChangedAt).toBeNull();
    expect(reviewValid(passed.body)).toBe(true);

    // 第 3 轮：客户回应、注安师采用
    const [round] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body;
    expect(round).toMatchObject({ round: 3, status: 'awaiting_customer' });
    await (await as('feiyu@test.cn'))
      .post(`/api/tasks/${taskId}/supplement-requests/${round.id}/response`)
      .send({ note: '联系人还是王建国', confirmed: true })
      .expect(201);
    const adoption = {
      facts: [
        { key: 'contactPerson', value: '王建国' },
        { key: 'contactPhone', value: '13900002072' },
      ],
      confirmed: true,
    };
    // 这个任务正在发布：不能采用（采用会让正在发布的审核结论作废），这一轮仍待采用
    const [publishing] = await db
      .insert(deliveries)
      .values({
        publishId: randomUUID(),
        taskId,
        batchId,
        version: 1,
        status: 'publishing',
        reviewedBy: expertId,
        reviewedAt: new Date(),
        versions: { plan: 0, risk: 0, resource: 0 },
        publishedBy: expertId,
      })
      .returning();
    const blocked = await zhou.post(`/api/tasks/${taskId}/supplements/${round.id}/adopt`).send(adoption).expect(409);
    expect(blocked.body).toMatchObject({ reason: 'publishing', message: '这个任务正在发布三份 Word，请等发布完成后再采用补件' });
    expect((await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body[0]).toMatchObject({ id: round.id, status: 'awaiting_expert' });
    await db.delete(deliveries).where(eq(deliveries.id, publishing!.id));

    const adopted = await zhou.post(`/api/tasks/${taskId}/supplements/${round.id}/adopt`).send(adoption).expect(201);
    expect(adopted.body[0]).toMatchObject({ status: 'adopted', regenerated: false });

    const stale = await zhou.get(`/api/tasks/${taskId}/draft-review`).expect(200);
    expect(stale.body.factsChangedAt).toBe(adopted.body[0].adoptedAt);
    expect(reviewValid(stale.body)).toBe(false);
    const again = await zhou.post(`/api/tasks/${taskId}/draft-review`).send({ note: '再通过一次', versions: { plan: 0, risk: 0, resource: 0 } });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('facts_changed');

    // 按新事实重新生成（新一批）：这一轮算完成，新一批没有作废的结论
    const next = await batchOf(new Date(Date.now() + 1000));
    const [done] = (await zhou.get(`/api/tasks/${taskId}/supplements`).expect(200)).body;
    expect(done.regenerated).toBe(true);
    const fresh = await zhou.get(`/api/tasks/${taskId}/draft-review`).expect(200);
    expect(fresh.body).toMatchObject({ batchId: next, factsChangedAt: null, review: null });
  });
});
