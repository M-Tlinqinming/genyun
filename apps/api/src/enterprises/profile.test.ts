import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { checklistItems, enterpriseAssignments, enterprises, memberships, organizations, users } from '../db/schema.ts';
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
    // 成员处理分配给自己的企业
    const [member0] = await handle.db.select({ id: users.id }).from(users).where(eq(users.email, 'a-member@test.cn'));
    await handle.db.insert(enterpriseAssignments).values({ enterpriseId: id, userId: member0!.id, orgId: org.a });
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

describe('企业自填第 2 步 · 人员与应急组织', () => {
  async function organization(id: string) {
    const res = await (await as('a-admin@test.cn')).get(`/api/enterprises/${id}/organization-step`);
    expect(res.status).toBe(200);
    return res.body;
  }

  async function withTask(name: string) {
    const id = await newEnterprise(name);
    const agent = await as('a-admin@test.cn');
    const task = (await agent.post(`/api/enterprises/${id}/tasks`).send({ name: '2026 年应急预案编制' })).body;
    return { id, taskId: task.id as string, agent };
  }

  it('第一次打开按第 1 步的员工人数预设小组', async () => {
    const id = await newEnterprise('丑公司');
    expect((await organization(id)).step.groups.map((g: { name: string }) => g.name)).toEqual([
      '抢险救灾组',
      '综合保障组',
      '通讯联络组',
    ]);
    const agent = await as('a-admin@test.cn');
    await agent
      .put(`/api/enterprises/${id}/basic-step`)
      .send({ version: 1, identity: { name: '丑公司' }, basic: { employeeCount: 150 } });
    const s = await organization(id);
    expect(s).toMatchObject({ version: 2, employeeCount: 150, roster: [] });
    expect(s.step.groups).toHaveLength(5);
  });

  it('总指挥及手机填了「各应急小组成员」为已提供；值班电话要另填，不默认同总指挥', async () => {
    const { id, taskId, agent } = await withTask('寅公司');
    const s = await organization(id);
    const commander = { id: 'p1', name: '陈大文', position: '总经理' };

    const partial = await agent
      .put(`/api/enterprises/${id}/organization-step`)
      .send({ version: s.version, step: { ...s.step, commander } });
    expect(partial.status).toBe(200);
    expect(await checklistItem(taskId, 'emergency_groups')).toBeUndefined();
    expect(await checklistItem(taskId, 'duty_phone')).toBeUndefined();

    const full = await agent
      .put(`/api/enterprises/${id}/organization-step`)
      .send({ version: partial.body.version, step: { ...s.step, commander: { ...commander, phone: '13800002071' } } });
    expect(full.status).toBe(200);
    expect(full.body.step.commander.phone).toBe('13800002071');
    expect(await checklistItem(taskId, 'emergency_groups')).toMatchObject({ status: 'provided' });
    expect(await checklistItem(taskId, 'duty_phone')).toBeUndefined();

    // 删掉手机：「各应急小组成员」回到未回答；另填值班电话则值班电话为已提供
    await agent
      .put(`/api/enterprises/${id}/organization-step`)
      .send({ version: full.body.version, step: { ...s.step, commander, dutyPhone: '0752-3324567' } });
    expect(await checklistItem(taskId, 'emergency_groups')).toBeUndefined();
    expect(await checklistItem(taskId, 'duty_phone')).toMatchObject({ status: 'provided' });
  });

  it('和第 1 步共用版本号：别人刚保存过第 1 步时拒绝', async () => {
    const id = await newEnterprise('卯公司');
    const s = await organization(id);
    const agent = await as('a-admin@test.cn');
    await agent
      .put(`/api/enterprises/${id}/basic-step`)
      .send({ version: s.version, identity: { name: '卯公司' }, basic: { employeeCount: 10 } });
    const stale = await agent.put(`/api/enterprises/${id}/organization-step`).send({ version: s.version, step: s.step });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ reason: 'stale' });
    // 第 1 步的内容没被冲掉
    expect((await step(id)).basic.employeeCount).toBe(10);
  });

  it('小组少于 2 个、电话格式不对时不保存', async () => {
    const id = await newEnterprise('辰公司');
    const s = await organization(id);
    const agent = await as('a-admin@test.cn');
    const one = await agent
      .put(`/api/enterprises/${id}/organization-step`)
      .send({ version: s.version, step: { ...s.step, groups: s.step.groups.slice(0, 1) } });
    expect(one.status).toBe(400);
    expect(one.body.message).toBe('至少设 2 个应急小组');
    const phone = await agent
      .put(`/api/enterprises/${id}/organization-step`)
      .send({ version: s.version, step: { ...s.step, dutyPhone: '门卫室' } });
    expect(phone.status).toBe(400);
  });

  it('上传花名册：文件记在企业资料里，挂到「各应急小组成员」后为已提供，可以移除', async () => {
    const { id, taskId, agent } = await withTask('巳公司');
    const file = await agent.post(`/api/orgs/${org.a}/files`).attach('file', DOCX, '应急通讯录.docx');
    expect(file.status).toBe(201);
    const fileId = file.body.id as string;

    const added = await agent.post(`/api/enterprises/${id}/roster`).send({ fileId });
    expect(added.status).toBe(201);
    expect(added.body.roster).toEqual([{ fileId, originalName: '应急通讯录.docx' }]);
    await agent.post(`/api/tasks/${taskId}/checklist/emergency_groups/files`).send({ fileId });
    expect(await checklistItem(taskId, 'emergency_groups')).toMatchObject({ status: 'provided' });

    // 切到上传花名册方式保存：有文件作凭证，资料项不受影响
    const s = await organization(id);
    await agent
      .put(`/api/enterprises/${id}/organization-step`)
      .send({ version: s.version, step: { ...s.step, mode: 'roster' } });
    expect(await checklistItem(taskId, 'emergency_groups')).toMatchObject({ status: 'provided' });

    const removed = await agent.delete(`/api/enterprises/${id}/roster/${fileId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.roster).toEqual([]);
    expect(removed.body.step.mode).toBe('roster');
  });

  it('别的组织读不到也改不了，也不能挂别的组织的文件', async () => {
    const id = await newEnterprise('午公司');
    const s = await organization(id);
    const b = await as('b-admin@test.cn');
    expect((await b.get(`/api/enterprises/${id}/organization-step`)).status).toBe(404);
    expect((await b.put(`/api/enterprises/${id}/organization-step`).send({ version: s.version, step: s.step })).status).toBe(
      404,
    );
    const other = await b.post(`/api/orgs/${org.b}/files`).attach('file', PDF, 'b.pdf');
    const res = await (await as('a-admin@test.cn')).post(`/api/enterprises/${id}/roster`).send({ fileId: other.body.id });
    expect(res.status).toBe(404);
  });
});

describe('企业自填第 3 步 · 场所、设备与物料', () => {
  async function production(id: string) {
    const res = await (await as('a-admin@test.cn')).get(`/api/enterprises/${id}/production-step`);
    expect(res.status).toBe(200);
    return res.body;
  }

  async function withTask(name: string) {
    const id = await newEnterprise(name);
    const agent = await as('a-admin@test.cn');
    const task = (await agent.post(`/api/enterprises/${id}/tasks`).send({ name: '2026 年应急预案编制' })).body;
    return { id, taskId: task.id as string, agent };
  }

  const answers = (a: string[]) => ({
    pressureVessels: { answer: a[0] },
    boilers: { answer: a[1] },
    pressurePipelines: { answer: a[2] },
    storageTanks: { answer: a[3] },
  });

  it('第一次打开预选常见场所，并按第 1 步的经营范围加上喷涂', async () => {
    const id = await newEnterprise('丙一公司');
    const agent = await as('a-admin@test.cn');
    await agent
      .put(`/api/enterprises/${id}/basic-step`)
      .send({ version: 1, identity: { name: '丙一公司' }, basic: { businessScope: '五金件加工、喷涂' } });
    const s = await production(id);
    expect(s).toMatchObject({ version: 2, saved: false, businessScope: '五金件加工、喷涂', fileNames: {} });
    expect(s.step.sites).toEqual(['workshop', 'spraying', 'warehouse', 'power_room']);
  });

  it('设备、物料填了名称与数量为已提供；特种设备四类都答完才有结论', async () => {
    const { id, taskId, agent } = await withTask('丙二公司');
    let s = await production(id);
    const save = async (step: object) => {
      const res = await agent.put(`/api/enterprises/${id}/production-step`).send({ version: s.version, step });
      expect(res.status).toBe(200);
      s = res.body;
    };

    await save({
      ...s.step,
      equipment: [{ id: 'e1', name: '螺杆空压机', quantity: '2 台' }],
      materials: [{ id: 'm1', name: '油漆', maxStorage: '200 kg' }],
      specialEquipment: answers(['yes', 'no', 'no']),
    });
    expect(s.saved).toBe(true);
    expect(await checklistItem(taskId, 'equipment')).toMatchObject({ status: 'provided' });
    expect(await checklistItem(taskId, 'materials')).toMatchObject({ status: 'provided' });
    expect(await checklistItem(taskId, 'special_equipment')).toBeUndefined();

    await save({ ...s.step, specialEquipment: answers(['no', 'no', 'no', 'no']) });
    expect(await checklistItem(taskId, 'special_equipment')).toMatchObject({ status: 'none' });
    await save({ ...s.step, specialEquipment: answers(['photo', 'no', 'no', 'no']) });
    expect(await checklistItem(taskId, 'special_equipment')).toMatchObject({
      status: 'photo_for_expert',
      expertJudgement: { result: 'pending' },
    });
    await save({ ...s.step, specialEquipment: answers(['yes', 'no', 'no', 'no']) });
    expect(await checklistItem(taskId, 'special_equipment')).toMatchObject({ status: 'provided' });

    // 清掉数量、撤回一类回答，又回到未回答
    await save({
      ...s.step,
      equipment: [{ id: 'e1', name: '螺杆空压机' }],
      specialEquipment: answers(['yes', 'no', 'no']),
    });
    expect(await checklistItem(taskId, 'equipment')).toBeUndefined();
    expect(await checklistItem(taskId, 'special_equipment')).toBeUndefined();
    expect(await checklistItem(taskId, 'materials')).toMatchObject({ status: 'provided' });
  });

  it('包装标签、台账引用上传过的文件，页面拿到文件名', async () => {
    const { id, taskId, agent } = await withTask('丙三公司');
    const photo = await agent.post(`/api/orgs/${org.a}/files?rule=image_or_pdf`).attach('file', PDF, '油漆标签.pdf');
    const ledger = await agent.post(`/api/orgs/${org.a}/files`).attach('file', DOCX, '设备台账.docx');
    const s = await production(id);

    // 台账挂到「生产设备设施」上即已提供，之后保存内容（没有设备行）也不撤回
    await agent.post(`/api/tasks/${taskId}/checklist/equipment/files`).send({ fileId: ledger.body.id });
    const res = await agent.put(`/api/enterprises/${id}/production-step`).send({
      version: s.version,
      step: {
        ...s.step,
        materials: [{ id: 'm1', name: '油漆', labelPhotoFileIds: [photo.body.id] }],
        ledgers: { equipment: [ledger.body.id] },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.fileNames).toEqual({ [photo.body.id]: '油漆标签.pdf', [ledger.body.id]: '设备台账.docx' });
    expect(await checklistItem(taskId, 'equipment')).toMatchObject({ status: 'provided', fileIds: [ledger.body.id] });
  });

  it('和前两步共用版本号；格式不对、引用别的组织的文件时不保存', async () => {
    const id = await newEnterprise('丙四公司');
    const agent = await as('a-admin@test.cn');
    const s = await production(id);
    await agent.put(`/api/enterprises/${id}/basic-step`).send({ version: s.version, identity: { name: '丙四公司' }, basic: {} });
    const stale = await agent.put(`/api/enterprises/${id}/production-step`).send({ version: s.version, step: s.step });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ reason: 'stale', version: s.version + 1 });

    const fresh = await production(id);
    const put = (step: object) => agent.put(`/api/enterprises/${id}/production-step`).send({ version: fresh.version, step });
    expect((await put({ ...fresh.step, sites: ['moon_base'] })).status).toBe(400);
    expect((await put({ ...fresh.step, equipment: [{ id: 'e', name: '冲'.repeat(51) }] })).status).toBe(400);

    const other = await (await as('b-admin@test.cn')).post(`/api/orgs/${org.b}/files`).attach('file', PDF, 'b.pdf');
    expect((await put({ ...fresh.step, ledgers: { materials: [other.body.id] } })).status).toBe(404);
  });

  it('别的组织读不到也改不了', async () => {
    const id = await newEnterprise('丙五公司');
    const s = await production(id);
    const b = await as('b-admin@test.cn');
    expect((await b.get(`/api/enterprises/${id}/production-step`)).status).toBe(404);
    expect((await b.put(`/api/enterprises/${id}/production-step`).send({ version: s.version, step: s.step })).status).toBe(404);
  });
});

describe('企业自填第 3 步 · 工艺流程', () => {
  async function withTask(name: string) {
    const id = await newEnterprise(name);
    const agent = await as('a-admin@test.cn');
    const task = (await agent.post(`/api/enterprises/${id}/tasks`).send({ name: '2026 年应急预案编制' })).body;
    const s = (await agent.get(`/api/enterprises/${id}/production-step`)).body;
    return { id, taskId: task.id as string, agent, s };
  }

  it('选模板带出工序后「生产工艺流程」为已提供，删光工序又回到未回答；第 1 页内容不受影响', async () => {
    const { id, taskId, agent, s } = await withTask('丁一公司');
    expect(s.step.process).toEqual({ sketchFileIds: [], steps: [] });
    const steps = [
      { id: 'p1', name: '下料', equipment: ['剪板机'] },
      { id: 'p2', name: '冲压成型', equipment: ['冲床'] },
    ];
    const first = await agent.put(`/api/enterprises/${id}/production-step`).send({
      version: s.version,
      step: { ...s.step, process: { source: 'template', templateId: 'metal_stamping', steps } },
    });
    expect(first.status).toBe(200);
    expect(first.body.step.process).toMatchObject({ source: 'template', templateId: 'metal_stamping', steps });
    expect(first.body.step.sites).toEqual(s.step.sites);
    expect(await checklistItem(taskId, 'process_flow')).toMatchObject({ status: 'provided' });

    const cleared = await agent.put(`/api/enterprises/${id}/production-step`).send({
      version: first.body.version,
      step: { ...first.body.step, process: { source: 'template', templateId: 'metal_stamping', steps: [] } },
    });
    expect(cleared.status).toBe(200);
    expect(await checklistItem(taskId, 'process_flow')).toBeUndefined();
  });

  it('只写一句话、只传流程图照片也算已提供；不认识的模板、别的组织的照片不保存', async () => {
    const { id, taskId, agent, s } = await withTask('丁二公司');
    const put = (version: number, process: object) =>
      agent.put(`/api/enterprises/${id}/production-step`).send({ version, step: { ...s.step, process } });

    const text = await put(s.version, { source: 'text', description: '熔融、压铸、包装出货' });
    expect(text.status).toBe(200);
    expect(await checklistItem(taskId, 'process_flow')).toMatchObject({ status: 'provided' });

    const photo = await agent.post(`/api/orgs/${org.a}/files?rule=image_or_pdf`).attach('file', PDF, '流程图.pdf');
    const sketch = await put(text.body.version, { source: 'sketch', sketchFileIds: [photo.body.id] });
    expect(sketch.status).toBe(200);
    expect(sketch.body.fileNames).toEqual({ [photo.body.id]: '流程图.pdf' });
    expect(await checklistItem(taskId, 'process_flow')).toMatchObject({ status: 'provided' });

    expect((await put(sketch.body.version, { templateId: 'shipyard' })).status).toBe(400);
    const other = await (await as('b-admin@test.cn')).post(`/api/orgs/${org.b}/files`).attach('file', PDF, 'b.pdf');
    expect((await put(sketch.body.version, { sketchFileIds: [other.body.id] })).status).toBe(404);
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

  it('新建企业时先识别：只返回识别结果，不保存；别的组织不能用', async () => {
    const fileId = await uploadLicense();
    const res = await (await as('a-admin@test.cn')).post(`/api/orgs/${org.a}/license-recognition`).send({ fileId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'recognized', recognized: { name: '惠阳飞宇电器有限公司', legalRepresentative: '李文聪' } });
    const other = await (await as('b-admin@test.cn')).post(`/api/orgs/${org.a}/license-recognition`).send({ fileId });
    expect(other.status).toBe(403);
    const wrongOrg = await (await as('b-admin@test.cn')).post(`/api/orgs/${org.b}/license-recognition`).send({ fileId });
    expect(wrongOrg.status).toBe(404);
  });

  it('建档后挂执照（保留表单内容）：客户改过的身份信息不被识别结果覆盖，一致的标「来自营业执照」', async () => {
    const agent = await as('a-admin@test.cn');
    const ent = await agent.post(`/api/orgs/${org.a}/enterprises`).send({ name: '飞宇电器（客户改过名）', legalRepresentative: '李文聪' });
    const fileId = await uploadLicense();
    const res = await agent.post(`/api/enterprises/${ent.body.id}/license`).send({ fileId, keepIdentity: true });
    expect(res.status).toBe(201);
    expect(res.body.identity).toMatchObject({ name: '飞宇电器（客户改过名）', legalRepresentative: '李文聪', socialCreditCode: null });
    expect(res.body.sources).toMatchObject({ legalRepresentative: 'license', businessScope: 'license' });
    expect(res.body.sources.name).toBeUndefined();
    expect(res.body.license).toMatchObject({ fileId });
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

describe('企业自填第 4 步 · 应急资源与图纸', () => {
  async function resources(id: string) {
    const res = await (await as('a-admin@test.cn')).get(`/api/enterprises/${id}/resources-step`);
    expect(res.status).toBe(200);
    return res.body;
  }

  async function withTask(name: string) {
    const id = await newEnterprise(name);
    const agent = await as('a-admin@test.cn');
    const task = (await agent.post(`/api/enterprises/${id}/tasks`).send({ name: '2026 年应急预案编制' })).body;
    return { id, taskId: task.id as string, agent };
  }

  it('第一次打开按第 3 步的场所列出建筑，带出第 2 步的人员和第 3 步的物料', async () => {
    const id = await newEnterprise('丁一公司');
    const agent = await as('a-admin@test.cn');
    let v = (await resources(id)).version;
    const org2 = await agent.get(`/api/enterprises/${id}/organization-step`);
    const commander = { id: 'p1', name: '赵六', phone: '13500007786' };
    v = (
      await agent
        .put(`/api/enterprises/${id}/organization-step`)
        .send({ version: v, step: { ...org2.body.step, commander } })
    ).body.version;
    const prod = await agent.get(`/api/enterprises/${id}/production-step`);
    const step3 = {
      ...prod.body.step,
      sites: ['workshop', 'warehouse', 'dormitory'],
      materials: [
        { id: 'm1', name: '油漆' },
        { id: 'm2', name: '' },
      ],
    };
    expect((await agent.put(`/api/enterprises/${id}/production-step`).send({ version: v, step: step3 })).status).toBe(
      200,
    );

    const s = await resources(id);
    expect(s.saved).toBe(false);
    expect(s.step.buildings.map((b: { name: string }) => b.name)).toEqual(['生产车间', '仓库', '员工宿舍']);
    expect(s.step.supplies).toHaveLength(4);
    expect(s.people).toEqual([commander]);
    expect(s.materials.map((m: { name: string }) => m.name)).toEqual(['油漆']);
  });

  it('物资、药箱、水池、建筑、相邻企业填好后各自变为相应状态，撤回后回到未回答', async () => {
    const { id, taskId, agent } = await withTask('丁二公司');
    let s = await resources(id);
    const save = async (step: object) => {
      const res = await agent.put(`/api/enterprises/${id}/resources-step`).send({ version: s.version, step });
      expect(res.status).toBe(200);
      s = res.body;
    };
    const base = s.step;

    await save({
      ...base,
      supplies: [{ id: 'r1', name: '手提式干粉灭火器', unit: '具', quantity: 50, location: '厂区各处' }],
      firstAidKit: { ...base.firstAidKit, answer: 'yes' },
      firePool: { answer: 'yes', count: 1, volumeLater: true },
      buildings: [{ id: 'b1', name: '生产车间（A 栋）', fireRating: '2', floors: 3, areaM2: 20079.92 }],
      neighbors: { answer: 'none' },
    });
    for (const key of ['emergency_supplies', 'first_aid_kit', 'fire_pool', 'buildings', 'external_resources']) {
      expect(await checklistItem(taskId, key)).toMatchObject({ status: 'provided' });
    }
    expect((await step(id)).totalBuildingAreaM2).toBe(20079.92);

    // 没有药箱、没有水池；只传药箱照片不算已提供，清单要客户填
    await save({ ...s.step, firstAidKit: { ...s.step.firstAidKit, answer: 'no' }, firePool: { answer: 'no' } });
    expect(await checklistItem(taskId, 'first_aid_kit')).toMatchObject({ status: 'none' });
    expect(await checklistItem(taskId, 'fire_pool')).toMatchObject({ status: 'none' });
    const photo = await agent.post(`/api/orgs/${org.a}/files?rule=image_or_pdf`).attach('file', PDF, '药箱.pdf');
    const kitPhotoOnly = { answer: 'yes', mode: 'manual', items: [], photoFileIds: [photo.body.id] };
    expect((await agent.put(`/api/enterprises/${id}/resources-step`).send({ version: s.version, step: { ...s.step, firstAidKit: { ...kitPhotoOnly, mode: 'photo' } } })).status).toBe(400);
    await save({ ...s.step, firstAidKit: kitPhotoOnly });
    expect(await checklistItem(taskId, 'first_aid_kit')).toBeUndefined();
    expect(s.fileNames).toMatchObject({ [photo.body.id]: '药箱.pdf' });

    // 数量清空、建筑没面积、相邻企业不清楚
    await save({
      ...s.step,
      supplies: [{ id: 'r1', name: '手提式干粉灭火器', unit: '具' }],
      buildings: [{ id: 'b1', name: '生产车间', fireRating: 'expert' }],
      neighbors: { answer: 'unknown' },
    });
    expect(await checklistItem(taskId, 'emergency_supplies')).toBeUndefined();
    expect(await checklistItem(taskId, 'buildings')).toBeUndefined();
    expect(await checklistItem(taskId, 'external_resources')).toBeUndefined();
    expect((await step(id)).totalBuildingAreaM2).toBeNull();
  });

  it('以前只传药箱照片交给专家的：迁移后改为自己逐项填、清单待补，资料项为稍后补', async () => {
    const { id, taskId, agent } = await withTask('丁三公司');
    const s = await resources(id);
    const photo = await agent.post(`/api/orgs/${org.a}/files?rule=image_or_pdf`).attach('file', PDF, '药箱.pdf');
    const saved = await agent
      .put(`/api/enterprises/${id}/resources-step`)
      .send({ version: s.version, step: { ...s.step, firstAidKit: { ...s.step.firstAidKit, answer: 'yes', photoFileIds: [photo.body.id] } } });
    expect(saved.status).toBe(200);
    // 造出改版前的数据：方式为「拍药箱照片」（还留着常规配置的清单），资料项等专家判断
    const { db } = handle;
    await db
      .update(enterprises)
      .set({ profile: sql`jsonb_set(${enterprises.profile}, '{resourcesStep,step,firstAidKit,mode}', '"photo"')` })
      .where(eq(enterprises.id, id));
    await db
      .update(checklistItems)
      .set({ status: 'photo_for_expert', expertResult: 'pending', confirmedBy: null, confirmedAt: null })
      .where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.itemKey, 'first_aid_kit')));

    const migration = readFileSync(new URL('../../drizzle/0011_first_aid_list_by_customer.sql', import.meta.url), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) await db.execute(sql.raw(statement));

    const after = await resources(id);
    expect(after.step.firstAidKit).toMatchObject({ answer: 'yes', mode: 'manual', items: [], photoFileIds: [photo.body.id] });
    const item = await checklistItem(taskId, 'first_aid_kit');
    expect(item.status).toBe('later');
    expect(item.expertJudgement).toBeUndefined();
  });

  it('图纸挂到资料项上即已提供，内容里记着文件名', async () => {
    const { id, taskId, agent } = await withTask('丁三公司');
    const plan = await agent.post(`/api/orgs/${org.a}/files?rule=image_or_pdf`).attach('file', PDF, '总平面图.pdf');
    await agent.post(`/api/tasks/${taskId}/checklist/site_plan/files`).send({ fileId: plan.body.id });
    const s = await resources(id);
    const res = await agent.put(`/api/enterprises/${id}/resources-step`).send({
      version: s.version,
      step: { ...s.step, drawings: { site_plan: [plan.body.id] } },
    });
    expect(res.status).toBe(200);
    expect(res.body.fileNames).toEqual({ [plan.body.id]: '总平面图.pdf' });
    expect(await checklistItem(taskId, 'site_plan')).toMatchObject({ status: 'provided', fileIds: [plan.body.id] });
    expect(await checklistItem(taskId, 'evacuation_plan')).toBeUndefined();
  });

  it('保管人必须是已填人员；格式不对、版本过期、引用别的组织的文件时不保存', async () => {
    const id = await newEnterprise('丁四公司');
    const agent = await as('a-admin@test.cn');
    const s = await resources(id);
    const put = (step: object) => agent.put(`/api/enterprises/${id}/resources-step`).send({ version: s.version, step });
    expect((await put({ ...s.step, custodianId: 'nobody' })).status).toBe(400);
    expect((await put({ ...s.step, buildings: [{ id: 'b', name: '仓库', fireRating: '9' }] })).status).toBe(400);
    const other = await (await as('b-admin@test.cn')).post(`/api/orgs/${org.b}/files`).attach('file', PDF, 'b.pdf');
    expect((await put({ ...s.step, drawings: { evacuation_plan: [other.body.id] } })).status).toBe(404);

    expect((await put(s.step)).status).toBe(200);
    const stale = await put(s.step);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ reason: 'stale', version: s.version + 1 });
  });

  it('别的组织读不到也改不了', async () => {
    const id = await newEnterprise('丁五公司');
    const s = await resources(id);
    const b = await as('b-admin@test.cn');
    expect((await b.get(`/api/enterprises/${id}/resources-step`)).status).toBe(404);
    expect(
      (await b.put(`/api/enterprises/${id}/resources-step`).send({ version: s.version, step: s.step })).status,
    ).toBe(404);
  });
});

describe('企业自填第 5 步 · 核对与预约上门', () => {
  async function withTask(name: string) {
    const id = await newEnterprise(name);
    const agent = await as('a-admin@test.cn');
    const task = (await agent.post(`/api/enterprises/${id}/tasks`).send({ name: '2026 年应急预案编制' })).body;
    return { id, taskId: task.id as string, agent };
  }

  it('核对页按步骤列出已填内容和还缺的必需资料，带出联系人', async () => {
    const { id, taskId, agent } = await withTask('戊一公司');
    const s = await step(id);
    const saved = await agent.put(`/api/enterprises/${id}/basic-step`).send({
      version: s.version,
      identity: s.identity,
      basic: { contactPerson: '林小明', contactPhone: '13600003340', employeeCount: 86, mainProducts: '灯头' },
      later: ['safetyManagementCount'],
    });
    expect(saved.status).toBe(200);

    const res = await agent.get(`/api/tasks/${taskId}/review`);
    expect(res.status).toBe(200);
    const { review, contact, contract, onSiteRequest } = res.body;
    expect(review.steps[0].facts).toEqual(['戊一公司', '86 人', '联系人 林小明']);
    expect(review.steps[0].missing).toEqual(['营业执照']);
    expect(review.steps[0].later).toContain('安全管理人员数');
    expect(review.steps[3].missing).toEqual(['应急物资及装备', '总平面布置图', '紧急疏散示意图']);
    expect(review.canSubmit).toBe(false);
    expect(contact).toEqual({ name: '林小明', phone: '13600003340' });
    expect(contract).toEqual({ startsAt: '2026-01-01', endsAt: '2099-12-31' });
    expect(onSiteRequest).toBeNull();
  });

  it('提交预约上门后核对页显示已提交；联系人、电话必填', async () => {
    const { taskId, agent } = await withTask('戊二公司');
    expect((await agent.post(`/api/tasks/${taskId}/on-site-requests`).send({ contactName: '林小明' })).status).toBe(400);
    expect(
      (await agent.post(`/api/tasks/${taskId}/on-site-requests`).send({ contactName: '林小明', contactPhone: '找门卫' }))
        .status,
    ).toBe(400);

    const res = await agent.post(`/api/tasks/${taskId}/on-site-requests`).send({
      contactName: '林小明',
      contactPhone: '136 0000 3340',
      callTime: 'weekday_afternoon',
      helpItems: ['消防设施布置图', '消防水池容积'],
      note: '厂里没人懂图纸，希望有人来现场看一下。',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ callTime: 'weekday_afternoon', helpItems: ['消防设施布置图', '消防水池容积'] });
    // 客户只看到「已收到上门需求」，看不到运营的处理状态和内部备注
    expect(res.body).not.toHaveProperty('status');
    expect(res.body).not.toHaveProperty('internalNote');

    const review = (await agent.get(`/api/tasks/${taskId}/review`)).body;
    expect(review.onSiteRequest).toMatchObject({ id: res.body.id, contactName: '林小明' });
  });

  it('别的组织看不到核对内容，也不能替人预约；专家不能代客户预约', async () => {
    const { taskId } = await withTask('戊三公司');
    const b = await as('b-admin@test.cn');
    expect((await b.get(`/api/tasks/${taskId}/review`)).status).toBe(404);
    const body = { contactName: '张三', contactPhone: '13800000000' };
    expect((await b.post(`/api/tasks/${taskId}/on-site-requests`).send(body)).status).toBe(404);
    const expert = await as('expert@test.cn');
    expect((await expert.post(`/api/tasks/${taskId}/on-site-requests`).send(body)).status).not.toBe(201);
  });
});
