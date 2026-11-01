import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, memberships, organizationInvitations, organizations, tasks, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';
import { hashInvitationToken } from './invitations.ts';
import { MemoryMailer } from '../mail/mailer.ts';

// M3 第 2 项：接受邀请（Paper 10 页 A02）与运营组织详情里的「开通与邀请」（16 页 I03）
const PASSWORD = 'correct horse battery staple';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

let handle: DatabaseHandle;
let app: INestApplication;
let dir: string;
const mailer = new MemoryMailer();
let internalOrg = '';
let otherOrg = '';

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  dir = await mkdtemp(join(tmpdir(), 'genyun-invite-'));
  const passwordHash = await hashPassword(PASSWORD);
  const [internal, other] = await db
    .insert(organizations)
    .values([
      { name: '耕云', kind: 'internal' },
      { name: '别家机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: new Date() },
    ])
    .returning();
  internalOrg = internal!.id;
  otherOrg = other!.id;
  for (const p of [
    { email: 'ops@test.cn', name: '赵运营', orgId: internalOrg, role: 'operator' as const },
    { email: 'expert@test.cn', name: '周工', orgId: internalOrg, role: 'expert' as const },
    { email: 'other-admin@test.cn', name: '别家管理员', orgId: otherOrg, role: 'customer_admin' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
  }
  app = await createApp(db, { loginLimitPerMinute: 1000, storage: new LocalDiskStorage(dir, 'test-secret'), mailer });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function as(email: string) {
  let agent = agents.get(email);
  if (!agent) {
    agent = request.agent(app.getHttpServer());
    expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    agents.set(email, agent);
  }
  return agent;
}

const tokenOf = (text: string) => /\/invite\/([\w-]+)/.exec(text)![1]!;

// 登记并开通一家组织，返回组织和邀请链接里的令牌
async function openOrg(name: string, adminEmail: string) {
  const ops = await as('ops@test.cn');
  const reg = await ops.post('/api/operator/organizations').send({
    name,
    region: '广东省惠州市',
    socialCreditCode: '91441300MA5XXXXXX1',
    contactName: '孙经理',
    contactPhone: '136 2254 1234',
    contactEmail: adminEmail,
  });
  expect(reg.status).toBe(201);
  const up = await ops.post(`/api/operator/organizations/${reg.body.id}/contract-file`).attach('file', PDF, '合同.pdf');
  const res = await ops.post(`/api/operator/organizations/${reg.body.id}/open`).send({
    contractNumber: 'GY-HT-1',
    scopeKind: 'annual',
    scopeEnterprises: 3,
    startsAt: '2026-01-01',
    endsAt: '2099-12-31',
    contractFileId: up.body.id,
    paymentReceived: true,
    adminName: '孙经理',
    adminPhone: '136 2254 1234',
    adminEmail,
  });
  expect(res.status).toBe(200);
  return { orgId: reg.body.id as string, token: tokenOf(mailer.sent.at(-1)!.text) };
}

const accept = { name: '孙志强', password: 'genyun2026', agreed: true };

describe('打开邀请链接', () => {
  it('显示机构、邀请人、身份、受邀邮箱和有效期；不需要登录', async () => {
    const { token } = await openOrg('查看邀请机构', 'view@test.cn');
    const res = await request(app.getHttpServer()).get(`/api/invitations/${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: 'valid',
      orgName: '查看邀请机构',
      inviterName: '耕云运营',
      role: 'customer_admin',
      email: 'view@test.cn',
      name: '孙经理',
    });
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it('链接不对时说找不到', async () => {
    const res = await request(app.getHttpServer()).get('/api/invitations/not-a-real-token');
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('链接');
  });
});

describe('接受邀请', () => {
  it('设好姓名和密码后成为管理员，直接登录；同一链接再打开显示已使用', async () => {
    const { orgId, token } = await openOrg('接受邀请机构', 'Accept@Test.cn');
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post(`/api/invitations/${token}/accept`).send(accept);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'accept@test.cn', name: '孙志强' });
    expect(res.body.memberships).toEqual([{ orgId, orgName: '接受邀请机构', role: 'customer_admin' }]);
    // 已登录：直接能进客户工作台的接口
    expect((await agent.get('/api/auth/me')).body.email).toBe('accept@test.cn');
    // 新密码能登录
    expect((await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'accept@test.cn', password: 'genyun2026' })).status).toBe(200);

    const again = await request(app.getHttpServer()).get(`/api/invitations/${token}`);
    expect(again.body.state).toBe('accepted');
    const twice = await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send(accept);
    expect(twice.status).toBe(409);
    expect(twice.body.message).toContain('已使用');
  });

  it('密码不满足规则、没勾同意时说明怎么改', async () => {
    const { token } = await openOrg('密码规则机构', 'rule2026@test.cn');
    const short = await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send({ ...accept, password: 'abc123' });
    expect(short.status).toBe(400);
    expect(short.body.message).toBe('密码至少 8 位');
    const same = await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send({ ...accept, password: 'Rule2026@test.cn' });
    expect(same.body.message).toBe('密码不能与邮箱相同');
    const unchecked = await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send({ ...accept, agreed: false });
    expect(unchecked.status).toBe(400);
    expect(unchecked.body.message).toContain('服务协议');
  });

  it('超过 7 天的链接不能用', async () => {
    const { orgId, token } = await openOrg('过期邀请机构', 'late@test.cn');
    await handle.db
      .update(organizationInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(organizationInvitations.orgId, orgId));
    expect((await request(app.getHttpServer()).get(`/api/invitations/${token}`)).body.state).toBe('expired');
    const res = await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send(accept);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('过期');
    const [u] = await handle.db.select().from(users).where(eq(users.email, 'late@test.cn'));
    expect(u).toBeUndefined();
  });

  it('过期后请邀请人重新发送：只给邀请人发站内提醒，不生成新链接；重复点不重复提醒', async () => {
    const { orgId, token } = await openOrg('请求重发机构', 'resend-me@test.cn');
    const anon = () => request(app.getHttpServer());
    // 还有效时不能请求重发
    expect((await anon().post(`/api/invitations/${token}/request-resend`)).status).toBe(409);
    await handle.db
      .update(organizationInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(organizationInvitations.orgId, orgId));
    const mails = mailer.sent.length;
    const res = await anon().post(`/api/invitations/${token}/request-resend`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inviterName: '耕云运营' });
    expect((await anon().post(`/api/invitations/${token}/request-resend`)).status).toBe(200);
    // 不发邮件、不生成新邀请
    expect(mailer.sent.length).toBe(mails);
    expect(await handle.db.select().from(organizationInvitations).where(eq(organizationInvitations.orgId, orgId))).toHaveLength(1);
    // 邀请人（运营）收到一条站内提醒，点开进组织详情
    const list = await (await as('ops@test.cn')).get('/api/notifications');
    const mine = (list.body.items as { title: string; body: string; link: string }[]).filter((n) =>
      n.body.includes('resend-me@test.cn'),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: '邀请过期，请重新发送', link: `/operator/organizations/${orgId}` });
  });

  it('重发的新邀请再过期，还能再提醒一次', async () => {
    const { orgId, token } = await openOrg('二次过期机构', 'expire-twice@test.cn');
    // 两封邀请的到期时间不同（第一封两天前到期）
    const expire = (msAgo: number) =>
      handle.db
        .update(organizationInvitations)
        .set({ expiresAt: new Date(Date.now() - msAgo) })
        .where(eq(organizationInvitations.orgId, orgId));
    await expire(2 * 86_400_000);
    expect((await request(app.getHttpServer()).post(`/api/invitations/${token}/request-resend`)).status).toBe(200);
    const ops = await as('ops@test.cn');
    await ops
      .post(`/api/operator/organizations/${orgId}/admin-invitation`)
      .send({ name: '孙经理', phone: '136 2254 1234', email: 'expire-twice@test.cn' });
    const fresh = tokenOf(mailer.sent.at(-1)!.text);
    await handle.db
      .update(organizationInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(organizationInvitations.tokenHash, hashInvitationToken(fresh)));
    expect((await request(app.getHttpServer()).post(`/api/invitations/${fresh}/request-resend`)).status).toBe(200);
    const list = await ops.get('/api/notifications');
    const mine = (list.body.items as { body: string }[]).filter((n) => n.body.includes('expire-twice@test.cn'));
    expect(mine).toHaveLength(2);
  });

  it('发邀请后这个邮箱才有了耕云账号：接受时请对方先登录', async () => {
    const { token } = await openOrg('已有账号机构', 'later-account@test.cn');
    await handle.db.insert(users).values({ email: 'later-account@test.cn', name: '后来的账号', passwordHash: 'x' });
    const res = await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send(accept);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('已经有耕云账号');
  });

  it('同一封邀请同时点两次接受：只有一次成功，另一次 409', async () => {
    const { orgId, token } = await openOrg('并发接受机构', 'twice@test.cn');
    const results = await Promise.all(
      [0, 1].map(() => request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send(accept)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const admins = await handle.db.select().from(memberships).where(eq(memberships.orgId, orgId));
    expect(admins).toHaveLength(1);
  });

  it('同一邮箱同时接受两家组织的邀请：只有一家成功，另一家 409，不是 500', async () => {
    const a = await openOrg('同邮箱甲机构', 'same-mail@test.cn');
    const b = await openOrg('同邮箱乙机构', 'same-mail@test.cn');
    const results = await Promise.all(
      [a.token, b.token].map((t) => request(app.getHttpServer()).post(`/api/invitations/${t}/accept`).send(accept)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.message).toContain('已经有耕云账号');
  });
});

describe('运营重发邀请、更换首位管理员', () => {
  it('更换后旧链接作废，新邮件发给新管理员', async () => {
    const { orgId, token } = await openOrg('更换管理员机构', 'first@test.cn');
    const before = mailer.sent.length;
    const res = await (await as('ops@test.cn'))
      .post(`/api/operator/organizations/${orgId}/admin-invitation`)
      .send({ name: '钱经理', phone: '139 0000 1111', email: 'second@test.cn' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'second@test.cn', mailSent: true });
    expect(mailer.sent.length).toBe(before + 1);
    expect(mailer.sent.at(-1)!.to).toBe('second@test.cn');

    expect((await request(app.getHttpServer()).get(`/api/invitations/${token}`)).body.state).toBe('revoked');
    const old = await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send(accept);
    expect(old.status).toBe(409);
    expect(old.body.message).toContain('作废');

    const fresh = tokenOf(mailer.sent.at(-1)!.text);
    expect((await request(app.getHttpServer()).get(`/api/invitations/${fresh}`)).body).toMatchObject({ state: 'valid', name: '钱经理' });
  });

  it('首位管理员已经接受后不能再更换', async () => {
    const { orgId, token } = await openOrg('已接受机构', 'done@test.cn');
    await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send(accept);
    const res = await (await as('ops@test.cn'))
      .post(`/api/operator/organizations/${orgId}/admin-invitation`)
      .send({ name: '钱经理', phone: '139 0000 1111', email: 'x@test.cn' });
    expect(res.status).toBe(409);
  });

  it('还没开通的组织不能发邀请', async () => {
    const reg = await (await as('ops@test.cn'))
      .post('/api/operator/organizations')
      .send({
        name: '未开通机构',
        region: '惠州',
        socialCreditCode: '91441300MA5XXXXXX2',
        contactName: '孙',
        contactPhone: '136 2254 1234',
        contactEmail: 'not-open@test.cn',
      });
    const res = await (await as('ops@test.cn'))
      .post(`/api/operator/organizations/${reg.body.id}/admin-invitation`)
      .send({ name: '钱经理', phone: '139 0000 1111', email: 'x@test.cn' });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('开通');
  });

  it('邮箱已经有耕云账号时，开通和更换都当场拦下', async () => {
    const ops = await as('ops@test.cn');
    const reg = await ops.post('/api/operator/organizations').send({
      name: '已有账号开通机构',
      region: '广东省惠州市',
      socialCreditCode: '91441300MA5XXXXXX3',
      contactName: '孙经理',
      contactPhone: '136 2254 1234',
      contactEmail: 'expert@test.cn',
    });
    const up = await ops.post(`/api/operator/organizations/${reg.body.id}/contract-file`).attach('file', PDF, '合同.pdf');
    const before = mailer.sent.length;
    const open = await ops.post(`/api/operator/organizations/${reg.body.id}/open`).send({
      contractNumber: 'GY-HT-2',
      scopeKind: 'annual',
      scopeEnterprises: 3,
      startsAt: '2026-01-01',
      endsAt: '2099-12-31',
      contractFileId: up.body.id,
      paymentReceived: true,
      adminName: '周工',
      adminPhone: '136 2254 1234',
      adminEmail: 'Expert@Test.cn',
    });
    expect(open.status).toBe(409);
    expect(open.body).toMatchObject({ message: '这个邮箱已经有耕云账号，请换一个邮箱', field: 'email' });
    expect(mailer.sent.length).toBe(before);
    // 没开通成功
    expect((await ops.get(`/api/operator/organizations/${reg.body.id}`)).body.activatedAt).toBeNull();

    const { orgId, token } = await openOrg('已有账号更换机构', 'keep-me@test.cn');
    const replace = await ops
      .post(`/api/operator/organizations/${orgId}/admin-invitation`)
      .send({ name: '周工', phone: '139 0000 1111', email: 'expert@test.cn' });
    expect(replace.status).toBe(409);
    expect(replace.body).toMatchObject({ message: '这个邮箱已经有耕云账号，请换一个邮箱', field: 'email' });
    // 旧邀请还有效
    expect((await request(app.getHttpServer()).get(`/api/invitations/${token}`)).body.state).toBe('valid');
  });

  it('没登录 401；组织不存在 404', async () => {
    const body = { name: '钱经理', phone: '139 0000 1111', email: 'x@test.cn' };
    expect((await request(app.getHttpServer()).post(`/api/operator/organizations/${otherOrg}/admin-invitation`).send(body)).status).toBe(401);
    const missing = await (await as('ops@test.cn'))
      .post('/api/operator/organizations/00000000-0000-4000-8000-000000000000/admin-invitation')
      .send(body);
    expect(missing.status).toBe(404);
  });

  it('重新发送的邮件写明以最新一封为准，身份是机构管理员，写出具体有效期和落款', async () => {
    const { orgId } = await openOrg('邮件文字机构', 'mail-text@test.cn');
    const first = mailer.sent.at(-1)!;
    expect(first.subject).toBe('耕云运营邀请您加入「邮件文字机构」');
    expect(first.text).toContain('机构管理员身份');
    expect(first.text).toMatch(/链接有效期至 \d{4} 年 \d{1,2} 月 \d{1,2} 日 \d{2}:\d{2}（北京时间）/);
    expect(first.text).not.toContain('最新一封');
    expect(first.text.trimEnd().endsWith('耕云团队')).toBe(true);
    await (await as('ops@test.cn'))
      .post(`/api/operator/organizations/${orgId}/admin-invitation`)
      .send({ name: '孙经理', phone: '136 2254 1234', email: 'mail-text@test.cn' });
    expect(mailer.sent.at(-1)!.text).toContain('请以最新一封为准');
  });

  it('客户、专业人员不能发邀请', async () => {
    for (const who of ['other-admin@test.cn', 'expert@test.cn']) {
      const res = await (await as(who))
        .post(`/api/operator/organizations/${otherOrg}/admin-invitation`)
        .send({ name: '钱经理', phone: '139 0000 1111', email: 'x@test.cn' });
      expect(res.status).toBe(403);
    }
  });
});

describe('运营组织详情', () => {
  it('列出成员、邀请（含状态）和企业的任务进展', async () => {
    const { orgId, token } = await openOrg('详情机构', 'detail@test.cn');
    const accepted = await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send(accept);
    const adminId = accepted.body.id as string;
    const [ent] = await handle.db.insert(enterprises).values({ orgId, name: '详情甲企业', createdBy: adminId }).returning();
    await handle.db.insert(tasks).values({
      orgId,
      enterpriseId: ent!.id,
      number: 'GY-2026-801',
      businessType: 'emergency_plan',
      name: '应急预案编制',
      createdBy: adminId,
      status: 'submitted',
    });

    const res = await (await as('ops@test.cn')).get(`/api/operator/organizations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([
      expect.objectContaining({ name: '孙志强', email: 'detail@test.cn', role: 'customer_admin' }),
    ]);
    expect(res.body.invitations).toEqual([
      expect.objectContaining({ email: 'detail@test.cn', role: 'customer_admin', state: 'accepted', invitedByName: '赵运营' }),
    ]);
    expect(res.body.enterprises).toEqual([
      expect.objectContaining({ name: '详情甲企业', task: expect.objectContaining({ number: 'GY-2026-801', stage: 'unassigned' }) }),
    ]);
    expect(res.body.activatedByName).toBe('赵运营');
  });
});
