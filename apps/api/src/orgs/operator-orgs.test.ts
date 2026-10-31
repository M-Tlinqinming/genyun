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
import { memberships, organizationContracts, organizationInvitations, organizations, users } from '../db/schema.ts';
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
  region: '上海市闵行区',
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
    scopeKind: 'annual',
    scopeEnterprises: 5,
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
    // 已有合同的老组织算服务中
    expect((list.body as { id: string; state: string }[]).find((o) => o.id === org.a)?.state).toBe('active');
    // 内部组织不在客户组织列表里
    expect((list.body as { id: string }[]).some((o) => o.id === org.internal)).toBe(false);
  });

  it('缺必填项时说明缺什么', async () => {
    const res = await (await as('ops@test.cn')).post('/api/operator/organizations').send({ name: 'x', region: '' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('所在地区');
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
  it('缺合同原件或没确认到账不能开通，并列出缺项', async () => {
    const created = await register({ ...registration, name: '缺项测试' });
    const res = await (await as('ops@test.cn'))
      .post(`/api/operator/organizations/${created.id}/open`)
      .send({ ...opening(MISSING), contractFileId: null, paymentReceived: false });
    expect(res.status).toBe(400);
    expect(res.body.gaps).toEqual(['已签合同原件', '合同款已到账']);
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

    const { db } = handle;
    const [o] = await db.select().from(organizations).where(eq(organizations.id, created.id));
    expect(o!.activatedAt).not.toBeNull();
    const contracts = await db.select().from(organizationContracts).where(eq(organizationContracts.orgId, created.id));
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({ number: 'GY-HT-2026-018', scopeKind: 'annual', scopeEnterprises: 5, fileId: up.body.id });
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

  it('没登录不能访问', async () => {
    expect((await request(app.getHttpServer()).get('/api/operator/organizations')).status).toBe(401);
  });
});
