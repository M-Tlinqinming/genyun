import type { ExpertCenterData, ExpertCenterRow } from '@genyun/shared';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  deliveries,
  draftEdits,
  enterprises,
  expertProfiles,
  files,
  generatedDrafts,
  generationBatches,
  memberships,
  organizations,
  taskIntakeFiles,
  taskIntakes,
  taskIntakeSubmissions,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';
import { loadTaskViewInputs } from './task-view-input.ts';

const PASSWORD = 'correct horse battery staple';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const KEYS = [
  'toCheck',
  'working',
  'generating',
  'ready',
  'failed',
  'awaiting',
  'reopened',
  'deliveredNow',
  'deliveredOld',
  'legacy',
  'deleted',
  'others',
  'preparing',
  'withdrawn',
] as const;
type Key = (typeof KEYS)[number];

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
// 各种状态的任务：键是用例里的叫法
const T = {} as Record<Key, string>;
const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms);
// 待核对资料那一个任务的最晚资料上传时间（「最近更新」取它）
const LATEST_UPLOAD = ago(HOUR);
// 「已等 N 天」「本月已交付」按北京时间的日期、月份算。用 now 减几小时构造会随跑测试的钟点变：
// 北京时间 0–1 点跑，now 减 2 天 1 小时会落到三天前；每月 1 日 0 点那一分钟，now 减 1 分钟会落到上个月。
// 所以这两处按北京时间的日期构造，和钟点无关。
const BEIJING = 8 * HOUR;
const beijingToday = Math.floor((now.getTime() + BEIJING) / DAY);
/** 北京日期往前推 n 天的 12:00 */
const beijingNoonDaysAgo = (n: number) => new Date((beijingToday - n) * DAY + 12 * HOUR - BEIJING);
const nowInBeijing = new Date(now.getTime() + BEIJING);
const beijingMonthStart = Date.UTC(nowInBeijing.getUTCFullYear(), nowInBeijing.getUTCMonth(), 1) - BEIJING;
// 本月的两次交付：通常是 1 分钟前、30 秒前；月初第一分钟里跑就挪到本月开头，先后顺序不变
const AWAITING_SINCE = beijingNoonDaysAgo(2);
const DELIVERED_V2 = new Date(Math.max(now.getTime() - 60_000, beijingMonthStart));
const DELIVERED_V3 = new Date(Math.max(now.getTime() - 30_000, DELIVERED_V2.getTime() + 1));

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
  for (const p of [
    { email: 'admin@test.cn', name: '陈经理', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const by = uid['admin@test.cn']!;
  const zhou = uid['zhou@test.cn']!;
  // 吴工已有上架的专家资料
  await db.insert(expertProfiles).values({ userId: uid['wu@test.cn']!, reviewStatus: 'approved', displayName: '吴工' });

  const ents = await db
    .insert(enterprises)
    .values(KEYS.map((k) => ({ orgId: customer!.id, name: `示例${k}公司`, createdBy: by })))
    .returning();
  const old = ago(3 * DAY);
  const notSubmitted = (k: Key) => k === 'preparing' || k === 'withdrawn';
  const created = await db
    .insert(tasks)
    .values(
      KEYS.map((k, i) => ({
        orgId: customer!.id,
        enterpriseId: ents[i]!.id,
        number: `GY-2026-${String(i + 1).padStart(3, '0')}`,
        businessType: 'emergency_plan' as const,
        name: '2026 年应急预案',
        status: notSubmitted(k) ? ('preparing' as const) : ('submitted' as const),
        submittedAt: notSubmitted(k) ? null : old,
        assignedExpertId: k === 'others' ? uid['wu@test.cn']! : zhou,
        assignedAt: k === 'toCheck' ? now : old,
        updatedAt: ago(2 * DAY),
        createdBy: by,
        deletedAt: k === 'deleted' ? old : null,
        awaitingCustomerSince: k === 'awaiting' ? AWAITING_SINCE : null,
        awaitingCustomerItems: k === 'awaiting' ? 3 : null,
        reopenedAt: k === 'reopened' ? ago(DAY) : null,
      })),
    )
    .returning();
  KEYS.forEach((k, i) => (T[k] = created[i]!.id));

  // 新流程（除旧流程那一个外都有准备资料的记录）
  const intakeKeys = KEYS.filter((k) => k !== 'legacy');
  const fileRows = await db
    .insert(files)
    .values(
      intakeKeys.map((k) => ({
        orgId: customer!.id,
        kind: 'customer_material' as const,
        originalName: `${k}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 1,
        sha256: k,
        storageKey: `test/${k}`,
        uploadedBy: by,
      })),
    )
    .returning();
  const fileOf = Object.fromEntries(intakeKeys.map((k, i) => [k, fileRows[i]!.id])) as Record<Key, string>;
  const missing = (field: string) => ({ field, label: field, sheet: '基本信息', row: 3, cell: 'C3', note: '没填。' });
  await db.insert(taskIntakes).values(
    intakeKeys.map((k) => ({
      taskId: T[k],
      dataSheetFileId: fileOf[k],
      requiredCheck: {
        missing: k === 'preparing' ? [missing('enterprise.legalPerson'), missing('enterprise.phone')] : [],
        optional: [],
        checkedAt: old.toISOString(),
      },
    })),
  );
  await db.insert(taskIntakeSubmissions).values(
    intakeKeys
      .filter((k) => k !== 'preparing')
      .map((k) => ({
        taskId: T[k],
        requestId: randomUUID(),
        submittedBy: by,
        submittedAt: k === 'toCheck' ? ago(5 * HOUR) : old,
        withdrawnAt: k === 'withdrawn' ? ago(2 * DAY) : null,
        withdrawnBy: k === 'withdrawn' ? by : null,
        snapshot: {} as never,
      })),
  );
  // 撤回后又重新提交过一次：取没撤回的那一次
  await db.insert(taskIntakeSubmissions).values({
    taskId: T.toCheck,
    requestId: randomUUID(),
    submittedBy: by,
    submittedAt: ago(9 * HOUR),
    withdrawnAt: ago(8 * HOUR),
    withdrawnBy: by,
    snapshot: {} as never,
  });
  // 待核对资料：资料表格 1 份、图纸与照片 2 份（另有一张已移除的不算）
  await db.insert(taskIntakeFiles).values([
    { taskId: T.toCheck, slot: 'data_sheet', fileId: fileOf.toCheck, uploadedBy: by, uploadedAt: ago(6 * HOUR) },
    { taskId: T.toCheck, slot: 'site_plan', fileId: fileOf.toCheck, uploadedBy: by, uploadedAt: ago(6 * HOUR) },
    { taskId: T.toCheck, slot: 'other', fileId: fileOf.toCheck, uploadedBy: by, uploadedAt: LATEST_UPLOAD },
    { taskId: T.toCheck, slot: 'other', fileId: fileOf.toCheck, uploadedBy: by, uploadedAt: ago(7 * HOUR), removedAt: ago(5 * HOUR) },
  ]);

  // 开始核对了的
  const started = ['working', 'generating', 'ready', 'failed', 'reopened', 'deliveredNow', 'deliveredOld'] as const;
  await db.insert(taskWorkups).values(
    started.map((k) => ({
      taskId: T[k],
      snapshot: {} as never,
      snapshotAt: ago(2 * DAY),
      data: k === 'working' ? { overrides: {}, stepsDone: 3 } : { overrides: {} },
      updatedAt: ago(2 * DAY),
    })),
  );

  // 生成：每个任务一批，ready 另有一批更早、失败过的（只看最新一批）
  const batchOf: Partial<Record<Key, string>> = {};
  const batch = async (k: Key, createdAt: Date, statuses: ('queued' | 'running' | 'done' | 'failed')[]) => {
    const [b] = await db
      .insert(generationBatches)
      .values({ taskId: T[k], workupVersion: 1, snapshotAt: ago(2 * DAY), input: {} as never, materials: [], createdBy: zhou, createdAt })
      .returning();
    const kinds = ['plan', 'risk', 'resource'] as const;
    await db.insert(generatedDrafts).values(
      statuses.map((status, i) => ({
        batchId: b!.id,
        kind: kinds[i]!,
        status,
        finishedAt: status === 'done' || status === 'failed' ? createdAt : null,
      })),
    );
    batchOf[k] = b!.id;
  };
  await batch('ready', ago(DAY + HOUR), ['failed', 'failed', 'failed']);
  await batch('ready', ago(DAY), ['done', 'done', 'done']);
  await batch('failed', ago(DAY), ['done', 'failed', 'done']);
  for (const k of ['reopened', 'deliveredNow', 'deliveredOld'] as const) await batch(k, ago(50 * DAY), ['done', 'done', 'done']);
  // 改稿时间也算「最近更新」
  await db.insert(draftEdits).values({ batchId: batchOf.ready!, kind: 'plan', updatedAt: ago(10 * HOUR) });

  const delivery = (k: Key, publishedAt: Date, version = 1, status: 'done' | 'failed' = 'done') => ({
    publishId: randomUUID(),
    taskId: T[k],
    batchId: batchOf[k]!,
    version,
    status,
    reviewedBy: zhou,
    reviewedAt: publishedAt,
    versions: { plan: 0, risk: 0, resource: 0 },
    publishedBy: zhou,
    publishedAt,
  });
  await db.insert(deliveries).values([
    delivery('reopened', ago(5 * DAY)),
    // 先交付、重新打开后又交付了一次（再次交付）；失败的那次不算
    delivery('deliveredNow', ago(45 * DAY)),
    delivery('deliveredNow', DELIVERED_V2, 2),
    delivery('deliveredNow', DELIVERED_V3, 3, 'failed'),
    delivery('deliveredOld', ago(45 * DAY)),
  ]);

  app = await createApp(db, { loginLimitPerMinute: 1000 });
  await app.init();
  // 启动时会把没跑完的生成标为失败，生成中的这一批在启动后再插
  await batch('generating', ago(DAY), ['queued', 'running', 'done']);
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

describe('读状态输入（loadTaskViewInputs）', () => {
  it('新流程、旧流程，表格、必填、提交、撤回、资料份数', async () => {
    const facts = await loadTaskViewInputs(handle.db, [T.toCheck, T.legacy, T.preparing, T.withdrawn]);
    const toCheck = facts.get(T.toCheck)!;
    expect(toCheck).toMatchObject({ flow: 'intake', status: 'submitted', tableUploaded: true, missingCount: 0, withdrawnBefore: true });
    // 撤回后再提交：取没撤回的那一次
    expect(toCheck.submittedAt).toEqual(ago(5 * HOUR));
    expect(toCheck.fileCounts).toEqual({ table: 1, others: 2 });
    expect(toCheck.assignedAt).toEqual(now);
    expect(toCheck.activityAt).toEqual(LATEST_UPLOAD);

    expect(facts.get(T.legacy)).toMatchObject({
      flow: 'legacy',
      tableUploaded: false,
      missingCount: 0,
      withdrawnBefore: false,
      fileCounts: { table: 0, others: 0 },
    });
    expect(facts.get(T.legacy)!.submittedAt).toEqual(ago(3 * DAY));
    expect(facts.get(T.preparing)).toMatchObject({ status: 'preparing', missingCount: 2, withdrawnBefore: false, submittedAt: null });
    // 只有撤回过的那一次：退回任务上的提交时间（这里为空）
    expect(facts.get(T.withdrawn)).toMatchObject({ withdrawnBefore: true, submittedAt: null });
  });

  it('核对步数、初稿四种情况、交付、最近更新', async () => {
    const f = await loadTaskViewInputs(handle.db, Object.values(T));
    expect(f.size).toBe(KEYS.length);
    expect(f.get(T.toCheck)).toMatchObject({ snapshotAt: null, workupStepsDone: 0, draft: 'none', lastDelivery: null });
    expect(f.get(T.working)).toMatchObject({ snapshotAt: ago(2 * DAY), workupStepsDone: 3, draft: 'none' });
    expect(f.get(T.generating)!.draft).toBe('generating');
    // 最新一批全部完成；更早那批失败过不算
    expect(f.get(T.ready)!.draft).toBe('ready');
    expect(f.get(T.failed)!.draft).toBe('failed');
    // 改稿时间晚于其他时间：最近更新取它
    expect(f.get(T.ready)!.activityAt).toEqual(ago(10 * HOUR));
    expect(f.get(T.reopened)).toMatchObject({ lastDelivery: { at: ago(5 * DAY), kind: 'first' }, reopenedAt: ago(DAY) });
    expect(f.get(T.deliveredNow)!.lastDelivery).toEqual({ at: DELIVERED_V2, kind: 'update' });
    expect(f.get(T.awaiting)).toMatchObject({ awaitingCustomerSince: AWAITING_SINCE, awaitingCustomerItems: 3 });
    expect(f.get(T.deleted)!.deletedAt).toEqual(ago(3 * DAY));
  });

  it('失败、交付中的交付记录不算：最近交付和「首次 / 再次」都不变', async () => {
    const { db } = handle;
    const [b] = await db.select({ id: generationBatches.id }).from(generationBatches).where(eq(generationBatches.taskId, T.reopened));
    const extra = (version: number, status: 'failed' | 'publishing') => ({
      publishId: randomUUID(),
      taskId: T.reopened,
      batchId: b!.id,
      version,
      status,
      reviewedBy: uid['zhou@test.cn']!,
      reviewedAt: ago(HOUR),
      versions: { plan: 0, risk: 0, resource: 0 },
      publishedBy: uid['zhou@test.cn']!,
      // 时间比已完成的那次晚，也不该被当成最近交付
      publishedAt: ago(HOUR),
    });
    const added = await db.insert(deliveries).values([extra(2, 'failed'), extra(3, 'publishing')]).returning({ id: deliveries.id });
    try {
      const f = await loadTaskViewInputs(db, [T.reopened]);
      expect(f.get(T.reopened)!.lastDelivery).toEqual({ at: ago(5 * DAY), kind: 'first' });
    } finally {
      await db.delete(deliveries).where(inArray(deliveries.id, added.map((d) => d.id)));
    }
  });

  it('没有任务时不查库', async () => {
    expect((await loadTaskViewInputs(handle.db, [])).size).toBe(0);
  });
});

describe('专家任务中心', () => {
  async function zhouList() {
    return (await (await as('zhou@test.cn')).get('/api/expert/tasks').expect(200)).body as ExpertCenterData;
  }
  const rowOf = (data: ExpertCenterData, id: string) => data.rows.find((r) => r.id === id) as ExpertCenterRow;

  it('只列分给自己、已提交、没删除的；还在准备资料、撤回了的不列；旧流程只读显示', async () => {
    const data = await zhouList();
    expect(data.rows.map((r) => r.id).sort()).toEqual(
      [T.toCheck, T.working, T.generating, T.ready, T.failed, T.awaiting, T.reopened, T.deliveredNow, T.deliveredOld, T.legacy].sort(),
    );
    expect(rowOf(data, T.toCheck)).toMatchObject({
      number: 'GY-2026-001',
      enterpriseName: '示例toCheck公司',
      orgName: '示例安全咨询公司',
      name: '2026 年应急预案',
    });
    expect(rowOf(data, T.legacy)).toMatchObject({ view: { key: 'legacy_readonly', readOnly: true }, button: '查看', isOpen: true });
  });

  it('每行的阶段、第二行、按钮、时间列', async () => {
    const data = await zhouList();
    expect(rowOf(data, T.toCheck)).toMatchObject({
      view: { key: 'to_check', label: '待核对资料', detail: '资料表格 1 份 · 图纸与照片 2 份' },
      button: '开始核对',
      time: { tone: 'action' },
    });
    expect(rowOf(data, T.working)).toMatchObject({
      view: { key: 'working', label: '编制中', detail: '资料核对 3 / 5 步' },
      button: '继续核对',
      time: { tone: 'muted' },
    });
    expect(rowOf(data, T.generating)).toMatchObject({ view: { detail: '初稿生成中' }, button: '查看进度' });
    expect(rowOf(data, T.ready)).toMatchObject({ view: { detail: '三份初稿已生成' }, button: '核对文稿' });
    expect(rowOf(data, T.failed)).toMatchObject({ view: { tone: 'error' }, button: '重新生成' });
    expect(rowOf(data, T.awaiting)).toMatchObject({
      view: { key: 'awaiting_customer', label: '等客户补资料' },
      button: '查看缺项',
      time: { text: '已等 2 天', tone: 'muted' },
    });
    expect(rowOf(data, T.awaiting).view.detail).toMatch(/^缺 3 项/);
    expect(rowOf(data, T.reopened)).toMatchObject({ view: { key: 'reopened' }, button: '继续编制', isOpen: true });
    expect(rowOf(data, T.deliveredNow)).toMatchObject({ view: { key: 'delivered' }, button: '查看', isOpen: false, deliveredThisMonth: true });
    expect(rowOf(data, T.deliveredOld)).toMatchObject({ isOpen: false, deliveredThisMonth: false });
  });

  it('按组排：待核对、编制中（含重新打开）、等客户、旧流程、已交付', async () => {
    const data = await zhouList();
    const groupOf: Record<string, number> = { to_check: 0, working: 1, reopened: 1, awaiting_customer: 2, legacy_readonly: 3, delivered: 4 };
    const groups = data.rows.map((r) => groupOf[r.view.key]!);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(data.rows[0]!.id).toBe(T.toCheck);
    // 已交付按交付时间新的在前
    expect(data.rows.slice(-2).map((r) => r.id)).toEqual([T.deliveredNow, T.deliveredOld]);
  });

  it('四格统计：重新打开算编制中，旧流程、上月交付不计；没有资料行算接单中', async () => {
    const data = await zhouList();
    expect(data.stats).toEqual({ to_check: 1, working: 5, awaiting: 1, delivered_month: 1 });
    expect(data.acceptingOrders).toBe(true);
  });

  it('客户和运营不能用专家任务中心', async () => {
    const admin = await as('admin@test.cn');
    expect((await admin.get('/api/expert/tasks').expect(403)).body.message).toBe('任务中心只对专家开放');
    await (await as('ops@test.cn')).get('/api/expert/tasks').expect(403);
  });

  it('看不到别的专家的任务', async () => {
    const wu = (await (await as('wu@test.cn')).get('/api/expert/tasks').expect(200)).body as ExpertCenterData;
    expect(wu.rows.map((r) => r.id)).toEqual([T.others]);
    expect((await zhouList()).rows.map((r) => r.id)).not.toContain(T.others);
  });
});

describe('暂停接单', () => {
  it('没有资料行时插入一行，任务中心能看到；再打开就更新', async () => {
    const zhou = await as('zhou@test.cn');
    expect((await zhou.put('/api/expert/accepting').send({ acceptingOrders: false }).expect(200)).body).toEqual({ acceptingOrders: false });
    const [row] = await handle.db.select().from(expertProfiles).where(eq(expertProfiles.userId, uid['zhou@test.cn']!));
    expect(row).toMatchObject({ acceptingOrders: false, reviewStatus: null, displayName: null });
    expect(((await zhou.get('/api/expert/tasks').expect(200)).body as ExpertCenterData).acceptingOrders).toBe(false);

    expect((await zhou.put('/api/expert/accepting').send({ acceptingOrders: true }).expect(200)).body).toEqual({ acceptingOrders: true });
    expect(((await zhou.get('/api/expert/tasks')).body as ExpertCenterData).acceptingOrders).toBe(true);
  });

  it('已有资料行：只改接单状态，其他不动；手上的任务照常', async () => {
    const wu = await as('wu@test.cn');
    await wu.put('/api/expert/accepting').send({ acceptingOrders: false }).expect(200);
    const [row] = await handle.db.select().from(expertProfiles).where(eq(expertProfiles.userId, uid['wu@test.cn']!));
    expect(row).toMatchObject({ acceptingOrders: false, reviewStatus: 'approved', displayName: '吴工' });
    expect(((await wu.get('/api/expert/tasks')).body as ExpertCenterData).rows.map((r) => r.id)).toEqual([T.others]);
  });

  it('请求体不对 400；客户、运营 403', async () => {
    const zhou = await as('zhou@test.cn');
    expect((await zhou.put('/api/expert/accepting').send({ acceptingOrders: 'no' }).expect(400)).body.message).toBe('接单状态不正确');
    await zhou.put('/api/expert/accepting').send({}).expect(400);
    for (const email of ['admin@test.cn', 'ops@test.cn']) {
      const res = await (await as(email)).put('/api/expert/accepting').send({ acceptingOrders: false });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('任务中心只对专家开放');
    }
  });

  it('暂停、恢复记进操作日志', async () => {
    const ops = await as('ops@test.cn');
    const paused = await ops.get('/api/operator/audit-logs?action=expert_pause').expect(200);
    expect(paused.body.entries.map((e: { target: string }) => e.target).sort()).toEqual(['吴工', '周工'].sort());
    const resumed = await ops.get('/api/operator/audit-logs?action=expert_resume').expect(200);
    expect(resumed.body.entries).toHaveLength(1);
    expect(resumed.body.entries[0]).toMatchObject({ actorEmail: 'zhou@test.cn', target: '周工' });
  });
});
