import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterpriseDocuments, memberships, organizations, tasks, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';

const PASSWORD = 'correct horse battery staple';
const PDF = Buffer.from('%PDF-1.7\n% 企业资料\n');

let handle: DatabaseHandle;
let app: INestApplication;
let storageDir: string;
const org: Record<'a' | 'b' | 'internal', string> = { a: '', b: '', internal: '' };
const userIds: Record<string, string> = {};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const created = await db
    .insert(organizations)
    .values([
      { name: 'A 制造', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: 'B 制造', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  [org.a, org.b, org.internal] = created.map((o) => o.id) as [string, string, string];
  for (const p of [
    { email: 'a-admin@test.cn', orgId: org.a, role: 'customer_admin' as const },
    { email: 'b-admin@test.cn', orgId: org.b, role: 'customer_admin' as const },
    { email: 'expert@test.cn', orgId: org.internal, role: 'expert' as const },
    { email: 'expert2@test.cn', orgId: org.internal, role: 'expert' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.email, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    userIds[p.email] = u!.id;
  }
  storageDir = mkdtempSync(join(tmpdir(), 'genyun-documents-'));
  app = await createApp(db, { loginLimitPerMinute: 1000, storage: new LocalDiskStorage(storageDir, 'test-secret') });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function as(email: string) {
  let agent = agents.get(email);
  if (!agent) {
    agent = request.agent(app.getHttpServer());
    expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    agents.set(email, agent);
  }
  return agent;
}

async function newTask(name: string, email = 'a-admin@test.cn', orgId = org.a) {
  const agent = await as(email);
  const ent = await agent.post(`/api/orgs/${orgId}/enterprises`).send({ name });
  const task = await agent.post(`/api/enterprises/${ent.body.id}/tasks`).send({ name: '2026 年应急预案编制' });
  expect(task.status).toBe(201);
  return { enterpriseId: ent.body.id as string, taskId: task.body.id as string, agent };
}

async function upload(name: string, email = 'a-admin@test.cn', orgId = org.a) {
  const res = await (await as(email)).post(`/api/orgs/${orgId}/files?rule=material`).attach('file', PDF, name);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('上传已有资料 · 任务关联的企业原始资料', () => {
  it('上传的文件登记进企业资料库（V1）并关联到任务；同一文件重复关联不会多出一份', async () => {
    const { enterpriseId, taskId, agent } = await newTask('甲一公司');
    const first = await upload('企业资料清单.pdf');
    const second = await upload('应急人员名册.pdf');
    expect((await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId: first })).status).toBe(201);
    const res = await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId: second });
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ name: '企业资料清单.pdf', version: 1, category: null, fileId: first });

    await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId: first });
    expect((await agent.get(`/api/tasks/${taskId}/documents`)).body).toHaveLength(2);
    const library = await handle.db.select().from(enterpriseDocuments).where(eq(enterpriseDocuments.enterpriseId, enterpriseId));
    expect(library).toHaveLength(2);
  });

  it('移除只取消任务里的关联，资料库里的原件保留', async () => {
    const { enterpriseId, taskId, agent } = await newTask('甲二公司');
    const fileId = await upload('总平面图.pdf');
    const [doc] = (await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId })).body;
    const res = await agent.delete(`/api/tasks/${taskId}/documents/${doc.documentId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const library = await handle.db.select().from(enterpriseDocuments).where(eq(enterpriseDocuments.enterpriseId, enterpriseId));
    expect(library).toHaveLength(1);
    // 文件本身还能下载
    expect((await agent.get(`/api/files/${fileId}/download-url`)).status).toBe(200);
  });

  it('已提交的任务不能再改关联', async () => {
    const { taskId, agent } = await newTask('甲三公司');
    const fileId = await upload('疏散图.pdf');
    await handle.db.update(tasks).set({ status: 'submitted', submittedAt: new Date() }).where(eq(tasks.id, taskId));
    const res = await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('任务已提交');
  });

  it('别的组织看不到、改不了，也不能挂别家的文件；负责专家能看到并预览，其他专家不能', async () => {
    const { taskId, agent } = await newTask('甲四公司');
    const fileId = await upload('应急资源清单.pdf');
    await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId });

    const b = await as('b-admin@test.cn');
    expect((await b.get(`/api/tasks/${taskId}/documents`)).status).toBe(404);
    expect((await b.post(`/api/tasks/${taskId}/documents`).send({ fileId })).status).toBe(404);
    const other = await newTask('乙一公司', 'b-admin@test.cn', org.b);
    expect((await b.post(`/api/tasks/${other.taskId}/documents`).send({ fileId })).status).toBe(404);

    await handle.db.update(tasks).set({ assignedExpertId: userIds['expert@test.cn'] }).where(eq(tasks.id, taskId));
    const expert = await as('expert@test.cn');
    expect((await expert.get(`/api/tasks/${taskId}/documents`)).body).toHaveLength(1);
    expect((await expert.get(`/api/files/${fileId}/download-url`)).status).toBe(200);
    expect((await expert.post(`/api/tasks/${taskId}/documents`).send({ fileId })).status).toBe(403);
    const expert2 = await as('expert2@test.cn');
    expect((await expert2.get(`/api/files/${fileId}/download-url`)).status).toBe(404);
  });
});

describe('企业资料库 · 版本与选用', () => {
  it('资料库直接上传为 V1、待整理；上传新版本后任务仍用原版本，并提示有新版本', async () => {
    const { enterpriseId, taskId, agent } = await newTask('丙一公司');
    const v1 = await upload('应急人员名册.pdf');
    await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId: v1 });
    const libraryOnly = await upload('企业资料清单.pdf');
    const list = (await agent.post(`/api/enterprises/${enterpriseId}/documents`).send({ fileId: libraryOnly })).body;
    expect(list).toHaveLength(2);
    const roster = list.find((d: { name: string }) => d.name === '应急人员名册.pdf');
    expect(roster).toMatchObject({ category: null, versionCount: 1, latest: { version: 1, fileId: v1 } });

    const v2 = await upload('应急人员名册（2026 修订）.pdf');
    const detail = (await agent.post(`/api/enterprises/${enterpriseId}/documents/${roster.id}/versions`).send({ fileId: v2 }))
      .body;
    expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(detail.versions[0].tasks).toEqual([]);
    expect(detail.versions[1].tasks).toEqual([expect.objectContaining({ taskId, status: 'preparing' })]);

    const [linked] = (await agent.get(`/api/tasks/${taskId}/documents`)).body;
    expect(linked).toMatchObject({ version: 1, latestVersion: 2 });
    // 同一个文件不能再登记为新版本
    const again = await agent.post(`/api/enterprises/${enterpriseId}/documents/${roster.id}/versions`).send({ fileId: v2 });
    expect(again.status).toBe(400);
  });

  it('从资料库选用：确认后任务关联的就是选中的资料与版本，没选的取消关联', async () => {
    const { enterpriseId, taskId, agent } = await newTask('丙二公司');
    const a = await upload('总平面图.pdf');
    const b = await upload('疏散图.pdf');
    await agent.post(`/api/enterprises/${enterpriseId}/documents`).send({ fileId: a });
    const lib = (await agent.post(`/api/enterprises/${enterpriseId}/documents`).send({ fileId: b })).body;
    const plan = lib.find((d: { name: string }) => d.name === '总平面图.pdf');
    const evac = lib.find((d: { name: string }) => d.name === '疏散图.pdf');
    const v2 = await upload('总平面图 2026.pdf');
    const detail = (await agent.post(`/api/enterprises/${enterpriseId}/documents/${plan.id}/versions`).send({ fileId: v2 }))
      .body;

    let res = await agent.put(`/api/tasks/${taskId}/documents`).send({
      selections: [
        { documentId: plan.id, versionId: detail.versions[1].versionId },
        { documentId: evac.id, versionId: evac.latest.versionId },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((d: { name: string; version: number }) => [d.name, d.version])).toEqual([
      ['总平面图.pdf', 1],
      ['疏散图.pdf', 1],
    ]);

    // 改选 V2、去掉疏散图
    res = await agent.put(`/api/tasks/${taskId}/documents`).send({
      selections: [{ documentId: plan.id, versionId: detail.versions[0].versionId }],
    });
    expect(res.body.map((d: { version: number }) => d.version)).toEqual([2]);
    // 版本和资料对不上、或同一份资料选两个版本
    const mismatch = await agent.put(`/api/tasks/${taskId}/documents`).send({
      selections: [{ documentId: evac.id, versionId: detail.versions[0].versionId }],
    });
    expect(mismatch.status).toBe(404);
    const twice = await agent.put(`/api/tasks/${taskId}/documents`).send({
      selections: detail.versions.map((v: { versionId: string }) => ({ documentId: plan.id, versionId: v.versionId })),
    });
    expect(twice.status).toBe(400);
  });

  it('别的企业、别的组织的资料不能选用，也看不到资料库', async () => {
    const mine = await newTask('丙三公司');
    const other = await newTask('丙四公司');
    const fileId = await upload('别家资料.pdf');
    const [doc] = (await other.agent.post(`/api/enterprises/${other.enterpriseId}/documents`).send({ fileId })).body;
    const res = await mine.agent
      .put(`/api/tasks/${mine.taskId}/documents`)
      .send({ selections: [{ documentId: doc.id, versionId: doc.latest.versionId }] });
    expect(res.status).toBe(404);

    const b = await as('b-admin@test.cn');
    expect((await b.get(`/api/enterprises/${mine.enterpriseId}/documents`)).status).toBe(404);
    expect((await b.get(`/api/enterprises/${other.enterpriseId}/documents/${doc.id}`)).status).toBe(404);
    expect((await b.post(`/api/enterprises/${mine.enterpriseId}/documents`).send({ fileId })).status).toBe(404);
  });

  it('企业自填上传的图纸、台账自动进资料库，分类按填写位置；照片不进', async () => {
    const { enterpriseId, agent } = await newTask('丙五公司');
    const plan = await upload('总平面图.pdf');
    const ledger = await upload('设备台账.pdf');
    const label = await upload('油漆标签.pdf');
    const basic = (await agent.get(`/api/enterprises/${enterpriseId}/basic-step`)).body;
    const prod = (await agent.get(`/api/enterprises/${enterpriseId}/production-step`)).body;
    let saved = await agent.put(`/api/enterprises/${enterpriseId}/production-step`).send({
      version: basic.version,
      step: {
        ...prod.step,
        ledgers: { equipment: [ledger], materials: [] },
        materials: [{ id: 'm1', name: '油漆', labelPhotoFileIds: [label] }],
      },
    });
    expect(saved.status).toBe(200);
    const res = (await agent.get(`/api/enterprises/${enterpriseId}/resources-step`)).body;
    saved = await agent.put(`/api/enterprises/${enterpriseId}/resources-step`).send({
      version: saved.body.version,
      step: { ...res.step, drawings: { ...res.step.drawings, site_plan: [plan] } },
    });
    expect(saved.status).toBe(200);

    const lib = (await agent.get(`/api/enterprises/${enterpriseId}/documents`)).body;
    expect(lib.map((d: { name: string; category: string }) => [d.name, d.category]).sort()).toEqual([
      ['总平面图.pdf', 'drawings'],
      ['设备台账.pdf', 'production'],
    ]);
  });
});

describe('资料检查 · 逐项处理', () => {
  it('由我确认：记下填写的说明和确认人；改成别的状态时说明清掉', async () => {
    const { taskId, agent } = await newTask('丁一公司');
    let res = await agent.put(`/api/tasks/${taskId}/checklist/basic_info`).send({ status: 'provided', note: '员工 86 人，安全员 2 人' });
    expect(res.status).toBe(200);
    let check = (await agent.get(`/api/tasks/${taskId}/check`)).body;
    expect(check.items.basic_info).toMatchObject({ status: 'provided', note: '员工 86 人，安全员 2 人' });
    expect(check.userNames[check.items.basic_info.confirmedBy]).toBe('a-admin@test.cn');

    res = await agent.put(`/api/tasks/${taskId}/checklist/basic_info`).send({ status: 'later', callRequested: true });
    expect(res.status).toBe(200);
    check = (await agent.get(`/api/tasks/${taskId}/check`)).body;
    expect(check.items.basic_info).toMatchObject({ status: 'later', callRequested: true });
    expect(check.items.basic_info.note).toBeUndefined();
  });

  it('必需项不能单纯稍后补，请专家电话联系可以', async () => {
    const { taskId, agent } = await newTask('丁二公司');
    const plain = await agent.put(`/api/tasks/${taskId}/checklist/site_plan`).send({ status: 'later' });
    expect(plain.status).toBe(400);
    expect(plain.body.message).toContain('不能稍后补');
    const call = await agent.put(`/api/tasks/${taskId}/checklist/site_plan`).send({ status: 'later', callRequested: true });
    expect(call.status).toBe(200);
    expect(call.body.check.blocking.map((b: { key: string }) => b.key)).not.toContain('site_plan');
  });

  it('把已传的资料对应到资料项：检查结果带出文件名；别的组织看不到', async () => {
    const { taskId, agent } = await newTask('丁三公司');
    const fileId = await upload('总平面图.pdf');
    await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId });
    await agent.post(`/api/tasks/${taskId}/checklist/site_plan/files`).send({ fileId });
    const check = (await agent.get(`/api/tasks/${taskId}/check`)).body;
    expect(check.items.site_plan).toMatchObject({ status: 'provided', fileIds: [fileId] });
    expect(check.fileNames[fileId]).toBe('总平面图.pdf');
    expect((await (await as('b-admin@test.cn')).get(`/api/tasks/${taskId}/check`)).status).toBe(404);
  });
});

describe('检查页手动处理与自填同步', () => {
  it('检查页里答了「没有消防水池」，之后保存自填第 4 步不会把它撤回', async () => {
    const { enterpriseId, taskId, agent } = await newTask('戊一公司');
    expect((await agent.put(`/api/tasks/${taskId}/checklist/fire_pool`).send({ status: 'none' })).status).toBe(200);
    const res = (await agent.get(`/api/enterprises/${enterpriseId}/resources-step`)).body;
    const saved = await agent
      .put(`/api/enterprises/${enterpriseId}/resources-step`)
      .send({ version: res.version, step: { ...res.step, neighbors: { answer: 'none', items: [] } } });
    expect(saved.status).toBe(200);
    const check = (await agent.get(`/api/tasks/${taskId}/check`)).body;
    expect(check.items.fire_pool).toMatchObject({ status: 'none' });
    expect(check.items.external_resources).toMatchObject({ status: 'provided' });

    // 自填得出的状态，内容清空后照常撤回
    const again = (await agent.get(`/api/enterprises/${enterpriseId}/resources-step`)).body;
    await agent
      .put(`/api/enterprises/${enterpriseId}/resources-step`)
      .send({ version: again.version, step: { ...again.step, neighbors: { items: [] } } });
    expect((await agent.get(`/api/tasks/${taskId}/check`)).body.items.external_resources).toBeUndefined();
  });
});
