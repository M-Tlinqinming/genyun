import {
  addWorkingDays,
  agencyDistrictsOf,
  BUILTIN_AGENCY_DISTRICTS,
  BUILTIN_HOLIDAYS,
  BUILTIN_PROCESS_TEMPLATES,
  localAgenciesOf,
  type Address,
  type KnowledgeAgenciesView,
  type LocalAgencies,
  productionStepSchema,
  type KnowledgeTemplatesView,
} from '@genyun/shared';
import { feiyuLocation } from '@genyun/shared/fixtures/feiyu';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { auditLogs, enterprises, holidays, memberships, organizations, users } from '../db/schema.ts';
import { KnowledgeService } from './knowledge.service.ts';

const PASSWORD = 'correct horse battery staple';
const BEFORE = JSON.parse(readFileSync(new URL('./fixtures/local-agencies-before.json', import.meta.url), 'utf8')) as {
  address: Address | null;
  expected: LocalAgencies;
}[];

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};

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
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  // 一家企业选用过「五金冲压」模板
  await db.insert(enterprises).values({
    orgId: customer!.id,
    name: '示例五金有限公司',
    createdBy: uid['admin@test.cn']!,
    profile: { productionStep: { step: productionStepSchema.parse({ process: { source: 'template', templateId: 'metal_stamping' } }) } } as never,
  });
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
const logs = async (action: string) =>
  (await handle.db.select().from(auditLogs).where(eq(auditLogs.action, action as never))).map((r) => r.target);

describe('知识库 · 初始数据', () => {
  it('迁移把原来写在代码里的惠州机构原样写进数据库：每个镇街、园区查出来都和原来一样', async () => {
    const regions = await app.get(KnowledgeService).regions();
    const districts = agencyDistrictsOf(regions)!;
    expect(districts).toEqual(BUILTIN_AGENCY_DISTRICTS);
    // 改造前后一致：fixtures/local-agencies-before.json 是 main（8c1f1f3）上原来写在代码里的 localAgenciesOf
    // 对「区县 × 镇街 × 各种叫法」（含只写区县、只写镇街、外地、空地址）算出来的结果，现在读数据库逐条比对
    expect(BEFORE.length).toBeGreaterThan(700);
    const service = app.get(KnowledgeService);
    const fromDb = await service.agencyDistricts();
    for (const { address, expected } of BEFORE) {
      expect(localAgenciesOf(address ?? undefined, fromDb), JSON.stringify(address)).toEqual(expected);
      expect(localAgenciesOf(address ?? undefined), JSON.stringify(address)).toEqual(expected);
    }
    expect(localAgenciesOf(feiyuLocation.siteAddress, districts)).toEqual(localAgenciesOf(feiyuLocation.siteAddress));
    expect(localAgenciesOf(feiyuLocation.siteAddress, districts).emergencyBureau?.name).toBeTruthy();
  });

  it('节假日、工艺模板也原样写入', async () => {
    const rows = await handle.db.select().from(holidays);
    expect(rows.map((r) => ({ date: r.date, kind: r.kind, name: r.name })).sort((a, b) => a.date.localeCompare(b.date))).toEqual(
      [...BUILTIN_HOLIDAYS].sort((a, b) => a.date.localeCompare(b.date)),
    );
    const published = await (await as('admin@test.cn')).get('/api/process-templates').expect(200);
    expect(published.body.templates).toEqual(BUILTIN_PROCESS_TEMPLATES.map((t) => ({ ...t, keywords: [...t.keywords], steps: t.steps.map((s) => ({ name: s.name, equipment: [...s.equipment] })) })));
  });
});

describe('知识库 · 权限', () => {
  it('只有运营能看、能改：客户、注安师 403，没登录 401；客户能读已发布的模板', async () => {
    const view = (await (await as('ops@test.cn')).get('/api/operator/knowledge/agencies').expect(200)).body as KnowledgeAgenciesView;
    const region = view.regions[0]!;
    const agency = region.agencies[0]!;
    const calls = (a: ReturnType<typeof request.agent>) => [
      () => a.get('/api/operator/knowledge/agencies'),
      () => a.post('/api/operator/knowledge/regions').send({ province: '广东省', city: '惠州市', name: '惠城区', aliases: ['惠城'] }),
      () => a.put(`/api/operator/knowledge/regions/${region.id}`).send({ province: '广东省', city: '惠州市', name: region.name, aliases: region.aliases }),
      () => a.post('/api/operator/knowledge/agencies').send({ regionId: region.id, category: 'fire', name: 'x' }),
      () => a.put(`/api/operator/knowledge/agencies/${agency.id}`).send({ regionId: region.id, category: 'fire', name: 'x' }),
      () => a.post(`/api/operator/knowledge/agencies/${agency.id}/verify`),
      () => a.post(`/api/operator/knowledge/agencies/${agency.id}/disable`),
      () => a.post(`/api/operator/knowledge/agencies/${agency.id}/enable`),
      () => a.get('/api/operator/knowledge/holidays'),
      () => a.post('/api/operator/knowledge/holidays').send({ date: '2027-01-01', kind: 'holiday', name: '元旦' }),
      () => a.delete('/api/operator/knowledge/holidays/2026-01-01'),
      () => a.get('/api/operator/knowledge/templates'),
      () => a.post('/api/operator/knowledge/templates').send({ label: 'x' }),
      () => a.put('/api/operator/knowledge/templates/smt/draft').send({ label: 'x' }),
      () => a.post('/api/operator/knowledge/templates/smt/publish').send({ label: 'x', steps: [{ name: 'a' }] }),
      () => a.post('/api/operator/knowledge/templates/smt/disable'),
      () => a.post('/api/operator/knowledge/templates/smt/enable'),
    ];
    for (const email of ['admin@test.cn', 'zhou@test.cn']) {
      for (const call of calls(await as(email))) expect((await call()).status).toBe(403);
    }
    for (const call of calls(request.agent(app.getHttpServer()))) expect((await call()).status).toBe(401);
    await request(app.getHttpServer()).get('/api/process-templates').expect(401);
    await (await as('zhou@test.cn')).get('/api/process-templates').expect(200);
    expect(await logs('knowledge_agency_change')).toEqual([]);
  });
});

describe('知识库 · 属地应急机构', () => {
  it('改电话、停用：之后的生成按新的；操作记日志', async () => {
    const ops = await as('ops@test.cn');
    const view = (await ops.get('/api/operator/knowledge/agencies').expect(200)).body as KnowledgeAgenciesView;
    const region = view.regions.find((r) => r.name === '仲恺高新区')!;
    const bureau = region.agencies.find((a) => a.category === 'emergency')!;
    expect(bureau).toMatchObject({ verifiedAt: null, disabled: false });

    const changed = await ops
      .put(`/api/operator/knowledge/agencies/${bureau.id}`)
      .send({ regionId: region.id, category: 'emergency', name: bureau.name, phone: '0752-0000000' })
      .expect(200);
    const after = (changed.body as KnowledgeAgenciesView).regions.find((r) => r.id === region.id)!.agencies.find((a) => a.id === bureau.id)!;
    expect(after).toMatchObject({ phone: '0752-0000000', verifiedByName: '赵运营' });
    const service = app.get(KnowledgeService);
    expect(localAgenciesOf(feiyuLocation.siteAddress, await service.agencyDistricts()).emergencyBureau).toEqual({ name: bureau.name, phone: '0752-0000000' });

    await ops.post(`/api/operator/knowledge/agencies/${bureau.id}/disable`).expect(200);
    expect(localAgenciesOf(feiyuLocation.siteAddress, await service.agencyDistricts()).emergencyBureau).toBeUndefined();
    await ops.post(`/api/operator/knowledge/agencies/${bureau.id}/enable`).expect(200);
    await ops
      .put(`/api/operator/knowledge/agencies/${bureau.id}`)
      .send({ regionId: region.id, category: 'emergency', name: bureau.name, phone: bureau.phone })
      .expect(200);
    expect(agencyDistrictsOf((await service.regions()))).toEqual(BUILTIN_AGENCY_DISTRICTS);

    // 镇街应急办必须写适用镇街；电话格式不对、区县重名都拒绝
    await ops.post('/api/operator/knowledge/agencies').send({ regionId: region.id, category: 'street', name: '某某办' }).expect(400);
    await ops.post('/api/operator/knowledge/agencies').send({ regionId: region.id, category: 'fire', name: '某某大队', phone: 'abc' }).expect(400);
    await ops.post('/api/operator/knowledge/regions').send({ province: '广东省', city: '惠州市', name: '仲恺高新区', aliases: ['仲恺'] }).expect(409);
    const added = await ops.post('/api/operator/knowledge/regions').send({ province: '广东省', city: '珠海市', name: '香洲区', aliases: ['香洲'] }).expect(200);
    const hc = (added.body as KnowledgeAgenciesView).regions.find((r) => r.name === '香洲区')!;
    await ops
      .post('/api/operator/knowledge/agencies')
      .send({ regionId: hc.id, category: 'street', name: '拱北街道应急管理办公室', area: '拱北街道', phone: '0756-1111111' })
      .expect(200);
    const address = { province: '广东省', city: '惠州市', district: '', detail: '香洲区拱北街道某某路 1 号' };
    expect(localAgenciesOf(address, await service.agencyDistricts())).toEqual({
      districtPlan: undefined,
      streetOffice: { name: '拱北街道应急管理办公室', phone: '0756-1111111' },
      streetPlan: undefined,
    });

    expect(await logs('knowledge_agency_change')).toEqual([
      `修改机构：仲恺高新区 · ${bureau.name}`,
      `停用机构：仲恺高新区 · ${bureau.name}`,
      `恢复机构：仲恺高新区 · ${bureau.name}`,
      `修改机构：仲恺高新区 · ${bureau.name}`,
      '新增区县：广东省珠海市香洲区',
      '新增机构：香洲区 · 拱北街道应急管理办公室（街道 / 园区）',
    ]);
  });
});

describe('知识库 · 节假日', () => {
  it('补一天调休：工作日计算马上按新的表；删掉后恢复', async () => {
    const ops = await as('ops@test.cn');
    // 2026-12-31 周四 → 往后 1 个工作日：2027-01-01 周五（表里还没有 2027 年）
    const from = new Date('2026-12-31T02:00:00Z');
    expect(addWorkingDays(from, 1).toISOString()).toBe('2027-01-01T02:00:00.000Z');
    await ops.post('/api/operator/knowledge/holidays').send({ date: '2027-01-01', kind: 'holiday', name: '元旦' }).expect(200);
    expect(addWorkingDays(from, 1).toISOString()).toBe('2027-01-04T02:00:00.000Z');
    // 2027-01-02 周六改成调休上班
    await ops.post('/api/operator/knowledge/holidays').send({ date: '2027-01-02', kind: 'workday', name: '元旦调休' }).expect(200);
    expect(addWorkingDays(from, 1).toISOString()).toBe('2027-01-02T02:00:00.000Z');
    await ops.post('/api/operator/knowledge/holidays').send({ date: '2027-13-01', kind: 'holiday', name: 'x' }).expect(400);
    await ops.delete('/api/operator/knowledge/holidays/2027-01-02').expect(200);
    const res = await ops.delete('/api/operator/knowledge/holidays/2027-01-01').expect(200);
    expect(res.body.holidays).toHaveLength(BUILTIN_HOLIDAYS.length);
    expect(addWorkingDays(from, 1).toISOString()).toBe('2027-01-01T02:00:00.000Z');
    await ops.delete('/api/operator/knowledge/holidays/2027-01-01').expect(404);
    expect(await logs('knowledge_holiday_change')).toEqual([
      '设置 2027-01-01：元旦（放假）',
      '设置 2027-01-02：元旦调休（调休上班）',
      '删除 2027-01-02：元旦调休',
      '删除 2027-01-01：元旦',
    ]);
  });
});

describe('知识库 · 节假日读不到或为空', () => {
  // 2026-10-01 国庆放假（内置表里有），往后 1 个工作日：按内置表是 10-08，只跳过周末是 10-02
  const from = new Date('2026-09-30T02:00:00Z');
  const next = () => addWorkingDays(from, 1).toISOString().slice(0, 10);
  const broken = { select: () => { throw new Error('数据库连不上'); } } as never;

  it('启动时第一次就读不到：先用内置表；之后刷新失败保留上次读到的', async () => {
    const fresh = new KnowledgeService(broken);
    await fresh.reloadHolidays();
    expect(next()).toBe('2026-10-08');

    const service = new KnowledgeService(handle.db);
    await handle.db.insert(holidays).values({ date: '2026-10-01', kind: 'workday', name: '测试' }).onConflictDoUpdate({ target: holidays.date, set: { kind: 'workday' } });
    await service.reloadHolidays();
    const withTestRow = next();
    expect(withTestRow).toBe('2026-10-01');
    Object.assign(service, { db: broken });
    await service.reloadHolidays();
    expect(next()).toBe(withTestRow);
    await handle.db.update(holidays).set({ kind: 'holiday', name: '国庆节' }).where(eq(holidays.date, '2026-10-01'));
    await app.get(KnowledgeService).reloadHolidays();
    expect(next()).toBe('2026-10-08');
  });

  it('读库成功但表是空的：按空表算，只跳过周末', async () => {
    const saved = await handle.db.select().from(holidays);
    await handle.db.delete(holidays);
    try {
      await app.get(KnowledgeService).reloadHolidays();
      expect(next()).toBe('2026-10-01');
    } finally {
      await handle.db.insert(holidays).values(saved);
      await app.get(KnowledgeService).reloadHolidays();
    }
    expect(next()).toBe('2026-10-08');
  });
});

describe('知识库 · 工艺模板', () => {
  it('新增草稿客户看不到；发布后版本加 1；停用后客户看不到，已选用的企业照常保存', async () => {
    const ops = await as('ops@test.cn');
    const list = (await ops.get('/api/operator/knowledge/templates').expect(200)).body as KnowledgeTemplatesView;
    expect(list.templates.map((t) => t.id)).toEqual(BUILTIN_PROCESS_TEMPLATES.map((t) => t.id));
    expect(list.templates.find((t) => t.id === 'metal_stamping')).toMatchObject({ state: 'published', version: 1, usedBy: 1, draft: null });

    const created = await ops.post('/api/operator/knowledge/templates').send({ label: 'PCB 线路板', industry: '电子' }).expect(200);
    const id = created.body.id as string;
    expect(created.body.templates.find((t: { id: string }) => t.id === id)).toMatchObject({ state: 'draft', version: 0, published: null });
    const customer = await as('admin@test.cn');
    const ids = async () => (await customer.get('/api/process-templates').expect(200)).body.templates.map((t: { id: string }) => t.id);
    expect(await ids()).not.toContain(id);
    await ops.post(`/api/operator/knowledge/templates/${id}/publish`).send({ label: 'PCB 线路板', steps: [] }).expect(400);

    const steps = [{ name: '开料', equipment: ['开料机'], materials: ['覆铜板'], risks: ['机械伤害'] }];
    await ops.put(`/api/operator/knowledge/templates/${id}/draft`).send({ label: 'PCB 线路板', industry: '电子', keywords: ['线路板'], steps }).expect(200);
    expect(await ids()).not.toContain(id);
    const published = await ops.post(`/api/operator/knowledge/templates/${id}/publish`).send({ label: 'PCB 线路板', industry: '电子', keywords: ['线路板'], steps }).expect(200);
    expect(published.body.templates.find((t: { id: string }) => t.id === id)).toMatchObject({ state: 'published', version: 1, draft: null });
    const forCustomer = (await customer.get('/api/process-templates').expect(200)).body.templates.find((t: { id: string }) => t.id === id);
    // 客户只看到工序和设备，常见物料、风险提示不给客户
    expect(forCustomer).toEqual({ id, label: 'PCB 线路板', keywords: ['线路板'], steps: [{ name: '开料', equipment: ['开料机'] }] });
    await ops.post(`/api/operator/knowledge/templates/${id}/publish`).send({ label: 'PCB 线路板', keywords: ['线路板'], steps }).expect(200);
    expect(((await ops.get('/api/operator/knowledge/templates')).body as KnowledgeTemplatesView).templates.find((t) => t.id === id)!.version).toBe(2);

    await ops.post('/api/operator/knowledge/templates/metal_stamping/disable').expect(200);
    expect(await ids()).not.toContain('metal_stamping');

    // 客户保存工艺流程：已选用、后来停用的照常保存；新换的模板必须已发布、没停用
    const [ent] = await handle.db.select({ id: enterprises.id }).from(enterprises);
    const url = `/api/enterprises/${ent!.id}/production-step`;
    const save = async (templateId: string) => {
      const s = (await customer.get(url).expect(200)).body;
      return customer.put(url).send({ version: s.version, step: { ...s.step, process: { ...s.step.process, templateId } } });
    };
    expect((await save('metal_stamping')).status).toBe(200);
    const draftId = (await ops.post('/api/operator/knowledge/templates').send({ label: '草稿模板' }).expect(200)).body.id as string;
    expect((await save(draftId)).status).toBe(400);
    expect((await save(id)).status).toBe(200);
    expect((await save('metal_stamping')).status).toBe(400);
    expect((await save('no_such_template')).status).toBe(400);
    await ops.post('/api/operator/knowledge/templates/metal_stamping/enable').expect(200);
    expect((await save('metal_stamping')).status).toBe(200);
    await ops.post('/api/operator/knowledge/templates/nope/disable').expect(404);
    expect(await logs('knowledge_template_change')).toEqual([
      '新增工艺模板（草稿）：PCB 线路板',
      '保存工艺模板草稿：PCB 线路板',
      '发布工艺模板：PCB 线路板（第 1 版）',
      '发布工艺模板：PCB 线路板（第 2 版）',
      '停用工艺模板：五金冲压',
      '新增工艺模板（草稿）：草稿模板',
      '恢复工艺模板：五金冲压',
    ]);
  });
});
