import { AI_ASSISTED_NOTE, type EditDocumentView, type HistoryEntry, type PublishView, type ReviewView } from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { grantCredits } from '../credits/test-credits.ts';
import { MemoryMailer } from '../mail/mailer.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  auditLogs,
  creditEntries,
  deliveries,
  deliveryFiles,
  enterprises,
  files,
  memberships,
  organizations,
  taskReopens,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { InProcessQueue } from '../generation/queue.ts';
import { simplePdf, type PdfConverter } from '../generation/word/preview-pdf.ts';
import { completeFor, testDocument } from './test-workup.ts';

// 成果发布（M2 第 15 项）：审核结论有效才能发布、只有负责专家能发布、同一次发布重发只算一次、
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
const mailer = new MemoryMailer();
const uids: Record<string, string> = {};
const uid = (email: string) => uids[email]!;

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
  const uid = uids;
  for (const p of [
    {
      email: 'feiyu@test.cn',
      name: '陈志刚',
      orgId: customer!.id,
      role: 'customer_admin' as const,
    },
    {
      email: 'li@test.cn',
      name: '李明',
      orgId: customer!.id,
      role: 'customer_member' as const,
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
  // 编制次数（K14）：首次交付要扣 1 次，没有次数时成果会先锁住
  await grantCredits(db, customer!.id, uid['ops@test.cn']!, { purchase: 20 });

  app = await createApp(db, {
    mailer,
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
    .set({ data: await completeFor(db, taskId, row!.snapshot, storage), version: row!.version + 1 })
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
  it('审核结论确认前不能发布；运营只能看，别的专家、客户都不能发布', async () => {
    const zhou = await as('zhou@test.cn');
    const view: PublishView = (await zhou.get(publishUrl()).expect(200)).body;
    expect(view).toMatchObject({ batchId, canPublish: false, editable: true, nextVersion: 1, attempt: null, deliveries: [] });
    expect(view.blocker).toContain('确认审核结论后才能交付');
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

    // 越权：运营能看不能发；别的专家、别家客户、本组织客户都当作不存在
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

  it('正常交付：任务已交付、客户收到站内提醒、Word 文件属性写 AI 标识和审核人', async () => {
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
    expect(second.body.message).toContain('正在交付');
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
    expect(done.blocker).toBe('这个任务已经交付');

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
    expect(core).not.toMatch(/V\d/);
    const custom = await zip.file('docProps/custom.xml')!.async('string');
    expect(custom).toContain('审核人');
    expect(custom).toContain('交付日期');
    expect(custom).toMatch(/\d{4} 年 \d{1,2} 月 \d{1,2} 日/);
    expect(custom).not.toContain('交付版本');

    // 客户：站内提醒，不带专家电话
    const feiyu = await as('feiyu@test.cn');
    const notes = (await feiyu.get('/api/notifications').expect(200)).body.items as { title: string; body: string; link: string }[];
    const note = notes.find((n) => n.title.includes('成果已交付'))!;
    expect(note.title).toBe('惠阳飞宇电器有限公司的成果已交付');
    expect(note.body).toBe('应急预案、风险评估报告、应急资源调查报告已交付，可在成果文档里查看和下载。');
    expect(note.link).toBe(`/customer/documents/${taskId}`);
    expect(note.body).not.toMatch(/1[3-9]\d{9}/);
    // 交付的 Word 本组织客户能取，别家客户不能
    await feiyu.get(`/api/files/${plan.id}`).expect(200);
    await (await as('other@test.cn')).get(`/api/files/${plan.id}`).expect(404);
    // 负责专家能看、能下载交付文件；别的专家当作不存在
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
    expect(logged[0]).toMatchObject({ actorEmail: 'zhou@test.cn', target: 'GY-2026-001 · 第 1 次交付' });
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
    expect(saved.message).toBe('这个任务已交付。要修改，请先点「重新打开」');
    await zhou.put(url('plan', '/check')).send({ version: 0 }).expect(409);
    // AI 改写、再确认审核结论也被拦下
    const rewrite = (await zhou.post(url('plan', '/sections/ch1.1/rewrite')).send({ text: '一段需要改写的文字。' }).expect(409)).body;
    expect(rewrite.message).toBe('这个任务已交付。要修改，请先点「重新打开」');
    const conclude = (await zhou.post(reviewUrl()).send({ note: '再确认一次。', versions: VERSIONS }).expect(409)).body;
    expect(conclude.message).toBe('这个任务已交付。要修改，请先点「重新打开」');
    const review: ReviewView = (await zhou.get(reviewUrl()).expect(200)).body;
    expect(review).toMatchObject({ editable: false, published: { version: 1 } });
  });

});

// 重新打开和再次交付（K13，15 页 R11–R15）：接着上面已交付的第 1 次往下走
describe('重新打开和再次交付', () => {
  const reopenUrl = () => `/api/tasks/${taskId}/reopen`;
  const DELIVERED = '这个任务已交付。要修改，请先点「重新打开」';
  const deductionsOf = () => handle.db.select().from(creditEntries).where(and(eq(creditEntries.taskId, taskId), eq(creditEntries.type, 'delivery_deduction')));
  const mailsOf = (kind: string) => mailer.sent.filter((m) => m.kind === kind);
  // 三份都核对、写结论
  async function checkAll(agent: request.Agent, versions: Record<string, number>, note = '三份已重新核对。') {
    for (const kind of ['plan', 'risk', 'resource']) await agent.put(url(kind, '/check')).send({ version: versions[kind] }).expect(200);
    await agent.post(reviewUrl()).send({ note, versions }).expect(201);
  }
  async function save(agent: request.Agent, text: string) {
    const section = (await agent.get(url('plan', '/sections/ch1.1')).expect(200)).body;
    await agent
      .put(url('plan', '/sections/ch1.1'))
      .send({ saveId: randomUUID(), batchId, baseRev: section.rev, blocks: [{ type: 'paragraph', text: [text] }], note: '更正' })
      .expect(200);
  }

  it('首次交付：组织管理员又是提交人，只发一封邮件一；扣 1 次', async () => {
    const one = mailsOf('delivery_done');
    expect(one.map((m) => m.to)).toEqual(['feiyu@test.cn']);
    expect(one[0]!.subject).toBe('【耕云】惠阳飞宇电器有限公司的应急预案已编制完成，请登录下载');
    expect(await deductionsOf()).toHaveLength(1);
    const [v1] = await handle.db.select().from(deliveries).where(and(eq(deliveries.taskId, taskId), eq(deliveries.version, 1), eq(deliveries.status, 'done')));
    expect(v1!.updateNote).toBeNull();
    const view: PublishView = (await (await as('zhou@test.cn')).get(publishUrl()).expect(200)).body;
    expect(view.delivered).toMatchObject({ version: 1, reviewerName: '周工', note: '三份已核对。' });
    expect(view.delivered!.files.map((f) => f.kind)).toEqual(['plan', 'risk', 'resource']);
  });

  it('已交付没重新打开：资料核对、生成初稿的写接口 409，GET 照常；看不了的账号 404', async () => {
    const zhou = await as('zhou@test.cn');
    const facts = (await zhou.put(`/api/tasks/${taskId}/workup/facts`).send({}).expect(409)).body;
    expect(facts).toMatchObject({ code: 'delivered', reason: 'delivered', message: DELIVERED });
    expect((await zhou.post(`/api/tasks/${taskId}/generation`).send({ version: 1 }).expect(409)).body.reason).toBe('delivered');
    expect((await zhou.post(`/api/tasks/${taskId}/generation/retry`).send({}).expect(409)).body.reason).toBe('delivered');
    await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
    await zhou.get(`/api/tasks/${taskId}/generation`).expect(200);
    for (const email of ['wu@test.cn', 'other@test.cn', 'feiyu@test.cn']) {
      await (await as(email)).put(`/api/tasks/${taskId}/workup/facts`).send({}).expect(404);
    }
  });

  it('重新打开：只有负责专家能开；没交付、正在交付拒绝；两个同时到只成功一个', async () => {
    const zhou = await as('zhou@test.cn');
    await (await as('ops@test.cn')).post(reopenUrl()).send({}).expect(403);
    for (const email of ['wu@test.cn', 'other@test.cn', 'feiyu@test.cn']) await (await as(email)).post(reopenUrl()).send({}).expect(404);
    // 没交付过的任务
    const [cur] = await handle.db.select().from(tasks).where(eq(tasks.id, taskId));
    const [ent2] = await handle.db
      .insert(enterprises)
      .values({ orgId: cur!.orgId, name: '飞宇二厂', socialCreditCode: '91441300726483225B', legalRepresentative: '李文聪', registeredAddress: '惠州市', profile: feiyuProfile, createdBy: uid('feiyu@test.cn') })
      .returning();
    const [fresh] = await handle.db
      .insert(tasks)
      .values({ orgId: cur!.orgId, enterpriseId: ent2!.id, businessType: 'emergency_plan', name: '2027 年应急预案', number: 'GY-2026-901', status: 'submitted', assignedExpertId: uid('zhou@test.cn'), createdBy: uid('feiyu@test.cn') })
      .returning();
    expect((await zhou.post(`/api/tasks/${fresh!.id}/reopen`).send({}).expect(409)).body.reason).toBe('not_delivered');
    // 正在交付
    const [v1] = await handle.db.select().from(deliveries).where(and(eq(deliveries.taskId, taskId), eq(deliveries.version, 1), eq(deliveries.status, 'done')));
    const { id: _id, createdAt: _c, updatedAt: _u, publishedAt: _p, ...rest } = v1!;
    const [busy] = await handle.db.insert(deliveries).values({ ...rest, publishId: randomUUID(), version: 99, status: 'publishing' }).returning();
    expect((await zhou.post(reopenUrl()).send({}).expect(409)).body.reason).toBe('publishing');
    await handle.db.delete(deliveries).where(eq(deliveries.id, busy!.id));

    const [before] = await handle.db.select().from(tasks).where(eq(tasks.id, taskId));
    const results = await Promise.all([zhou.post(reopenUrl()).send({}), zhou.post(reopenUrl()).send({})]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.reason).toBe('already_reopened');
    expect((await zhou.post(reopenUrl()).send({}).expect(409)).body.reason).toBe('already_reopened');
    expect(await handle.db.select().from(taskReopens).where(eq(taskReopens.taskId, taskId))).toHaveLength(1);
    const [after] = await handle.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(after!.reopenedAt).not.toBeNull();
    expect(after!.closedAt?.getTime()).toBe(before!.closedAt!.getTime());
    // 不扣次数、不发邮件；操作日志一条
    expect(await deductionsOf()).toHaveLength(1);
    expect(mailer.sent.filter((m) => m.kind?.startsWith('delivery'))).toHaveLength(1);
    const logged = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'reopen'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorEmail: 'zhou@test.cn', target: 'GY-2026-001 · 重新打开' });
    const history = (await zhou.get(`/api/tasks/${taskId}/history`).expect(200)).body as HistoryEntry[];
    expect(history.filter((h) => h.what === '重新打开')).toEqual([expect.objectContaining({ who: '周工' })]);
  });

  it('重新打开以后：守卫放行；正在交付时 409；核对和结论作废，previousNote 是原来那句；最近一次尝试只取重新打开之后的', async () => {
    const zhou = await as('zhou@test.cn');
    const facts = await zhou.put(`/api/tasks/${taskId}/workup/facts`).send({});
    expect(facts.status).not.toBe(409);
    // 正在交付：守卫回 publishing
    const [v1] = await handle.db.select().from(deliveries).where(and(eq(deliveries.taskId, taskId), eq(deliveries.version, 1), eq(deliveries.status, 'done')));
    const { id: _id, createdAt: _c, updatedAt: _u, publishedAt: _p, ...rest } = v1!;
    const [busy] = await handle.db.insert(deliveries).values({ ...rest, publishId: randomUUID(), version: 99, status: 'publishing' }).returning();
    expect((await zhou.put(`/api/tasks/${taskId}/workup/facts`).send({}).expect(409)).body.reason).toBe('publishing');
    await handle.db.delete(deliveries).where(eq(deliveries.id, busy!.id));

    const review: ReviewView = (await zhou.get(reviewUrl()).expect(200)).body;
    expect(review).toMatchObject({ editable: true, published: null, review: null, previousNote: '三份已核对。' });
    expect(review.docs.map((d) => d.check)).toEqual([null, null, null]);
    expect(review.reopened).toMatchObject({ deliveredAt: v1!.publishedAt!.toISOString(), edits: [] });
    const view: PublishView = (await zhou.get(publishUrl()).expect(200)).body;
    expect(view).toMatchObject({ attempt: null, delivered: null, canPublish: false });
    // 没重新核对就交付：结论无效
    expect((await zhou.post(publishUrl()).send(body()).expect(409)).body.reason).toBe('review_invalid');
  });

  it('再次交付：同一批改过正文、重新核对后交付，版本 +1；更新说明去空格；邮件二发给管理员和提交人；不再扣次数', async () => {
    const zhou = await as('zhou@test.cn');
    // 提交人换成本组织另一个成员：邮件二管理员和提交人各一封
    await handle.db.update(tasks).set({ createdBy: uid('li@test.cn') }).where(eq(tasks.id, taskId));
    await save(zhou, '交付后改过的编制目的。');
    const versions = { plan: 1, risk: 0, resource: 0 };
    await checkAll(zhou, versions);
    const review: ReviewView = (await zhou.get(reviewUrl()).expect(200)).body;
    expect(review.reopened!.suggestedNote).toBe('编制目的');
    // 更新说明超过 40 个字：400
    await zhou.post(publishUrl()).send({ ...body(randomUUID(), versions), updateNote: '字'.repeat(41) }).expect(400);
    const sent = mailer.sent.length;
    const done: PublishView = (await zhou.post(publishUrl()).send({ ...body(randomUUID(), versions), updateNote: '  值班电话、编制目的  ' }).expect(201)).body;
    expect(done.attempt).toMatchObject({ status: 'done', version: 2 });
    expect(done.delivered).toMatchObject({ version: 2 });
    const [v2] = await handle.db.select().from(deliveries).where(and(eq(deliveries.taskId, taskId), eq(deliveries.version, 2)));
    expect(v2!.updateNote).toBe('值班电话、编制目的');
    expect(await deductionsOf()).toHaveLength(1);

    const two = mailer.sent.slice(sent).filter((m) => m.kind === 'delivery_updated');
    expect(two.map((m) => m.to).sort()).toEqual(['feiyu@test.cn', 'li@test.cn']);
    expect(two[0]!.subject).toBe('【耕云】惠阳飞宇电器有限公司的应急预案已更新，请登录下载');
    expect(two[0]!.text).toMatch(/\d{1,2} 月 \d{1,2} 日更新：值班电话、编制目的/);
    const bells = (await (await as('feiyu@test.cn')).get('/api/notifications').expect(200)).body.items as { title: string }[];
    expect(bells.map((b) => b.title)).toContain('惠阳飞宇电器有限公司的成果已更新');
    // 处理记录：再次交付那条带更新说明
    const history = (await zhou.get(`/api/tasks/${taskId}/history`).expect(200)).body as HistoryEntry[];
    const delivered = history.filter((h) => h.what === '定稿并交付');
    expect(delivered.map((h) => h.extra).sort()).toEqual([null, '值班电话、编制目的'].sort());
    // 没重新打开不能再交付
    await zhou.post(publishUrl()).send(body(randomUUID(), versions)).expect(409);
    await zhou.put(`/api/tasks/${taskId}/workup/facts`).send({}).expect(409);
  });

  it('客户只看最新一版：旧版的文件和压缩包客户 404，专家、运营能拿', async () => {
    const files1 = await handle.db
      .select({ fileId: deliveryFiles.fileId, version: deliveries.version })
      .from(deliveryFiles)
      .innerJoin(deliveries, eq(deliveries.id, deliveryFiles.deliveryId))
      .where(eq(deliveries.taskId, taskId));
    const old = files1.find((f) => f.version === 1)!.fileId;
    const latest = files1.find((f) => f.version === 2)!.fileId;
    const feiyu = await as('feiyu@test.cn');
    await feiyu.get(`/api/files/${old}`).expect(404);
    await feiyu.get(`/api/files/${old}/download-url`).expect(404);
    await feiyu.get(`/api/tasks/${taskId}/deliveries/1/bundle`).expect(404);
    await feiyu.get(`/api/files/${latest}/download-url`).expect(200);
    await feiyu.get(`/api/tasks/${taskId}/deliveries/2/bundle`).expect(200);
    for (const email of ['zhou@test.cn', 'ops@test.cn']) {
      const agent = await as(email);
      await agent.get(`/api/files/${old}/download-url`).expect(200);
      await agent.get(`/api/tasks/${taskId}/deliveries/1/bundle`).expect(200);
    }
  });

  it('上一版改过的节：只取交付时那一版的修订，每节一条；之后再改不影响', async () => {
    const zhou = await as('zhou@test.cn');
    await zhou.post(reopenUrl()).send({}).expect(201);
    await save(zhou, '第二次重新打开以后又改的。');
    const review: ReviewView = (await zhou.get(reviewUrl()).expect(200)).body;
    expect(review.reopened!.edits).toEqual([{ kind: 'plan', sectionId: 'ch1.1', title: '1.1 编制目的', text: '交付后改过的编制目的。' }]);
    expect(review.previousNote).toBe('三份已重新核对。');
  });

  it('重新打开以后重新生成，新一批交付成功；更新说明留空存 null，邮件二不带那一行', async () => {
    const zhou = await as('zhou@test.cn');
    const workup = (await zhou.get(`/api/tasks/${taskId}/workup`).expect(200)).body as { version: number };
    await zhou.post(`/api/tasks/${taskId}/generation`).send({ version: workup.version }).expect(201);
    await queue.idle();
    const newBatch: string = (await zhou.get(url('plan', '/edit')).expect(200)).body.batchId;
    expect(newBatch).not.toBe(batchId);
    // 旧批次已作废：用旧批次交付被拒
    expect((await zhou.post(publishUrl()).send(body()).expect(409)).body.reason).toBe('regenerated');
    batchId = newBatch;
    await checkAll(zhou, VERSIONS);
    const sent = mailer.sent.length;
    const done: PublishView = (await zhou.post(publishUrl()).send({ ...body(), updateNote: '   ' }).expect(201)).body;
    expect(done.attempt).toMatchObject({ status: 'done', version: 3 });
    const [v3] = await handle.db.select().from(deliveries).where(and(eq(deliveries.taskId, taskId), eq(deliveries.version, 3)));
    expect(v3!.updateNote).toBeNull();
    const mails = mailer.sent.slice(sent);
    expect(mails.map((m) => m.kind)).toEqual(['delivery_updated', 'delivery_updated']);
    expect(mails[0]!.text).not.toContain('这次更新');
    expect(await deductionsOf()).toHaveLength(1);
  });
});
