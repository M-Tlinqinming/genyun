import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword, type SessionUser } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { auditLogs, enterprises, memberships, organizationInvitations, organizations, sessions, tasks, users } from '../db/schema.ts';
import { MemoryMailer } from '../mail/mailer.ts';
import { InternalAccountsController } from './internal-accounts.controller.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
let mailer: MemoryMailer;
const uid: Record<string, string> = {};
let taskId = '';

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例安全咨询机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: new Date() },
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
  const [ent, ent2] = await db
    .insert(enterprises)
    .values([
      { orgId: customer!.id, name: '示例化工有限公司', createdBy: by },
      { orgId: customer!.id, name: '示例物流有限公司', createdBy: by },
    ])
    .returning();
  // 周工手上有一个在办任务；另一个已提交、待分派
  const [mine, waiting] = await db
    .insert(tasks)
    .values([
      {
        orgId: customer!.id,
        enterpriseId: ent!.id,
        number: 'GY-2026-001',
        businessType: 'emergency_plan' as const,
        name: '2026 年应急预案',
        status: 'submitted' as const,
        submittedAt: new Date(),
        createdBy: by,
        assignedExpertId: uid['zhou@test.cn'],
        assignedAt: new Date(),
      },
      {
        orgId: customer!.id,
        enterpriseId: ent2!.id,
        number: 'GY-2026-002',
        businessType: 'emergency_plan' as const,
        name: '2027 年应急预案',
        status: 'submitted' as const,
        submittedAt: new Date(),
        createdBy: by,
      },
    ])
    .returning();
  taskId = waiting!.id;
  uid.task = mine!.id;

  mailer = new MemoryMailer();
  app = await createApp(db, { loginLimitPerMinute: 1000, mailer });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

async function as(email: string, password = PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  expect((await agent.post('/api/auth/login').send({ email, password })).status).toBe(200);
  return agent;
}

const codeFor = async (email: string) => {
  // 验证码邮件是事务后异步发的，等它进发件箱
  for (let i = 0; i < 50; i++) {
    const mail = mailer.sent.filter((m) => m.to === email).at(-1);
    const code = mail && /\b(\d{6})\b/.exec(mail.text)?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`没有发给 ${email} 的验证码`);
};
const idOf = async (email: string) => (await handle.db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;
const enabledOperators = async () =>
  (
    await handle.db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.role, 'operator'), isNull(users.disabledAt)))
  ).length;
const tokenOf = (text: string) => /\/invite\/([\w-]+)/.exec(text)![1]!;
const actions = async (action: string) =>
  (await handle.db.select().from(auditLogs).where(eq(auditLogs.action, action as never))).map((r) => r.target);

describe('内部账号', () => {
  it('只有运营能看、能改：客户、注安师 403，没登录 401', async () => {
    const id = uid['wu@test.cn'];
    for (const email of ['admin@test.cn', 'zhou@test.cn']) {
      const other = await as(email);
      expect((await other.get('/api/operator/accounts')).status).toBe(403);
      expect((await other.post('/api/operator/accounts/invitations').send({ name: '新人', email: 'x@test.cn', role: 'expert' })).status).toBe(403);
      expect((await other.post(`/api/operator/accounts/${id}/disable`)).status).toBe(403);
      expect((await other.post(`/api/operator/accounts/${id}/enable`)).status).toBe(403);
      expect((await other.put(`/api/operator/accounts/${id}/role`).send({ role: 'operator' })).status).toBe(403);
      expect((await other.get('/api/operator/overview')).status).toBe(403);
    }
    const anon = request(app.getHttpServer());
    expect((await anon.get('/api/operator/accounts')).status).toBe(401);
    expect((await anon.post(`/api/operator/accounts/${id}/disable`)).status).toBe(401);
    expect((await anon.get('/api/operator/overview')).status).toBe(401);
    // 越权没有改到任何东西
    const [wu] = await handle.db.select().from(users).where(eq(users.id, id!));
    expect(wu!.disabledAt).toBeNull();
  });

  it('列表只有耕云内部的人：角色、在办任务、自己标出来', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.get('/api/operator/accounts').expect(200);
    const rows = res.body.accounts as { name: string; role: string; openTasks: number; self: boolean; lastLoginAt: string | null }[];
    expect(rows.map((r) => r.name).sort()).toEqual(['吴工', '周工', '赵运营'].sort());
    expect(rows.find((r) => r.name === '周工')).toMatchObject({ role: 'expert', openTasks: 1, self: false });
    expect(rows.find((r) => r.name === '赵运营')).toMatchObject({ role: 'operator', self: true });
    // 刚登录过，最近登录有值
    expect(rows.find((r) => r.name === '赵运营')!.lastLoginAt).not.toBeNull();
  });

  it('不能停用自己，也不能改自己的角色', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.post(`/api/operator/accounts/${uid['ops@test.cn']}/disable`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('不能停用自己的账号');
    expect((await ops.put(`/api/operator/accounts/${uid['ops@test.cn']}/role`).send({ role: 'expert' })).status).toBe(409);
  });

  it('客户组织的人不在内部账号里，停用不了', async () => {
    const ops = await as('ops@test.cn');
    expect((await ops.post(`/api/operator/accounts/${uid['admin@test.cn']}/disable`)).status).toBe(404);
  });

  it('注安师还有在办任务时不能停用，要先改派', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.post(`/api/operator/accounts/${uid['zhou@test.cn']}/disable`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('周工还有 1 个在办任务，请先在任务中心改派给其他注安师，再停用');
    expect((await ops.put(`/api/operator/accounts/${uid['zhou@test.cn']}/role`).send({ role: 'operator' })).status).toBe(409);
  });

  it('停用后：不能登录、已登录的会话失效、不在分派名单、分派给他被拒；记操作日志', async () => {
    const wu = await as('wu@test.cn');
    expect((await wu.get('/api/auth/me')).status).toBe(200);
    // 停用前他刚申请过找回密码
    await request(app.getHttpServer()).post('/api/auth/recover/send').send({ email: 'wu@test.cn' }).expect(204);
    const code = await codeFor('wu@test.cn');
    const ops = await as('ops@test.cn');
    const res = await ops.post(`/api/operator/accounts/${uid['wu@test.cn']}/disable`).expect(200);
    expect((res.body.accounts as { name: string; disabledAt: string | null }[]).find((a) => a.name === '吴工')!.disabledAt).not.toBeNull();

    // 记明是运营停用的（客户邀请不能恢复）
    expect((await handle.db.select({ r: users.disabledReason }).from(users).where(eq(users.id, uid['wu@test.cn']!)))[0]!.r).toBe('operator');
    // 已登录的地方退出
    expect((await wu.get('/api/auth/me')).status).toBe(401);
    expect(await handle.db.select().from(sessions).where(eq(sessions.userId, uid['wu@test.cn']!))).toHaveLength(0);
    // 密码对也登录不了，告诉他找运营
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'wu@test.cn', password: PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.message).toBe('这个账号已停用。如需恢复，请联系耕云运营');
    // 密码错时仍是通用的说法，不透露账号状态
    const wrong = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'wu@test.cn', password: 'nope nope nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).not.toContain('停用');

    // 分派名单里没有他，分派给他被拒
    const experts = (await ops.get(`/api/operator/tasks/${taskId}/experts`).expect(200)).body as { name: string }[];
    expect(experts.map((e) => e.name)).toEqual(['周工']);
    expect((await ops.post(`/api/operator/tasks/${taskId}/assign`).send({ expertId: uid['wu@test.cn'], currentExpertId: null })).status).toBe(400);

    // 找回密码也走不通：停用前拿到的验证码不能用（和验证码错一样的说法，不透露账号状态），密码没被改掉
    const reset = await request(app.getHttpServer())
      .post('/api/auth/recover/reset')
      .send({ email: 'wu@test.cn', code, password: 'brand new pass 2026' });
    expect(reset.status).toBe(400);
    expect(reset.body.message).toBe('验证码不正确或已失效，请检查或重新获取');
    expect((await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'wu@test.cn', password: 'brand new pass 2026' })).status).toBe(401);

    expect(await actions('account_disable')).toEqual(['吴工（wu@test.cn）· 注安师']);
    // 停用过的不能再停用，也不重复记日志
    expect((await ops.post(`/api/operator/accounts/${uid['wu@test.cn']}/disable`)).status).toBe(409);
    expect(await actions('account_disable')).toHaveLength(1);
  });

  it('恢复后可以登录、重新出现在分派名单', async () => {
    const ops = await as('ops@test.cn');
    await ops.post(`/api/operator/accounts/${uid['wu@test.cn']}/enable`).expect(200);
    expect((await handle.db.select({ r: users.disabledReason }).from(users).where(eq(users.id, uid['wu@test.cn']!)))[0]!.r).toBeNull();
    // 已经恢复的再点恢复：409，不重复记日志
    expect((await ops.post(`/api/operator/accounts/${uid['wu@test.cn']}/enable`)).status).toBe(409);
    await as('wu@test.cn');
    const experts = (await ops.get(`/api/operator/tasks/${taskId}/experts`).expect(200)).body as { name: string }[];
    expect(experts.map((e) => e.name).sort()).toEqual(['吴工', '周工'].sort());
    expect(await actions('account_enable')).toEqual(['吴工（wu@test.cn）· 注安师']);
  });

  it('改角色：注安师改成运营后能进内部账号，不在分派名单；记操作日志', async () => {
    const ops = await as('ops@test.cn');
    expect((await ops.put(`/api/operator/accounts/${uid['wu@test.cn']}/role`).send({ role: 'boss' })).status).toBe(400);
    await ops.put(`/api/operator/accounts/${uid['wu@test.cn']}/role`).send({ role: 'operator' }).expect(200);
    const wu = await as('wu@test.cn');
    expect((await wu.get('/api/operator/accounts')).status).toBe(200);
    const experts = (await ops.get(`/api/operator/tasks/${taskId}/experts`).expect(200)).body as { name: string }[];
    expect(experts.map((e) => e.name)).toEqual(['周工']);
    expect(await actions('account_role_change')).toEqual(['吴工（wu@test.cn）· 注安师 → 运营管理员']);
    await ops.put(`/api/operator/accounts/${uid['wu@test.cn']}/role`).send({ role: 'expert' }).expect(200);
  });

  it('邀请注安师：发邀请邮件，列表里显示待接受；接受后以注安师身份登录', async () => {
    const ops = await as('ops@test.cn');
    // 已有账号的邮箱不能再邀请
    const dup = await ops.post('/api/operator/accounts/invitations').send({ name: '周工', email: 'zhou@test.cn', role: 'expert' });
    expect(dup.status).toBe(409);
    expect(dup.body.field).toBe('email');

    await ops.post('/api/operator/accounts/invitations').send({ name: '孙工', email: 'Sun@Test.cn', role: 'expert' }).expect(200);
    const mail = mailer.sent.filter((m) => m.to === 'sun@test.cn').at(-1)!;
    expect(mail.text).toContain('注安师');
    expect(mail.text).not.toContain('专业人员');

    const view = (await ops.get('/api/operator/accounts').expect(200)).body;
    expect(view.invitations).toEqual([expect.objectContaining({ name: '孙工', email: 'sun@test.cn', role: 'expert', state: 'valid', invitedByName: '赵运营' })]);

    // 重新发送：旧链接作废，只留一封
    const firstToken = tokenOf(mail.text);
    await ops.post(`/api/operator/accounts/invitations/${view.invitations[0].id}/resend`).expect(200);
    const again = mailer.sent.filter((m) => m.to === 'sun@test.cn').at(-1)!;
    const token = tokenOf(again.text);
    expect(token).not.toBe(firstToken);
    expect((await request(app.getHttpServer()).get(`/api/invitations/${firstToken}`)).body.state).toBe('revoked');
    expect((await ops.get('/api/operator/accounts').expect(200)).body.invitations).toHaveLength(1);

    const sun = request.agent(app.getHttpServer());
    const accepted = await sun.post(`/api/invitations/${token}/accept`).send({ name: '孙工', password: 'genyun2026', agreed: true });
    expect(accepted.status).toBe(200);
    const after = (await ops.get('/api/operator/accounts').expect(200)).body;
    expect(after.invitations).toEqual([]);
    expect(after.accounts.find((a: { email: string }) => a.email === 'sun@test.cn')).toMatchObject({ role: 'expert', name: '孙工' });
    // 新注安师出现在分派名单
    const experts = (await ops.get(`/api/operator/tasks/${taskId}/experts`).expect(200)).body as { name: string }[];
    expect(experts.map((e) => e.name)).toContain('孙工');

    expect(await actions('account_invite')).toEqual(['孙工（sun@test.cn）· 注安师', '孙工（sun@test.cn）· 注安师 · 重新发送']);
  });

  it('邀请运营：接受后进入运营工作台', async () => {
    const ops = await as('ops@test.cn');
    await ops.post('/api/operator/accounts/invitations').send({ name: '钱运营', email: 'qian@test.cn', role: 'operator' }).expect(200);
    const token = tokenOf(mailer.sent.filter((m) => m.to === 'qian@test.cn').at(-1)!.text);
    const qian = request.agent(app.getHttpServer());
    await qian.post(`/api/invitations/${token}/accept`).send({ name: '钱运营', password: 'genyun2026', agreed: true }).expect(200);
    expect((await qian.get('/api/operator/accounts')).status).toBe(200);
    const [m] = await handle.db
      .select()
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(users.email, 'qian@test.cn'), eq(memberships.role, 'operator')));
    expect(m).toBeTruthy();
  });
  it('重新发送前查账号：对方已经有耕云账号时不再发', async () => {
    const ops = await as('ops@test.cn');
    await ops.post('/api/operator/accounts/invitations').send({ name: '郑工', email: 'zheng@test.cn', role: 'expert' }).expect(200);
    const inv = (await ops.get('/api/operator/accounts').expect(200)).body.invitations.find((i: { email: string }) => i.email === 'zheng@test.cn');
    // 对方在这期间通过别的途径有了账号
    await handle.db.insert(users).values({ email: 'zheng@test.cn', name: '郑工', passwordHash: await hashPassword(PASSWORD) });
    const sent = mailer.sent.length;
    const res = await ops.post(`/api/operator/accounts/invitations/${inv.id}/resend`);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('已经有耕云账号');
    expect(mailer.sent.length).toBe(sent);
  });

  it('两位运营同时重发同一封邀请：只有一封有效，另一位提示刷新', async () => {
    const ops = await as('ops@test.cn');
    const qian = await as('qian@test.cn', 'genyun2026');
    await ops.post('/api/operator/accounts/invitations').send({ name: '冯工', email: 'feng@test.cn', role: 'expert' }).expect(200);
    const inv = (await ops.get('/api/operator/accounts').expect(200)).body.invitations.find((i: { email: string }) => i.email === 'feng@test.cn');
    const results = await Promise.all([ops, qian].map((a) => a.post(`/api/operator/accounts/invitations/${inv.id}/resend`)));
    expect(results.map((r) => r.status)).toContain(200);
    for (const r of results.filter((x) => x.status !== 200)) expect(r.status).toBe(409);
    const open = await handle.db
      .select()
      .from(organizationInvitations)
      .where(and(eq(organizationInvitations.email, 'feng@test.cn'), isNull(organizationInvitations.acceptedAt), isNull(organizationInvitations.revokedAt)));
    expect(open).toHaveLength(1);
    // 数据库也拦着：同一邮箱不能有第二封未接受、未作废的邀请
    const { id: _id, ...row } = open[0]!;
    await expect(handle.db.insert(organizationInvitations).values({ ...row, tokenHash: 'dup-token-hash' })).rejects.toThrow();
  });

  it('两位运营同时停用对方：只有一个成功，至少留一位能登录的运营', async () => {
    const ops = await as('ops@test.cn');
    const qian = await as('qian@test.cn', 'genyun2026');
    const qianId = await idOf('qian@test.cn');
    const before = (await actions('account_disable')).length;
    const [a, b] = await Promise.all([
      ops.post(`/api/operator/accounts/${qianId}/disable`),
      qian.post(`/api/operator/accounts/${uid['ops@test.cn']}/disable`),
    ]);
    expect([a.status, b.status].filter((x) => x === 200)).toHaveLength(1);
    for (const r of [a, b].filter((x) => x.status !== 200)) expect([401, 409]).toContain(r.status);
    expect(await enabledOperators()).toBeGreaterThanOrEqual(1);
    expect(await actions('account_disable')).toHaveLength(before + 1);
    // 复原：两位都恢复
    await handle.db.update(users).set({ disabledAt: null }).where(eq(users.email, 'ops@test.cn'));
    await handle.db.update(users).set({ disabledAt: null }).where(eq(users.email, 'qian@test.cn'));
  });

  it('最后一位能登录的运营不能被停用或改成注安师（409）', async () => {
    // 钱运营的请求已经过了登录校验，这时他自己被停用了：赵运营就是最后一位
    const qianId = await idOf('qian@test.cn');
    const controller = app.get(InternalAccountsController);
    const [org] = await handle.db.select().from(organizations).where(eq(organizations.kind, 'internal'));
    const qianUser: SessionUser = { id: qianId, email: 'qian@test.cn', name: '钱运营', memberships: [{ orgId: org!.id, orgName: '耕云', role: 'operator' }] };
    const req = { ip: '127.0.0.1' } as Request;
    await handle.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, qianId));
    const logs = (await actions('account_disable')).length;
    await expect(controller.disable(qianUser, uid['ops@test.cn']!, req)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('最后一位能登录的运营管理员'),
    });
    await expect(controller.changeRole(qianUser, uid['ops@test.cn']!, { role: 'expert' }, req)).rejects.toMatchObject({ status: 409 });
    const [zhao] = await handle.db.select().from(users).where(eq(users.id, uid['ops@test.cn']!));
    expect(zhao!.disabledAt).toBeNull();
    expect((await actions('account_disable')).length).toBe(logs);
    await handle.db.update(users).set({ disabledAt: null }).where(eq(users.id, qianId));
  });
});
