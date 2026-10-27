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
