import { reviewValid, type ReviewView } from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, memberships, organizations, tasks, taskWorkups, users } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { InProcessQueue } from '../generation/queue.ts';
import { simplePdf, type PdfConverter } from '../generation/word/preview-pdf.ts';
import { complete, testDocument } from './test-workup.ts';

// Word 校对与审核结论（M2 第 12 项）：逐份核对、改正文后该份回到待核对、三份核对完才能确认结论、
// 当前稿转 PDF 给校对页看、越权
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

const reviewUrl = () => `/api/tasks/${taskId}/draft-review`;
const url = (kind: string, rest = '') => `/api/tasks/${taskId}/drafts/${kind}${rest}`;
const doc = (view: ReviewView, kind: string) => view.docs.find((d) => d.kind === kind)!;

async function saveSection(agent: request.Agent, kind: string, text: string) {
  const section = (await agent.get(url(kind, '/sections/ch1.1')).expect(200)).body;
  return (
    await agent
      .put(url(kind, '/sections/ch1.1'))
      .send({
        saveId: randomUUID(),
        batchId,
        baseRev: section.rev,
        blocks: [{ type: 'paragraph', text: [text] }],
        note: '更正措辞',
      })
      .expect(200)
  ).body;
}

describe('逐份核对', () => {
  it('三份都待核对；只有负责专家能核对，运营只能看，别人看不到', async () => {
    const zhou = await as('zhou@test.cn');
    const view: ReviewView = (await zhou.get(reviewUrl()).expect(200)).body;
    expect(view).toMatchObject({ batchId, review: null, editable: true });
    expect(view.docs.map((d) => [d.kind, d.version, d.check])).toEqual([
      ['plan', 0, null],
      ['risk', 0, null],
      ['resource', 0, null],
    ]);
    // 没改过的稿，保存时间是生成完成的时间
    expect(doc(view, 'plan').savedAt).toEqual(expect.any(String));

    const ops = await as('ops@test.cn');
    expect((await ops.get(reviewUrl()).expect(200)).body.editable).toBe(false);
    await ops.put(url('plan', '/check')).send({ version: 0 }).expect(403);
    for (const email of ['wu@test.cn', 'feiyu@test.cn', 'other@test.cn']) {
      const agent = await as(email);
      await agent.get(reviewUrl()).expect(404);
      await agent.put(url('plan', '/check')).send({ version: 0 }).expect(404);
    }
    await zhou.put(url('nope', '/check')).send({ version: 0 }).expect(404);
    await zhou.put(url('plan', '/check')).send({ version: -1 }).expect(400);
  });

  it('核对完一份后改正文，该份回到待核对；核对时页面上的稿已过时就拒绝', async () => {
    const zhou = await as('zhou@test.cn');
    const checked: ReviewView = (await zhou.put(url('plan', '/check')).send({ version: 0 }).expect(200)).body;
    expect(doc(checked, 'plan').check).toMatchObject({
      byName: '周工',
      version: 0,
    });

    const saved = await saveSection(zhou, 'plan', '改过的编制目的。');
    expect(saved.version).toBe(1);
    const after: ReviewView = (await zhou.get(reviewUrl()).expect(200)).body;
    // 核对记录还在，但对应的是旧稿
    expect(doc(after, 'plan')).toMatchObject({
      version: 1,
      check: { version: 0 },
    });

    // 页面还停在旧稿时核对：拒绝，带回最新的核对情况
    const stale = (await zhou.put(url('plan', '/check')).send({ version: 0 }).expect(409)).body;
    expect(stale.message).toContain('保存了新的修订');
    expect(doc(stale.view, 'plan').version).toBe(1);

    const again: ReviewView = (await zhou.put(url('plan', '/check')).send({ version: 1 }).expect(200)).body;
    expect(doc(again, 'plan').check).toMatchObject({ version: 1 });
  });
});

describe('审核结论', () => {
  it('三份都核对完才能确认；确认后任何一份再改，结论失效', async () => {
    const zhou = await as('zhou@test.cn');
    const note = '我已核对本次三份文稿，内容与 Word 版式符合本次交付要求。';
    const versions = { plan: 1, risk: 0, resource: 0 };
    const early = (await zhou.post(reviewUrl()).send({ note, versions }).expect(409)).body;
    expect(early.message).toContain('风险评估报告');

    await zhou.put(url('risk', '/check')).send({ version: 0 }).expect(200);
    await zhou.put(url('resource', '/check')).send({ version: 0 }).expect(200);
    await zhou.post(reviewUrl()).send({ note: '  ', versions }).expect(400);
    // 页面看到的修订次数不是当前的
    await zhou
      .post(reviewUrl())
      .send({ note, versions: { ...versions, plan: 0 } })
      .expect(409);
    const ops = await as('ops@test.cn');
    await ops.post(reviewUrl()).send({ note, versions }).expect(403);

    const done: ReviewView = (await zhou.post(reviewUrl()).send({ note, versions }).expect(201)).body;
    expect(done.review).toMatchObject({ note, byName: '周工', versions });
    expect(reviewValid(done)).toBe(true);

    await saveSection(zhou, 'risk', '风险评估改过的措辞。');
    const after: ReviewView = (await zhou.get(reviewUrl()).expect(200)).body;
    expect(reviewValid(after)).toBe(false);
    expect(doc(after, 'risk')).toMatchObject({
      version: 1,
      check: { version: 0 },
    });
    // 改过的那份重新核对、重新确认结论
    await zhou
      .post(reviewUrl())
      .send({ note, versions: { ...versions, risk: 1 } })
      .expect(409);
    await zhou.put(url('risk', '/check')).send({ version: 1 }).expect(200);
    const again: ReviewView = (
      await zhou
        .post(reviewUrl())
        .send({ note, versions: { ...versions, risk: 1 } })
        .expect(201)
    ).body;
    expect(reviewValid(again)).toBe(true);
  });
});

describe('当前稿 PDF', () => {
  async function waitFor(agent: request.Agent, kind: string, status: string) {
    let body: { status: string; version: number; error: string | null } = {
      status: '',
      version: -1,
      error: null,
    };
    await expect
      .poll(async () => {
        body = (await agent.get(url(kind, '/preview')).expect(200)).body;
        return body.status;
      })
      .toBe(status);
    return body;
  }

  it('打开时转当前稿，转好后可以取；改过正文按新稿重新转；转换失败可以重试', async () => {
    const zhou = await as('zhou@test.cn');
    const first = (await zhou.get(url('resource', '/preview')).expect(200)).body;
    expect(first).toMatchObject({ status: 'converting', version: 0 });
    await waitFor(zhou, 'resource', 'ready');
    const pdf = await zhou.get(url('resource', '/preview/file')).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
    // 再打开不重复转
    const count = converted.length;
    await waitFor(zhou, 'resource', 'ready');
    expect(converted.length).toBe(count);

    await saveSection(zhou, 'resource', '资源调查改过的措辞。');
    failNext = true;
    const changed = (await zhou.get(url('resource', '/preview')).expect(200)).body;
    expect(changed).toMatchObject({ status: 'converting', version: 1 });
    const failed = await waitFor(zhou, 'resource', 'failed');
    expect(failed.error).toBe('转换没有成功，请重试；也可以先下载 Word 核对');
    // 转好之前不给旧稿
    await zhou.get(url('resource', '/preview/file')).expect(404);

    await zhou.post(url('resource', '/preview/retry')).expect(201);
    expect((await waitFor(zhou, 'resource', 'ready')).version).toBe(1);
    expect(converted.length).toBe(count + 1);

    // 运营能看，别家看不到
    const ops = await as('ops@test.cn');
    await ops.get(url('resource', '/preview/file')).expect(200);
    const other = await as('other@test.cn');
    await other.get(url('resource', '/preview')).expect(404);
  });
});
