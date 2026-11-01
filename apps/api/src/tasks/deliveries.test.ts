import type { TaskDeliveries } from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { deliveries, deliveryFiles, enterprises, generationBatches, memberships, organizations, tasks, taskWorkups, users } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { InProcessQueue } from '../generation/queue.ts';
import { simplePdf, type PdfConverter } from '../generation/word/preview-pdf.ts';
import { complete, testDocument } from './test-workup.ts';

// 客户成果文档（M2 第 16 项）：同组织客户能看、下载三份 Word 与整套压缩包、在线阅读发布时的 PDF；
// 别家客户、没负责这项任务的注安师一律 404；运营和负责注安师按原规则能看；多次交付按 V2、V1 列出
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
    return stored.get(key)!;
  },
  async downloadUrl(key) {
    return `/blob/${key}`;
  },
};
// 生成时只有应急预案带转好的 PDF：风险评估报告、应急资源调查报告不能在线阅读
const renderer: DraftRenderer = async (kind) => ({
  word: Buffer.from('word'),
  pdf: kind === 'plan' ? simplePdf(['plan']) : null,
  notes: [],
  document: testDocument(kind),
});
const converter: PdfConverter = async () => simplePdf(['preview']);

let orgId = '';
let otherOrgId = '';
let taskId = '';
let emptyTaskId = '';

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, other, internal] = await db
    .insert(organizations)
    .values([
      { name: '飞宇演示客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '别家客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  orgId = customer!.id;
  otherOrgId = other!.id;
  const uid: Record<string, string> = {};
  for (const p of [
    { email: 'feiyu@test.cn', name: '陈志刚', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'member@test.cn', name: '飞宇成员', orgId: customer!.id, role: 'customer_member' as const },
    { email: 'other@test.cn', name: '别家', orgId: other!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const ent0 = {
    orgId: customer!.id,
    legalRepresentative: '李文聪',
    registeredAddress: '惠州市仲恺高新区陈江街道正大路 17 号',
    profile: feiyuProfile,
    createdBy: uid['feiyu@test.cn']!,
  };
  const [ent, ent2] = await db
    .insert(enterprises)
    .values([
      { ...ent0, name: '惠阳飞宇电器有限公司', socialCreditCode: '91441300726483224B' },
      { ...ent0, name: '惠阳飞宇二厂', socialCreditCode: '91441300726483225X' },
    ])
    .returning();
  const [task, empty] = await db
    .insert(tasks)
    .values([
      {
        orgId: customer!.id,
        enterpriseId: ent!.id,
        businessType: 'emergency_plan',
        name: '2026 年应急预案',
        number: 'GY-2026-001',
        status: 'submitted',
        assignedExpertId: uid['zhou@test.cn']!,
        createdBy: uid['feiyu@test.cn']!,
      },
      {
        orgId: customer!.id,
        enterpriseId: ent2!.id,
        businessType: 'emergency_plan',
        name: '2027 年应急预案',
        number: 'GY-2026-002',
        status: 'preparing',
        createdBy: uid['feiyu@test.cn']!,
      },
    ])
    .returning();
  taskId = task!.id;
  emptyTaskId = empty!.id;

  app = await createApp(db, { loginLimitPerMinute: 1000, storage, queue, renderer, drafter: null, pdf: converter });
  await app.init();

  // 生成 → 三份核对 → 审核结论 → 发布交付 V1
  const zhou = await as('zhou@test.cn');
  await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
  const [row] = await db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
  await db
    .update(taskWorkups)
    .set({ data: complete(row!.snapshot), version: row!.version + 1 })
    .where(eq(taskWorkups.taskId, taskId));
  await zhou.post(`/api/tasks/${taskId}/generation`).send({ version: row!.version + 1 }).expect(201);
  await queue.idle();
  const batchId: string = (await zhou.get(`/api/tasks/${taskId}/drafts/plan/edit`).expect(200)).body.batchId;
  const versions = { plan: 0, risk: 0, resource: 0 };
  for (const kind of ['plan', 'risk', 'resource']) await zhou.put(`/api/tasks/${taskId}/drafts/${kind}/check`).send({ version: 0 }).expect(200);
  await zhou.post(`/api/tasks/${taskId}/draft-review`).send({ note: '三份已核对。', versions }).expect(201);
  const published = await zhou.post(`/api/tasks/${taskId}/publication`).send({ publishId: randomUUID(), batchId, versions }).expect(201);
  expect(published.body.attempt).toMatchObject({ status: 'done', version: 1 });
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

const base = () => `/api/tasks/${taskId}/deliveries`;

// supertest 收二进制
const binary = (r: { on: (event: string, fn: (chunk?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c) => chunks.push(c!));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('成果文档', () => {
  it('同组织客户：列表只有已交付的任务，三份 Word 都在，生成时带 PDF 的那份能在线阅读', async () => {
    const feiyu = await as('feiyu@test.cn');
    const list: TaskDeliveries[] = (await feiyu.get(`/api/orgs/${orgId}/deliveries`).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ taskId, taskNumber: 'GY-2026-001', enterpriseName: '惠阳飞宇电器有限公司' });
    expect(list[0]!.versions.map((v) => v.version)).toEqual([1]);
    const files = list[0]!.versions[0]!.files;
    expect(files.map((f) => [f.kind, f.name, f.readable])).toEqual([
      ['plan', '惠阳飞宇电器有限公司应急预案.docx', true],
      ['risk', '惠阳飞宇电器有限公司风险评估报告.docx', false],
      ['resource', '惠阳飞宇电器有限公司应急资源调查报告.docx', false],
    ]);

    // 单份下载：交付文件同组织客户可以取下载链接
    for (const f of files) expect((await feiyu.get(`/api/files/${f.fileId}/download-url`).expect(200)).body.url).toContain('/blob/');

    // 任务列表带最新交付版本
    const tasksList = (await feiyu.get(`/api/orgs/${orgId}/tasks`).expect(200)).body as { id: string; delivery: unknown }[];
    expect(tasksList.find((t) => t.id === taskId)!.delivery).toMatchObject({ version: 1 });
    expect(tasksList.find((t) => t.id === emptyTaskId)!.delivery).toBeNull();

    // 没交付的任务：详情为空，不报错
    expect((await feiyu.get(`/api/tasks/${emptyTaskId}/deliveries`).expect(200)).body.versions).toEqual([]);
  });

  it('整套下载：一个压缩包里正好三份 Word，文件名写企业和交付版本', async () => {
    const feiyu = await as('feiyu@test.cn');
    const res = await feiyu.get(`${base()}/1/bundle`).buffer(true).parse(binary as never).expect(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(decodeURIComponent(res.headers['content-disposition']!)).toContain('惠阳飞宇电器有限公司编制成果（交付 V1）.zip');
    const zip = await JSZip.loadAsync(res.body as Buffer);
    expect(Object.keys(zip.files).sort()).toEqual(
      ['惠阳飞宇电器有限公司应急预案.docx', '惠阳飞宇电器有限公司应急资源调查报告.docx', '惠阳飞宇电器有限公司风险评估报告.docx'].sort(),
    );
    // 压缩包里的就是交付的那份 Word
    const word = await zip.file('惠阳飞宇电器有限公司应急预案.docx')!.async('nodebuffer');
    expect((await JSZip.loadAsync(word)).file('word/document.xml')).not.toBeNull();
    await feiyu.get(`${base()}/9/bundle`).expect(404);
  });

  it('在线阅读：有 PDF 的返回 PDF，没有的提示下载 Word', async () => {
    const feiyu = await as('feiyu@test.cn');
    const res = await feiyu.get(`${base()}/1/plan/pdf`).buffer(true).parse(binary as never).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await feiyu.get(`${base()}/1/risk/pdf`).expect(404)).body.message).toContain('请下载 Word');
    await feiyu.get(`${base()}/1/nope/pdf`).expect(404);
    await feiyu.get(`${base()}/2/plan/pdf`).expect(404);
  });

  it('越权：别家客户、没负责的注安师一律 404；运营、负责注安师、同组织成员能看', async () => {
    for (const email of ['other@test.cn', 'wu@test.cn']) {
      const agent = await as(email);
      await agent.get(base()).expect(404);
      await agent.get(`${base()}/1/bundle`).expect(404);
      await agent.get(`${base()}/1/plan/pdf`).expect(404);
    }
    const other = await as('other@test.cn');
    await other.get(`/api/orgs/${orgId}/deliveries`).expect(404);
    // 别家客户看自己组织：没有成果
    expect((await other.get(`/api/orgs/${otherOrgId}/deliveries`).expect(200)).body).toEqual([]);
    // 别家客户拿到交付文件编号也下载不了
    const fileId = (await (await as('feiyu@test.cn')).get(base()).expect(200)).body.versions[0].files[0].fileId;
    await other.get(`/api/files/${fileId}/download-url`).expect(404);

    for (const email of ['ops@test.cn', 'zhou@test.cn', 'member@test.cn']) {
      const agent = await as(email);
      expect((await agent.get(base()).expect(200)).body.versions).toHaveLength(1);
      await agent.get(`${base()}/1/bundle`).expect(200);
    }
  });

  it('第二次交付：按 V2、V1 列出，V1 仍能单独下载', async () => {
    const { db } = handle;
    const [v1] = await db.select().from(deliveries).where(eq(deliveries.taskId, taskId));
    const v1Files = await db.select().from(deliveryFiles).where(eq(deliveryFiles.deliveryId, v1!.id));
    // 新的交付各自来自重新生成的一批（这里直接复制一批，不带草稿，所以 V2 不能在线阅读）
    const [{ id: _id, createdAt: _c, ...batch }] = (await db.select().from(generationBatches).where(eq(generationBatches.id, v1!.batchId))) as [
      typeof generationBatches.$inferSelect,
    ];
    const [b2, b3] = await db.insert(generationBatches).values([batch, batch]).returning();
    const [v2] = await db
      .insert(deliveries)
      .values({
        publishId: randomUUID(),
        taskId,
        batchId: b2!.id,
        version: 2,
        status: 'done',
        reviewedBy: v1!.reviewedBy,
        reviewedAt: v1!.reviewedAt,
        versions: v1!.versions,
        publishedBy: v1!.publishedBy,
        publishedAt: new Date(v1!.publishedAt!.getTime() + 60_000),
      })
      .returning();
    await db.insert(deliveryFiles).values(v1Files.map((f) => ({ deliveryId: v2!.id, kind: f.kind, fileId: f.fileId })));
    // 发布中的不算交付版本
    await db.insert(deliveries).values({
      publishId: randomUUID(),
      taskId,
      batchId: b3!.id,
      version: 3,
      status: 'publishing',
      reviewedBy: v1!.reviewedBy,
      reviewedAt: v1!.reviewedAt,
      versions: v1!.versions,
      publishedBy: v1!.publishedBy,
    });

    const feiyu = await as('feiyu@test.cn');
    const detail: TaskDeliveries = (await feiyu.get(base()).expect(200)).body;
    expect(detail.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(detail.versions[0]!.files.map((f) => f.readable)).toEqual([false, false, false]);
    expect(detail.versions[1]!.files[0]!.readable).toBe(true);
    await feiyu.get(`${base()}/1/bundle`).expect(200);
    await feiyu.get(`${base()}/3/bundle`).expect(404);
    const tasksList = (await feiyu.get(`/api/orgs/${orgId}/tasks`).expect(200)).body as { id: string; delivery: { version: number } }[];
    expect(tasksList.find((t) => t.id === taskId)!.delivery.version).toBe(2);
    await db.delete(deliveries).where(eq(deliveries.status, 'publishing'));
  });
});
