import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { checklistItems, enterprises, memberships, organizations, tasks, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';

const PASSWORD = 'correct horse battery staple';
const PDF = Buffer.from('%PDF-1.7\n% 技术人员名单\n');

let handle: DatabaseHandle;
let app: INestApplication;
let storageDir: string;
let customerOrg = '';
const uid: Record<string, string> = {};
const task = { feiyu: '', other: '', unreachable: '' };

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
  customerOrg = customer!.id;
  for (const p of [
    { email: 'feiyu@test.cn', name: '陈志刚', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const customerId = uid['feiyu@test.cn']!;
  const ents = await db
    .insert(enterprises)
    .values([
      { orgId: customer!.id, name: '惠阳飞宇电器有限公司', profile: feiyuProfile, createdBy: customerId },
      { orgId: customer!.id, name: '示例五金制品有限公司', createdBy: customerId },
      { orgId: customer!.id, name: '示例精工有限公司', createdBy: customerId },
    ])
    .returning();
  const submittedAt = new Date('2026-10-27T07:20:00Z');
  const base = { orgId: customer!.id, businessType: 'emergency_plan' as const, name: '2026 年应急预案', status: 'submitted' as const, submittedAt, createdBy: customerId };
  const created = await db
    .insert(tasks)
    .values([
      { ...base, enterpriseId: ents[0]!.id, number: 'GY-2026-001', assignedExpertId: uid['zhou@test.cn']! },
      { ...base, enterpriseId: ents[1]!.id, number: 'GY-2026-002', assignedExpertId: uid['wu@test.cn']! },
      { ...base, enterpriseId: ents[2]!.id, number: 'GY-2026-003', assignedExpertId: uid['zhou@test.cn']! },
    ])
    .returning();
  [task.feiyu, task.other, task.unreachable] = created.map((t) => t.id) as [string, string, string];
  const later = { status: 'later' as const, callRequested: true, updatedBy: customerId, updatedAt: new Date('2026-10-27T06:00:00Z') };
  await db.insert(checklistItems).values([
    { ...later, taskId: task.feiyu, itemKey: 'fire_pool' },
    { ...later, taskId: task.unreachable, itemKey: 'fire_pool' },
  ]);

  storageDir = mkdtempSync(join(tmpdir(), 'genyun-contacts-'));
  app = await createApp(db, { loginLimitPerMinute: 1000, storage: new LocalDiskStorage(storageDir, 'test-secret') });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

async function as(email: string) {
  const agent = request.agent(app.getHttpServer());
  expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  return agent;
}

const target = { name: '陈志刚', role: '总指挥', phone: '13800002071' };
const bannerOf = async (taskId: string) =>
  ((await (await as('zhou@test.cn')).get('/api/expert/tasks').expect(200)).body.tasks as { id: string; contact: unknown }[]).find(
    (t) => t.id === taskId,
  )!.contact;

describe('联系客户 · 我打电话问', () => {
  it('未接通照样记一条，但客户请求联系的倒计时不停', async () => {
    const zhou = await as('zhou@test.cn');
    const res = await zhou
      .post(`/api/tasks/${task.unreachable}/contacts`)
      .send({ method: 'phone', target, result: 'unreachable', questions: [{ itemKey: 'fire_pool', label: '消防水池', question: '有没有消防水池？' }] })
      .expect(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ method: 'phone', result: 'unreachable', createdByName: '周工', target });
    expect(await bannerOf(task.unreachable)).not.toBeNull();
  });

  it('已问清：回答回填到企业事实（客户确认 · 电话确认），请求联系的资料项变为已补，横幅消失', async () => {
    expect(await bannerOf(task.feiyu)).not.toBeNull();
    const zhou = await as('zhou@test.cn');
    await zhou
      .post(`/api/tasks/${task.feiyu}/contacts`)
      .send({
        method: 'phone',
        target,
        result: 'clarified',
        questions: [
          { factKey: 'technicalManagementCount', label: '技术人员数', question: '有多少技术人员？', answer: '6 位：工程师 2、技术员 4', value: 6 },
          { itemKey: 'fire_pool', label: '消防水池', question: '有没有消防水池？', answer: '厂区东侧 200 m³ 消防水池一座' },
        ],
      })
      .expect(201);

    const workup = await zhou.get(`/api/tasks/${task.feiyu}/workup`).expect(200);
    expect(workup.body.data.overrides.technicalManagementCount).toMatchObject({ value: 6, source: 'customer', via: 'phone', byName: '周工' });
    const [item] = await handle.db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.taskId, task.feiyu), eq(checklistItems.itemKey, 'fire_pool')));
    expect(item).toMatchObject({ status: 'provided', callRequested: false, note: '厂区东侧 200 m³ 消防水池一座' });
    expect(await bannerOf(task.feiyu)).toBeNull();
  });

  it('已问清但没写回答、回填的值类型不对都拒绝', async () => {
    const zhou = await as('zhou@test.cn');
    const q = { factKey: 'technicalManagementCount', label: '技术人员数', question: '有多少？' };
    const noAnswer = await zhou.post(`/api/tasks/${task.feiyu}/contacts`).send({ method: 'phone', target, result: 'clarified', questions: [q] }).expect(400);
    expect(noAnswer.body.message).toBe('请填写「技术人员数」的回答');
    const wrong = await zhou
      .post(`/api/tasks/${task.feiyu}/contacts`)
      .send({ method: 'phone', target, result: 'clarified', questions: [{ ...q, value: '六个' }] })
      .expect(400);
    expect(wrong.body.message).toBe('「技术人员数」：请填写人数');
  });
});

describe('联系客户 · 请客户在任务里补充', () => {
  let contactId = '';

  it('专家发出后，客户收到站内提醒、在任务里看到问题；联系记录本身客户看不到', async () => {
    const zhou = await as('zhou@test.cn');
    const res = await zhou
      .post(`/api/tasks/${task.feiyu}/contacts`)
      .send({
        method: 'request',
        questions: [
          { factKey: 'dutyPhone', label: '值班电话', question: '请提供 24 小时值班电话。' },
          { label: '夜班', question: '有没有夜班？夜班有几人？' },
        ],
      })
      .expect(201);
    contactId = res.body.at(-1).id;

    const customer = await as('feiyu@test.cn');
    const notes = await customer.get('/api/notifications').expect(200);
    expect(notes.body.unread).toBe(1);
    expect(notes.body.items[0]).toMatchObject({ title: '周工请您补充 2 项', link: `/customer/tasks/${task.feiyu}` });
    const requests = await customer.get(`/api/tasks/${task.feiyu}/requests`).expect(200);
    expect(requests.body).toEqual([
      expect.objectContaining({ id: contactId, createdByName: '周工', answeredAt: null, questions: [expect.objectContaining({ id: 'q1', label: '值班电话' }), expect.objectContaining({ id: 'q2' })] }),
    ]);
    expect(requests.body[0].questions[0].factKey).toBeUndefined();
    await customer.get(`/api/tasks/${task.feiyu}/contacts`).expect(404);
  });

  it('每个问题都要回答；客户回答（含文件）后专家收到提醒，文件进原件对照', async () => {
    const customer = await as('feiyu@test.cn');
    const partial = await customer
      .post(`/api/tasks/${task.feiyu}/requests/${contactId}/answer`)
      .send({ answers: [{ questionId: 'q1', text: '0752-3388001' }] })
      .expect(400);
    expect(partial.body.message).toBe('请回答「夜班」，写文字或附文件都可以');

    const upload = await customer.post(`/api/orgs/${customerOrg}/files?rule=material`).attach('file', PDF, '夜班排班表.pdf').expect(201);
    const fileId = upload.body.id as string;
    const res = await customer
      .post(`/api/tasks/${task.feiyu}/requests/${contactId}/answer`)
      .send({ answers: [{ questionId: 'q1', text: '0752-3388001' }, { questionId: 'q2', fileIds: [fileId] }] })
      .expect(201);
    expect(res.body[0]).toMatchObject({ answeredByName: '陈志刚', files: [{ id: fileId, name: '夜班排班表.pdf' }] });

    await customer.post(`/api/tasks/${task.feiyu}/requests/${contactId}/answer`).send({ answers: [{ questionId: 'q1', text: '再答一次' }, { questionId: 'q2', text: 'x' }] }).expect(409);

    const zhou = await as('zhou@test.cn');
    const notes = await zhou.get('/api/notifications').expect(200);
    expect(notes.body.items[0]).toMatchObject({ title: '惠阳飞宇电器有限公司回答了补充请求', link: `/expert/tasks/${task.feiyu}` });
    const workup = await zhou.get(`/api/tasks/${task.feiyu}/workup`).expect(200);
    expect(workup.body.originals.map((o: { name: string }) => o.name)).toContain('夜班排班表.pdf');
    const records = await zhou.get(`/api/tasks/${task.feiyu}/contacts`).expect(200);
    expect(records.body.at(-1).questions[0].answer).toBe('0752-3388001');
  });

  it('专家采用客户的回答：来源记为客户确认 · 任务内补充', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${task.feiyu}/workup`);
    const saved = await zhou
      .put(`/api/tasks/${task.feiyu}/workup/facts`)
      .send({ version: body.version, key: 'dutyPhone', value: '0752-3388001', contactId })
      .expect(200);
    expect(saved.body.data.overrides.dutyPhone).toMatchObject({ source: 'customer', via: 'request', contactId });
  });

  it('站内提醒标为已读', async () => {
    const customer = await as('feiyu@test.cn');
    const res = await customer.post('/api/notifications/read').send({}).expect(201);
    expect(res.body.unread).toBe(0);
  });
});

describe('联系客户 · 权限', () => {
  it('其他专家、客户不能发起联系；运营能看联系记录不能发起；专家不能替客户回答', async () => {
    const question = { method: 'request', questions: [{ label: '夜班', question: '有没有夜班？' }] };
    await (await as('wu@test.cn')).post(`/api/tasks/${task.feiyu}/contacts`).send(question).expect(404);
    await (await as('feiyu@test.cn')).post(`/api/tasks/${task.feiyu}/contacts`).send(question).expect(404);
    const ops = await as('ops@test.cn');
    await ops.get(`/api/tasks/${task.feiyu}/contacts`).expect(200);
    await ops.post(`/api/tasks/${task.feiyu}/contacts`).send(question).expect(403);

    const zhou = await as('zhou@test.cn');
    const res = await zhou.post(`/api/tasks/${task.feiyu}/contacts`).send(question).expect(201);
    const id = res.body.at(-1).id;
    await zhou.get(`/api/tasks/${task.feiyu}/requests`).expect(404);
    await zhou.post(`/api/tasks/${task.feiyu}/requests/${id}/answer`).send({ answers: [{ questionId: 'q1', text: '没有' }] }).expect(404);
  });

  it('不能采用还没回答的补充请求', async () => {
    const zhou = await as('zhou@test.cn');
    const res = await zhou
      .post(`/api/tasks/${task.feiyu}/contacts`)
      .send({ method: 'request', questions: [{ factKey: 'shortName', label: '企业简称', question: '简称？' }] })
      .expect(201);
    const { body } = await zhou.get(`/api/tasks/${task.feiyu}/workup`);
    const err = await zhou
      .put(`/api/tasks/${task.feiyu}/workup/facts`)
      .send({ version: body.version, key: 'shortName', value: 'FY', contactId: res.body.at(-1).id })
      .expect(400);
    expect(err.body.message).toBe('客户还没有回答这条补充请求');
  });
});
