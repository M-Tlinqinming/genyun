// 提交给专家、撤回一次、删除任务：接口、权限、重复请求、删掉以后哪里都不出现
import type { IntakeView } from '@genyun/shared';
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
import { memberships, notifications, organizations, taskIntakeSubmissions, tasks, taskWorkups, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';
import { CUSTOMER_WITHDREW_MESSAGE } from '../tasks/workup.service.ts';
import {
  EXPERT_STARTED_MESSAGE,
  missingMessage,
  NO_SHEET_MESSAGE,
  READ_ONLY_MESSAGE,
  UNDELETABLE_MESSAGE,
  WITHDRAW_USED_MESSAGE,
} from './intake.service.ts';
import { newMissing, notTemplate, renamed } from './test-workbooks.ts';

const PASSWORD = 'correct horse battery staple';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n% 图纸\n');

let handle: DatabaseHandle;
let app: INestApplication;
let storageDir: string;
let orgId = '';
const uid: Record<string, string> = {};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal, strangerOrg] = await db
    .insert(organizations)
    .values([
      { name: '示例制造', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
      { name: '别家组织', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
    ])
    .returning();
  orgId = customer!.id;
  for (const p of [
    { email: 'admin@test.cn', name: '林管理员', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'member@test.cn', name: '王成员', orgId: customer!.id, role: 'customer_member' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'stranger@test.cn', name: '别家管理员', orgId: strangerOrg!.id, role: 'customer_admin' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  storageDir = mkdtempSync(join(tmpdir(), 'genyun-submit-'));
  app = await createApp(db, { loginLimitPerMinute: 1000, storage: new LocalDiskStorage(storageDir, 'test-secret') });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function as(email = 'admin@test.cn') {
  let agent = agents.get(email);
  if (!agent) {
    agent = request.agent(app.getHttpServer());
    expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    agents.set(email, agent);
  }
  return agent;
}

async function newTask(name: string) {
  const agent = await as();
  const ent = await agent.post(`/api/orgs/${orgId}/enterprises`).send({ name });
  expect(ent.status).toBe(201);
  const task = await agent.post(`/api/enterprises/${ent.body.id}/tasks`).send({ name: '2026 年应急预案编制' });
  expect(task.status).toBe(201);
  return { taskId: task.body.id as string, enterpriseId: ent.body.id as string };
}

async function put(taskId: string, slot: string, buf: Buffer, name: string) {
  const res = await (await as()).post(`/api/tasks/${taskId}/intake/files?slot=${slot}`).attach('file', buf, name);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as IntakeView;
}

/** 新建任务并传齐：填好的资料表格、总平面布置图、一张紧急疏散示意图、一张其他照片 */
async function readyTask(name: string) {
  const t = await newTask(name);
  await put(t.taskId, 'data_sheet', await renamed(name), '资料表格.xlsx');
  await put(t.taskId, 'site_plan', PDF, '总平面.pdf');
  await put(t.taskId, 'evacuation_map', PNG, '一楼疏散.png');
  const v = await put(t.taskId, 'other', PNG, '现场.png');
  expect(v.requiredCheck!.missing).toEqual([]);
  return t;
}

async function submit(taskId: string, requestId: string = crypto.randomUUID(), email?: string) {
  return (await as(email)).post(`/api/tasks/${taskId}/intake/submit`).send({ requestId });
}
const withdraw = async (taskId: string, email?: string) => (await as(email)).post(`/api/tasks/${taskId}/intake/withdraw`);
const remove = async (taskId: string, email?: string) => (await as(email)).delete(`/api/tasks/${taskId}`);
const view = (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as IntakeView;
};
const submissionCount = async (taskId: string) =>
  (await handle.db.select().from(taskIntakeSubmissions).where(eq(taskIntakeSubmissions.taskId, taskId))).length;
const taskRow = async (taskId: string) => (await handle.db.select().from(tasks).where(eq(tasks.id, taskId)))[0]!;
/** 专家开始核对：资料核对第一次打开时插的那一行 */
const expertStarts = (taskId: string) =>
  handle.db.insert(taskWorkups).values({ taskId, snapshot: {} as never, snapshotAt: new Date() });

describe('提交给专家', () => {
  it('提交后任务变成已提交，快照里是当时的文件；重发、再交都只记一次', async () => {
    const { taskId } = await readyTask('耕云测试提交有限公司');
    const requestId = crypto.randomUUID();
    const v = view(await submit(taskId, requestId));
    expect(v.canEdit).toBe(false);
    expect(v.canWithdraw).toBe(true);
    expect(v.expertStarted).toBe(false);
    expect(v.withdrawnAt).toBeNull();
    expect(v.submission!.submittedByName).toBe('林管理员');
    expect(v.submission!.noEvacuationMap).toBe(false);
    expect(v.submission!.files.map((f) => [f.slot, f.originalName])).toEqual([
      ['data_sheet', '资料表格.xlsx'],
      ['site_plan', '总平面.pdf'],
      ['evacuation_map', '一楼疏散.png'],
      ['other', '现场.png'],
    ]);
    const row = await taskRow(taskId);
    expect(row.status).toBe('submitted');
    expect(row.submittedAt?.toISOString()).toBe(v.submission!.submittedAt);
    const [sub] = await handle.db.select().from(taskIntakeSubmissions).where(eq(taskIntakeSubmissions.taskId, taskId));
    expect(sub!.snapshot.templateVersion).not.toBeNull();
    expect(sub!.snapshot.parse).not.toBeNull();

    // 同一个 requestId 重发、换一个 requestId 再交：都返回当前资料，不多记
    expect(view(await submit(taskId, requestId)).submission!.submittedAt).toBe(v.submission!.submittedAt);
    expect(view(await submit(taskId)).submission!.submittedAt).toBe(v.submission!.submittedAt);
    expect(await submissionCount(taskId)).toBe(1);
  });

  it('同一次提交连发两次（并发）只记一次', async () => {
    const { taskId } = await readyTask('耕云测试连点有限公司');
    const requestId = crypto.randomUUID();
    const [a, b] = await Promise.all([submit(taskId, requestId), submit(taskId, requestId)]);
    expect(view(a).submission).not.toBeNull();
    expect(view(b).submission).not.toBeNull();
    expect(await submissionCount(taskId)).toBe(1);
  });

  it('没读到表格、还有必填没填：409，任务还在准备资料', async () => {
    const empty = await newTask('耕云测试空任务有限公司');
    const r1 = await submit(empty.taskId);
    expect(r1.status).toBe(409);
    expect(r1.body.message).toBe(NO_SHEET_MESSAGE);

    const wrong = await newTask('耕云测试不像模板有限公司');
    await put(wrong.taskId, 'data_sheet', await notTemplate(), '随便一张表.xlsx');
    expect((await submit(wrong.taskId)).body.message).toBe(NO_SHEET_MESSAGE);

    const name = '耕云测试缺项有限公司';
    const missing = await newTask(name);
    const v = await put(missing.taskId, 'data_sheet', await newMissing(name), '资料表格.xlsx');
    const r3 = await submit(missing.taskId);
    expect(r3.status).toBe(409);
    expect(r3.body.message).toBe(missingMessage(v.requiredCheck!.missing.length));
    expect((await taskRow(missing.taskId)).status).toBe('preparing');
    expect(await submissionCount(missing.taskId)).toBe(0);
  });

  it('运营、负责专家 403；别家组织、没分到的成员 404；删掉的 404；请求体不对 400', async () => {
    const { taskId } = await readyTask('耕云测试提交权限有限公司');
    await handle.db.update(tasks).set({ assignedExpertId: uid['zhou@test.cn']! }).where(eq(tasks.id, taskId));
    for (const email of ['ops@test.cn', 'zhou@test.cn']) {
      const res = await submit(taskId, undefined, email);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(READ_ONLY_MESSAGE);
    }
    expect((await submit(taskId, undefined, 'stranger@test.cn')).status).toBe(404);
    expect((await submit(taskId, undefined, 'member@test.cn')).status).toBe(404);
    expect((await (await as()).post(`/api/tasks/${taskId}/intake/submit`).send({ requestId: 'x' })).status).toBe(400);
    await handle.db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
    expect((await submit(taskId)).status).toBe(404);
  });
});

describe('撤回', () => {
  it('撤回回到准备资料，文件和负责专家都还在；再提交后不能再撤回', async () => {
    const { taskId } = await readyTask('耕云测试撤回有限公司');
    view(await submit(taskId));
    await handle.db.update(tasks).set({ assignedExpertId: uid['zhou@test.cn']! }).where(eq(tasks.id, taskId));

    const v = view(await withdraw(taskId));
    expect(v.canEdit).toBe(true);
    expect(v.canWithdraw).toBe(false);
    expect(v.submission).toBeNull();
    expect(v.withdrawnAt).not.toBeNull();
    expect(v.sitePlan?.originalName).toBe('总平面.pdf');
    expect(v.evacuationMaps).toHaveLength(1);
    expect(v.requiredCheck!.missing).toEqual([]);
    const row = await taskRow(taskId);
    expect(row.status).toBe('preparing');
    expect(row.submittedAt).toBeNull();
    expect(row.assignedExpertId).toBe(uid['zhou@test.cn']);

    // 重复点：返回当前资料
    expect(view(await withdraw(taskId)).withdrawnAt).toBe(v.withdrawnAt);

    // 撤回后还能改，再提交
    await put(taskId, 'other', PNG, '补拍.png');
    const again = view(await submit(taskId));
    expect(again.canWithdraw).toBe(false);
    expect(again.withdrawnAt).toBe(v.withdrawnAt);
    expect(again.submission!.files.map((f) => f.originalName)).toContain('补拍.png');
    expect((await taskRow(taskId)).assignedExpertId).toBe(uid['zhou@test.cn']);

    const used = await withdraw(taskId);
    expect(used.status).toBe(409);
    expect(used.body).toMatchObject({ code: 'withdraw_used', message: WITHDRAW_USED_MESSAGE });
    expect((await taskRow(taskId)).status).toBe('submitted');

    // 处理记录：提交、撤回、再提交
    const history = await (await as('ops@test.cn')).get(`/api/tasks/${taskId}/history`);
    expect(history.status).toBe(200);
    const whats = (history.body as { what: string; extra: string | null }[]).map((e) => `${e.what}｜${e.extra}`);
    expect(whats).toEqual(['客户提交资料｜林管理员上传 Excel 模板', '客户撤回提交｜林管理员撤回了这次提交', '客户提交资料｜林管理员上传 Excel 模板']);
  });

  it('专家已开始核对：409 expert_started，状态不变', async () => {
    const { taskId } = await readyTask('耕云测试已核对有限公司');
    view(await submit(taskId));
    await expertStarts(taskId);
    const got = view(await (await as()).get(`/api/tasks/${taskId}/intake`));
    expect(got.expertStarted).toBe(true);
    expect(got.canWithdraw).toBe(false);
    const res = await withdraw(taskId);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'expert_started', message: EXPERT_STARTED_MESSAGE });
    expect((await taskRow(taskId)).status).toBe('submitted');
  });

  it('还没提交的不能撤回；运营 403', async () => {
    const { taskId } = await readyTask('耕云测试没提交有限公司');
    const early = await withdraw(taskId);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('not_withdrawable');
    view(await submit(taskId));
    const ops = await withdraw(taskId, 'ops@test.cn');
    expect(ops.status).toBe(403);
    expect(ops.body.message).toBe(READ_ONLY_MESSAGE);
    expect(view(await (await as('ops@test.cn')).get(`/api/tasks/${taskId}/intake`)).canWithdraw).toBe(false);
  });
});

describe('撤回和专家开始核对加锁', () => {
  /** 提交好、分给周工，还没打开 */
  async function assigned(name: string) {
    const { taskId } = await readyTask(name);
    view(await submit(taskId));
    await handle.db.update(tasks).set({ assignedExpertId: uid['zhou@test.cn']! }).where(eq(tasks.id, taskId));
    return taskId;
  }
  const open = async (taskId: string) => (await as('zhou@test.cn')).get(`/api/tasks/${taskId}/workup`);
  const workupRows = async (taskId: string) => (await handle.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId))).length;

  it('先撤回、后专家打开：409 customer_withdrew，不插快照', async () => {
    const taskId = await assigned('耕云测试先撤回有限公司');
    view(await withdraw(taskId));
    const res = await open(taskId);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'customer_withdrew', message: CUSTOMER_WITHDREW_MESSAGE });
    expect(await workupRows(taskId)).toBe(0);
    expect((await taskRow(taskId)).status).toBe('preparing');
    // 改好再提交：专家打开，快照取的是重新提交时的资料
    view(await submit(taskId));
    const ok = await open(taskId);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.snapshot.identity.name).toBe('耕云测试先撤回有限公司');
    expect(await workupRows(taskId)).toBe(1);
  });

  it('先专家打开、后撤回：撤回 409 expert_started，还是已提交', async () => {
    const taskId = await assigned('耕云测试先打开有限公司');
    expect((await open(taskId)).status).toBe(200);
    expect(await workupRows(taskId)).toBe(1);
    const res = await withdraw(taskId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('expert_started');
    expect((await taskRow(taskId)).status).toBe('submitted');
  });

  it('同时撤回和打开：只能是上面两种结果之一', async () => {
    for (let i = 0; i < 3; i++) {
      const taskId = await assigned(`耕云测试同时撤回${i}有限公司`);
      const [w, o] = await Promise.all([withdraw(taskId), open(taskId)]);
      const status = (await taskRow(taskId)).status;
      const rows = await workupRows(taskId);
      if (w.status === 200) {
        expect(o.status).toBe(409);
        expect(o.body.code).toBe('customer_withdrew');
        expect([status, rows]).toEqual(['preparing', 0]);
      } else {
        expect(w.status).toBe(409);
        expect(w.body.code).toBe('expert_started');
        expect(o.status).toBe(200);
        expect([status, rows]).toEqual(['submitted', 1]);
      }
    }
  }, 60_000); // 连建三个任务、各读一次表格，机器忙时会超过默认时限

  it('撤回后删掉的任务：负责专家打不开（404）', async () => {
    const taskId = await assigned('耕云测试删掉打不开有限公司');
    view(await withdraw(taskId));
    expect((await remove(taskId)).status).toBe(204);
    expect((await open(taskId)).status).toBe(404);
  });
});

describe('删除任务', () => {
  it('还在准备资料的、撤回以后的能删；已提交、已交付的 409；别家 404，运营 403', async () => {
    const preparing = await newTask('耕云测试删准备中有限公司');
    expect((await remove(preparing.taskId, 'ops@test.cn')).status).toBe(403);
    expect((await remove(preparing.taskId, 'stranger@test.cn')).status).toBe(404);
    expect((await remove(preparing.taskId)).status).toBe(204);
    expect((await remove(preparing.taskId)).status).toBe(404);

    const withdrawn = await readyTask('耕云测试删撤回有限公司');
    view(await submit(withdrawn.taskId));
    view(await withdraw(withdrawn.taskId));
    expect((await remove(withdrawn.taskId)).status).toBe(204);

    const submitted = await readyTask('耕云测试删已提交有限公司');
    view(await submit(submitted.taskId));
    const r = await remove(submitted.taskId);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe(UNDELETABLE_MESSAGE);
    await handle.db.update(tasks).set({ closedAt: new Date() }).where(eq(tasks.id, submitted.taskId));
    expect((await remove(submitted.taskId)).status).toBe(409);
    expect((await taskRow(submitted.taskId)).deletedAt).toBeNull();
  });

  it('删掉以后：哪里都看不到，提醒没了，能再建，不挡停用专家', async () => {
    const { taskId, enterpriseId } = await readyTask('耕云测试删后有限公司');
    view(await submit(taskId));
    await handle.db.update(tasks).set({ assignedExpertId: uid['wu@test.cn']! }).where(eq(tasks.id, taskId));
    view(await withdraw(taskId));
    await handle.db.insert(notifications).values({ userId: uid['admin@test.cn']!, taskId, title: '提醒', body: '一条提醒', link: '/' });

    const before = await (await as()).get(`/api/orgs/${orgId}/management`);
    const openTasks = async () =>
      ((await (await as('ops@test.cn')).get('/api/operator/organizations')).body as { id: string; openTasks: number }[]).find(
        (o) => o.id === orgId,
      )!.openTasks;
    const openBefore = await openTasks();
    expect((await remove(taskId)).status).toBe(204);
    // 管理端组织列表的在办任务数也减了 1
    expect(await openTasks()).toBe(openBefore - 1);
    const row = await taskRow(taskId);
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe(uid['admin@test.cn']);
    expect(await handle.db.select().from(notifications).where(eq(notifications.taskId, taskId))).toHaveLength(0);

    const admin = await as();
    expect((await admin.get(`/api/tasks/${taskId}`)).status).toBe(404);
    expect((await admin.get(`/api/tasks/${taskId}/intake`)).status).toBe(404);
    expect(((await admin.get(`/api/orgs/${orgId}/tasks`)).body as { id: string }[]).map((t) => t.id)).not.toContain(taskId);
    const ops = await as('ops@test.cn');
    expect(((await ops.get('/api/operator/tasks')).body as { id: string }[]).map((t) => t.id)).not.toContain(taskId);
    expect((await ops.get(`/api/operator/tasks/${taskId}`)).status).toBe(404);
    const expertList = (await (await as('wu@test.cn')).get('/api/expert/tasks')).body as { tasks?: { id: string }[] } | { id: string }[];
    expect(JSON.stringify(expertList)).not.toContain(taskId);
    // 组织管理页的统计少了这一个
    const after = await admin.get(`/api/orgs/${orgId}/management`);
    expect(after.body.service.inProgress).toBe(before.body.service.inProgress - 1);

    // 同一家企业可以再建
    const again = await admin.post(`/api/enterprises/${enterpriseId}/tasks`).send({ name: '2026 年应急预案编制' });
    expect(again.status).toBe(201);

    // 吴工名下只有这个删掉的任务：不算在办，能停用
    const accounts = (await ops.get('/api/operator/accounts')).body as { accounts: { id: string; openTasks: number }[] };
    expect(accounts.accounts.find((a) => a.id === uid['wu@test.cn'])?.openTasks).toBe(0);
    expect((await ops.post(`/api/operator/accounts/${uid['wu@test.cn']}/disable`)).status).toBe(200);
  });
});
