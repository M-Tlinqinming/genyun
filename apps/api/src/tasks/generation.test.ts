import {
  factDefOf,
  figureSignature,
  figuresView,
  workupGaps,
  emptyProductionWorkup,
  type DraftKind,
  type FactValue,
  type FigureKey,
  type ScopeKey,
  type SpecialCategory,
  type WorkupData,
  type WorkupSnapshot,
} from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, files, memberships, organizations, tasks, taskWorkups, users } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { InProcessQueue } from '../generation/queue.ts';

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
// 模拟：fail 里的份失败一次；每份记下生成了几次
const fail = new Set<DraftKind>();
const rendered: DraftKind[] = [];
// 测试可以先挡住生成，检查「生成中」的状态
let gate: Promise<void> = Promise.resolve();
const renderer: DraftRenderer = async (kind, input) => {
  await gate;
  rendered.push(kind);
  if (fail.delete(kind)) throw new Error('模拟转换超时');
  return { word: Buffer.from(`${kind}:${input.basic.companyName}:word`), pdf: Buffer.from(`${kind}:pdf`), notes: [] };
};

let feiyuTask = '';
const uid: Record<string, string> = {};

const stamp = { by: 'u', byName: '周工', at: '2026-10-31T08:00:00.000Z' };

// 按缺项逐个补齐（取第一个选项、判为否），让这份整理可以确认生成
function complete(snapshot: WorkupSnapshot): WorkupData {
  const data: WorkupData = { overrides: {}, production: emptyProductionWorkup(), scope: { switches: {} }, figures: { adopted: {} } };
  for (let round = 0; round < 5; round++) {
    const { gaps } = workupGaps(snapshot, data);
    if (gaps.length === 0) return data;
    for (const g of gaps) {
      const [head, id] = g.key.split(':') as [string, string | undefined];
      if (g.module === 'facts') {
        const kind = factDefOf(snapshot, g.key)!.kind;
        const value: FactValue = kind === 'count' ? 5 : kind === 'person' ? { name: '测试人员', phone: '13800000099' } : '测试补充';
        data.overrides[g.key] = { value, source: 'expert', ...stamp };
      } else if (head === 'material') data.production!.hazardous[id!] = { ...stamp, value: false };
      else if (head === 'special') data.production!.special[id as SpecialCategory] = { ...stamp, value: { answer: 'no', items: [] } };
      else if (head === 'building') data.production!.fireRatings[id!] = { ...stamp, value: '2' };
      else if (head === 'scope') data.scope!.switches[id as ScopeKey] = { ...stamp, value: false };
      else if (head === 'figure') {
        const view = figuresView(snapshot, data);
        data.figures!.adopted![id as FigureKey] = { ...stamp, signature: figureSignature(view, id as FigureKey) };
      }
    }
  }
  throw new Error(`补不齐：${workupGaps(snapshot, data).gaps.map((g) => g.label).join('、')}`);
}

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
  for (const p of [
    { email: 'feiyu@test.cn', name: '陈志刚', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
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
  feiyuTask = task!.id;

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

const statuses = (body: { current: { drafts: { kind: string; status: string }[] } }) =>
  Object.fromEntries(body.current.drafts.map((d) => [d.kind, d.status]));

describe('确认采用资料并生成三份草稿', () => {
  it('还没生成过：进度为空；必需项没齐不能生成', async () => {
    const zhou = await as('zhou@test.cn');
    const opened = await zhou.get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    expect((await zhou.get(`/api/tasks/${feiyuTask}/generation`).expect(200)).body).toEqual({ current: null });
    const res = await zhou.post(`/api/tasks/${feiyuTask}/generation`).send({ version: opened.body.version }).expect(400);
    expect(res.body.reason).toBe('gaps');
    expect(res.body.message).toMatch(/^还差 \d+ 项没有整理完/);
  });

  it('整理已被别人改过：拒绝，请专家看过最新内容再确认', async () => {
    const { db } = handle;
    const [row] = await db.select().from(taskWorkups).where(eq(taskWorkups.taskId, feiyuTask));
    await db.update(taskWorkups).set({ data: complete(row!.snapshot), version: row!.version + 1 }).where(eq(taskWorkups.taskId, feiyuTask));
    const res = await (await as('zhou@test.cn')).post(`/api/tasks/${feiyuTask}/generation`).send({ version: row!.version }).expect(409);
    expect(res.body).toMatchObject({ reason: 'stale', version: row!.version + 1 });
  });

  it('客户和其他专家不能生成，也看不到进度', async () => {
    await (await as('feiyu@test.cn')).get(`/api/tasks/${feiyuTask}/generation`).expect(404);
    await (await as('wu@test.cn')).post(`/api/tasks/${feiyuTask}/generation`).send({ version: 2 }).expect(404);
  });

  it('模拟一份失败：另外两份照常生成；只重试失败的这一份', async () => {
    const zhou = await as('zhou@test.cn');
    fail.add('risk');
    let release = () => {};
    gate = new Promise((r) => (release = r));
    const started = await zhou.post(`/api/tasks/${feiyuTask}/generation`).send({ version: 2 }).expect(201);
    expect(started.body.current.workupVersion).toBe(2);
    expect(started.body.current.createdByName).toBe('周工');
    expect(started.body.current.drafts.map((d: { kind: string }) => d.kind)).toEqual(['plan', 'risk', 'resource']);

    // 生成中不能再确认一次；放行后三份依次生成
    await zhou.post(`/api/tasks/${feiyuTask}/generation`).send({ version: 2 }).expect(409);
    release();

    await queue.idle();
    const after = await zhou.get(`/api/tasks/${feiyuTask}/generation`).expect(200);
    expect(statuses(after.body)).toEqual({ plan: 'done', risk: 'failed', resource: 'done' });
    const risk = after.body.current.drafts.find((d: { kind: string }) => d.kind === 'risk');
    expect(risk).toMatchObject({ attempts: 1, wordFileId: null, error: '生成没有完成：模拟转换超时' });
    const plan = after.body.current.drafts.find((d: { kind: string }) => d.kind === 'plan');
    expect(plan.wordFileId).toBeTruthy();
    expect(plan.pdfFileId).toBeTruthy();

    rendered.length = 0;
    await zhou.post(`/api/tasks/${feiyuTask}/generation/retry`).expect(201);
    await queue.idle();
    expect(rendered).toEqual(['risk']);
    const done = await zhou.get(`/api/tasks/${feiyuTask}/generation`).expect(200);
    expect(statuses(done.body)).toEqual({ plan: 'done', risk: 'done', resource: 'done' });
    // 已生成的两份没有动过
    expect(done.body.current.drafts.find((d: { kind: string }) => d.kind === 'plan')).toEqual(plan);
    expect(done.body.current.drafts.find((d: { kind: string }) => d.kind === 'risk').attempts).toBe(2);

    // 没有失败的就没什么可重试
    await zhou.post(`/api/tasks/${feiyuTask}/generation/retry`).expect(400);
  });

  it('草稿文件：负责专家能下载，客户看不到；生成用的是确认时锁定的整理版本', async () => {
    const zhou = await as('zhou@test.cn');
    const res = await zhou.get(`/api/tasks/${feiyuTask}/generation`).expect(200);
    const plan = res.body.current.drafts.find((d: { kind: string }) => d.kind === 'plan');
    const file = await zhou.get(`/api/files/${plan.wordFileId}`).expect(200);
    expect(file.body).toMatchObject({ kind: 'draft', originalName: '惠阳飞宇电器有限公司应急预案（草稿）.docx' });
    await zhou.get(`/api/files/${plan.pdfFileId}/download-url`).expect(200);
    await (await as('feiyu@test.cn')).get(`/api/files/${plan.wordFileId}`).expect(404);
    await (await as('wu@test.cn')).get(`/api/files/${plan.wordFileId}`).expect(404);

    const [row] = await handle.db.select().from(files).where(eq(files.id, plan.wordFileId));
    expect(stored.get(row!.storageKey)!.toString()).toBe('plan:惠阳飞宇电器有限公司:word');
  });
});
