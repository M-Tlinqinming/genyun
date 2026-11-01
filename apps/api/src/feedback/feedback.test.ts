import { randomUUID } from 'node:crypto';
import type { CustomerFeedback, OperatorFeedback, OperatorFeedbackView, OperatorOverview } from '@genyun/shared';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  auditLogs,
  deliveries,
  enterpriseAssignments,
  enterprises,
  files,
  generationBatches,
  memberships,
  notifications,
  organizations,
  tasks,
  users,
} from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
const id: Record<string, string> = {};

async function addFile(orgId: string, uploadedBy: string, name: string) {
  const fileId = randomUUID();
  await handle.db.insert(files).values({
    id: fileId,
    orgId,
    kind: 'customer_material',
    originalName: name,
    contentType: 'image/png',
    sizeBytes: 10,
    sha256: 'x',
    storageKey: `${orgId}/${fileId}`,
    uploadedBy,
  });
  return fileId;
}

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  const [orgA, orgB, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例安全咨询机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: now },
      { name: '别家咨询公司', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: now },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  id.orgA = orgA!.id;
  id.orgB = orgB!.id;
  for (const p of [
    { email: 'admin@a.cn', name: '林管理员', orgId: orgA!.id, role: 'customer_admin' as const },
    { email: 'member@a.cn', name: '陈编制', orgId: orgA!.id, role: 'customer_member' as const },
    { email: 'admin@b.cn', name: '吴主任', orgId: orgB!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const admin = uid['admin@a.cn']!;
  const zhou = uid['zhou@test.cn']!;
  const [mine, other] = await db
    .insert(enterprises)
    .values([
      { orgId: orgA!.id, name: '示例包装有限公司', createdBy: admin },
      { orgId: orgA!.id, name: '示例电子有限公司', createdBy: admin },
    ])
    .returning();
  // 成员只分到包装
  await db.insert(enterpriseAssignments).values({ enterpriseId: mine!.id, userId: uid['member@a.cn']!, orgId: orgA!.id });
  const base = { orgId: orgA!.id, businessType: 'emergency_plan' as const, name: '2026 年应急预案', createdBy: admin, status: 'submitted' as const, submittedAt: now };
  const [delivered, hidden] = await db
    .insert(tasks)
    .values([
      { ...base, enterpriseId: mine!.id, number: 'GY-2026-003', assignedExpertId: zhou, assignedAt: now, closedAt: now },
      { ...base, enterpriseId: other!.id, number: 'GY-2026-002' },
    ])
    .returning();
  id.task = delivered!.id;
  id.hiddenTask = hidden!.id;
  const [batch] = await db
    .insert(generationBatches)
    .values({ taskId: delivered!.id, workupVersion: 1, snapshotAt: now, input: {} as never, materials: [], createdBy: zhou })
    .returning();
  await db.insert(deliveries).values({
    publishId: randomUUID(),
    taskId: delivered!.id,
    batchId: batch!.id,
    version: 1,
    status: 'done',
    reviewedBy: zhou,
    reviewedAt: now,
    versions: { plan: 0, risk: 0, resource: 0 },
    publishedBy: zhou,
    publishedAt: now,
  });
  id.memberFile = await addFile(orgA!.id, uid['member@a.cn']!, '下载页截图.png');
  // 机构管理员上传的、没挂到成员企业上的文件：成员不能借反馈附上
  id.adminFile = await addFile(orgA!.id, admin, '电子厂平面图.png');
  id.otherOrgFile = await addFile(orgB!.id, uid['admin@b.cn']!, '别家.png');

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

const notesOf = async (email: string) =>
  handle.db.select({ title: notifications.title, body: notifications.body, link: notifications.link }).from(notifications).where(eq(notifications.userId, uid[email]!));

describe('客户提交反馈', () => {
  it('成员从成果文档页就自己企业的交付版本提交，可附自己上传的文件；默认「成果内容」', async () => {
    const member = await as('member@a.cn');
    const res = await member
      .post(`/api/orgs/${id.orgA}/feedback`)
      .send({ content: '希望更容易找到整套下载\n每次要分别点三份文档下载。', fileIds: [id.memberFile], taskId: id.task, deliveryVersion: 1, source: 'delivery' })
      .expect(201);
    const fb = res.body as CustomerFeedback;
    expect(fb).toMatchObject({
      title: '希望更容易找到整套下载',
      status: 'new',
      source: 'delivery',
      enterpriseName: '示例包装有限公司',
      taskNumber: 'GY-2026-003',
      deliveryVersion: 1,
      files: [{ id: id.memberFile, name: '下载页截图.png' }],
      reply: null,
    });
    id.fb = fb.id;
  });

  it('通用入口只写意见也能提交', async () => {
    const admin = await as('admin@a.cn');
    const fb = (await admin.post(`/api/orgs/${id.orgA}/feedback`).send({ content: '邀请邮件进了垃圾箱' }).expect(201)).body as CustomerFeedback;
    expect(fb).toMatchObject({ source: 'general', taskId: null, enterpriseName: null });
    id.fbAdmin = fb.id;
  });

  it('意见为空、交付版本不存在都拒绝', async () => {
    const member = await as('member@a.cn');
    expect((await member.post(`/api/orgs/${id.orgA}/feedback`).send({ content: '  ' })).status).toBe(400);
    expect((await member.post(`/api/orgs/${id.orgA}/feedback`).send({ content: '版本', taskId: id.task, deliveryVersion: 9 })).status).toBe(404);
  });

  it('越权：成员不能就没分到的企业反馈、不能附别人的文件；别家客户 404；未登录 401', async () => {
    const member = await as('member@a.cn');
    expect((await member.post(`/api/orgs/${id.orgA}/feedback`).send({ content: '电子厂', taskId: id.hiddenTask })).status).toBe(404);
    expect((await member.post(`/api/orgs/${id.orgA}/feedback`).send({ content: '附件', fileIds: [id.adminFile] })).status).toBe(404);
    expect((await member.post(`/api/orgs/${id.orgA}/feedback`).send({ content: '附件', fileIds: [id.otherOrgFile] })).status).toBe(404);
    const other = await as('admin@b.cn');
    expect((await other.post(`/api/orgs/${id.orgA}/feedback`).send({ content: '别家' })).status).toBe(404);
    expect((await other.get(`/api/orgs/${id.orgA}/feedback`)).status).toBe(404);
    // 别家客户拿自己组织提交，却挂上 A 组织的任务
    expect((await other.post(`/api/orgs/${id.orgB}/feedback`).send({ content: '挂别家任务', taskId: id.task })).status).toBe(404);
    // 运营、注安师不替客户提交
    expect((await (await as('ops@test.cn')).post(`/api/orgs/${id.orgA}/feedback`).send({ content: '运营' })).status).toBe(404);
    expect((await request(app.getHttpServer()).post(`/api/orgs/${id.orgA}/feedback`).send({ content: '未登录' })).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`/api/orgs/${id.orgA}/feedback`)).status).toBe(401);
  });

  it('成员只看到自己提交的，机构管理员看到本组织全部', async () => {
    const mine = (await (await as('member@a.cn')).get(`/api/orgs/${id.orgA}/feedback`).expect(200)).body as CustomerFeedback[];
    expect(mine.map((f) => f.id)).toEqual([id.fb]);
    const all = (await (await as('admin@a.cn')).get(`/api/orgs/${id.orgA}/feedback`).expect(200)).body as CustomerFeedback[];
    expect(all.map((f) => f.id).sort()).toEqual([id.fb, id.fbAdmin].sort());
  });
});

describe('运营受理反馈', () => {
  it('只有运营能看、能处理：客户、注安师 403，未登录 401', async () => {
    for (const email of ['admin@a.cn', 'member@a.cn', 'zhou@test.cn']) {
      const agent = await as(email);
      expect((await agent.get('/api/operator/feedback')).status).toBe(403);
      expect((await agent.patch(`/api/operator/feedback/${id.fb}`).send({ action: 'accept' })).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/api/operator/feedback')).status).toBe(401);
    expect((await request(app.getHttpServer()).patch(`/api/operator/feedback/${id.fb}`).send({ action: 'accept' })).status).toBe(401);
  });

  it('列表：待受理在前，带企业、任务、附件、负责注安师', async () => {
    const ops = await as('ops@test.cn');
    const view = (await ops.get('/api/operator/feedback').expect(200)).body as OperatorFeedbackView;
    expect(view.counts).toEqual({ new: 2, processing: 0, closed: 0 });
    const fb = view.items.find((f) => f.id === id.fb)!;
    expect(fb).toMatchObject({ orgName: '示例安全咨询机构', createdByName: '陈编制', category: 'content', taskExpertName: '周工', internalNote: null });
    expect((await ops.patch(`/api/operator/feedback/${randomUUID()}`).send({ action: 'accept' })).status).toBe(404);
  });

  it('概览：待跟进反馈的数字和「待受理反馈」待办', async () => {
    const ops = await as('ops@test.cn');
    const o = (await ops.get('/api/operator/overview').expect(200)).body as OperatorOverview;
    expect(o.feedback).toEqual({ new: 2, processing: 0 });
    const todo = o.todos.find((t) => t.kind === 'feedback' && t.id === id.fb);
    expect(todo).toMatchObject({ title: '示例包装有限公司', subtitle: 'GY-2026-003 · 已交付 V1', action: '受理反馈', link: `/operator/feedback?id=${id.fb}` });
  });

  it('受理：变为处理中，提醒提交人，记操作日志；客户看不到内部备注和回复草稿', async () => {
    const ops = await as('ops@test.cn');
    const fb = (await ops
      .patch(`/api/operator/feedback/${id.fb}`)
      .send({ action: 'accept', internalNote: '记到需求池', reply: '草稿' })
      .expect(200)).body as OperatorFeedback;
    expect(fb).toMatchObject({ status: 'processing', handlerName: '赵运营', internalNote: '记到需求池' });
    expect(await notesOf('member@a.cn')).toEqual([
      { title: '耕云已受理您的反馈', body: '「希望更容易找到整套下载」已由耕云运营受理，处理结果会在这里通知您。', link: `/customer/feedback?id=${id.fb}` },
    ]);
    const mine = (await (await as('member@a.cn')).get(`/api/orgs/${id.orgA}/feedback`).expect(200)).body as CustomerFeedback[];
    expect(mine[0]).toMatchObject({ status: 'processing', reply: null });
    expect(mine[0]).not.toHaveProperty('internalNote');
    const logs = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'feedback_accept'));
    expect(logs.map((l) => l.target)).toEqual(['示例安全咨询机构 · 希望更容易找到整套下载']);
  });

  it('转给注安师：只限成果内容、有负责注安师的任务；注安师收到站内提醒', async () => {
    const ops = await as('ops@test.cn');
    expect((await ops.patch(`/api/operator/feedback/${id.fb}`).send({ action: 'forward', category: 'platform' })).status).toBe(400);
    expect((await ops.patch(`/api/operator/feedback/${id.fbAdmin}`).send({ action: 'forward', category: 'content' })).status).toBe(400);
    const fb = (await ops.patch(`/api/operator/feedback/${id.fb}`).send({ action: 'forward', category: 'content' }).expect(200)).body as OperatorFeedback;
    expect(fb).toMatchObject({ forwardedToName: '周工', status: 'processing' });
    const notes = await notesOf('zhou@test.cn');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: '客户反馈了成果内容', link: `/expert/tasks/${id.task}` });
    expect(notes[0]!.body).toContain('已交付版本保持不变');
    expect(await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'feedback_forward'))).toHaveLength(1);
  });

  it('回复并关闭：回复必填；客户看到回复和站内提醒；关闭后不能再改', async () => {
    const ops = await as('ops@test.cn');
    expect((await ops.patch(`/api/operator/feedback/${id.fb}`).send({ action: 'close', reply: '' })).status).toBe(400);
    const reply = '感谢反馈。成果文档页已有「下载整套 Word」。';
    const fb = (await ops.patch(`/api/operator/feedback/${id.fb}`).send({ action: 'close', reply, category: 'platform' }).expect(200)).body as OperatorFeedback;
    expect(fb).toMatchObject({ status: 'closed', closedByName: '赵运营', category: 'platform', reply });
    expect((await notesOf('member@a.cn')).map((n) => n.title).sort()).toEqual(['您的反馈已处理', '耕云已受理您的反馈']);
    const mine = (await (await as('member@a.cn')).get(`/api/orgs/${id.orgA}/feedback`).expect(200)).body as CustomerFeedback[];
    expect(mine[0]).toMatchObject({ status: 'closed', reply });
    expect((await ops.patch(`/api/operator/feedback/${id.fb}`).send({ action: 'save', internalNote: '再改' })).status).toBe(409);
    expect(await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'feedback_close'))).toHaveLength(1);
  });

  it('待受理的直接回复并关闭也算受理；不改任务状态、不动交付版本', async () => {
    const ops = await as('ops@test.cn');
    const fb = (await ops.patch(`/api/operator/feedback/${id.fbAdmin}`).send({ action: 'close', reply: '已协助加入白名单', category: 'account' }).expect(200)).body as OperatorFeedback;
    expect(fb).toMatchObject({ status: 'closed', handlerName: '赵运营' });
    expect((await notesOf('admin@a.cn')).map((n) => n.title)).toEqual(['您的反馈已处理']);
    const [task] = await handle.db.select().from(tasks).where(eq(tasks.id, id.task!));
    expect(task).toMatchObject({ status: 'submitted', assignedExpertId: uid['zhou@test.cn'] });
    expect(task!.closedAt).not.toBeNull();
    const versions = await handle.db.select().from(deliveries).where(and(eq(deliveries.taskId, id.task!), eq(deliveries.status, 'done')));
    expect(versions.map((d) => d.version)).toEqual([1]);
    const batches = await handle.db.select().from(generationBatches).where(eq(generationBatches.taskId, id.task!));
    expect(batches).toHaveLength(1);
    const o = (await ops.get('/api/operator/overview').expect(200)).body as OperatorOverview;
    expect(o.feedback).toEqual({ new: 0, processing: 0 });
  });
});
