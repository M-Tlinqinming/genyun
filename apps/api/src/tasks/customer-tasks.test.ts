import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  deliveries,
  enterpriseAssignments,
  enterprises,
  files,
  generationBatches,
  memberships,
  organizations,
  taskIntakeFiles,
  taskIntakes,
  taskIntakeSubmissions,
  tasks,
  users,
} from '../db/schema.ts';

// 客户任务列表（11 页 C01 工作台、C04 任务列表）：每个任务带三段状态 view、「更新」列时间 updatedOn，
// 成果锁住时带组织管理员名字；成员只看分给自己的企业
const PASSWORD = 'correct horse battery staple';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEYS = ['noTable', 'missing', 'ready', 'expert', 'delivered', 'updated', 'locked', 'legacy'] as const;
type Key = (typeof KEYS)[number];

let handle: DatabaseHandle;
let app: INestApplication;
let orgId = '';
const T = {} as Record<Key, string>;
const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms);
const CREATED = ago(10 * DAY);
const at = {
  missingRemoved: ago(2 * HOUR),
  readyWithdrawn: ago(3 * HOUR),
  expertSubmitted: ago(DAY),
  delivered: ago(4 * DAY),
  updated: ago(DAY + HOUR),
  locked: ago(5 * HOUR),
  legacySubmitted: ago(6 * DAY),
};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例安全咨询公司', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  orgId = customer!.id;
  const uid: Record<string, string> = {};
  for (const p of [
    { email: 'admin@test.cn', name: '陈经理', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'member@test.cn', name: '小王', orgId: customer!.id, role: 'customer_member' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const by = uid['admin@test.cn']!;
  const zhou = uid['zhou@test.cn']!;
  const ents = await db
    .insert(enterprises)
    .values(KEYS.map((k) => ({ orgId, name: `示例${k}公司`, createdBy: by })))
    .returning();
  const submitted = (k: Key) => !['noTable', 'missing', 'ready'].includes(k);
  const created = await db
    .insert(tasks)
    .values(
      KEYS.map((k, i) => ({
        orgId,
        enterpriseId: ents[i]!.id,
        number: `GY-2026-${String(i + 1).padStart(3, '0')}`,
        businessType: 'emergency_plan' as const,
        name: '2026 年应急预案',
        status: submitted(k) ? ('submitted' as const) : ('preparing' as const),
        submittedAt: k === 'legacy' ? at.legacySubmitted : submitted(k) ? at.expertSubmitted : null,
        assignedExpertId: submitted(k) ? zhou : null,
        chargeStatus: k === 'locked' ? ('awaiting_credits' as const) : k === 'delivered' || k === 'updated' ? ('charged' as const) : ('not_charged' as const),
        createdAt: CREATED,
        updatedAt: ago(HOUR),
        createdBy: by,
      })),
    )
    .returning();
  KEYS.forEach((k, i) => (T[k] = created[i]!.id));
  // 成员分到「还没上传」和「锁住」两家
  for (const k of ['noTable', 'locked'] as const) {
    await db.insert(enterpriseAssignments).values({ enterpriseId: ents[KEYS.indexOf(k)]!.id, userId: uid['member@test.cn']!, orgId });
  }

  const [sheet] = await db
    .insert(files)
    .values({
      orgId,
      kind: 'customer_material',
      originalName: '资料表格.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1,
      sha256: 'x',
      storageKey: 'test/x',
      uploadedBy: by,
    })
    .returning();
  const check = (n: number) => ({
    missing: Array.from({ length: n }, (_, i) => ({ field: `f${i}`, label: `f${i}`, sheet: '基本信息', row: 3, cell: 'C3', note: '没填。' })),
    optional: [],
    checkedAt: CREATED.toISOString(),
  });
  await db.insert(taskIntakes).values(
    KEYS.filter((k) => k !== 'legacy').map((k) => ({
      taskId: T[k],
      dataSheetFileId: k === 'noTable' ? null : sheet!.id,
      requiredCheck: k === 'noTable' ? null : check(k === 'missing' ? 4 : 0),
    })),
  );
  // 还差几项：上传后又移除了一张图（移除时间算「最近动资料」）
  await db.insert(taskIntakeFiles).values([
    { taskId: T.missing, slot: 'data_sheet', fileId: sheet!.id, uploadedBy: by, uploadedAt: ago(5 * HOUR) },
    { taskId: T.missing, slot: 'site_plan', fileId: sheet!.id, uploadedBy: by, uploadedAt: ago(4 * HOUR), removedAt: at.missingRemoved },
    { taskId: T.ready, slot: 'data_sheet', fileId: sheet!.id, uploadedBy: by, uploadedAt: ago(10 * HOUR) },
  ]);
  // 必填齐了：提交过又撤回（撤回时间算「最近动资料」）；其余新流程的任务各提交一次
  await db.insert(taskIntakeSubmissions).values([
    { taskId: T.ready, requestId: randomUUID(), submittedBy: by, submittedAt: ago(8 * HOUR), withdrawnAt: at.readyWithdrawn, withdrawnBy: by, snapshot: {} as never },
    ...(['expert', 'delivered', 'updated', 'locked'] as const).map((k) => ({
      taskId: T[k],
      requestId: randomUUID(),
      submittedBy: by,
      submittedAt: at.expertSubmitted,
      snapshot: {} as never,
    })),
  ]);

  const delivery = async (k: Key, publishedAt: Date, version = 1) => {
    const [b] = await db
      .insert(generationBatches)
      .values({ taskId: T[k], workupVersion: 1, snapshotAt: CREATED, input: {} as never, materials: [], createdBy: zhou })
      .returning();
    await db.insert(deliveries).values({
      publishId: randomUUID(),
      taskId: T[k],
      batchId: b!.id,
      version,
      status: 'done',
      reviewedBy: zhou,
      reviewedAt: publishedAt,
      versions: { plan: 0, risk: 0, resource: 0 },
      publishedBy: zhou,
      publishedAt,
    });
  };
  await delivery('delivered', at.delivered);
  await delivery('updated', ago(8 * DAY));
  await delivery('updated', at.updated, 2);
  await delivery('locked', at.locked);

  app = await createApp(db, { loginLimitPerMinute: 1000 });
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

interface Row {
  id: string;
  view: { key: string; label: string; nextStep: string; detail: string; stage: number; needsAction: boolean };
  updatedOn: string;
  adminNames: string | null;
  delivery: { version: number } | null;
  missing: string[];
  activityAt: string;
}
const list = async (email: string) => {
  const rows = (await (await as(email)).get(`/api/orgs/${orgId}/tasks`).expect(200)).body as Row[];
  return new Map(rows.map((r) => [r.id, r]));
};
const iso = (d: Date) => d.toISOString();

describe('客户任务列表的三段状态', () => {
  it('组织管理员：准备资料三种、专家编制、已交付、已更新、锁住', async () => {
    const rows = await list('admin@test.cn');
    expect(rows.size).toBe(KEYS.length);
    const v = (k: Key) => rows.get(T[k])!;
    expect(v('noTable').view).toMatchObject({ key: 'preparing_no_table', label: '准备资料', nextStep: '下载资料模板，填好后上传', needsAction: true, stage: 0 });
    expect(v('missing').view).toMatchObject({ key: 'preparing_missing', nextStep: '还差 4 项必填，补齐后提交', needsAction: true });
    expect(v('ready').view).toMatchObject({ key: 'preparing_ready', detail: '已撤回，这次提交后不能再撤回', needsAction: true });
    expect(v('expert').view).toMatchObject({ key: 'expert_working', label: '专家编制', stage: 1, needsAction: false });
    expect(v('delivered').view).toMatchObject({ key: 'delivered', nextStep: '成果已交付，三份 Word 可以下载', detail: '专家已交付', stage: 2 });
    expect(v('updated').view).toMatchObject({ key: 'delivered', nextStep: '成果已更新，三份 Word 可以下载', detail: '已更新' });
    expect(v('locked').view).toMatchObject({ key: 'delivered_locked', label: '已编制好 · 续约后可下载', needsAction: true });
    expect(v('legacy').view).toMatchObject({ key: 'legacy_readonly', label: '专家编制', needsAction: false });

    // 「更新」列：没动过资料用创建时间；移除、撤回都算动资料；专家编制看提交；已交付看最近一次交付
    expect(v('noTable').updatedOn).toBe(iso(CREATED));
    expect(v('missing').updatedOn).toBe(iso(at.missingRemoved));
    expect(v('ready').updatedOn).toBe(iso(at.readyWithdrawn));
    expect(v('expert').updatedOn).toBe(iso(at.expertSubmitted));
    expect(v('delivered').updatedOn).toBe(iso(at.delivered));
    expect(v('updated').updatedOn).toBe(iso(at.updated));
    expect(v('locked').updatedOn).toBe(iso(at.locked));
    expect(v('legacy').updatedOn).toBe(iso(at.legacySubmitted));

    // 管理员名字只在锁住时带；原来的字段照旧
    expect(v('locked').adminNames).toBe('陈经理');
    for (const k of KEYS.filter((x) => x !== 'locked')) expect(v(k).adminNames).toBeNull();
    expect(v('updated').delivery).toMatchObject({ version: 2 });
    expect(v('noTable')).toHaveProperty('missing');
    expect(v('noTable')).toHaveProperty('activityAt');
  });

  it('成员：只看分给自己的企业；锁住时不提次数，提示联系管理员', async () => {
    const rows = await list('member@test.cn');
    expect([...rows.keys()].sort()).toEqual([T.noTable, T.locked].sort());
    const locked = rows.get(T.locked)!;
    expect(locked.view).toMatchObject({ key: 'delivered_locked', label: '已编制好 · 暂不能下载', needsAction: false, detail: '需要贵组织管理员处理，请联系陈经理' });
    expect(locked.adminNames).toBe('陈经理');
    expect(rows.get(T.noTable)!.view.needsAction).toBe(true);
  });
});
