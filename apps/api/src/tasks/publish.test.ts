import { AI_ASSISTED_NOTE, type EditDocumentView, type PublishView, type ReviewView } from '@genyun/shared';
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
import { auditLogs, deliveries, deliveryFiles, enterprises, files, memberships, organizations, tasks, taskWorkups, users } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { InProcessQueue } from '../generation/queue.ts';
import { simplePdf, type PdfConverter } from '../generation/word/preview-pdf.ts';
import { complete, testDocument } from './test-workup.ts';

// 成果发布（M2 第 15 项）：审核结论有效才能发布、只有负责注安师能发布、同一次发布重发只算一次、
// 存储出错不形成交付可以重试、发布后任务已交付并提醒客户、正文只读、Word 文件属性写 AI 标识和审核人
const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const queue = new InProcessQueue();
const stored = new Map<string, Buffer>();
// failPuts > 0：接下来这么多次存文件失败（模拟发布时存储出错）
let failPuts = 0;
// hold：存文件停在这里，直到放行（让一次发布停在「正在发布」）
let hold: Promise<void> | null = null;
const storage: FileStorage = {
  async put(key, data) {
    if (hold) await hold;
    if (failPuts > 0) {
      failPuts--;
      throw new Error('storage unavailable');
    }
    stored.set(key, data);
  },
  async read(key) {
    return stored.get(key)!;
  },
  async downloadUrl(key) {
    return `/blob/${key}`;
  },
};
const renderer: DraftRenderer = async (kind) => ({
  word: Buffer.from('word'),
  pdf: null,
  notes: [],
  document: testDocument(kind),
});
// 转 PDF：记下转了几次；failNext 让下一次失败
const converted: number[] = [];
let failNext = false;
const converter: PdfConverter = async (docx) => {
  if (failNext) {
    failNext = false;
    throw new Error('soffice exited with code 1');
  }
  converted.push(docx.length);
  return simplePdf([`copy ${converted.length}`]);
};

let taskId = '';
let batchId = '';

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, other, internal] = await db
    .insert(organizations)
    .values([
      {
        name: '飞宇演示客户',
        kind: 'customer',
        contractStartsAt: '2026-01-01',
        contractEndsAt: '2099-12-31',
      },
      {
        name: '别家客户',
        kind: 'customer',
        contractStartsAt: '2026-01-01',
        contractEndsAt: '2099-12-31',
      },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  const uid: Record<string, string> = {};
  for (const p of [
    {
      email: 'feiyu@test.cn',
      name: '陈志刚',
      orgId: customer!.id,
      role: 'customer_admin' as const,
    },
    {
      email: 'other@test.cn',
      name: '别家',
      orgId: other!.id,
      role: 'customer_admin' as const,
    },
    {
      email: 'zhou@test.cn',
      name: '周工',
      orgId: internal!.id,
      role: 'expert' as const,
    },
    {
      email: 'wu@test.cn',
      name: '吴工',
      orgId: internal!.id,
      role: 'expert' as const,
    },
    {
      email: 'ops@test.cn',
      name: '运营',
      orgId: internal!.id,
      role: 'operator' as const,
    },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const [ent] = await db
    .insert(enterprises)
    .values({
      orgId: customer!.id,
      name: '惠阳飞宇电器有限公司',
      socialCreditCode: '91441300726483224B',
      legalRepresentative: '李文聪',
      registeredAddress: '惠州市仲恺高新区陈江街道正大路 17 号',
      profile: feiyuProfile,
      createdBy: uid['feiyu@test.cn']!,
    })
    .returning();
  const [task] = await db
    .insert(tasks)
    .values({
      orgId: customer!.id,
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

  app = await createApp(db, {
    loginLimitPerMinute: 1000,
    storage,
    queue,
    renderer,
    drafter: null,
    pdf: converter,
  });
  await app.init();

  const zhou = await as('zhou@test.cn');
  // 还没生成草稿时不能核对
  await zhou.get(`/api/tasks/${taskId}/draft-review`).expect(400);
  await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
  const [row] = await db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
  await db
    .update(taskWorkups)
    .set({ data: complete(row!.snapshot), version: row!.version + 1 })
    .where(eq(taskWorkups.taskId, taskId));
  await zhou
    .post(`/api/tasks/${taskId}/generation`)
    .send({ version: row!.version + 1 })
    .expect(201);
  await queue.idle();
  batchId = (await zhou.get(`/api/tasks/${taskId}/drafts/plan/edit`).expect(200)).body.batchId;
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

const publishUrl = () => `/api/tasks/${taskId}/publication`;
const reviewUrl = () => `/api/tasks/${taskId}/draft-review`;
const url = (kind: string, rest = '') => `/api/tasks/${taskId}/drafts/${kind}${rest}`;
const VERSIONS = { plan: 0, risk: 0, resource: 0 };
const body = (publishId: string = randomUUID(), versions = VERSIONS) => ({ publishId, batchId, versions });

describe('发布', () => {
  it('审核结论确认前不能发布；运营只能看，别的注安师、客户都不能发布', async () => {
    const zhou = await as('zhou@test.cn');
    const view: PublishView = (await zhou.get(publishUrl()).expect(200)).body;
    expect(view).toMatchObject({ batchId, canPublish: false, editable: true, nextVersion: 1, attempt: null, deliveries: [] });
    expect(view.blocker).toContain('确认审核结论后才能发布');
    expect(view.docs.map((d) => d.name)).toEqual([
      '惠阳飞宇电器有限公司应急预案.docx',
      '惠阳飞宇电器有限公司风险评估报告.docx',
      '惠阳飞宇电器有限公司应急资源调查报告.docx',
    ]);
    const early = (await zhou.post(publishUrl()).send(body()).expect(409)).body;
    expect(early.reason).toBe('review_invalid');

    for (const kind of ['plan', 'risk', 'resource']) await zhou.put(url(kind, '/check')).send({ version: 0 }).expect(200);
    await zhou.post(reviewUrl()).send({ note: '三份已核对。', versions: VERSIONS }).expect(201);
    const ready: PublishView = (await zhou.get(publishUrl()).expect(200)).body;
    expect(ready).toMatchObject({ canPublish: true, blocker: null, review: { byName: '周工', valid: true } });

    // 越权：运营能看不能发；别的注安师、别家客户、本组织客户都当作不存在
    const ops = await as('ops@test.cn');
    expect((await ops.get(publishUrl()).expect(200)).body).toMatchObject({ editable: false, canPublish: false });
    await ops.post(publishUrl()).send(body()).expect(403);
    for (const email of ['wu@test.cn', 'other@test.cn', 'feiyu@test.cn']) {
      const agent = await as(email);
      await agent.get(publishUrl()).expect(404);
      await agent.post(publishUrl()).send(body()).expect(404);
    }
    expect(await handle.db.select().from(deliveries)).toHaveLength(0);
    // 页面看到的修订次数、批次不对：拒绝
    expect((await zhou.post(publishUrl()).send(body(randomUUID(), { ...VERSIONS, plan: 1 })).expect(409)).body.reason).toBe('stale');
    expect((await zhou.post(publishUrl()).send({ ...body(), batchId: randomUUID() }).expect(409)).body.reason).toBe('regenerated');
    await zhou.post(publishUrl()).send({ publishId: 'x', batchId, versions: VERSIONS }).expect(400);
  });

  it('存储出错：不形成交付、任务没交付，换一次发布重试仍是 V1', async () => {
    const zhou = await as('zhou@test.cn');
    failPuts = 1;
    const failedId = randomUUID();
    const failed: PublishView = (await zhou.post(publishUrl()).send(body(failedId)).expect(201)).body;
    expect(failed.attempt).toMatchObject({ publishId: failedId, status: 'failed', version: 1 });
    expect(failed.attempt!.error).toContain('没有形成交付');
    expect(failed).toMatchObject({ canPublish: true, deliveries: [] });
    const [task] = await handle.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task!.closedAt).toBeNull();
    // 查询这一次：还是失败
    expect((await zhou.get(`${publishUrl()}?publishId=${failedId}`).expect(200)).body.attempt.status).toBe('failed');
  });

  it('正常发布形成交付 V1：任务已交付、客户收到站内提醒、Word 文件属性写 AI 标识和审核人', async () => {
    const zhou = await as('zhou@test.cn');
    // 后台从没收到过的一次：查询结果为空，页面据此判断可以重新发布
    const unknown: PublishView = (await zhou.get(`${publishUrl()}?publishId=${randomUUID()}`).expect(200)).body;
    expect(unknown.attempt).toBeNull();

    // 两次不同的发布同时进来：先到的停在「正在发布」，后到的撞上「同一任务只有一次在发布」，答复 409 而不是出错
    const publishId = randomUUID();
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    const first = zhou.post(publishUrl()).send(body(publishId)).then((r) => r);
    for (let i = 0; i < 100; i++) {
      if ((await handle.db.select().from(deliveries).where(eq(deliveries.status, 'publishing'))).length > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const second = await zhou.post(publishUrl()).send(body());
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('publishing');
    expect(second.body.message).toContain('正在发布');
    // 正在发布时也不能改正文
    const sectionNow = (await zhou.get(url('plan', '/sections/ch1.1')).expect(200)).body;
    await zhou
      .put(url('plan', '/sections/ch1.1'))
      .send({ saveId: randomUUID(), batchId, baseRev: sectionNow.rev, blocks: [{ type: 'paragraph', text: ['发布中再改。'] }], note: '更正' })
      .expect(409);
    hold = null;
    release();
    const firstRes = await first;
    expect(firstRes.status).toBe(201);
    const done: PublishView = firstRes.body;
    expect(done.attempt).toMatchObject({ publishId, status: 'done', version: 1, byName: '周工' });
    expect(done.deliveries).toHaveLength(1);
    expect(done.deliveries[0]).toMatchObject({ version: 1, byName: '周工' });
    expect(done.deliveries[0]!.files.map((f) => f.kind)).toEqual(['plan', 'risk', 'resource']);
    expect(done).toMatchObject({ canPublish: false, nextVersion: 2 });
    expect(done.blocker).toContain('已发布为交付 V1');

    const [task] = await handle.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task!.closedAt).not.toBeNull();

    // 定稿文件：kind = delivery，文件属性里有 AI 标识和审核人
    const words = await handle.db.select().from(files).where(eq(files.kind, 'delivery'));
    expect(words).toHaveLength(3);
    const plan = words.find((w) => w.originalName.endsWith('应急预案.docx'))!;
    const zip = await JSZip.loadAsync(stored.get(plan.storageKey)!);
    const core = await zip.file('docProps/core.xml')!.async('string');
    expect(core).toContain(AI_ASSISTED_NOTE);
    expect(core).toContain('周工');
    expect(core).toContain('交付 V1');
    const custom = await zip.file('docProps/custom.xml')!.async('string');
    expect(custom).toContain('审核人');

    // 客户：站内提醒，不带注安师电话
    const feiyu = await as('feiyu@test.cn');
    const notes = (await feiyu.get('/api/notifications').expect(200)).body.items as { title: string; body: string; link: string }[];
    const note = notes.find((n) => n.title.includes('成果已交付'))!;
    expect(note.body).toContain('交付 V1');
    expect(note.link).toBe(`/customer/tasks/${taskId}`);
    expect(note.body).not.toMatch(/1[3-9]\d{9}/);
    // 交付的 Word 本组织客户能取，别家客户不能
    await feiyu.get(`/api/files/${plan.id}`).expect(200);
    await (await as('other@test.cn')).get(`/api/files/${plan.id}`).expect(404);
    // 负责注安师能看、能下载交付文件；别的注安师当作不存在
    expect((await handle.db.select().from(deliveryFiles)).map((f) => f.fileId)).toContain(plan.id);
    await zhou.get(`/api/files/${plan.id}`).expect(200);
    expect((await zhou.get(`/api/files/${plan.id}/download-url`).expect(200)).body.url).toBeTruthy();
    const wu = await as('wu@test.cn');
    await wu.get(`/api/files/${plan.id}`).expect(404);
    await wu.get(`/api/files/${plan.id}/download-url`).expect(404);
  });

  it('同一次发布重发只返回那一次，不产生第二个版本；换一次发布也不能重复发布这批文稿', async () => {
    const zhou = await as('zhou@test.cn');
    const [first] = await handle.db.select().from(deliveries).where(eq(deliveries.status, 'done'));
    const again: PublishView = (await zhou.post(publishUrl()).send(body(first!.publishId)).expect(201)).body;
    expect(again.attempt).toMatchObject({ publishId: first!.publishId, status: 'done', version: 1 });
    const other = (await zhou.post(publishUrl()).send(body()).expect(409)).body;
    expect(other.reason).toBe('already_published');
    // 这个 publishId 属于别的任务：拒绝，不当成本任务的那一次
    const [otherTask] = await handle.db
      .insert(tasks)
      .values({ ...(await handle.db.select().from(tasks).where(eq(tasks.id, taskId)))[0]!, id: undefined, number: 'GY-2026-002', name: '另一个任务', closedAt: null })
      .returning();
    const cross = (await zhou.post(`/api/tasks/${otherTask!.id}/publication`).send(body(first!.publishId)).expect(409)).body;
    expect(cross.reason).toBe('other_task');
    // 同一个 publishId 两个请求同时到
    await Promise.all([zhou.post(publishUrl()).send(body(first!.publishId)), zhou.post(publishUrl()).send(body(first!.publishId))]);
    const all = await handle.db.select().from(deliveries).where(eq(deliveries.taskId, taskId));
    expect(all.filter((d) => d.status === 'done')).toHaveLength(1);
    expect(await handle.db.select().from(files).where(eq(files.kind, 'delivery'))).toHaveLength(3);
    // 操作日志：只有形成交付的那一次记「发布」；存储失败的、重发的、被拒绝的都不记
    const logged = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'publish'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorEmail: 'zhou@test.cn', target: 'GY-2026-001 · 交付 V1' });
    expect(logged[0]!.ip).toBeTruthy();
  });

  it('发布后正文只读：不能保存修订、不能再核对', async () => {
    const zhou = await as('zhou@test.cn');
    const edit: EditDocumentView = (await zhou.get(url('plan', '/edit')).expect(200)).body;
    expect(edit).toMatchObject({ editable: false, published: { version: 1 } });
    const section = (await zhou.get(url('plan', '/sections/ch1.1')).expect(200)).body;
    const saved = (
      await zhou
        .put(url('plan', '/sections/ch1.1'))
        .send({ saveId: randomUUID(), batchId, baseRev: section.rev, blocks: [{ type: 'paragraph', text: ['发布后再改。'] }], note: '更正' })
        .expect(409)
    ).body;
    expect(saved.message).toContain('已发布为交付 V1');
    await zhou.put(url('plan', '/check')).send({ version: 0 }).expect(409);
    // AI 改写、再确认审核结论也被拦下
    const rewrite = (await zhou.post(url('plan', '/sections/ch1.1/rewrite')).send({ text: '一段需要改写的文字。' }).expect(409)).body;
    expect(rewrite.message).toContain('已发布为交付 V1');
    const conclude = (await zhou.post(reviewUrl()).send({ note: '再确认一次。', versions: VERSIONS }).expect(409)).body;
    expect(conclude.message).toContain('已发布为交付 V1');
    const review: ReviewView = (await zhou.get(reviewUrl()).expect(200)).body;
    expect(review).toMatchObject({ editable: false, published: { version: 1 } });
  });
});
