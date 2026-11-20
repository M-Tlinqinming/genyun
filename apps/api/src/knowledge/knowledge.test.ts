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
import { auditLogs, enterprises, holidays, memberships, organizations, processTemplates, users } from '../db/schema.ts';
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
  it('只有运营能看、能改：客户、专家 403，没登录 401；客户能读已发布的模板', async () => {
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
  // 运营维护工艺模板的页面和接口已取消；表里的数据照常给客户选用、给生成读
  it('客户只看到已发布、没停用的模板；已选用、后来停用的照常保存，新换的必须已发布、没停用', async () => {
    const customer = await as('admin@test.cn');
    const ids = async () => (await customer.get('/api/process-templates').expect(200)).body.templates.map((t: { id: string }) => t.id);
    await handle.db.insert(processTemplates).values({ id: 'pcb_draft', label: '草稿模板', version: 0 });
    expect(await ids()).not.toContain('pcb_draft');
    await handle.db.update(processTemplates).set({ disabledAt: new Date() }).where(eq(processTemplates.id, 'metal_stamping'));
    expect(await ids()).not.toContain('metal_stamping');

    const [ent] = await handle.db.select({ id: enterprises.id }).from(enterprises);
    const url = `/api/enterprises/${ent!.id}/production-step`;
    const save = async (templateId: string) => {
      const s = (await customer.get(url).expect(200)).body;
      return customer.put(url).send({ version: s.version, step: { ...s.step, process: { ...s.step.process, templateId } } });
    };
    expect((await save('metal_stamping')).status).toBe(200);
    expect((await save('pcb_draft')).status).toBe(400);
    const other = BUILTIN_PROCESS_TEMPLATES.find((t) => t.id !== 'metal_stamping')!.id;
    expect((await save(other)).status).toBe(200);
    expect((await save('metal_stamping')).status).toBe(400);
    expect((await save('no_such_template')).status).toBe(400);
    await handle.db.update(processTemplates).set({ disabledAt: null }).where(eq(processTemplates.id, 'metal_stamping'));
    expect((await save('metal_stamping')).status).toBe(200);
  });
});
