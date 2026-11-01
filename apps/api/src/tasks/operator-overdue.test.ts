import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  checklistItems,
  enterprises,
  memberships,
  notifications,
  onSiteRequests,
  organizations,
  taskContacts,
  tasks,
  users,
} from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
const task: Record<'silent' | 'unreachable' | 'reached' | 'fresh' | 'reassigned' | 'noCall', string> = {
  silent: '',
  unreachable: '',
  reached: '',
  fresh: '',
  reassigned: '',
  noCall: '',
};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例安全咨询机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
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
  const keys = Object.keys(task) as (keyof typeof task)[];
  const ents = await db
    .insert(enterprises)
    .values(keys.map((k) => ({ orgId: customer!.id, name: `示例${k}有限公司`, createdBy: by })))
    .returning();
  // 2026-10-27（周二）提交，2 个工作日后是 10-29，现在早已超时
  const long = new Date('2026-10-27T07:20:00Z');
  const now = new Date();
  const created = await db
    .insert(tasks)
    .values(
      keys.map((k, i) => {
        const at = k === 'fresh' ? now : long;
        return {
          orgId: customer!.id,
          enterpriseId: ents[i]!.id,
          number: `GY-2026-00${i + 1}`,
          businessType: 'emergency_plan' as const,
          name: '2026 年应急预案',
          status: 'submitted' as const,
          submittedAt: at,
          createdBy: by,
          assignedExpertId: zhou,
          // 刚改派过：期限从新注安师接手重新算
          assignedAt: k === 'reassigned' ? now : at,
        };
      }),
    )
    .returning();
  keys.forEach((k, i) => (task[k] = created[i]!.id));
  for (const k of keys) {
    if (k === 'noCall') continue;
    await db.insert(checklistItems).values({
      taskId: task[k],
      itemKey: 'fire_pool',
      status: 'later',
      callRequested: true,
      updatedBy: by,
      updatedAt: k === 'fresh' ? now : new Date('2026-10-27T06:00:00Z'),
    });
  }
  const phone = { method: 'phone' as const, questions: [], createdBy: zhou };
  await db.insert(taskContacts).values([
    { ...phone, taskId: task.unreachable, result: 'unreachable', createdAt: new Date('2026-10-28T02:00:00Z') },
    { ...phone, taskId: task.unreachable, result: 'unreachable', createdAt: new Date('2026-10-28T08:00:00Z') },
    { ...phone, taskId: task.reached, result: 'later', createdAt: new Date('2026-10-28T02:00:00Z') },
  ]);

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

describe('超时兜底', () => {
  it('客户请电话联系后 2 个工作日没联系上的任务进超时兜底，带原因和联系记录', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.get('/api/operator/tasks/overdue');
    expect(res.status).toBe(200);
    const rows = res.body as { id: string; reason: string; contacts: { result: string }[]; request: { labels: string[] } }[];
    // 联系上了的、刚提交的、刚改派的、没请电话联系的都不在里面
    expect(rows.map((r) => r.id).sort()).toEqual([task.silent, task.unreachable].sort());
    const silent = rows.find((r) => r.id === task.silent)!;
    expect(silent).toMatchObject({ reason: '还没有联系过客户', contacts: [], request: { labels: ['消防水池'] } });
    const unreachable = rows.find((r) => r.id === task.unreachable)!;
    expect(unreachable.reason).toBe('打过 2 次电话都没接通');
    expect(unreachable.contacts.map((c) => c.result)).toEqual(['unreachable', 'unreachable']);
  });

  it('写内部备注：记在任务上，只有运营看得到', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.post(`/api/operator/tasks/${task.silent}/notes`).send({ body: '客户说周五前回电' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual([expect.objectContaining({ kind: 'note', body: '客户说周五前回电', createdByName: '赵运营' })]);
    expect((await ops.post(`/api/operator/tasks/${task.silent}/notes`).send({ body: '  ' })).status).toBe(400);

    for (const email of ['admin@test.cn', 'zhou@test.cn']) {
      const other = await as(email);
      expect((await other.get(`/api/operator/tasks/${task.silent}/notes`)).status).toBe(403);
      expect((await other.post(`/api/operator/tasks/${task.silent}/notes`).send({ body: 'x' })).status).toBe(403);
    }
    // 客户看任务时没有内部备注
    const admin = await as('admin@test.cn');
    const view = await admin.get(`/api/tasks/${task.silent}`);
    expect(JSON.stringify(view.body)).not.toContain('客户说周五前回电');
  });

  it('提醒注安师：负责注安师收到站内提醒，任务上记一条', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.post(`/api/operator/tasks/${task.unreachable}/remind`).send({ body: '客户上午在厂里' });
    expect(res.status).toBe(201);
    expect(res.body[0]).toMatchObject({ kind: 'remind_expert', body: '周工 · 客户上午在厂里' });
    const sent = await handle.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, uid['zhou@test.cn']!), eq(notifications.taskId, task.unreachable)));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('运营提醒：请尽快联系客户');
    expect(sent[0]!.body.startsWith('运营说明：客户上午在厂里')).toBe(true);
    // 客户、注安师不能发
    expect((await (await as('zhou@test.cn')).post(`/api/operator/tasks/${task.unreachable}/remind`).send({})).status).toBe(403);
  });

  it('从超时兜底改派：任务上记一条改派，期限从新注安师接手重新算', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops
      .post(`/api/operator/tasks/${task.silent}/assign`)
      .send({ expertId: uid['wu@test.cn'], currentExpertId: uid['zhou@test.cn'], reason: 'busy' });
    expect(res.status).toBe(201);
    const notes = (await ops.get(`/api/operator/tasks/${task.silent}/notes`)).body as { kind: string; body: string }[];
    expect(notes[0]).toMatchObject({ kind: 'reassign', body: '周工 → 吴工 · 忙不过来' });
    const overdue = (await ops.get('/api/operator/tasks/overdue')).body as { id: string }[];
    expect(overdue.map((r) => r.id)).toEqual([task.unreachable]);
  });
});

describe('上门工单', () => {
  it('客户提交的上门需求出现在上门工单；运营写内部备注、转交、关闭；客户、注安师不能处理', async () => {
    const [t] = await handle.db.select().from(tasks).where(eq(tasks.id, task.noCall));
    const [req] = await handle.db
      .insert(onSiteRequests)
      .values({
        orgId: t!.orgId,
        enterpriseId: t!.enterpriseId,
        taskId: t!.id,
        contactName: '陈经理',
        contactPhone: '0752-1234567',
        helpItems: ['消防水池'],
        createdBy: uid['admin@test.cn']!,
      })
      .returning();
    const ops = await as('ops@test.cn');
    const list = await ops.get('/api/operator/on-site');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({ id: req!.id, status: 'new', taskNumber: t!.number, enterpriseName: '示例noCall有限公司' })]);

    const noted = await ops.patch(`/api/operator/on-site/${req!.id}`).send({ internalNote: '已约周三上门' });
    expect(noted.body).toMatchObject({ status: 'new', internalNote: '已约周三上门' });
    expect((await ops.patch(`/api/operator/on-site/${req!.id}`).send({ status: 'handed_over' })).body).toMatchObject({ status: 'handed_over', internalNote: '已约周三上门' });
    expect((await ops.patch(`/api/operator/on-site/${req!.id}`).send({ status: 'closed' })).body.status).toBe('closed');
    expect((await ops.patch(`/api/operator/on-site/${req!.id}`).send({ status: 'done' })).status).toBe(400);
    expect((await ops.patch(`/api/operator/on-site/${req!.id}`).send({})).status).toBe(400);

    for (const email of ['admin@test.cn', 'zhou@test.cn']) {
      const other = await as(email);
      expect((await other.get('/api/operator/on-site')).status).toBe(403);
      expect((await other.patch(`/api/operator/on-site/${req!.id}`).send({ status: 'new' })).status).toBe(403);
    }
  });
});
