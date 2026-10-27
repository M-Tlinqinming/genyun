import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { memberships, organizations, users } from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';
import { FakeLicenseRecognizer } from '../license/recognizer.ts';

const PASSWORD = 'correct horse battery staple';
const PDF = Buffer.from('%PDF-1.7\n% 营业执照\n');
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('..[Content_Types].xml..word/document.xml'),
]);

let handle: DatabaseHandle;
// 两个后台共用一个数据库：一个配了识别服务（模拟），一个没配
let app: INestApplication;
let appWithoutOcr: INestApplication;
let storageDir: string;
const org: Record<'a' | 'b' | 'internal', string> = { a: '', b: '', internal: '' };

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const created = await db
    .insert(organizations)
    .values([
      { name: 'A 安全咨询', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: 'B 制造', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  [org.a, org.b, org.internal] = created.map((o) => o.id) as [string, string, string];
  for (const p of [
    { email: 'a-admin@test.cn', orgId: org.a, role: 'customer_admin' as const },
    { email: 'a-member@test.cn', orgId: org.a, role: 'customer_member' as const },
    { email: 'b-admin@test.cn', orgId: org.b, role: 'customer_admin' as const },
    { email: 'expert@test.cn', orgId: org.internal, role: 'expert' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.email, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
  }

  storageDir = mkdtempSync(join(tmpdir(), 'genyun-profile-'));
  const storage = new LocalDiskStorage(storageDir, 'test-secret');
  app = await createApp(db, { loginLimitPerMinute: 1000, storage, recognizer: new FakeLicenseRecognizer() });
  await app.init();
  appWithoutOcr = await createApp(db, { loginLimitPerMinute: 1000, storage, recognizer: null });
  await appWithoutOcr.init();
});

afterAll(async () => {
  await app?.close();
  await appWithoutOcr?.close();
  await handle?.close();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function as(email: string, target = app) {
  const key = `${email}|${target === app ? 'ocr' : 'plain'}`;
  let agent = agents.get(key);
  if (!agent) {
    agent = request.agent(target.getHttpServer());
    expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    agents.set(key, agent);
  }
  return agent;
}

async function newEnterprise(name: string, orgId = org.a): Promise<string> {
  const res = await (await as('a-admin@test.cn')).post(`/api/orgs/${orgId}/enterprises`).send({ name });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function step(id: string) {
  const res = await (await as('a-admin@test.cn')).get(`/api/enterprises/${id}/basic-step`);
  expect(res.status).toBe(200);
  return res.body;
}

async function checklistItem(taskId: string, key: string) {
  const res = await (await as('a-admin@test.cn')).get(`/api/tasks/${taskId}/checklist`);
  return res.body.items[key];
}

const ready = { contactPerson: '李文聪', contactPhone: '13800000000', employeeCount: 86, mainProducts: '电热水壶' };

describe('企业自填第 1 步 · 保存', () => {
  it('新企业从版本 1 开始，资料为空', async () => {
    const id = await newEnterprise('甲公司');
    const s = await step(id);
    expect(s).toMatchObject({ version: 1, identity: { name: '甲公司' }, basic: {}, later: [], license: null });
  });

  it('保存后版本加 1，企业身份同步到企业档案，其余进企业资料', async () => {
    const id = await newEnterprise('乙公司');
    const agent = await as('a-admin@test.cn');
    const res = await agent.put(`/api/enterprises/${id}/basic-step`).send({
      version: 1,
      identity: { name: '乙制造有限公司', legalRepresentative: '王五' },
      basic: { industry: '33', employeeCount: 40, siteAddress: '惠州市惠阳区某路 1 号' },
      later: ['safetyManagementCount'],
      sources: { contactPerson: 'account' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: 2,
      basic: { industry: '33', employeeCount: 40 },
      later: ['safetyManagementCount'],
    });
    const enterprise = (await agent.get(`/api/enterprises/${id}`)).body;
    expect(enterprise).toMatchObject({ name: '乙制造有限公司', legalRepresentative: '王五' });
    // 再读一次内容还在（分次填写）
    expect((await step(id)).basic.siteAddress).toBe('惠州市惠阳区某路 1 号');
  });

  it('别人已保存过（版本对不上）时拒绝，返回最新版本', async () => {
    const id = await newEnterprise('丙公司');
    const admin = await as('a-admin@test.cn');
    const member = await as('a-member@test.cn');
    expect(
      (
        await admin
          .put(`/api/enterprises/${id}/basic-step`)
          .send({ version: 1, identity: { name: '丙公司' }, basic: { employeeCount: 1 } })
      ).status,
    ).toBe(200);
    const stale = await member
      .put(`/api/enterprises/${id}/basic-step`)
      .send({ version: 1, identity: { name: '丙公司' }, basic: { employeeCount: 2 } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ reason: 'stale', version: 2 });
    expect((await step(id)).basic.employeeCount).toBe(1);
  });

  it('在企业详情里改过信息，填写页里的旧内容不能覆盖', async () => {
    const id = await newEnterprise('丁公司');
    const agent = await as('a-admin@test.cn');
    expect((await agent.patch(`/api/enterprises/${id}`).send({ legalRepresentative: '赵六' })).status).toBe(200);
    const res = await agent
      .put(`/api/enterprises/${id}/basic-step`)
      .send({ version: 1, identity: { name: '丁公司' }, basic: {} });
    expect(res.status).toBe(409);
  });

  it('格式不对的内容不保存', async () => {
    const id = await newEnterprise('戊公司');
    const res = await (
      await as('a-admin@test.cn')
    )
      .put(`/api/enterprises/${id}/basic-step`)
      .send({ version: 1, identity: { name: '戊公司' }, basic: { postalCode: '5160' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('邮政编码应为 6 位数字');
  });

  it('别的组织、没分派到任务的专业人员都读不到也改不了', async () => {
    const id = await newEnterprise('己公司');
    const b = await as('b-admin@test.cn');
    expect((await b.get(`/api/enterprises/${id}/basic-step`)).status).toBe(404);
    expect(
      (await b.put(`/api/enterprises/${id}/basic-step`).send({ version: 1, identity: { name: 'x' }, basic: {} }))
        .status,
    ).toBe(404);
    const expert = await as('expert@test.cn');
    expect((await expert.get(`/api/enterprises/${id}/basic-step`)).status).toBe(404);
    expect(
      (await expert.put(`/api/enterprises/${id}/basic-step`).send({ version: 1, identity: { name: 'x' }, basic: {} }))
        .status,
    ).toBe(404);
  });
});

describe('企业自填第 1 步 · 资料清单跟着填写情况走', () => {
  it('联系人、电话、职工人数、主要产品填齐后「企业基本情况」为已提供，删掉一项又回到未回答', async () => {
    const id = await newEnterprise('庚公司');
    const agent = await as('a-admin@test.cn');
    const task = (await agent.post(`/api/enterprises/${id}/tasks`).send({ name: '2026 年应急预案编制' })).body;

    const partial = await agent
      .put(`/api/enterprises/${id}/basic-step`)
      .send({ version: 1, identity: { name: '庚公司' }, basic: { ...ready, mainProducts: '' } });
    expect(partial.status).toBe(200);
    expect(await checklistItem(task.id, 'basic_info')).toBeUndefined();

    expect(
      (
        await agent
          .put(`/api/enterprises/${id}/basic-step`)
          .send({ version: 2, identity: { name: '庚公司' }, basic: ready })
      ).status,
    ).toBe(200);
    const item = await checklistItem(task.id, 'basic_info');
    expect(item).toMatchObject({ status: 'provided' });
    expect(item.confirmedBy).toBeTruthy();

    expect(
      (
        await agent
          .put(`/api/enterprises/${id}/basic-step`)
          .send({ version: 3, identity: { name: '庚公司' }, basic: { ...ready, contactPhone: '' } })
      ).status,
    ).toBe(200);
    expect(await checklistItem(task.id, 'basic_info')).toBeUndefined();
  });
});

describe('营业执照', () => {
  async function uploadLicense(data = PDF, name = '营业执照.pdf') {
    const res = await (
      await as('a-admin@test.cn')
    )
      .post(`/api/orgs/${org.a}/files?rule=image_or_pdf`)
      .attach('file', data, name);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('识别出的内容填进表单，标「来自营业执照」，版本加 1', async () => {
    const id = await newEnterprise('辛公司');
    const fileId = await uploadLicense();
    const res = await (await as('a-admin@test.cn')).post(`/api/enterprises/${id}/license`).send({ fileId });
    expect(res.status).toBe(201);
    expect(res.body.recognition).toEqual({ status: 'recognized', count: 8 });
    expect(res.body).toMatchObject({
      version: 2,
      identity: { name: '惠阳飞宇电器有限公司', socialCreditCode: '91441303MA4W12345X', legalRepresentative: '李文聪' },
      basic: { registrationAuthority: '惠州市惠阳区市场监督管理局' },
      sources: { name: 'license', businessScope: 'license' },
      license: { fileId, originalName: '营业执照.pdf' },
    });
  });

  it('识别出的信用代码已被本组织另一家企业使用时提示，不改动', async () => {
    const id = await newEnterprise('壬公司');
    const fileId = await uploadLicense();
    const res = await (await as('a-admin@test.cn')).post(`/api/enterprises/${id}/license`).send({ fileId });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ field: 'socialCreditCode' });
    expect((await step(id)).identity.name).toBe('壬公司');
  });

  it('没配置识别服务时只保存执照，告诉页面请手动填写', async () => {
    const id = await newEnterprise('癸公司');
    const fileId = await uploadLicense();
    const res = await (
      await as('a-admin@test.cn', appWithoutOcr)
    )
      .post(`/api/enterprises/${id}/license`)
      .send({ fileId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ recognition: { status: 'unavailable', count: 0 }, recognizerAvailable: false });
    expect(res.body.identity.name).toBe('癸公司');
    expect(res.body.license.fileId).toBe(fileId);
  });

  it('营业执照只收图片和 PDF；别的组织的文件用不了', async () => {
    const id = await newEnterprise('子公司');
    const agent = await as('a-admin@test.cn');
    // 页面按图片或 PDF 规则上传，Word 在上传时就被拒；直接挂一个按普通资料规则传上来的 Word 也不行
    expect(
      (await agent.post(`/api/orgs/${org.a}/files?rule=image_or_pdf`).attach('file', DOCX, '执照.docx')).status,
    ).toBe(400);
    const word = await agent.post(`/api/orgs/${org.a}/files`).attach('file', DOCX, '执照.docx');
    expect(word.status).toBe(201);
    expect((await agent.post(`/api/enterprises/${id}/license`).send({ fileId: word.body.id })).status).toBe(400);

    const other = await (await as('b-admin@test.cn')).post(`/api/orgs/${org.b}/files`).attach('file', PDF, 'b.pdf');
    expect((await agent.post(`/api/enterprises/${id}/license`).send({ fileId: other.body.id })).status).toBe(404);
  });
});
