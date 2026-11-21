// 生成初稿（K12）：单份重新生成、进度、排队位置、页数和待补充处数、附图不收 CAD、处理记录的用时
import { pendingCount, pendingOf, type DraftKind, type GenerationProgress, type HistoryEntry } from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, files, generatedDrafts, generationBatches, memberships, organizations, taskIntakeFiles, tasks, taskWorkups, users } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { DrawingRenderer } from '../generation/drawings/renderer.ts';
import { LANDSCAPE, testPdf } from '../generation/drawings/test-pdf.ts';
import type { PlanDrawings } from '../generation/plan/assemble.ts';
import type { DraftHandler, DraftJob, DraftQueue } from '../generation/queue.ts';
import { complete, testDocument } from './test-workup.ts';

const PASSWORD = 'correct horse battery staple';

// 测试自己决定什么时候跑哪一个：jobs 里排着，next() 跑最前面的一个
class ManualQueue implements DraftQueue {
  readonly durable = true;
  jobs: DraftJob[] = [];
  private handler: DraftHandler | null = null;
  async add(job: DraftJob) {
    this.jobs.push(job);
  }
  start(handler: DraftHandler) {
    this.handler = handler;
  }
  next(): Promise<void> {
    const job = this.jobs.shift();
    if (!job || !this.handler) throw new Error('队列里没有任务');
    return this.handler(job);
  }
  async drain() {
    while (this.jobs.length) await this.next();
  }
  async idle() {}
  async close() {
    this.handler = null;
  }
}

// 数页数：pages 设了就按它（'throw' = 出错），没设就真的去数
class FakePages extends DrawingRenderer {
  pages: number | 'throw' | null = null;
  override async count(data: Uint8Array, contentType: string): Promise<number> {
    if (this.pages === 'throw') throw new Error('模拟数页数出错');
    if (this.pages !== null) return this.pages;
    return super.count(data, contentType);
  }
}

let handle: DatabaseHandle;
let app: INestApplication;
const queue = new ManualQueue();
const pagesRenderer = new FakePages();
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

// 假的渲染：fail 里的份失败一次；hold 里的份报一次进度后停住，等 release；pdf 决定给不给 PDF
const fail = new Set<DraftKind>();
const hold = new Map<DraftKind, Promise<void>>();
let withPdf = false;
const received: Partial<Record<DraftKind, PlanDrawings | undefined>> = {};
const renderer: DraftRenderer = async (kind, _input, drawings, onProgress) => {
  received[kind] = drawings;
  await onProgress?.({ done: 1, total: 3, step: 'layout' });
  await hold.get(kind);
  if (fail.delete(kind)) throw new Error('模拟连接中断');
  return { word: Buffer.from(`${kind}:word`), pdf: withPdf ? Buffer.from('%PDF-fake') : null, notes: [], document: testDocument(kind) };
};
function holdOn(kind: DraftKind) {
  let release = () => {};
  hold.set(kind, new Promise<void>((r) => (release = r)));
  return () => {
    hold.delete(kind);
    release();
  };
}

const uid: Record<string, string> = {};
let orgId = '';
const task: Record<'a' | 'b' | 'cad', string> = { a: '', b: '', cad: '' };

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: '飞宇演示客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  orgId = customer!.id;
  for (const p of [
    { email: 'feiyu@test.cn', name: '陈志刚', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  let n = 0;
  for (const key of ['a', 'b', 'cad'] as const) {
    const [ent] = await db
      .insert(enterprises)
      .values({ orgId: customer!.id, name: `飞宇电器${key}`, profile: feiyuProfile, createdBy: uid['feiyu@test.cn']! })
      .returning();
    const [t] = await db
      .insert(tasks)
      .values({
        orgId: customer!.id,
        enterpriseId: ent!.id,
        businessType: 'emergency_plan',
        name: '2026 年应急预案',
        number: `GY-2026-30${++n}`,
        status: 'submitted',
        assignedExpertId: uid['zhou@test.cn']!,
        createdBy: uid['feiyu@test.cn']!,
      })
      .returning();
    task[key] = t!.id;
  }
  app = await createApp(db, { loginLimitPerMinute: 1000, storage, queue, renderer, drawingRenderer: pagesRenderer });
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

// 打开整理、补齐缺项、确认生成
async function confirm(taskId: string): Promise<GenerationProgress> {
  const zhou = await as('zhou@test.cn');
  await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
  const [row] = await handle.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
  await handle.db.update(taskWorkups).set({ data: complete(row!.snapshot), version: row!.version + 1 }).where(eq(taskWorkups.taskId, taskId));
  return (await zhou.post(`/api/tasks/${taskId}/generation`).send({ version: row!.version + 1 }).expect(201)).body.current;
}

async function progress(taskId: string): Promise<GenerationProgress> {
  return (await (await as('zhou@test.cn')).get(`/api/tasks/${taskId}/generation`).expect(200)).body.current;
}
const draftOf = (g: GenerationProgress, kind: DraftKind) => g.drafts.find((d) => d.kind === kind)!;
const statuses = (g: GenerationProgress) => Object.fromEntries(g.drafts.map((d) => [d.kind, d.status]));

// 测试按顺序共用数据：a 先确认（排在前面），b 后确认
describe('排队位置', () => {
  it('早的那批有排队的份：晚的那批看到 1（两份排队也只算 1 个）；早的那批看不到晚的', async () => {
    const a = await confirm(task.a);
    expect(a.queueAhead).toBe(0);
    const b = await confirm(task.b);
    expect(b.queueAhead).toBe(1);
    expect((await progress(task.a)).queueAhead).toBe(0);
  });

  it('早的那批有一份在生成：晚的那批还是 1；我自己这一批在跑的份不算', async () => {
    const release = holdOn('plan');
    const running = queue.next();
    await expect.poll(async () => draftOf(await progress(task.a), 'plan').status).toBe('running');
    // 只剩一份在生成、别的在排队，也算 1
    expect((await progress(task.b)).queueAhead).toBe(1);
    expect((await progress(task.a)).queueAhead).toBe(0);

    // 生成中能看到进度
    expect(draftOf(await progress(task.a), 'plan').progress).toEqual({ done: 1, total: 3, step: 'layout' });
    release();
    await running;
  });

  it('a 跑完以后 b 看到 0；我这一批没有排队中的份时为 null', async () => {
    await queue.next();
    await queue.next();
    const a = await progress(task.a);
    expect(statuses(a)).toEqual({ plan: 'done', risk: 'done', resource: 'done' });
    expect(a.queueAhead).toBeNull();
    expect((await progress(task.b)).queueAhead).toBe(0);
  });
});

describe('queued_at', () => {
  it('确认生成时写了；老数据为空时接口用这一批的确认时间', async () => {
    const b = await progress(task.b);
    for (const d of b.drafts) expect(Date.parse(d.queuedAt)).toBeGreaterThanOrEqual(Date.parse(b.createdAt));
    await handle.db.update(generatedDrafts).set({ queuedAt: null }).where(eq(generatedDrafts.batchId, b.id));
    const after = await progress(task.b);
    for (const d of after.drafts) expect(d.queuedAt).toBe(after.createdAt);
    expect(after.queueAhead).toBe(0);
  });
});

describe('单份重新生成', () => {
  it('失败时进度留着；只重做这一份，另两份不动；连点两下不会重复进队列', async () => {
    // b：应急预案失败，另两份还在排队
    fail.add('plan');
    await queue.next();
    let b = await progress(task.b);
    expect(statuses(b)).toEqual({ plan: 'failed', risk: 'queued', resource: 'queued' });
    const failed = draftOf(b, 'plan');
    expect(failed.progress).toEqual({ done: 1, total: 3, step: 'layout' });
    expect(failed.startedAt).toBeTruthy();
    const others = b.drafts.filter((d) => d.kind !== 'plan');

    const zhou = await as('zhou@test.cn');
    const before = Date.now();
    const res = await zhou.post(`/api/tasks/${task.b}/generation/retry`).send({ kind: 'plan' }).expect(201);
    b = res.body.current;
    const again = draftOf(b, 'plan');
    expect(again).toMatchObject({ status: 'queued', error: null, startedAt: null, finishedAt: null, progress: null });
    expect(Date.parse(again.queuedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(b.drafts.filter((d) => d.kind !== 'plan')).toEqual(others);
    expect(queue.jobs.filter((j) => j.kind === 'plan')).toHaveLength(1);

    const second = await zhou.post(`/api/tasks/${task.b}/generation/retry`).send({ kind: 'plan' }).expect(409);
    expect(second.body).toMatchObject({ code: 'draft_not_failed', message: '这一份已经在重新生成了' });
    expect(queue.jobs.filter((j) => j.kind === 'plan')).toHaveLength(1);
  });

  it('另一份正在生成时也能重做失败的这一份；生成中的那份也是「已经在重新生成了」', async () => {
    // 队列现在是 risk、resource、plan：risk 失败，resource 停在生成中
    fail.add('risk');
    await queue.next();
    const release = holdOn('resource');
    const running = queue.next();
    await expect.poll(async () => draftOf(await progress(task.b), 'resource').status).toBe('running');

    const zhou = await as('zhou@test.cn');
    const res = await zhou.post(`/api/tasks/${task.b}/generation/retry`).send({ kind: 'risk' }).expect(201);
    expect(statuses(res.body.current)).toEqual({ plan: 'queued', risk: 'queued', resource: 'running' });
    const busy = await zhou.post(`/api/tasks/${task.b}/generation/retry`).send({ kind: 'resource' }).expect(409);
    expect(busy.body.message).toBe('这一份已经在重新生成了');
    release();
    await running;
    await queue.drain();
    expect(statuses(await progress(task.b))).toEqual({ plan: 'done', risk: 'done', resource: 'done' });
  });

  it('已生成的：「这一份已经生成好了」；不认识的 kind 400；不带 kind 没有失败的照旧 400', async () => {
    const zhou = await as('zhou@test.cn');
    const done = await zhou.post(`/api/tasks/${task.b}/generation/retry`).send({ kind: 'plan' }).expect(409);
    expect(done.body).toMatchObject({ code: 'draft_not_failed', message: '这一份已经生成好了，刷新看看' });
    await zhou.post(`/api/tasks/${task.b}/generation/retry`).send({ kind: 'nope' }).expect(400);
    await zhou.post(`/api/tasks/${task.b}/generation/retry`).expect(400);
    await zhou.post(`/api/tasks/${task.b}/generation/retry`).send({}).expect(400);
  });

  it('不带 kind：重做所有失败的，进度和时间都清掉', async () => {
    const b = await progress(task.b);
    await handle.db
      .update(generatedDrafts)
      .set({ status: 'failed', error: 'x', progress: { done: 0, total: 3, step: 'content' }, finishedAt: new Date() })
      .where(and(eq(generatedDrafts.batchId, b.id), eq(generatedDrafts.kind, 'risk')));
    await handle.db
      .update(generatedDrafts)
      .set({ status: 'failed', error: 'x', startedAt: null, finishedAt: new Date() })
      .where(and(eq(generatedDrafts.batchId, b.id), eq(generatedDrafts.kind, 'resource')));
    const res = await (await as('zhou@test.cn')).post(`/api/tasks/${task.b}/generation/retry`).expect(201);
    const g: GenerationProgress = res.body.current;
    expect(statuses(g)).toEqual({ plan: 'done', risk: 'queued', resource: 'queued' });
    for (const k of ['risk', 'resource'] as const) expect(draftOf(g, k)).toMatchObject({ error: null, startedAt: null, finishedAt: null, progress: null });
    expect(g.queueAhead).toBe(0);
    await queue.drain();
  });

  it('处理记录：有一份重新生成过，「三份初稿生成完成」后面不写用时；没重做过的照旧写', async () => {
    const zhou = await as('zhou@test.cn');
    const line = async (taskId: string) =>
      ((await zhou.get(`/api/tasks/${taskId}/history`).expect(200)).body as HistoryEntry[]).find((e) => e.what === '三份初稿生成完成');
    expect((await line(task.b))!.extra).toBeNull();
    expect((await line(task.a))!.extra).toMatch(/^用时 \d+ 分钟$/);
  });
});

describe('页数和待补充处数', () => {
  const regenerate = async () => {
    const b = await progress(task.b);
    await handle.db
      .update(generatedDrafts)
      .set({ status: 'failed' })
      .where(and(eq(generatedDrafts.batchId, b.id), eq(generatedDrafts.kind, 'risk')));
    await (await as('zhou@test.cn')).post(`/api/tasks/${task.b}/generation/retry`).send({ kind: 'risk' }).expect(201);
    await queue.drain();
    return draftOf(await progress(task.b), 'risk');
  };

  it('不给 PDF 时页数为空；待补充处数写进去了', async () => {
    const risk = draftOf(await progress(task.b), 'risk');
    expect(risk.pages).toBeNull();
    const doc = testDocument('risk');
    expect(risk.pendingCount).toBe(pendingCount(pendingOf(doc, doc)));
  });

  it('给 PDF 时是数出来的页数；数页数出错时为空，生成照样成功', async () => {
    withPdf = true;
    pagesRenderer.pages = 7;
    try {
      expect(await regenerate()).toMatchObject({ status: 'done', pages: 7 });
      pagesRenderer.pages = 'throw';
      const risk = await regenerate();
      expect(risk).toMatchObject({ status: 'done', pages: null });
      expect(risk.pdfFileId).toBeTruthy();
    } finally {
      withPdf = false;
      pagesRenderer.pages = null;
    }
  });
});

describe('附图只用客户上传的 PDF 和图片，CAD 只给专家看', () => {
  it('总平面图位上传 PDF 和 dwg：PDF 进图纸候选、进了生成用的附图；dwg 两处都没有；负责专家能下载 dwg', async () => {
    const { db } = handle;
    const mk = async (name: string, contentType: string, data: Buffer) => {
      const storageKey = `${orgId}/${name}`;
      stored.set(storageKey, data);
      const [f] = await db
        .insert(files)
        .values({ orgId, kind: 'customer_material', originalName: name, contentType, sizeBytes: data.length, sha256: name, storageKey, uploadedBy: uid['feiyu@test.cn']! })
        .returning();
      return f!.id;
    };
    const pdf = await mk('总平面图.pdf', 'application/pdf', testPdf([LANDSCAPE]));
    const dwg = await mk('总平面图.dwg', 'image/vnd.dwg', Buffer.from('AC1032 fake'));
    await db.insert(taskIntakeFiles).values([
      { taskId: task.cad, slot: 'site_plan', fileId: pdf, uploadedBy: uid['feiyu@test.cn']! },
      { taskId: task.cad, slot: 'site_plan', fileId: dwg, uploadedBy: uid['feiyu@test.cn']! },
    ]);

    const zhou = await as('zhou@test.cn');
    await zhou.get(`/api/tasks/${task.cad}/workup`).expect(200);
    // 第 4 步图纸卡选页用的那份清单
    const candidates: { fileId: string }[] = (await zhou.get(`/api/tasks/${task.cad}/drawings`).expect(200)).body.drawings;
    expect(candidates.map((d) => d.fileId)).toContain(pdf);
    expect(candidates.some((d) => d.fileId === dwg)).toBe(false);

    await confirm(task.cad);
    const [batch] = await db.select().from(generationBatches).where(eq(generationBatches.taskId, task.cad));
    const refs = batch!.input.drawings ?? [];
    expect(refs.map((r) => r.fileId)).toEqual([pdf]);
    await queue.drain();
    const plan = received.plan;
    expect(Object.values(plan ?? {}).flat()).toHaveLength(1);
    expect(statuses(await progress(task.cad))).toEqual({ plan: 'done', risk: 'done', resource: 'done' });

    await zhou.get(`/api/files/${dwg}/download-url`).expect(200);
    await (await as('wu@test.cn')).get(`/api/files/${dwg}/download-url`).expect(404);
  }, 120_000);
});
