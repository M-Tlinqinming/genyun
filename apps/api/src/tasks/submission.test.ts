import { CHECKLIST_ITEMS } from '@genyun/shared';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { memberships, organizations, taskSubmissions, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';

const PASSWORD = 'correct horse battery staple';
const PDF = Buffer.from('%PDF-1.7\n% 企业资料\n');

let handle: DatabaseHandle;
let app: INestApplication;
let storageDir: string;
const org: Record<'a' | 'b', string> = { a: '', b: '' };

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const created = await db
    .insert(organizations)
    .values([
      { name: 'A 制造', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: 'B 制造', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
    ])
    .returning();
  [org.a, org.b] = created.map((o) => o.id) as [string, string];
  for (const p of [
    { email: 'a-admin@test.cn', name: '林管理员', orgId: org.a, role: 'customer_admin' as const },
    { email: 'b-admin@test.cn', name: 'B 管理员', orgId: org.b, role: 'customer_admin' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
  }
  storageDir = mkdtempSync(join(tmpdir(), 'genyun-submission-'));
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

async function upload(name: string) {
  const res = await (await as('a-admin@test.cn')).post(`/api/orgs/${org.a}/files?rule=material`).attach('file', PDF, name);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

// 上传路线的任务：传一份总平面图，开始编制必需的项都处理好（图纸挂文件，其余由我确认）
async function readyTask(name: string) {
  const agent = await as('a-admin@test.cn');
  const ent = await agent.post(`/api/orgs/${org.a}/enterprises`).send({ name });
  const task = await agent.post(`/api/enterprises/${ent.body.id}/tasks`).send({ name: '2026 年应急预案编制' });
  const taskId = task.body.id as string;
  await agent.patch(`/api/tasks/${taskId}`).send({ startMethod: 'upload' });
  const plan = await upload('总平面图.pdf');
  await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId: plan });
  await agent.post(`/api/tasks/${taskId}/checklist/site_plan/files`).send({ fileId: plan });
  for (const def of CHECKLIST_ITEMS) {
    if (def.requirement !== 'start' || def.key === 'site_plan') continue;
    const body = def.key === 'duty_phone' ? { status: 'later', callRequested: true } : { status: 'provided', note: '已核对' };
    expect((await agent.put(`/api/tasks/${taskId}/checklist/${def.key}`).send(body)).status).toBe(200);
  }
  return { agent, taskId, enterpriseId: ent.body.id as string, plan };
}

async function preview(agent: Awaited<ReturnType<typeof as>>, taskId: string) {
  const res = await agent.get(`/api/tasks/${taskId}/submission`);
  expect(res.status).toBe(200);
  expect(res.body.submitted).toBe(false);
  return res.body.preview;
}

function submit(agent: Awaited<ReturnType<typeof as>>, taskId: string, p: { fingerprint: string; taskDocuments: unknown[] }, requestId = randomUUID()) {
  return agent.post(`/api/tasks/${taskId}/submission`).send({ requestId, fingerprint: p.fingerprint, documents: p.taskDocuments });
}

describe('提交生成申请', () => {
  it('必需资料没处理完不能提交，并说清缺哪几项', async () => {
    const agent = await as('a-admin@test.cn');
    const ent = await agent.post(`/api/orgs/${org.a}/enterprises`).send({ name: '缺资料公司' });
    const task = await agent.post(`/api/enterprises/${ent.body.id}/tasks`).send({ name: '2026 年应急预案编制' });
    await agent.patch(`/api/tasks/${task.body.id}`).send({ startMethod: 'upload' });
    const p = await preview(agent, task.body.id);
    expect(p.canSubmit).toBe(false);
    const res = await submit(agent, task.body.id, p);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('营业执照');
  });

  it('确认框列出资料版本与由客户确认的事项；提交后任务变为已提交并记下当时的资料', async () => {
    const { agent, taskId } = await readyTask('飞宇制造');
    const p = await preview(agent, taskId);
    expect(p.canSubmit).toBe(true);
    expect(p.documents).toEqual([expect.objectContaining({ name: '总平面图.pdf', version: 1 })]);
    expect(p.answers).toContainEqual({ label: '24 小时值班电话', answer: '请专家电话联系' });
    expect(p.answers).toContainEqual({ label: '营业执照', answer: '已核对' });

    const res = await submit(agent, taskId, p);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ submittedByName: '林管理员', documents: [expect.objectContaining({ version: 1 })] });
    // 交付前补齐的项与待专家电话联系的项进待补清单
    expect(res.body.pendingKeys).toEqual(expect.arrayContaining(['duty_phone', 'msds', 'fire_facility_plan']));
    expect(res.body.pendingKeys).not.toContain('business_license');

    const task = (await agent.get(`/api/tasks/${taskId}`)).body;
    expect(task.status).toBe('submitted');
    expect(task.submittedAt).toBeTruthy();
    const after = (await agent.get(`/api/tasks/${taskId}/submission`)).body;
    expect(after).toMatchObject({ submitted: true, submission: { submittedByName: '林管理员' } });
  });

  it('断网后重发同一次提交只记一次；别人已交过也按已提交处理', async () => {
    const { agent, taskId } = await readyTask('断网公司');
    const p = await preview(agent, taskId);
    const requestId = randomUUID();
    const [first, second] = await Promise.all([submit(agent, taskId, p, requestId), submit(agent, taskId, p, requestId)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.submittedAt).toBe(first.body.submittedAt);
    const again = await submit(agent, taskId, p);
    expect(again.status).toBe(200);
    expect(again.body.submittedAt).toBe(first.body.submittedAt);
    const rows = await handle.db.select().from(taskSubmissions).where(eq(taskSubmissions.taskId, taskId));
    expect(rows).toHaveLength(1);
  });

  it('确认之后换了图纸版本：这次不提交，说明哪份资料变了', async () => {
    const { agent, taskId, enterpriseId } = await readyTask('换版本公司');
    const p = await preview(agent, taskId);
    const [doc] = (await agent.get(`/api/tasks/${taskId}/documents`)).body;
    const v2 = await upload('总平面图 2026.pdf');
    const detail = (await agent.post(`/api/enterprises/${enterpriseId}/documents/${doc.documentId}/versions`).send({ fileId: v2 })).body;
    await agent.put(`/api/tasks/${taskId}/documents`).send({
      selections: [{ documentId: doc.documentId, versionId: detail.versions[0].versionId }],
    });

    const res = await submit(agent, taskId, p);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'materials_changed', changes: ['总平面图.pdf由 V1 改为 V2'] });
    expect((await agent.get(`/api/tasks/${taskId}`)).body.status).toBe('preparing');
    // 重新检查后按新版本提交
    const ok = await submit(agent, taskId, await preview(agent, taskId));
    expect(ok.status).toBe(200);
    expect(ok.body.documents[0]).toMatchObject({ version: 2 });
  });

  it('提交以后：已提交的项与资料版本锁定，待补清单里的项还能补', async () => {
    const { agent, taskId, plan } = await readyTask('补件公司');
    await submit(agent, taskId, await preview(agent, taskId));

    const locked = await agent.put(`/api/tasks/${taskId}/checklist/business_license`).send({ status: 'provided', note: '改一下' });
    expect(locked.status).toBe(400);
    expect(locked.body.message).toContain('已随申请提交');
    expect((await agent.delete(`/api/tasks/${taskId}/checklist/site_plan/files/${plan}`)).status).toBe(400);
    const [doc] = (await agent.get(`/api/tasks/${taskId}/documents`)).body;
    expect((await agent.delete(`/api/tasks/${taskId}/documents/${doc.documentId}`)).status).toBe(400);

    // 补消防设施布置图：传新文件进任务，再对应到这一项
    const fire = await upload('消防设施布置图.pdf');
    expect((await agent.post(`/api/tasks/${taskId}/documents`).send({ fileId: fire })).status).toBe(201);
    const linked = await agent.post(`/api/tasks/${taskId}/checklist/fire_facility_plan/files`).send({ fileId: fire });
    expect(linked.status).toBe(201);
    expect(linked.body.items.fire_facility_plan.status).toBe('provided');
    // 待专家电话联系的项也可以自己补
    expect((await agent.put(`/api/tasks/${taskId}/checklist/duty_phone`).send({ status: 'provided', note: '0752-1234567' })).status).toBe(200);
  });

  it('别的组织既看不到也交不了', async () => {
    const { agent, taskId } = await readyTask('越权公司');
    const p = await preview(agent, taskId);
    const other = await as('b-admin@test.cn');
    expect((await other.get(`/api/tasks/${taskId}/submission`)).status).toBe(404);
    expect((await submit(other, taskId, p)).status).toBe(404);
    expect((await agent.get(`/api/tasks/${taskId}`)).body.status).toBe('preparing');
  });
});
