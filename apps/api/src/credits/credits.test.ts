import { chinaToday, type OperatorOrgCredits, type OperatorOverview, type OrgCredits, type TaskDeliveries } from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  auditLogs,
  creditEntries,
  deliveries,
  deliveryFiles,
  enterpriseAssignments,
  enterprises,
  memberships,
  notifications,
  organizationContracts,
  organizations,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { InProcessQueue } from '../generation/queue.ts';
import { simplePdf, type PdfConverter } from '../generation/word/preview-pdf.ts';
import { MemoryMailer } from '../mail/mailer.ts';
import { PublishService } from '../tasks/publish.service.ts';
import type { ReviewService } from '../tasks/review.service.ts';
import { completeFor, testDocument } from '../tasks/test-workup.ts';
import { CreditsService } from './credits.service.ts';
import { grantCredits } from './test-credits.ts';

// 编制次数（K14）：首次交付扣 1 次、扣不到先锁住、下载锁、调整次数、放开、提醒、运营数据、并发
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
const renderer: DraftRenderer = async (kind) => ({ word: Buffer.from('word'), pdf: null, notes: [], document: testDocument(kind) });
const converter: PdfConverter = async () => simplePdf(['copy']);
const mailer = new MemoryMailer();

const uid: Record<string, string> = {};
const org: Record<'a' | 'b' | 'c' | 'd' | 'e', string> = { a: '', b: '', c: '', d: '', e: '' };
let codeSeq = 0;

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const rows = await db
    .insert(organizations)
    .values([
      // a：次数用完、锁住、放开的主流程
      { name: '飞宇演示客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: new Date() },
      // b：合同到期
      { name: '到期客户', kind: 'customer', contractStartsAt: '2025-01-01', contractEndsAt: '2025-12-31', activatedAt: new Date() },
      // c：没有合同
      { name: '没合同客户', kind: 'customer', activatedAt: new Date() },
      // d：次数提醒
      { name: '提醒客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: new Date() },
      // e：并发
      { name: '并发客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: new Date() },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  (['a', 'b', 'c', 'd', 'e'] as const).forEach((k, i) => (org[k] = rows[i]!.id));
  const internal = rows[5]!.id;
  // 管理员按建号先后：陈志刚在前
  const people = [
    { email: 'chen@test.cn', name: '陈志刚', orgId: org.a, role: 'customer_admin' as const },
    { email: 'wang@test.cn', name: '王经理', orgId: org.a, role: 'customer_admin' as const },
    { email: 'member@test.cn', name: '飞宇成员', orgId: org.a, role: 'customer_member' as const },
    { email: 'b-admin@test.cn', name: '到期管理员', orgId: org.b, role: 'customer_admin' as const },
    { email: 'c-admin@test.cn', name: '没合同管理员', orgId: org.c, role: 'customer_admin' as const },
    { email: 'd-admin@test.cn', name: '提醒管理员', orgId: org.d, role: 'customer_admin' as const },
    { email: 'd-admin2@test.cn', name: '提醒管理员二', orgId: org.d, role: 'customer_admin' as const },
    { email: 'e-admin@test.cn', name: '并发管理员', orgId: org.e, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal, role: 'expert' as const },
    { email: 'ops@test.cn', name: '运营', orgId: internal, role: 'operator' as const },
  ];
  for (const [i, p] of people.entries()) {
    const [u] = await db
      .insert(users)
      .values({ email: p.email, name: p.name, passwordHash, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) })
      .returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  // a：合同买 2 次、赠送 1 次
  await grantCredits(db, org.a, uid['ops@test.cn']!, { purchase: 2, gift: 1, number: 'GY-A-1' });
  // b：只有一份过期的合同
  await grantCredits(db, org.b, uid['ops@test.cn']!, { purchase: 5, startsAt: '2025-01-01', endsAt: '2025-12-31', number: 'GY-B-1' });
  await grantCredits(db, org.d, uid['ops@test.cn']!, { purchase: 4, number: 'GY-D-1' });
  await grantCredits(db, org.e, uid['ops@test.cn']!, { purchase: 1, number: 'GY-E-1' });

  app = await createApp(db, { loginLimitPerMinute: 1000, storage, queue, renderer, drafter: null, pdf: converter, mailer });
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

// 新建一家企业和一个已提交、分给周工的任务；成员能看到 a 组织的每家企业
async function newTask(orgId: string, createdBy: string, opts: { closedAt?: Date } = {}) {
  const { db } = handle;
  codeSeq++;
  const [ent] = await db
    .insert(enterprises)
    .values({
      orgId,
      name: `测试企业${codeSeq}有限公司`,
      socialCreditCode: `91441300726483${String(codeSeq).padStart(3, '0')}B`,
      legalRepresentative: '李文聪',
      registeredAddress: '惠州市仲恺高新区',
      profile: feiyuProfile,
      createdBy,
    })
    .returning();
  if (orgId === org.a) await db.insert(enterpriseAssignments).values({ enterpriseId: ent!.id, userId: uid['member@test.cn']!, orgId });
  const [task] = await db
    .insert(tasks)
    .values({
      orgId,
      enterpriseId: ent!.id,
      businessType: 'emergency_plan',
      name: '2026 年应急预案',
      number: `GY-2026-${String(codeSeq).padStart(3, '0')}`,
      status: 'submitted',
      assignedExpertId: uid['zhou@test.cn']!,
      createdBy,
      closedAt: opts.closedAt ?? null,
      reopenedAt: opts.closedAt ? new Date() : null,
      createdAt: new Date(Date.UTC(2026, 5, 1, 0, codeSeq)),
    })
    .returning();
  return { taskId: task!.id, enterpriseName: ent!.name };
}

// 生成 → 三份核对 → 审核结论，返回交付要带的内容
async function prepare(taskId: string) {
  const { db } = handle;
  const zhou = await as('zhou@test.cn');
  await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
  const [row] = await db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
  await db
    .update(taskWorkups)
    .set({ data: await completeFor(db, taskId, row!.snapshot, storage), version: row!.version + 1 })
    .where(eq(taskWorkups.taskId, taskId));
  await zhou.post(`/api/tasks/${taskId}/generation`).send({ version: row!.version + 1 }).expect(201);
  await queue.idle();
  const batchId: string = (await zhou.get(`/api/tasks/${taskId}/drafts/plan/edit`).expect(200)).body.batchId;
  const versions = { plan: 0, risk: 0, resource: 0 };
  for (const kind of ['plan', 'risk', 'resource']) await zhou.put(`/api/tasks/${taskId}/drafts/${kind}/check`).send({ version: 0 }).expect(200);
  await zhou.post(`/api/tasks/${taskId}/draft-review`).send({ note: '三份已核对。', versions }).expect(201);
  return { zhou, body: { batchId, versions } };
}

async function deliver(taskId: string) {
  const { zhou, body } = await prepare(taskId);
  const res = await zhou.post(`/api/tasks/${taskId}/publication`).send({ publishId: randomUUID(), ...body }).expect(201);
  expect(res.body.attempt).toMatchObject({ status: 'done' });
  return body;
}

async function bells(email: string): Promise<{ title: string; body: string; link: string }[]> {
  return (await (await as(email)).get('/api/notifications').expect(200)).body.items;
}

const chargeOf = async (taskId: string) =>
  (await handle.db.select({ s: tasks.chargeStatus }).from(tasks).where(eq(tasks.id, taskId)))[0]!.s;
const deductions = (taskId: string) =>
  handle.db
    .select()
    .from(creditEntries)
    .where(and(eq(creditEntries.taskId, taskId), eq(creditEntries.type, 'delivery_deduction')));
const firstFileId = async (taskId: string) =>
  (
    await handle.db
      .select({ id: deliveryFiles.fileId })
      .from(deliveryFiles)
      .innerJoin(deliveries, eq(deliveries.id, deliveryFiles.deliveryId))
      .where(eq(deliveries.taskId, taskId))
      .limit(1)
  )[0]!.id;
const mailsSince = (n: number) => mailer.sent.slice(n);
const adjust = async (orgId: string, body: object) => (await as('ops@test.cn')).post(`/api/operator/organizations/${orgId}/credits`).send(body);

describe('首次交付扣次数', () => {
  let t1 = '';
  let ent1 = '';
  it('扣 1 次，先扣赠送；任务记为已扣；照常发「已交付」；剩 2 次提醒管理员', async () => {
    ({ taskId: t1, enterpriseName: ent1 } = await newTask(org.a, uid['member@test.cn']!));
    await deliver(t1);
    expect(await chargeOf(t1)).toBe('charged');
    const rows = await deductions(t1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: -1, pool: 'gift', createdBy: uid['zhou@test.cn'], reason: null });
    expect((await bells('chen@test.cn')).map((b) => b.title)).toEqual(expect.arrayContaining([`${ent1}的成果已交付`, '编制次数还剩 2 次']));
    const member = await bells('member@test.cn');
    expect(member.map((b) => b.title)).toContain(`${ent1}的成果已交付`);
    // 成员看不到次数
    expect(member.some((b) => b.title.includes('次数'))).toBe(false);
  });

  it('重新打开后再交付不扣', async () => {
    await handle.db.update(tasks).set({ reopenedAt: new Date() }).where(eq(tasks.id, t1));
    // 同一批文稿再次交付：审核页的「已交付」判断先拦在前面，这里绕开（写法同 publish.test）
    const review = (app.get(PublishService) as unknown as { review: ReviewService }).review;
    const real = review.view.bind(review);
    const spy = vi.spyOn(review, 'view').mockImplementation(async (...args) => ({ ...(await real(...args)), published: null }));
    try {
      const zhou = await as('zhou@test.cn');
      const batchId: string = (await zhou.get(`/api/tasks/${t1}/drafts/plan/edit`).expect(200)).body.batchId;
      const res = await zhou
        .post(`/api/tasks/${t1}/publication`)
        .send({ publishId: randomUUID(), batchId, versions: { plan: 0, risk: 0, resource: 0 } })
        .expect(201);
      expect(res.body.attempt).toMatchObject({ status: 'done', version: 2 });
    } finally {
      spy.mockRestore();
    }
    expect(await deductions(t1)).toHaveLength(1);
    expect((await bells('chen@test.cn')).map((b) => b.title)).toContain(`${ent1}的成果已更新`);
  });

  it('已有 closedAt 的旧任务交付不扣', async () => {
    const { taskId } = await newTask(org.a, uid['chen@test.cn']!, { closedAt: new Date('2026-03-01T00:00:00Z') });
    await deliver(taskId);
    expect(await deductions(taskId)).toHaveLength(0);
    expect(await chargeOf(taskId)).toBe('not_charged');
  });
});

describe('调整次数', () => {
  it('校验：原因必填、赠送要活动名称、不为 0、只有运营能调', async () => {
    expect((await adjust(org.a, { type: 'top_up', delta: 1, reason: '  ' })).body.message).toBe('请写调整原因');
    expect((await adjust(org.a, { type: 'gift', delta: 1, reason: '活动' })).status).toBe(400);
    expect((await adjust(org.a, { type: 'top_up', delta: 0, reason: '错' })).status).toBe(400);
    const chen = await as('chen@test.cn');
    await chen.post(`/api/operator/organizations/${org.a}/credits`).send({ type: 'top_up', delta: 1, reason: '自己加' }).expect(403);
  });

  it('没有合同 409；减成负数被拒', async () => {
    const r = await adjust(org.c, { type: 'top_up', delta: 1, reason: '加购' });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('这个组织没有有效合同，请先登记续约');
    // a 的购买池还剩 2 次
    const over = await adjust(org.a, { type: 'top_up', delta: -3, reason: '退款' });
    expect(over.status).toBe(409);
    expect(over.body.message).toBe('这份合同的购买次数只剩 2 次，最多减 2 次');
  });

  it('减到 0：记台账和操作记录，管理员收到「编制次数已经用完」', async () => {
    const r = await adjust(org.a, { type: 'top_up', delta: -2, reason: '客户退回 2 次' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ released: 0, summary: { remaining: { total: 0 } } });
    const [log] = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'credits_adjust'));
    expect(log!.target).toBe('飞宇演示客户 · 加购次数 -2 次');
    expect((await bells('chen@test.cn')).map((b) => b.title)).toContain('编制次数已经用完');
    const again = await adjust(org.a, { type: 'top_up', delta: -1, reason: '再退' });
    expect(again.body.message).toBe('这份合同的购买次数已经是 0 次，不能再减');
    // 操作记录和次数记录同一个事务：被拒的调整不留操作记录
    expect(log).toMatchObject({ actorId: uid['ops@test.cn'], actorEmail: 'ops@test.cn' });
    expect(await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'credits_adjust'))).toHaveLength(1);
  });
});

describe('扣不到：成果先锁住', () => {
  let t2 = '';
  let ent2 = '';
  let t3 = '';
  it('任务等次数；锁住铃铛分管理员和成员；不发「已交付」；管理员都收到第 3 封，成员提交人收到第 4 封', async () => {
    ({ taskId: t2, enterpriseName: ent2 } = await newTask(org.a, uid['member@test.cn']!));
    const before = mailer.sent.length;
    await deliver(t2);
    expect(await chargeOf(t2)).toBe('awaiting_credits');
    expect(await deductions(t2)).toHaveLength(0);
    const chen = await bells('chen@test.cn');
    expect(chen.map((b) => b.title)).not.toContain(`${ent2}的成果已交付`);
    expect(chen.find((b) => b.title === `${ent2}的成果已编制好，等续约后下载`)?.body).toBe(
      '贵组织的编制次数已经用完。续约后自动放开，算 1 次。',
    );
    const member = await bells('member@test.cn');
    expect(member.find((b) => b.title === `${ent2}的成果已编制好，暂时还不能下载`)?.body).toBe(
      '需要贵组织管理员处理，请联系陈志刚、王经理。',
    );
    expect(member.map((b) => b.title)).not.toContain(`${ent2}的成果已交付`);
    expect((await bells('zhou@test.cn')).some((b) => b.title.includes(ent2))).toBe(false);

    const mails = mailsSince(before);
    expect(mails.map((m) => [m.kind, m.to]).sort()).toEqual(
      [
        ['credits_locked_admin', 'chen@test.cn'],
        ['credits_locked_admin', 'wang@test.cn'],
        ['credits_locked_submitter', 'member@test.cn'],
      ].sort(),
    );
    const admin = mails.find((m) => m.kind === 'credits_locked_admin')!;
    expect(admin.subject).toBe(`【耕云】${ent2}的应急预案已编制完成，补充次数后可以下载`);
    expect(admin.text).toContain('贵组织的编制次数已经用完，这份成果先锁住');
    expect(admin.text).toContain(`${chinaToday().replaceAll('-', '.')} 编制完成，还没放开下载`);
    expect(admin.text).toContain(`/customer/documents/${t2}`);
    const sub = mails.find((m) => m.kind === 'credits_locked_submitter')!;
    expect(sub.text).toContain('贵组织的管理员是陈志刚、王经理');
  });

  it('提交人是管理员时只发第 3 封', async () => {
    ({ taskId: t3 } = await newTask(org.a, uid['chen@test.cn']!));
    const before = mailer.sent.length;
    await deliver(t3);
    expect(await chargeOf(t3)).toBe('awaiting_credits');
    expect(mailsSince(before).map((m) => m.kind)).toEqual(['credits_locked_admin', 'credits_locked_admin']);
  });

  it('下载锁：管理员、成员单份下载和整套下载都 403，文案对；专家、运营照常', async () => {
    const fileId = await firstFileId(t2);
    const chen = await as('chen@test.cn');
    const member = await as('member@test.cn');
    expect((await chen.get(`/api/files/${fileId}/download-url`).expect(403)).body.message).toBe('编制次数已经用完，续约后就能下载');
    expect((await chen.get(`/api/tasks/${t2}/deliveries/1/bundle`).expect(403)).body.message).toBe('编制次数已经用完，续约后就能下载');
    expect((await member.get(`/api/files/${fileId}/download-url`).expect(403)).body.message).toBe('需要组织管理员处理后才能下载');
    expect((await member.get(`/api/tasks/${t2}/deliveries/1/bundle`).expect(403)).body.message).toBe('需要组织管理员处理后才能下载');
    for (const email of ['zhou@test.cn', 'ops@test.cn']) {
      const a = await as(email);
      await a.get(`/api/files/${fileId}/download-url`).expect(200);
      await a.get(`/api/tasks/${t2}/deliveries/1/bundle`).expect(200);
    }
    // 成果列表带锁住原因和管理员名字
    const list: TaskDeliveries[] = (await chen.get(`/api/orgs/${org.a}/deliveries`).expect(200)).body;
    expect(list.find((d) => d.taskId === t2)!.lock).toEqual({ reason: 'credits', adminNames: '陈志刚、王经理' });
    // 交付过两次的那份（重新打开后再交付）：客户只拿到最新一版，没锁
    const again = list.find((d) => d.versions[0]!.version === 2)!;
    expect(again).toMatchObject({ lock: null });
    expect(again.versions).toHaveLength(1);
    // 成员只拿到管理员名字，不带原因；专家、运营不带锁住信息
    expect((await member.get(`/api/tasks/${t2}/deliveries`).expect(200)).body.lock).toEqual({ adminNames: '陈志刚、王经理' });
    const memberList: TaskDeliveries[] = (await member.get(`/api/orgs/${org.a}/deliveries`).expect(200)).body;
    expect(memberList.find((d) => d.taskId === t2)?.lock ?? { adminNames: '' }).not.toHaveProperty('reason');
    for (const email of ['zhou@test.cn', 'ops@test.cn']) {
      expect((await (await as(email)).get(`/api/tasks/${t2}/deliveries`).expect(200)).body.lock).toBeNull();
    }
  });

  it('运营数据：次数记录、组织列表、概览的「次数用完」待办；组织管理员查自己的次数', async () => {
    const ops = await as('ops@test.cn');
    const view: OperatorOrgCredits = (await ops.get(`/api/operator/organizations/${org.a}/credits`).expect(200)).body;
    expect(view).toMatchObject({ remaining: { total: 0 }, granted: 1, used: 1, awaiting: 2, validUntil: '2099-12-31' });
    expect(view.typeCounts).toMatchObject({ contract_purchase: 1, gift: 1, top_up: 1, delivery_deduction: 1 });
    expect(view.giftCampaigns).toEqual([{ campaign: '开通赠送', total: 1 }]);
    const deduction = view.entries.find((e) => e.type === 'delivery_deduction')!;
    expect(deduction).toMatchObject({ typeLabel: '交付成果', delta: -1, pool: 'gift', contractNumber: 'GY-A-1', createdByName: '周工' });
    expect(deduction.taskNumber).toMatch(/^GY-2026-/);
    expect(view.entries[0]!.type).toBe('top_up');
    // 等次数的成果按任务生成先后；调整次数记在生效的合同上
    expect(view.awaitingTasks.map((t) => t.taskId)).toEqual([t2, t3]);
    expect(view.awaitingTasks[0]).toMatchObject({ enterpriseName: expect.any(String), deliveredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(view.adjustTarget).toMatchObject({ contractNumber: 'GY-A-1', endsAt: '2099-12-31', upcoming: false, balance: { gift: 0, purchase: 0 } });
    expect(deduction).toMatchObject({ contractEndsAt: '2099-12-31' });

    const list = (await ops.get('/api/operator/organizations').expect(200)).body as { id: string; credits: unknown }[];
    expect(list.find((o) => o.id === org.a)!.credits).toMatchObject({ awaiting: 2, remaining: { total: 0 } });

    const overview: OperatorOverview = (await ops.get('/api/operator/overview').expect(200)).body;
    const todo = overview.todos.find((t) => t.kind === 'credits_out' && t.id === org.a)!;
    expect(todo).toMatchObject({
      title: '飞宇演示客户',
      subtitle: '客户组织 · 剩余 0 次',
      note: '有 2 份成果已编制好，等次数到账后放开；客户加购或续约后在这里登记',
      action: '调整次数',
      link: `/operator/organizations/${org.a}?adjust=1`,
    });
    // 续约与次数：剩 0 次标黄，操作是调整次数
    expect(overview.renewals.find((r) => r.orgId === org.a)).toMatchObject({
      flagged: true,
      credits: { value: '剩 0 次', warn: true },
      action: { text: '调整次数', link: `/operator/organizations/${org.a}?adjust=1` },
    });

    const mine: OrgCredits = (await (await as('chen@test.cn')).get(`/api/orgs/${org.a}/credits`).expect(200)).body;
    expect(mine.awaitingTasks.map((t) => t.taskId)).toEqual([t2, t3]);
    // 次数记录：和运营看到的同一批（都在生效合同上），新的在前；不带原因、操作人、合同编号
    expect(mine.entries.map((e) => e.id)).toEqual(view.entries.map((e) => e.id));
    for (const e of mine.entries) {
      expect(e).not.toHaveProperty('reason');
      expect(e).not.toHaveProperty('createdByName');
      expect(e).not.toHaveProperty('contractNumber');
    }
    expect(mine.entries.find((e) => e.type === 'delivery_deduction')).toMatchObject({
      delta: -1,
      pool: 'gift',
      taskNumber: deduction.taskNumber,
      enterpriseName: deduction.enterpriseName,
      contractEndsAt: '2099-12-31',
    });
    expect(mine.entries.find((e) => e.type === 'gift')).toMatchObject({ campaign: '开通赠送', taskNumber: null, enterpriseName: null });
    // 只有过期合同的组织：次数记录为空
    const expiredOrg: OrgCredits = (await (await as('b-admin@test.cn')).get(`/api/orgs/${org.b}/credits`).expect(200)).body;
    expect(expiredOrg).toMatchObject({ validUntil: null, entries: [] });
    await (await as('member@test.cn')).get(`/api/orgs/${org.a}/credits`).expect(403);
    expect([403, 404]).toContain((await (await as('zhou@test.cn')).get(`/api/orgs/${org.a}/credits`)).status);
    await (await as('b-admin@test.cn')).get(`/api/orgs/${org.a}/credits`).expect(404);
  });

  it('加赠送 1 次：按任务先后只放开前一份；第 5 封同一人一封；放开铃铛写「次数已到账」', async () => {
    const before = mailer.sent.length;
    const r = await adjust(org.a, { type: 'gift', delta: 1, reason: '老客户回馈', campaign: '老客户回馈' });
    expect(r.status).toBe(200);
    expect(r.body.released).toBe(1);
    expect(await chargeOf(t2)).toBe('charged');
    expect(await chargeOf(t3)).toBe('awaiting_credits');
    const [row] = await deductions(t2);
    expect(row).toMatchObject({ pool: 'gift', createdBy: uid['zhou@test.cn'] });
    const released = mailsSince(before).filter((m) => m.kind === 'delivery_released');
    expect(released.map((m) => m.to).sort()).toEqual(['chen@test.cn', 'member@test.cn', 'wang@test.cn']);
    expect(released[0]!.subject).toBe(`【耕云】${ent2}的应急预案现在可以下载了`);
    expect((await bells('chen@test.cn')).find((b) => b.title === `${ent2}的成果可以下载了`)?.body).toBe(
      '次数已到账，这份成果已放开，算 1 次。',
    );
    expect((await bells('member@test.cn')).find((b) => b.title === `${ent2}的成果可以下载了`)?.body).toBe('三份文档已放开，点开就能下载。');
    // 放开以后能下载
    await (await as('member@test.cn')).get(`/api/files/${await firstFileId(t2)}/download-url`).expect(200);
  });
});

describe('合同到期', () => {
  it('锁住写「年度服务已到期」；新合同到了开始日期，每小时扫描放开，铃铛写「续约已生效」', async () => {
    const { taskId, enterpriseName } = await newTask(org.b, uid['b-admin@test.cn']!);
    const before = mailer.sent.length;
    await deliver(taskId);
    expect(await chargeOf(taskId)).toBe('awaiting_credits');
    const mail = mailsSince(before).find((m) => m.kind === 'credits_locked_admin')!;
    expect(mail.subject).toBe(`【耕云】${enterpriseName}的应急预案已编制完成，续约后可以下载`);
    expect(mail.text).toContain('贵组织的年度服务已到期，这份成果先锁住');
    expect((await bells('b-admin@test.cn')).find((b) => b.title.endsWith('等续约后下载'))?.body).toBe(
      '贵组织的年度服务已到期。续约后自动放开，算 1 次。',
    );
    const admin = await as('b-admin@test.cn');
    expect((await admin.get(`/api/files/${await firstFileId(taskId)}/download-url`).expect(403)).body.message).toBe(
      '年度服务已到期，续约后就能下载',
    );

    // 新合同明天才开始：扫描不放开；到了开始日期再扫描就放开
    const service = app.get(CreditsService);
    const tomorrow = new Date(Date.now() + 86_400_000);
    const contractId = await grantCredits(handle.db, org.b, uid['ops@test.cn']!, {
      purchase: 3,
      startsAt: chinaToday(tomorrow),
      endsAt: '2099-12-31',
    });
    expect(await service.scan()).toBe(0);
    expect(await chargeOf(taskId)).toBe('awaiting_credits');
    await handle.db.update(organizationContracts).set({ startsAt: chinaToday() }).where(eq(organizationContracts.id, contractId));
    expect(await service.scan()).toBe(1);
    expect(await chargeOf(taskId)).toBe('charged');
    expect((await bells('b-admin@test.cn')).find((b) => b.title === `${enterpriseName}的成果可以下载了`)?.body).toBe(
      '续约已生效，这份成果已放开，算 1 次。',
    );
  });
});

describe('次数提醒', () => {
  const lowTitles = async (email = 'd-admin@test.cn') =>
    (await bells(email)).map((b) => b.title).filter((t) => t.startsWith('编制次数'));

  // 交付扣减直接插行（不挂任务），再像交付后那样检查提醒
  const deduct = async (n: number) => {
    const [contract] = await handle.db
      .select({ id: organizationContracts.id })
      .from(organizationContracts)
      .where(eq(organizationContracts.orgId, org.d));
    for (let i = 0; i < n; i++) {
      await handle.db.insert(creditEntries).values({
        orgId: org.d,
        type: 'delivery_deduction',
        delta: -1,
        contractId: contract!.id,
        pool: 'purchase',
        createdBy: uid['zhou@test.cn']!,
      });
      await app.get(CreditsService).checkReminders(org.d);
    }
  };

  it('剩 3、2、1 各一次；加次数本身不提醒，之后再扣到 3 次重新提醒；用完提醒一次', async () => {
    const count = async (title: string) => (await lowTitles()).filter((t) => t === title).length;
    await deduct(1);
    await app.get(CreditsService).checkReminders(org.d);
    await deduct(2);
    expect((await lowTitles()).sort()).toEqual(['编制次数还剩 1 次', '编制次数还剩 2 次', '编制次数还剩 3 次']);
    // 剩 1 次时加 3 次（剩 4 次）：加次数本身不提醒
    expect((await adjust(org.d, { type: 'top_up', delta: 3, reason: '加购' })).status).toBe(200);
    expect((await lowTitles()).length).toBe(3);
    // 之后扣到 3 次（共几次变了），重新提醒
    await deduct(1);
    expect(await count('编制次数还剩 3 次')).toBe(2);
    await deduct(3);
    await app.get(CreditsService).checkReminders(org.d);
    expect(await count('编制次数已经用完')).toBe(1);
    // 用完后加 2 次（0 → 2）：不冒出「还剩 2 次」
    const before = await count('编制次数还剩 2 次');
    expect((await adjust(org.d, { type: 'top_up', delta: 2, reason: '加购' })).status).toBe(200);
    expect(await count('编制次数还剩 2 次')).toBe(before);
    // 成员不收（d 组织这时还没有成员）；专家、运营不收
    expect((await bells('ops@test.cn')).some((b) => b.title.startsWith('编制次数'))).toBe(false);
  });

  it('管理员改成成员后，次数铃铛被删掉', async () => {
    expect((await lowTitles('d-admin2@test.cn')).length).toBeGreaterThan(0);
    const admin = await as('d-admin@test.cn');
    await admin.put(`/api/orgs/${org.d}/management/members/${uid['d-admin2@test.cn']}/role`).send({ role: 'customer_member' }).expect(200);
    expect(await lowTitles('d-admin2@test.cn')).toEqual([]);
    const left = await handle.db.select().from(notifications).where(eq(notifications.userId, uid['d-admin2@test.cn']!));
    expect(left.some((n) => n.title.startsWith('编制次数'))).toBe(false);
  });
});

describe('并发', () => {
  it('只剩 1 次时两个首次交付同时到，只有一个扣到', async () => {
    const a = await newTask(org.e, uid['e-admin@test.cn']!);
    const b = await newTask(org.e, uid['e-admin@test.cn']!);
    const pa = await prepare(a.taskId);
    const pb = await prepare(b.taskId);
    await Promise.all([
      pa.zhou.post(`/api/tasks/${a.taskId}/publication`).send({ publishId: randomUUID(), ...pa.body }).expect(201),
      pb.zhou.post(`/api/tasks/${b.taskId}/publication`).send({ publishId: randomUUID(), ...pb.body }).expect(201),
    ]);
    const states = [await chargeOf(a.taskId), await chargeOf(b.taskId)].sort();
    expect(states).toEqual(['awaiting_credits', 'charged']);
    const all = await handle.db
      .select()
      .from(creditEntries)
      .where(and(eq(creditEntries.orgId, org.e), eq(creditEntries.type, 'delivery_deduction')));
    expect(all).toHaveLength(1);
  });
});

describe('定时扫描', () => {
  it('关掉应用时清掉定时器', async () => {
    const other = await openDatabase('memory://');
    const second = await createApp(other.db, { storage, queue: new InProcessQueue(), renderer, drafter: null, pdf: converter, mailer });
    await second.init();
    const timer = (second.get(CreditsService) as unknown as { timer: unknown }).timer;
    expect(timer).toBeDefined();
    const spy = vi.spyOn(globalThis, 'clearInterval');
    await second.close();
    expect(spy).toHaveBeenCalledWith(timer);
    spy.mockRestore();
    await other.close();
    // 另开一个库要跑迁移，给足时间
  }, 60_000);
});
