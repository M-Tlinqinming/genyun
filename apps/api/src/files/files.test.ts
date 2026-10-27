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
import { files, memberships, organizations, tasks, users } from '../db/schema.ts';
import { LocalDiskStorage } from './storage.ts';

const PASSWORD = 'correct horse battery staple';
const MISSING = '00000000-0000-4000-8000-000000000000';

const PDF = Buffer.from('%PDF-1.7\n% 耕云测试文件\n');
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('..[Content_Types].xml..word/document.xml')]);
const DOC = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
  Buffer.from('WordDocument', 'utf16le'),
]);

let handle: DatabaseHandle;
let app: INestApplication;
let storage: LocalDiskStorage;
let storageDir: string;
const org: Record<'a' | 'b' | 'internal', string> = { a: '', b: '', internal: '' };
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
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  [org.a, org.b, org.internal] = created.map((o) => o.id) as [string, string, string];

  const people = [
    { email: 'a-admin@test.cn', orgId: org.a, role: 'customer_admin' as const },
    { email: 'b-admin@test.cn', orgId: org.b, role: 'customer_admin' as const },
    { email: 'expert@test.cn', orgId: org.internal, role: 'expert' as const },
    { email: 'ops@test.cn', orgId: org.internal, role: 'operator' as const },
  ];
  for (const p of people) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.email, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }

  storageDir = mkdtempSync(join(tmpdir(), 'genyun-files-'));
  storage = new LocalDiskStorage(storageDir, 'test-secret');
  app = await createApp(db, { loginLimitPerMinute: 1000, storage });
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

async function upload(email: string, orgId: string, data: Buffer, filename: string, rule?: string) {
  const agent = await as(email);
  return agent.post(`/api/orgs/${orgId}/files${rule ? `?rule=${rule}` : ''}`).attach('file', data, filename);
}

async function uploadOk(email: string, orgId: string, data: Buffer, filename: string) {
  const res = await upload(email, orgId, data, filename);
  expect(res.status).toBe(201);
  return res.body as { id: string; originalName: string; contentType: string; sizeBytes: number };
}

async function newTask(email: string, orgId: string, name: string) {
  const agent = await as(email);
  const ent = await agent.post(`/api/orgs/${orgId}/enterprises`).send({ name }).expect(201);
  const task = await agent.post(`/api/enterprises/${ent.body.id}/tasks`).send({ name: '2026 年应急预案编制' }).expect(201);
  return task.body.id as string;
}

// 拿到下载链接后，不带登录状态直接下载
async function download(email: string, fileId: string) {
  const res = await (await as(email)).get(`/api/files/${fileId}/download-url`);
  if (res.status !== 200) return { status: res.status, message: res.body.message as string };
  const blob = await request(app.getHttpServer()).get(res.body.url).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  return { status: blob.status, body: blob.body as Buffer, headers: blob.headers, url: res.body.url as string };
}

describe('上传', () => {
  it('上传 PDF，保留中文文件名，类型按内容判断', async () => {
    const f = await uploadOk('a-admin@test.cn', org.a, PDF, '总平面图.pdf');
    expect(f).toMatchObject({ originalName: '总平面图.pdf', contentType: 'application/pdf', sizeBytes: PDF.length });
  });

  it('接受 Word 新老两种格式', async () => {
    expect((await uploadOk('a-admin@test.cn', org.a, DOCX, '应急人员名册.docx')).contentType).toMatch(/wordprocessingml/);
    expect((await uploadOk('a-admin@test.cn', org.a, DOC, '生产安全应急预案资料清单.doc')).contentType).toBe('application/msword');
  });

  it('改了扩展名的文件被拒绝', async () => {
    const res = await upload('a-admin@test.cn', org.a, Buffer.from('not really a pdf'), '假文件.pdf');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/格式不支持/);
  });

  it('营业执照入口不接受 Word', async () => {
    const res = await upload('a-admin@test.cn', org.a, DOCX, '执照.docx', 'image_or_pdf');
    expect(res.status).toBe(400);
  });

  it('超过 10 MB 被拒绝', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    PDF.copy(big);
    const res = await upload('a-admin@test.cn', org.a, big, '总平面图.pdf');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/10 MB/);
  });

  it('没有选择文件时提示', async () => {
    const res = await (await as('a-admin@test.cn')).post(`/api/orgs/${org.a}/files`).field('x', '1');
    expect(res.status).toBe(400);
  });
});

describe('下载', () => {
  it('凭短时效链接下载到原文件，带原文件名', async () => {
    const f = await uploadOk('a-admin@test.cn', org.a, PDF, '疏散图.pdf');
    const d = await download('a-admin@test.cn', f.id);
    expect(d.status).toBe(200);
    expect(Buffer.compare(d.body!, PDF)).toBe(0);
    expect(d.headers!['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('疏散图.pdf')}`);
    expect(d.headers!['x-content-type-options']).toBe('nosniff');
  });

  it('改动链接里的任何参数都无法下载', async () => {
    const f = await uploadOk('a-admin@test.cn', org.a, PDF, '改链接.pdf');
    const other = await uploadOk('b-admin@test.cn', org.b, PDF, 'B 的文件.pdf');
    const [otherKey] = await handle.db.select({ k: files.storageKey }).from(files).where(eq(files.id, other.id));
    const { url } = (await download('a-admin@test.cn', f.id)) as { url: string };
    const u = new URL(url, 'http://x');
    const tamper = (name: string, value: string) => {
      const t = new URL(u);
      t.searchParams.set(name, value);
      return t.pathname + t.search;
    };
    const server = request(app.getHttpServer());
    await server.get(tamper('k', otherKey!.k)).expect(403);
    await server.get(tamper('e', String(Math.floor(Date.now() / 1000) + 86400 * 365))).expect(403);
    await server.get(tamper('t', 'text/html')).expect(403);
    await server.get('/api/files/blob').expect(403);
  });

  it('过期的链接无法下载', async () => {
    const f = await uploadOk('a-admin@test.cn', org.a, PDF, '过期.pdf');
    const [row] = await handle.db.select({ k: files.storageKey }).from(files).where(eq(files.id, f.id));
    const url = await storage.downloadUrl(row!.k, { filename: '过期.pdf', contentType: 'application/pdf', ttlSeconds: -1 });
    const res = await request(app.getHttpServer()).get(url);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/已过期/);
  });
});

describe('越权：文件', () => {
  let fileA: string;
  beforeAll(async () => {
    fileA = (await uploadOk('a-admin@test.cn', org.a, PDF, 'A 的营业执照.pdf')).id;
  });

  it('B 组织拿不到 A 的文件和下载链接，且无法判断文件是否存在', async () => {
    const b = await as('b-admin@test.cn');
    const other = await b.get(`/api/files/${fileA}/download-url`);
    const missing = await b.get(`/api/files/${MISSING}/download-url`);
    expect(other.status).toBe(404);
    expect(other.body.message).toBe(missing.body.message);
    await b.get(`/api/files/${fileA}`).expect(404);
  });

  it('B 组织不能往 A 组织上传', async () => {
    expect((await upload('b-admin@test.cn', org.a, PDF, '冒传.pdf')).status).toBe(404);
  });

  it('B 组织不能把 A 的文件挂到自己的任务上', async () => {
    const taskB = await newTask('b-admin@test.cn', org.b, 'B 的企业');
    const res = await (await as('b-admin@test.cn'))
      .post(`/api/tasks/${taskB}/checklist/business_license/files`)
      .send({ fileId: fileA });
    expect(res.status).toBe(404);
  });

  it('未登录拿不到下载链接', async () => {
    await request(app.getHttpServer()).get(`/api/files/${fileA}/download-url`).expect(401);
  });

  it('运营可以下载，但不替客户上传', async () => {
    expect((await download('ops@test.cn', fileA)).status).toBe(200);
    expect((await upload('ops@test.cn', org.a, PDF, '运营传的.pdf')).status).toBe(403);
  });

  it('专业人员只能下载分派给自己的任务里用到的文件', async () => {
    const taskA = await newTask('a-admin@test.cn', org.a, '专家文件企业');
    const linked = await uploadOk('a-admin@test.cn', org.a, PDF, '挂在任务上的.pdf');
    await (await as('a-admin@test.cn'))
      .post(`/api/tasks/${taskA}/checklist/site_plan/files`)
      .send({ fileId: linked.id })
      .expect(201);

    expect((await download('expert@test.cn', linked.id)).status).toBe(404);
    await handle.db.update(tasks).set({ assignedExpertId: uid['expert@test.cn'] }).where(eq(tasks.id, taskA));
    expect((await download('expert@test.cn', linked.id)).status).toBe(200);
    // 同组织但没挂在这个任务上的文件仍然看不到
    expect((await download('expert@test.cn', fileA)).status).toBe(404);
  });
});

describe('资料项关联文件', () => {
  let taskId: string;
  beforeAll(async () => {
    taskId = await newTask('a-admin@test.cn', org.a, '关联文件企业');
  });

  it('挂上文件后该项变为已提供，以文件为凭证不需要确认人', async () => {
    const f = await uploadOk('a-admin@test.cn', org.a, PDF, '营业执照.pdf');
    const res = await (await as('a-admin@test.cn'))
      .post(`/api/tasks/${taskId}/checklist/business_license/files`)
      .send({ fileId: f.id })
      .expect(201);
    expect(res.body.items.business_license).toMatchObject({ status: 'provided', fileIds: [f.id] });
    expect(res.body.items.business_license.confirmedBy).toBeUndefined();
  });

  it('拍照给耕云看的照片挂上后，状态保持不变', async () => {
    const a = await as('a-admin@test.cn');
    await a.put(`/api/tasks/${taskId}/checklist/special_equipment`).send({ status: 'photo_for_expert' }).expect(200);
    const photo = await uploadOk('a-admin@test.cn', org.a, PDF, '铭牌.pdf');
    const res = await a.post(`/api/tasks/${taskId}/checklist/special_equipment/files`).send({ fileId: photo.id }).expect(201);
    expect(res.body.items.special_equipment).toMatchObject({ status: 'photo_for_expert', fileIds: [photo.id] });
  });

  it('移除最后一个文件后恢复为未回答，文件本身保留', async () => {
    const a = await as('a-admin@test.cn');
    const f = await uploadOk('a-admin@test.cn', org.a, PDF, '疏散图.pdf');
    await a.post(`/api/tasks/${taskId}/checklist/evacuation_plan/files`).send({ fileId: f.id }).expect(201);
    const res = await a.delete(`/api/tasks/${taskId}/checklist/evacuation_plan/files/${f.id}`).expect(200);
    expect(res.body.items.evacuation_plan).toBeUndefined();
    await a.get(`/api/files/${f.id}`).expect(200);
  });

  it('耕云代办的项不能由客户挂文件', async () => {
    const f = await uploadOk('a-admin@test.cn', org.a, PDF, '体系图.pdf');
    const res = await (await as('a-admin@test.cn'))
      .post(`/api/tasks/${taskId}/checklist/org_chart/files`)
      .send({ fileId: f.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/由耕云生成/);
  });
});
