import type { PlanInput } from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import { createCanvas } from '@napi-rs/canvas';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { checklistItemFiles, drawingPages, enterprises, files, memberships, organizations, tasks, taskWorkups, users } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { LANDSCAPE, PORTRAIT, testPdf } from '../generation/drawings/test-pdf.ts';
import type { PlanDrawings } from '../generation/plan/assemble.ts';
import { InProcessQueue } from '../generation/queue.ts';
import { complete, testDocument } from './test-workup.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const queue = new InProcessQueue();
const stored = new Map<string, Buffer>();
const storage: FileStorage = {
  async put(key, data) {
    stored.set(key, data);
  },
  async read(key) {
    const data = stored.get(key);
    if (!data) throw new Error(`no ${key}`);
    return data;
  },
  async downloadUrl(key) {
    return `/blob/${key}`;
  },
};
// 记下应急预案生成时拿到的图纸
const received: { kind: string; input: PlanInput; drawings?: PlanDrawings }[] = [];
const renderer: DraftRenderer = async (kind, input, drawings) => {
  received.push({ kind, input, drawings });
  return { word: Buffer.from('word'), pdf: null, notes: [], document: testDocument(kind) };
};

let taskId = '';
let orgId = '';
let otherOrgId = '';
const uid: Record<string, string> = {};
// 总平面图：3 页 PDF；疏散图：企业自填第 4 步上传的照片；坏文件：打不开的 PDF
const fileId: Record<'site' | 'evac' | 'broken' | 'foreign', string> = { site: '', evac: '', broken: '', foreign: '' };

async function addFile(org: string, name: string, contentType: string, data: Buffer) {
  const id = randomUUID();
  const storageKey = `${org}/${id}`;
  stored.set(storageKey, data);
  await handle.db.insert(files).values({
    id,
    orgId: org,
    kind: 'customer_material',
    originalName: name,
    contentType,
    sizeBytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    storageKey,
    uploadedBy: uid['feiyu@test.cn']!,
  });
  return id;
}

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, other, internal] = await db
    .insert(organizations)
    .values([
      { name: '飞宇演示客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '别的客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  orgId = customer!.id;
  otherOrgId = other!.id;
  for (const p of [
    { email: 'feiyu@test.cn', name: '陈志刚', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }

  fileId.site = await addFile(orgId, '总平面图.pdf', 'application/pdf', testPdf([LANDSCAPE, PORTRAIT, LANDSCAPE]));
  const photo = createCanvas(600, 900);
  photo.getContext('2d').fillRect(50, 50, 200, 300);
  fileId.evac = await addFile(orgId, '疏散图.png', 'image/png', await photo.encode('png'));
  fileId.broken = await addFile(orgId, '消防设施图.pdf', 'application/pdf', Buffer.from('%PDF-1.4 坏了'));
  fileId.foreign = await addFile(otherOrgId, '别家总平面图.pdf', 'application/pdf', testPdf([LANDSCAPE]));

  const resources = feiyuProfile.resourcesStep!;
  const [ent] = await db
    .insert(enterprises)
    .values({
      orgId,
      name: '惠阳飞宇电器有限公司',
      socialCreditCode: '91441300726483224B',
      legalRepresentative: '李文聪',
      registeredAddress: '惠州市仲恺高新区陈江街道正大路 17 号',
      // 疏散图是企业自填第 4 步上传的；别家组织的文件即使写进资料也不认
      profile: {
        ...feiyuProfile,
        resourcesStep: {
          ...resources,
          step: { ...resources.step, drawings: { site_plan: [fileId.foreign], evacuation_plan: [fileId.evac], fire_facility_plan: [] } },
        },
      },
      createdBy: uid['feiyu@test.cn']!,
    })
    .returning();
  const [task] = await db
    .insert(tasks)
    .values({
      orgId,
      enterpriseId: ent!.id,
      businessType: 'emergency_plan',
      name: '2026 年应急预案',
      number: 'GY-2026-001',
      status: 'submitted',
      assignedExpertId: uid['zhou@test.cn']!,
      createdBy: uid['feiyu@test.cn']!,
    })
    .returning();
  taskId = task!.id;
  // 上传已有资料：总平面图、消防设施图挂在资料项上
  await db.insert(checklistItemFiles).values([
    { taskId, itemKey: 'site_plan', fileId: fileId.site, linkedBy: uid['feiyu@test.cn']! },
    { taskId, itemKey: 'fire_facility_plan', fileId: fileId.broken, linkedBy: uid['feiyu@test.cn']! },
  ]);

  app = await createApp(db, { loginLimitPerMinute: 1000, storage, queue, renderer });
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

// supertest 默认不收集二进制响应体
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('客户图纸选页（附件 7）', () => {
  it('列出任务里的三种图纸：按附件 7 的先后，没选过的默认第 1 页；打不开的提示；别家组织的文件不认', async () => {
    const zhou = await as('zhou@test.cn');
    await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
    const { drawings } = (await zhou.get(`/api/tasks/${taskId}/drawings`).expect(200)).body;
    expect(drawings).toMatchObject([
      { fileId: fileId.site, name: '总平面图.pdf', key: 'site_plan', pageCount: 3, selected: [1], customized: false },
      { fileId: fileId.evac, key: 'evacuation_plan', pageCount: 1, selected: [1] },
      { fileId: fileId.broken, key: 'fire_facility_plan', pageCount: null, selected: [] },
    ]);
    expect(drawings[2].error).toMatch(/打不开/);
  });

  it('缩略图：每页转一次，之后直接取；没有的页 404', async () => {
    const zhou = await as('zhou@test.cn');
    const url = `/api/tasks/${taskId}/drawings/${fileId.site}/pages/2/thumb`;
    const res = await zhou.get(url).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect((res.body as Buffer)[0]).toBe(0xff);
    await zhou.get(url).expect(200);
    const full = await zhou.get(`/api/tasks/${taskId}/drawings/${fileId.site}/pages/2/full`).buffer(true).parse(binary).expect(200);
    expect(full.headers['content-type']).toBe('image/png');
    const rows = await handle.db.select().from(drawingPages).where(eq(drawingPages.fileId, fileId.site));
    expect(rows.map((r) => r.page)).toEqual([2]);
    expect(rows[0]!.height).toBeGreaterThan(rows[0]!.width);
    await zhou.get(`/api/tasks/${taskId}/drawings/${fileId.site}/pages/4/thumb`).expect(404);
    await zhou.get(`/api/tasks/${taskId}/drawings/${fileId.foreign}/pages/1/thumb`).expect(404);
  });

  it('客户和其他专家看不到', async () => {
    await (await as('feiyu@test.cn')).get(`/api/tasks/${taskId}/drawings`).expect(404);
    await (await as('wu@test.cn')).get(`/api/tasks/${taskId}/drawings/${fileId.site}/pages/1/thumb`).expect(404);
  });

  it('专家勾选：只覆盖带上的文件；不在任务里的文件不收', async () => {
    const zhou = await as('zhou@test.cn');
    const { version } = (await zhou.get(`/api/tasks/${taskId}/workup`).expect(200)).body;
    await zhou
      .put(`/api/tasks/${taskId}/workup/figures`)
      .send({ version, drawings: { [fileId.foreign]: [1] } })
      .expect(400);
    await zhou
      .put(`/api/tasks/${taskId}/workup/figures`)
      .send({ version, drawings: { [fileId.site]: [3, 2, 3, 9] } })
      .expect(200);
    const { drawings } = (await zhou.get(`/api/tasks/${taskId}/drawings`).expect(200)).body;
    expect(drawings[0]).toMatchObject({ selected: [2, 3], customized: true });
    expect(drawings[1]).toMatchObject({ selected: [1], customized: false });

    // 疏散图一页都不放
    const v2 = (await zhou.get(`/api/tasks/${taskId}/workup`).expect(200)).body.version;
    await zhou.put(`/api/tasks/${taskId}/workup/figures`).send({ version: v2, drawings: { [fileId.evac]: [] } }).expect(200);
    const after = (await zhou.get(`/api/tasks/${taskId}/drawings`).expect(200)).body.drawings;
    expect(after.map((d: { selected: number[] }) => d.selected)).toEqual([[2, 3], [], []]);
  });

  it('确认生成时锁定选页；应急预案拿到这几页的高清图，另两份不取图', async () => {
    const { db } = handle;
    const [row] = await db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
    const data = complete(row!.snapshot);
    data.figures = { ...data.figures, drawings: row!.data.figures?.drawings };
    await db.update(taskWorkups).set({ data, version: row!.version + 1 }).where(eq(taskWorkups.taskId, taskId));

    const zhou = await as('zhou@test.cn');
    await zhou.post(`/api/tasks/${taskId}/generation`).send({ version: row!.version + 1 }).expect(201);
    await queue.idle();
    const plan = received.find((r) => r.kind === 'plan')!;
    expect(plan.input.drawings).toEqual([
      { key: 'site_plan', fileId: fileId.site, page: 2 },
      { key: 'site_plan', fileId: fileId.site, page: 3 },
    ]);
    const images = plan.drawings!.sitePlan!;
    expect(images.map((i) => [i.imageType, i.width > i.height])).toEqual([
      ['png', false],
      ['png', true],
    ]);
    expect(Object.keys(plan.drawings!)).toEqual(['sitePlan']);
    expect(received.filter((r) => r.kind !== 'plan').every((r) => r.drawings === undefined)).toBe(true);
  });
});
