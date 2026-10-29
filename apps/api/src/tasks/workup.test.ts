import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { checklistItemFiles, enterprises, files, memberships, organizations, tasks, taskWorkups, users } from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
let feiyuTask = '';
let feiyuEnterprise = '';
let otherTask = '';
let preparingTask = '';
let rosterFile = '';

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
      { orgId: customer!.id, name: '惠阳飞宇电器有限公司', socialCreditCode: '91441300726483224B', legalRepresentative: '李文聪', registeredAddress: '惠州市仲恺高新区陈江街道正大路 17 号', profile: feiyuProfile, createdBy: customerId },
      { orgId: customer!.id, name: '示例五金制品有限公司', createdBy: customerId },
      { orgId: customer!.id, name: '示例精工有限公司', createdBy: customerId },
    ])
    .returning();
  feiyuEnterprise = ents[0]!.id;
  const base = { orgId: customer!.id, businessType: 'emergency_plan' as const, name: '2026 年应急预案', createdBy: customerId };
  const created = await db
    .insert(tasks)
    .values([
      { ...base, enterpriseId: ents[0]!.id, number: 'GY-2026-001', status: 'submitted' as const, assignedExpertId: uid['zhou@test.cn']! },
      { ...base, enterpriseId: ents[1]!.id, number: 'GY-2026-002', status: 'submitted' as const, assignedExpertId: uid['wu@test.cn']! },
      { ...base, enterpriseId: ents[2]!.id, number: 'GY-2026-003', assignedExpertId: uid['zhou@test.cn']! },
    ])
    .returning();
  [feiyuTask, otherTask, preparingTask] = created.map((t) => t.id) as [string, string, string];

  const [roster] = await db
    .insert(files)
    .values({
      orgId: customer!.id,
      kind: 'customer_material',
      originalName: '应急人员名册.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'x',
      storageKey: `${customer!.id}/${crypto.randomUUID()}`,
      uploadedBy: customerId,
    })
    .returning();
  rosterFile = roster!.id;
  await db.insert(checklistItemFiles).values({ taskId: feiyuTask, itemKey: 'emergency_groups', fileId: rosterFile, linkedBy: customerId });

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

describe('专业整理', () => {
  it('第一次打开时复制企业资料；原件列出任务里的文件', async () => {
    const res = await (await as('zhou@test.cn')).get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    expect(res.body.version).toBe(1);
    expect(res.body.snapshot.identity.name).toBe('惠阳飞宇电器有限公司');
    expect(res.body.snapshot.profile.basicStep.basic.employeeCount).toBe(86);
    expect(res.body.originals).toEqual([
      expect.objectContaining({ fileId: rosterFile, name: '应急人员名册.pdf', itemKeys: ['emergency_groups'], version: null }),
    ]);
  });

  it('专家改的内容退出再进还在；客户之后改企业资料不影响这份整理', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    const saved = await zhou
      .put(`/api/tasks/${feiyuTask}/workup/facts`)
      .send({ version: body.version, key: 'technicalManagementCount', value: 6, fileId: rosterFile })
      .expect(200);
    expect(saved.body.version).toBe(body.version + 1);
    expect(saved.body.data.overrides.technicalManagementCount).toMatchObject({ value: 6, source: 'expert', byName: '周工', fileId: rosterFile });

    await handle.db.update(enterprises).set({ name: '客户后来改的名字' }).where(eq(enterprises.id, feiyuEnterprise));
    const again = await (await as('zhou@test.cn')).get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    expect(again.body.data.overrides.technicalManagementCount.value).toBe(6);
    expect(again.body.snapshot.identity.name).toBe('惠阳飞宇电器有限公司');
    expect(again.body.updatedByName).toBe('周工');
  });

  it('标为客户确认；传 null 撤回专家的修改', async () => {
    const zhou = await as('zhou@test.cn');
    let { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`);
    ({ body } = await zhou
      .put(`/api/tasks/${feiyuTask}/workup/facts`)
      .send({ version: body.version, key: 'dutyPhone', value: '0752-1234567', source: 'customer' })
      .expect(200));
    expect(body.data.overrides.dutyPhone.source).toBe('customer');
    ({ body } = await zhou.put(`/api/tasks/${feiyuTask}/workup/facts`).send({ version: body.version, key: 'dutyPhone', value: null }).expect(200));
    expect(body.data.overrides.dutyPhone).toBeUndefined();
  });

  it('版本过期时拒绝，不覆盖别人的修改', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`);
    await zhou.put(`/api/tasks/${feiyuTask}/workup/facts`).send({ version: body.version, key: 'shortName', value: 'FY' }).expect(200);
    const stale = await zhou
      .put(`/api/tasks/${feiyuTask}/workup/facts`)
      .send({ version: body.version, key: 'shortName', value: 'FEIYU' })
      .expect(409);
    expect(stale.body).toMatchObject({ reason: 'stale', version: body.version + 1 });
  });

  it('不存在的项、系统生成的项、类型不对、不在任务里的原件都拒绝', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`);
    const put = (payload: object) => zhou.put(`/api/tasks/${feiyuTask}/workup/facts`).send({ version: body.version, ...payload });
    expect((await put({ key: 'nope', value: 'x' }).expect(400)).body.message).toBe('没有这一项');
    expect((await put({ key: 'compilation.leader', value: 'x' }).expect(400)).body.message).toContain('由系统按规则生成');
    expect((await put({ key: 'commander', value: '李文聪' }).expect(400)).body.message).toBe('请填写姓名、职位和电话');
    expect((await put({ key: 'superior', value: 'x', fileId: crypto.randomUUID() }).expect(400)).body.message).toBe('对照的原件不在这个任务里');
  });

  it('其他专家、客户看不到；运营能看不能改', async () => {
    await (await as('wu@test.cn')).get(`/api/tasks/${feiyuTask}/workup`).expect(404);
    await (await as('feiyu@test.cn')).get(`/api/tasks/${feiyuTask}/workup`).expect(404);
    await (await as('zhou@test.cn')).get(`/api/tasks/${otherTask}/workup`).expect(404);
    const ops = await as('ops@test.cn');
    const { body } = await ops.get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    await ops.put(`/api/tasks/${feiyuTask}/workup/facts`).send({ version: body.version, key: 'shortName', value: 'X' }).expect(403);
  });

  it('客户还没提交的任务不能开始整理', async () => {
    const res = await (await as('zhou@test.cn')).get(`/api/tasks/${preparingTask}/workup`).expect(400);
    expect(res.body.message).toContain('还没有提交');
  });

  it('对照原件的链接在页面里显示 PDF', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/files/${rosterFile}/download-url?inline=1`).expect(200);
    expect(body.url).toContain('d=inline');
    const plain = await zhou.get(`/api/files/${rosterFile}/download-url`).expect(200);
    expect(plain.body.url).not.toContain('d=inline');
  });
});

describe('生产设备与物料', () => {
  it('危化品、特种设备、耐火等级逐条判定；企业事实与判断互不覆盖', async () => {
    const zhou = await as('zhou@test.cn');
    let { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    const put = async (payload: object) => {
      ({ body } = await zhou.put(`/api/tasks/${feiyuTask}/workup/production`).send({ version: body.version, ...payload }).expect(200));
    };
    await put({ kind: 'hazardous', rowId: 'm5', value: true, fileId: rosterFile });
    await put({ kind: 'special', category: 'pressurePipelines', value: { answer: 'no' } });
    await put({ kind: 'fireRating', rowId: 'b1', value: '2' });
    expect(body.data.production.hazardous.m5).toMatchObject({ value: true, byName: '周工', fileId: rosterFile });
    expect(body.data.production.special.pressurePipelines.value).toEqual({ answer: 'no', items: [] });
    expect(body.data.production.fireRatings.b1.value).toBe('2');

    // 之前存的企业事实还在；再改企业事实，判断也还在
    expect(body.data.overrides.technicalManagementCount.value).toBe(6);
    ({ body } = await zhou.put(`/api/tasks/${feiyuTask}/workup/facts`).send({ version: body.version, key: 'hospital', value: '仲恺人民医院' }).expect(200));
    expect(body.data.production.fireRatings.b1.value).toBe('2');
  });

  it('改客户的行、新增行；撤回回到客户的值，删掉新增物料连同判断', async () => {
    const zhou = await as('zhou@test.cn');
    let { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    const put = async (payload: object) => {
      ({ body } = await zhou.put(`/api/tasks/${feiyuTask}/workup/production`).send({ version: body.version, ...payload }).expect(200));
    };
    await put({ kind: 'equipment', rowId: 'e8', value: { name: '空压机', quantity: '1 台', location: '空压机房' } });
    await put({ kind: 'equipment', rowId: 'x1', value: { name: '电动叉车', quantity: '1 台' } });
    await put({ kind: 'material', rowId: 'x2', value: { kind: 'cylinder', name: '乙炔', cylinderSpec: '40L', maxStorage: '4 瓶' } });
    await put({ kind: 'hazardous', rowId: 'x2', value: true });
    expect(Object.keys(body.data.production.equipment).sort()).toEqual(['e8', 'x1']);

    await put({ kind: 'equipment', rowId: 'e8', value: null });
    await put({ kind: 'material', rowId: 'x2', value: null });
    expect(body.data.production.equipment.e8).toBeUndefined();
    expect(body.data.production.materials.x2).toBeUndefined();
    expect(body.data.production.hazardous.x2).toBeUndefined();
  });

  it('不存在的行、格式不对的参数、过期版本都拒绝；运营不能改', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`);
    const put = (payload: object) => zhou.put(`/api/tasks/${feiyuTask}/workup/production`).send({ version: body.version, ...payload });
    expect((await put({ kind: 'hazardous', rowId: 'm99', value: true }).expect(400)).body.message).toBe('没有这一行物料');
    expect((await put({ kind: 'equipment', rowId: 'e99', value: { name: '冲床' } }).expect(400)).body.message).toBe('没有这一行设备');
    await put({ kind: 'special', category: 'pressureVessels', value: { answer: 'yes', items: [{ volumeM3: '很大' }] } }).expect(400);
    await put({ kind: 'fireRating', rowId: 'b1', value: '五' }).expect(400);
    await zhou.put(`/api/tasks/${feiyuTask}/workup/production`).send({ version: body.version - 1, kind: 'fireRating', rowId: 'b1', value: '3' }).expect(409);

    const ops = await as('ops@test.cn');
    await ops.put(`/api/tasks/${feiyuTask}/workup/production`).send({ version: body.version, kind: 'fireRating', rowId: 'b1', value: '3' }).expect(403);
  });
});

describe('危险源辨识', () => {
  const fire = { factor: '火灾', workplace: '1 号生产厂房', l: 1, e: 6, c: 7 };

  it('改候选的取值、新增一行；撤回回到系统推荐；其他整理内容不受影响', async () => {
    const zhou = await as('zhou@test.cn');
    let { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    const put = async (payload: object) => {
      ({ body } = await zhou.put(`/api/tasks/${feiyuTask}/workup/risks`).send({ version: body.version, ...payload }).expect(200));
    };
    await put({ rowId: 'SP01', value: { ...fire, c: 40, note: '仓库紧邻车间' } });
    await put({ rowId: 'xr1', value: { factor: '其他爆炸', workplace: '气瓶间', l: 1, e: 3, c: 40 } });
    expect(body.data.risks.rows.SP01).toMatchObject({ value: { c: 40, note: '仓库紧邻车间' }, byName: '周工' });
    expect(Object.keys(body.data.risks.rows).sort()).toEqual(['SP01', 'xr1']);
    expect(body.data.production.fireRatings.b1.value).toBe('2');

    await put({ rowId: 'SP01', value: null });
    await put({ rowId: 'xr1', value: null });
    expect(body.data.risks.rows).toEqual({});
    // 再存企业事实，危险源的修改不会被覆盖
    await put({ rowId: 'SP02', value: { factor: '触电', workplace: '配电房', l: 1, e: 6, c: 7, excluded: true } });
    ({ body } = await zhou.put(`/api/tasks/${feiyuTask}/workup/facts`).send({ version: body.version, key: 'hospital', value: '仲恺人民医院' }).expect(200));
    expect(body.data.risks.rows.SP02.value.excluded).toBe(true);
  });

  it('取值不在取值表、不存在的候选、过期版本都拒绝；运营不能改', async () => {
    const zhou = await as('zhou@test.cn');
    const { body } = await zhou.get(`/api/tasks/${feiyuTask}/workup`);
    const put = (payload: object) => zhou.put(`/api/tasks/${feiyuTask}/workup/risks`).send({ version: body.version, ...payload });
    expect((await put({ rowId: 'SP01', value: { ...fire, c: 20 } }).expect(400)).body.message).toBe('C 请从取值表里选');
    expect((await put({ rowId: 'SP08', value: fire }).expect(400)).body.message).toBe('没有这一项危险源');
    await zhou.put(`/api/tasks/${feiyuTask}/workup/risks`).send({ version: body.version - 1, rowId: 'SP01', value: fire }).expect(409);

    const ops = await as('ops@test.cn');
    await ops.put(`/api/tasks/${feiyuTask}/workup/risks`).send({ version: body.version, rowId: 'SP01', value: fire }).expect(403);
  });
});
describe('原件对照里的自填照片', () => {
  it('客户拍给耕云看的压力管道照片出现在右栏', async () => {
    const { db } = handle;
    const [task] = await db.select({ orgId: tasks.orgId }).from(tasks).where(eq(tasks.id, feiyuTask));
    const [photo] = await db
      .insert(files)
      .values({
        orgId: task!.orgId,
        kind: 'customer_material',
        originalName: '压缩空气管道.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 100,
        sha256: 'y',
        storageKey: `${task!.orgId}/${crypto.randomUUID()}`,
        uploadedBy: uid['feiyu@test.cn']!,
      })
      .returning();
    const [row] = await db.select().from(taskWorkups).where(eq(taskWorkups.taskId, feiyuTask));
    const snapshot = structuredClone(row!.snapshot);
    snapshot.profile.productionStep!.step.specialEquipment.pressurePipelines.photoFileIds = [photo!.id];
    await db.update(taskWorkups).set({ snapshot }).where(eq(taskWorkups.taskId, feiyuTask));

    const { body } = await (await as('zhou@test.cn')).get(`/api/tasks/${feiyuTask}/workup`).expect(200);
    expect(body.originals).toContainEqual(
      expect.objectContaining({ fileId: photo!.id, name: '压缩空气管道.jpg', itemKeys: ['special_equipment'] }),
    );
  });
});