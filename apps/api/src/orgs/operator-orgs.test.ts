import { addDays, chinaToday } from '@genyun/shared';
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
import {
  auditLogs,
  creditEntries,
  enterprises,
  memberships,
  organizationContracts,
  organizationInvitations,
  organizations,
  tasks,
  users,
} from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';
import { MemoryMailer } from '../mail/mailer.ts';

const PASSWORD = 'correct horse battery staple';
const MISSING = '00000000-0000-4000-8000-000000000000';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let handle: DatabaseHandle;
let app: INestApplication;
let dir: string;
const mailer = new MemoryMailer();
const org: Record<'a' | 'internal', string> = { a: '', internal: '' };

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  dir = await mkdtemp(join(tmpdir(), 'genyun-ops-'));
  const passwordHash = await hashPassword(PASSWORD);
  const created = await db
    .insert(organizations)
    .values([
      { name: 'A 安全咨询', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: new Date() },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  [org.a, org.internal] = created.map((o) => o.id) as [string, string];
  for (const p of [
    { email: 'a-admin@test.cn', orgId: org.a, role: 'customer_admin' as const },
    { email: 'expert@test.cn', orgId: org.internal, role: 'expert' as const },
    { email: 'ops@test.cn', orgId: org.internal, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.email.split('@')[0]!, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    if (p.role === 'customer_admin') {
      // A 组织：两家企业，一个在办任务、一个已结束
      const ents = await db
        .insert(enterprises)
        .values([
          { orgId: org.a, name: '甲企业', createdBy: u!.id },
          { orgId: org.a, name: '乙企业', createdBy: u!.id },
        ])
        .returning();
      await db.insert(tasks).values(
        ents.map((e, i) => ({
          orgId: org.a,
          enterpriseId: e.id,
          number: `GY-2026-90${i}`,
          businessType: 'emergency_plan' as const,
          name: '应急预案编制',
          createdBy: u!.id,
          closedAt: i === 1 ? new Date() : null,
        })),
      );
    }
  }
  app = await createApp(db, {
    loginLimitPerMinute: 1000,
    storage: new LocalDiskStorage(dir, 'test-secret'),
    mailer,
  });
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

const registration = {
  name: '华东安评服务有限公司',
  region: { province: '上海市', city: '上海市', district: '闵行区' },
  socialCreditCode: '91310112MA1XXXXXX3',
  contactName: '孙经理',
  contactPhone: '136 2254 1234',
  contactEmail: 'sun@huadong-anping.cn',
};

async function register(body: object = registration) {
  const res = await (await as('ops@test.cn')).post('/api/operator/organizations').send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string; state: string };
}

async function uploadContract(orgId: string, buf = PDF, name = '合同-盖章版.pdf') {
  return (await as('ops@test.cn')).post(`/api/operator/organizations/${orgId}/contract-file`).attach('file', buf, name);
}

function opening(fileId: string) {
  return {
    contractNumber: 'GY-HT-2026-018',
    purchasedCredits: 0,
    startsAt: '2026-11-01',
    endsAt: '2027-10-31',
    contractFileId: fileId,
    paymentReceived: true,
    adminName: '孙经理',
    adminPhone: '136 2254 1234',
    adminEmail: 'Sun@Huadong-Anping.cn',
  };
}

describe('登记客户组织', () => {
  it('运营登记后在列表里是「待开通」', async () => {
    const created = await register();
    expect(created.state).toBe('pending');
    const list = await (await as('ops@test.cn')).get('/api/operator/organizations');
    expect(list.status).toBe(200);
    const row = (list.body as { id: string; state: string; members: number }[]).find((o) => o.id === created.id);
    expect(row).toMatchObject({ state: 'pending', members: 0 });
    // 已有合同的老组织算服务中；企业、成员、在办任务按本组织计数
    expect((list.body as { id: string }[]).find((o) => o.id === org.a)).toMatchObject({
      state: 'active',
      enterprises: 2,
      members: 1,
      openTasks: 1,
    });
    // 内部组织不在客户组织列表里
    expect((list.body as { id: string }[]).some((o) => o.id === org.internal)).toBe(false);
  });

  it('缺必填项时说明缺什么', async () => {
    const res = await (await as('ops@test.cn')).post('/api/operator/organizations').send({ name: 'x', region: '' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('所在地区');
  });

  it('所在地区按省、市、区县登记：存三列和全称，列表和详情带 regionParts', async () => {
    const ops = await as('ops@test.cn');
    const created = await register({ ...registration, name: '地区测试', region: { province: '江苏省', city: '苏州市', district: '吴中区' } });
    const [o] = await handle.db.select().from(organizations).where(eq(organizations.id, created.id));
    expect(o).toMatchObject({ region: '江苏省苏州市吴中区', regionProvince: '江苏省', regionCity: '苏州市', regionDistrict: '吴中区' });
    const detail = (await ops.get(`/api/operator/organizations/${created.id}`).expect(200)).body;
    expect(detail.regionParts).toEqual({ province: '江苏省', city: '苏州市', district: '吴中区' });
    expect(detail.regionProvince).toBeUndefined();
    const list = (await ops.get('/api/operator/organizations').expect(200)).body as { id: string; regionParts: unknown }[];
    expect(list.find((r) => r.id === created.id)!.regionParts).toEqual({ province: '江苏省', city: '苏州市', district: '吴中区' });
    // 老组织只有文字：regionParts 为 null
    expect(list.find((r) => r.id === org.a)!.regionParts).toBeNull();
  });

  it('地区要在全国区划里、上下级对得上，有区县的市要选到区县', async () => {
    const ops = await as('ops@test.cn');
    const send = (region: object) => ops.post('/api/operator/organizations').send({ ...registration, name: '地区校验', region });
    expect((await send({ province: '江苏省', city: '惠州市', district: '惠城区' })).body.message).toBe('所在地区不在全国区划里，请重新选择');
    expect((await send({ province: '江苏省', city: '苏州市', district: '惠城区' })).body.message).toBe('所在地区不在全国区划里，请重新选择');
    expect((await send({ province: '江苏省', city: '苏州市' })).body.message).toBe('请选到区县');
    expect((await send({ province: '广东省' })).body.message).toBe('请选到市');
  });

  it('可以修改登记资料', async () => {
    const created = await register({ ...registration, name: '待改名机构' });
    const res = await (await as('ops@test.cn'))
      .put(`/api/operator/organizations/${created.id}`)
      .send({ ...registration, name: '已改名机构' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('已改名机构');
  });
});

describe('上传合同原件', () => {
  it('只收 PDF', async () => {
    const created = await register({ ...registration, name: '合同格式测试' });
    const res = await uploadContract(created.id, PNG, '合同.png');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('PDF');
  });

  it('超过 20 MB 拒收', async () => {
    const created = await register({ ...registration, name: '合同大小测试' });
    const big = Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024)]);
    const res = await uploadContract(created.id, big);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('20 MB');
  });

  it('上传后只有运营能取下载链接', async () => {
    const created = await register({ ...registration, name: '合同可见测试' });
    const up = await uploadContract(created.id);
    expect(up.status).toBe(201);
    expect(up.body.kind).toBe('contract');
    const ok = await (await as('ops@test.cn')).get(`/api/files/${up.body.id}/download-url?inline=1`);
    expect(ok.status).toBe(200);
    for (const who of ['a-admin@test.cn', 'expert@test.cn']) {
      expect((await (await as(who)).get(`/api/files/${up.body.id}/download-url`)).status).toBe(404);
    }
  });
});

describe('开通', () => {
  it('没填购买次数、没确认到账不能开通，并列出缺项；合同原件选填', async () => {
    const created = await register({ ...registration, name: '缺项测试' });
    const res = await (await as('ops@test.cn'))
      .post(`/api/operator/organizations/${created.id}/open`)
      .send({ ...opening(MISSING), purchasedCredits: undefined, contractFileId: null, paymentReceived: false });
    expect(res.status).toBe(400);
    expect(res.body.gaps).toEqual(['合同购买次数', '合同款已到账']);
  });

  it('不传合同原件也能开通，记一条操作日志', async () => {
    const created = await register({ ...registration, name: '无原件开通' });
    const res = await (await as('ops@test.cn'))
      .post(`/api/operator/organizations/${created.id}/open`)
      .send({ ...opening(MISSING), contractFileId: undefined, adminEmail: 'noscan@test.cn', purchasedCredits: 5 });
    expect(res.status).toBe(200);
    const [c] = await handle.db.select().from(organizationContracts).where(eq(organizationContracts.orgId, created.id));
    expect(c).toMatchObject({ fileId: null, scopeKind: null, scopeEnterprises: null });
    const logs = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'org_open'));
    expect(logs.some((l) => l.target === '无原件开通 · 合同 GY-HT-2026-018')).toBe(true);
  });

  it('不能用别家组织的合同原件', async () => {
    const other = await register({ ...registration, name: '别家合同' });
    const up = await uploadContract(other.id);
    const created = await register({ ...registration, name: '借用合同' });
    const res = await (await as('ops@test.cn')).post(`/api/operator/organizations/${created.id}/open`).send(opening(up.body.id));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('合同原件');
  });

  it('填齐后开通：服务中、合同有效期生效、给首位管理员发邀请邮件', async () => {
    const created = await register();
    const up = await uploadContract(created.id);
    const before = mailer.sent.length;
    const res = await (await as('ops@test.cn')).post(`/api/operator/organizations/${created.id}/open`).send(opening(up.body.id));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'active', contractStartsAt: '2026-11-01', contractEndsAt: '2027-10-31' });
    // 测试用的发信记录是真实发出，不提示「未真实发送」
    expect(res.body.invitation).toMatchObject({ mailSent: true, mailSimulated: false, mailInOutbox: false });

    const { db } = handle;
    const [o] = await db.select().from(organizations).where(eq(organizations.id, created.id));
    expect(o!.activatedAt).not.toBeNull();
    const contracts = await db.select().from(organizationContracts).where(eq(organizationContracts.orgId, created.id));
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({ number: 'GY-HT-2026-018', scopeKind: null, scopeEnterprises: null, fileId: up.body.id });
    // 购买次数为 0、没有赠送时不记台账
    expect(await db.select().from(creditEntries).where(eq(creditEntries.orgId, created.id))).toEqual([]);
    const invites = await db.select().from(organizationInvitations).where(eq(organizationInvitations.orgId, created.id));
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ email: 'sun@huadong-anping.cn', role: 'customer_admin', acceptedAt: null });

    expect(mailer.sent.length).toBe(before + 1);
    const mail = mailer.sent.at(-1)!;
    expect(mail.to).toBe('sun@huadong-anping.cn');
    expect(mail.text).toMatch(/\/invite\/[\w-]{20,}/);
    // 链接里的令牌不以明文存库
    const token = /\/invite\/([\w-]+)/.exec(mail.text)![1]!;
    expect(invites[0]!.tokenHash).not.toBe(token);

    // 已开通的不能再开通一次
    const again = await (await as('ops@test.cn')).post(`/api/operator/organizations/${created.id}/open`).send(opening(up.body.id));
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('这个组织已经开通了，续约请到组织详情里点「登记续约」');
    // 挂到合同上的原件不再带进开通、续约弹窗
    expect((await (await as('ops@test.cn')).get(`/api/operator/organizations/${created.id}`)).body.contractFile).toBeNull();
  });
});

describe('开通时登记次数', () => {
  it('带合同购买和赠送次数时记两行台账，原因是次数记录里的原话', async () => {
    const created = await register({ ...registration, name: '华南安评服务有限公司', socialCreditCode: '91440300MA5XXXXXX7' });
    const up = await uploadContract(created.id);
    const ops = await as('ops@test.cn');
    const body = { ...opening(up.body.id), adminEmail: 'li@huanan-anping.cn', purchasedCredits: 20, giftCredits: 2 };
    // 有赠送时要写活动名称
    expect((await ops.post(`/api/operator/organizations/${created.id}/open`).send(body)).body.message).toBe('开通前还要填：活动名称');
    const res = await ops.post(`/api/operator/organizations/${created.id}/open`).send({ ...body, giftCampaign: ' 开通赠送 ' });
    expect(res.status).toBe(200);
    const { db } = handle;
    const [contract] = await db.select().from(organizationContracts).where(eq(organizationContracts.orgId, created.id));
    const rows = await db.select().from(creditEntries).where(eq(creditEntries.orgId, created.id));
    expect(rows.map((r) => ({ type: r.type, delta: r.delta, pool: r.pool, campaign: r.campaign, reason: r.reason, contractId: r.contractId })).sort((a, b) => a.type.localeCompare(b.type))).toEqual([
      { type: 'contract_purchase', delta: 20, pool: 'purchase', campaign: null, reason: '开通时按合同登记。', contractId: contract!.id },
      { type: 'gift', delta: 2, pool: 'gift', campaign: '开通赠送', reason: '开通时按活动规则赠送，跟合同一起到期。', contractId: contract!.id },
    ]);
    // 运营列表带次数汇总；还没开通的为 null
    const list = (await ops.get('/api/operator/organizations').expect(200)).body as { id: string; state: string; credits: unknown }[];
    expect(list.find((o) => o.id === created.id)!.credits).toMatchObject({ remaining: { total: 22, gift: 2, purchase: 20 }, granted: 22, used: 0, awaiting: 0 });
    expect(list.filter((o) => o.state === 'pending').every((o) => o.credits === null)).toBe(true);
  });
});

describe('越权', () => {
  it('客户、专业人员不能登记、查看、上传合同或开通', async () => {
    const created = await register({ ...registration, name: '越权测试' });
    const up = await uploadContract(created.id);
    for (const who of ['a-admin@test.cn', 'expert@test.cn']) {
      const agent = await as(who);
      expect((await agent.get('/api/operator/organizations')).status).toBe(403);
      expect((await agent.post('/api/operator/organizations').send(registration)).status).toBe(403);
      expect((await agent.put(`/api/operator/organizations/${created.id}`).send(registration)).status).toBe(403);
      expect((await agent.post(`/api/operator/organizations/${created.id}/contract-file`).attach('file', PDF, 'x.pdf')).status).toBe(403);
      expect((await agent.post(`/api/operator/organizations/${created.id}/open`).send(opening(up.body.id))).status).toBe(403);
    }
  });

  it('不存在的组织、内部组织都按找不到处理', async () => {
    const agent = await as('ops@test.cn');
    expect((await agent.put(`/api/operator/organizations/${MISSING}`).send(registration)).status).toBe(404);
    expect((await agent.post(`/api/operator/organizations/${org.internal}/open`).send(opening(MISSING))).status).toBe(404);
  });

  it('本组织自己的客户管理员也取不到合同原件', async () => {
    const up = await uploadContract(org.a);
    expect(up.status).toBe(201);
    expect((await (await as('a-admin@test.cn')).get(`/api/files/${up.body.id}/download-url`)).status).toBe(404);
    expect((await (await as('a-admin@test.cn')).get(`/api/files/${up.body.id}/download-url?inline=1`)).status).toBe(404);
  });

  it('客户看不了运营的组织详情，包括自己组织的', async () => {
    expect((await (await as('a-admin@test.cn')).get(`/api/operator/organizations/${org.a}`)).status).toBe(403);
    expect((await (await as('expert@test.cn')).get(`/api/operator/organizations/${org.a}`)).status).toBe(403);
  });

  it('同时点两次开通，只有一次成功', async () => {
    const created = await register({ ...registration, name: '并发开通' });
    const up = await uploadContract(created.id);
    const ops = await as('ops@test.cn');
    const before = mailer.sent.length;
    const results = await Promise.all([
      ops.post(`/api/operator/organizations/${created.id}/open`).send(opening(up.body.id)),
      ops.post(`/api/operator/organizations/${created.id}/open`).send(opening(up.body.id)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const contracts = await handle.db.select().from(organizationContracts).where(eq(organizationContracts.orgId, created.id));
    expect(contracts).toHaveLength(1);
    expect(mailer.sent.length).toBe(before + 1);
  });

  it('没登录不能访问', async () => {
    expect((await request(app.getHttpServer()).get('/api/operator/organizations')).status).toBe(401);
  });
});

describe('组织详情的合同列表', () => {
  it('新的在前，次数按类型相加，带原件和登记人', async () => {
    const ops = await as('ops@test.cn');
    const created = await register({ ...registration, name: '合同列表测试' });
    const up = await uploadContract(created.id);
    const today = chinaToday();
    await ops
      .post(`/api/operator/organizations/${created.id}/open`)
      .send({
        ...opening(up.body.id),
        startsAt: addDays(today, -30),
        endsAt: addDays(today, 100),
        adminEmail: 'list@test.cn',
        purchasedCredits: 20,
        giftCredits: 2,
        giftCampaign: '开通赠送',
      })
      .expect(200);
    await ops
      .post(`/api/operator/organizations/${created.id}/credits`)
      .send({ type: 'top_up', delta: 3, reason: '加买' })
      .expect(200);
    const detail = (await ops.get(`/api/operator/organizations/${created.id}`).expect(200)).body;
    expect(detail.contracts).toHaveLength(1);
    expect(detail.contracts[0]).toMatchObject({
      number: 'GY-HT-2026-018',
      state: 'active',
      credits: { purchase: 20, gift: 2, topUp: 3, compensation: 0 },
      file: { id: up.body.id, originalName: '合同-盖章版.pdf' },
      paymentConfirmedByName: expect.any(String),
    });
  });
});

describe('登记续约', () => {
  async function opened(name: string, startsAt: string, endsAt: string, email: string) {
    const created = await register({ ...registration, name });
    await (await as('ops@test.cn'))
      .post(`/api/operator/organizations/${created.id}/open`)
      .send({ ...opening(MISSING), contractFileId: null, startsAt, endsAt, adminEmail: email, purchasedCredits: 1 })
      .expect(200);
    return created.id;
  }
  const renewal = (v: object = {}) => ({ contractNumber: 'GY-XY-2027-001', purchasedCredits: 10, paymentReceived: true, ...v });

  it('没到期的：接着现在的合同，只延长到期日，记次数和操作日志', async () => {
    const today = chinaToday();
    const end = addDays(today, 20);
    const id = await opened('续约没到期', addDays(today, -300), end, 'renew1@test.cn');
    const ops = await as('ops@test.cn');
    const url = `/api/operator/organizations/${id}/renewal`;
    // 开始日晚于现在到期日的后一天
    const late = await ops.post(url).send(renewal({ contractStartsAt: addDays(end, 2), contractEndsAt: addDays(end, 300) }));
    expect(late.status).toBe(400);
    expect(late.body.message).toBe(`新合同要接着现在的合同：开始日不能晚于 ${addDays(end, 1).replaceAll('-', '.')}`);
    // 到期日不晚于现在的
    const short = await ops.post(url).send(renewal({ contractStartsAt: addDays(end, 1), contractEndsAt: end }));
    expect(short.body.message).toBe('合同到期日不能早于开始日');
    const same = await ops.post(url).send(renewal({ contractStartsAt: today, contractEndsAt: end }));
    expect(same.body.message).toBe(`新合同的到期日要晚于现在的合同（${end.replaceAll('-', '.')}）`);
    // 早于上一份合同的开始日
    const early = await ops.post(url).send(renewal({ contractStartsAt: addDays(today, -400), contractEndsAt: addDays(end, 30) }));
    expect(early.body.message).toBe(`新合同的开始日不能早于上一份合同（${addDays(today, -300).replaceAll('-', '.')}）`);
    // 没确认到账
    expect((await ops.post(url).send(renewal({ paymentReceived: false, contractStartsAt: addDays(end, 1), contractEndsAt: addDays(end, 365) }))).body.message).toBe(
      '合同款到账后才能登记续约',
    );
    // 同编号
    const dup = await ops.post(url).send(renewal({ contractNumber: 'GY-HT-2026-018', contractStartsAt: addDays(end, 1), contractEndsAt: addDays(end, 365) }));
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('这个合同编号已经登记过了');

    const ok = await ops.post(url).send(renewal({ giftCredits: 2, giftCampaign: '续约赠送', contractStartsAt: addDays(end, 1), contractEndsAt: addDays(end, 365) }));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ released: 0 });
    const [o] = await handle.db.select().from(organizations).where(eq(organizations.id, id));
    expect(o).toMatchObject({ contractStartsAt: addDays(today, -300), contractEndsAt: addDays(end, 365) });
    const contracts = await handle.db.select().from(organizationContracts).where(eq(organizationContracts.orgId, id));
    const next = contracts.find((c) => c.number === 'GY-XY-2027-001')!;
    expect(next).toMatchObject({ startsAt: addDays(end, 1), endsAt: addDays(end, 365), fileId: null, scopeKind: null });
    const rows = await handle.db.select().from(creditEntries).where(eq(creditEntries.contractId, next.id));
    expect(rows.map((r) => [r.type, r.delta, r.campaign, r.reason]).sort()).toEqual([
      ['contract_purchase', 10, null, '续约时按合同登记。'],
      ['gift', 2, '续约赠送', '续约时按活动规则赠送，跟合同一起到期。'],
    ]);
    const logs = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'contract_renew'));
    expect(logs.some((l) => l.target === `续约没到期 · 合同 GY-XY-2027-001，到 ${addDays(end, 365).replaceAll('-', '.')}`)).toBe(true);
  });

  it('已到期的：开始和到期都换成新合同的，放开等续约的成果', async () => {
    const today = chinaToday();
    const id = await opened('续约已到期', addDays(today, -10), addDays(today, 1), 'renew2@test.cn');
    // 改成已经到期
    await handle.db.update(organizations).set({ contractStartsAt: addDays(today, -400), contractEndsAt: addDays(today, -5) }).where(eq(organizations.id, id));
    await handle.db.update(organizationContracts).set({ startsAt: addDays(today, -400), endsAt: addDays(today, -5) }).where(eq(organizationContracts.orgId, id));
    const ops = await as('ops@test.cn');
    const res = await ops.post(`/api/operator/organizations/${id}/renewal`).send(renewal({ contractStartsAt: today, contractEndsAt: addDays(today, 364) }));
    expect(res.status).toBe(200);
    const [o] = await handle.db.select().from(organizations).where(eq(organizations.id, id));
    expect(o).toMatchObject({ contractStartsAt: today, contractEndsAt: addDays(today, 364) });
    const list = (await ops.get('/api/operator/organizations').expect(200)).body as { id: string; state: string }[];
    expect(list.find((r) => r.id === id)!.state).toBe('active');
  });

  it('还没开通的不能续约；客户、专家 403', async () => {
    const created = await register({ ...registration, name: '续约没开通' });
    const today = chinaToday();
    const body = renewal({ contractStartsAt: today, contractEndsAt: addDays(today, 364) });
    const res = await (await as('ops@test.cn')).post(`/api/operator/organizations/${created.id}/renewal`).send(body);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('这个组织还没开通，请先开通');
    for (const who of ['a-admin@test.cn', 'expert@test.cn']) {
      expect((await (await as(who)).post(`/api/operator/organizations/${org.a}/renewal`).send(body)).status).toBe(403);
    }
  });
});

describe('赠送活动统计', () => {
  it('只算耕云赠送，按活动名称分组；客户 403', async () => {
    const ops = await as('ops@test.cn');
    const res = await ops.get('/api/operator/credits/gift-campaigns').expect(200);
    const year = Number(chinaToday().slice(0, 4));
    expect(res.body.year).toBe(year);
    expect(res.body.years).toContain(year);
    expect(res.body.unnamed).toMatchObject({ campaign: null });
    for (const c of res.body.campaigns as { campaign: string; granted: number; used: number; unused: number }[]) {
      expect(c.granted).toBe(c.used + c.unused);
    }
    expect((await ops.get('/api/operator/credits/gift-campaigns?year=abc')).status).toBe(400);
    expect((await (await as('a-admin@test.cn')).get('/api/operator/credits/gift-campaigns')).status).toBe(403);
  });
});
