// 资料核对向导第 3、4 步（K11）：整步保存、只有专家填的部分、代客户上传和专家上传的图、处理记录、图纸候选
import { effectiveSnapshot, productionStepView, resourcesStepView, type HistoryEntry, type WorkupData } from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { enterprises, files, memberships, organizations, taskIntakeFiles, tasks, taskWorkups, users } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import { LANDSCAPE, PORTRAIT, testPdf } from '../generation/drawings/test-pdf.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const uid: Record<string, string> = {};
let taskId = '';
let otherOrgFile = '';
let PNG: Buffer;
const stored = new Map<string, Buffer>();
const storage: FileStorage = {
  async put(key, data) {
    stored.set(key, data);
  },
  async read(key) {
    const data = stored.get(key);
    if (!data) throw new Error(`no ${key}`);
    return data;
  },
  async downloadUrl(key) {
    return `/blob/${key}`;
  },
};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  PNG = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal, other] = await db
    .insert(organizations)
    .values([
      { name: '飞宇演示客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
      { name: '别的客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
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
  const [ent] = await db
    .insert(enterprises)
    .values({ orgId: customer!.id, name: '飞宇电器', profile: feiyuProfile, createdBy: customerId })
    .returning();
  const [task] = await db
    .insert(tasks)
    .values({
      orgId: customer!.id,
      enterpriseId: ent!.id,
      businessType: 'emergency_plan',
      name: '2026 年应急预案',
      number: 'GY-2026-201',
      createdBy: customerId,
      status: 'submitted',
      assignedExpertId: uid['zhou@test.cn']!,
    })
    .returning();
  taskId = task!.id;
  const [f] = await db
    .insert(files)
    .values({
      orgId: other!.id,
      kind: 'customer_material',
      originalName: '别家的图.png',
      contentType: 'image/png',
      sizeBytes: 1,
      sha256: 'x',
      storageKey: 'other/x',
      uploadedBy: customerId,
    })
    .returning();
  otherOrgFile = f!.id;

  app = await createApp(db, { loginLimitPerMinute: 1000, storage });
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

const current = async () => (await (await as('zhou@test.cn')).get(`/api/tasks/${taskId}/workup`).expect(200)).body;

describe('第 3 步整步保存', () => {
  it('写进专家那份，步数只增不减；运营 403；版本过期 409', async () => {
    const zhou = await as('zhou@test.cn');
    const body = await current();
    const url = `/api/tasks/${taskId}/workup/steps/production`;
    const step = { ...structuredClone(feiyuProfile.productionStep!.step), sites: ['workshop', 'warehouse'] };
    await (await as('ops@test.cn')).put(url).send({ version: body.version, step }).expect(403);
    await zhou.put(url).send({ version: body.version + 5, step }).expect(409);
    const res = await zhou.put(url).send({ version: body.version, step, stepsDone: 3 }).expect(200);
    expect(res.body.data.profile.productionStep.step.sites).toEqual(['workshop', 'warehouse']);
    expect(res.body.data.stepsDone).toBe(3);
    expect(res.body.data.steps.production.byName).toBe('周工');
    // 客户原表不动
    expect(res.body.snapshot.profile.productionStep.step.sites).toEqual(feiyuProfile.productionStep!.step.sites);
  });
});

describe('第 4 步整步保存', () => {
  it('资料写进专家那份，派出所、值守时间、四邻写进 resourcesExtra', async () => {
    const zhou = await as('zhou@test.cn');
    const body = await current();
    const step = { ...resourcesStepView(body.snapshot, body.data), hospital: { name: '仲恺医院', phone: '0752-1234567' } };
    const extra = {
      police: { name: '陈江派出所', phone: '0752-3333333' },
      brigade: { none: true },
      hours: { fireDept: '8 小时' },
      quarters: { east: '空地', north: '和畅五路' },
    };
    const res = await zhou.put(`/api/tasks/${taskId}/workup/steps/resources`).send({ version: body.version, step, extra, stepsDone: 4 }).expect(200);
    expect(res.body.data.profile.resourcesStep.step.hospital).toEqual({ name: '仲恺医院', phone: '0752-1234567' });
    expect(res.body.data.resourcesExtra).toMatchObject({ police: { name: '陈江派出所' }, brigade: { none: true }, hours: { fireDept: '8 小时' }, quarters: { east: '空地' } });
    expect(res.body.data.resourcesExtra.drawings).toEqual({ surroundings_map: [], hospital_route: [], traffic_map: [] });
    expect(res.body.data.stepsDone).toBe(4);
    expect(effectiveSnapshot(res.body.snapshot, res.body.data).profile.resourcesStep?.step.hospital?.name).toBe('仲恺医院');
  });

  it('派出所电话位数不对 400；别家组织的文件 400', async () => {
    const zhou = await as('zhou@test.cn');
    const body = await current();
    const url = `/api/tasks/${taskId}/workup/steps/resources`;
    const step = resourcesStepView(body.snapshot, body.data);
    const bad = await zhou.put(url).send({ version: body.version, step, extra: { police: { phone: '12345678' } } }).expect(400);
    expect(bad.body.message).toBe('号码位数不对');
    // 就近医院的电话也一样
    const badHospital = { ...step, hospital: { name: '仲恺医院', phone: '12345678' } };
    expect((await zhou.put(url).send({ version: body.version, step: badHospital, extra: {} }).expect(400)).body.message).toBe('号码位数不对');
    const foreign = { ...step, drawings: { ...step.drawings, site_plan: [otherOrgFile] } };
    expect((await zhou.put(url).send({ version: body.version, step: foreign, extra: {} }).expect(400)).body.message).toBe('有文件不在这个任务里');
    const foreignExtra = { drawings: { traffic_map: [otherOrgFile] } };
    await zhou.put(url).send({ version: body.version, step, extra: foreignExtra }).expect(400);
  });
});

describe('代客户上传和专家上传的图', () => {
  it('疏散图代客户上传：写进第 4 步、算进图纸，处理记录记一条；替换时去掉旧的', async () => {
    const zhou = await as('zhou@test.cn');
    let body = await current();
    const up = (target: string, name: string, replace?: string) =>
      zhou
        .post(`/api/tasks/${taskId}/workup/files`)
        .query({ target, version: body.version, ...(replace ? { replace } : {}) })
        .attach('file', PNG, name);
    body = (await up('drawing:evacuation_plan', '疏散图.png').expect(201)).body;
    const [first] = resourcesStepView(body.snapshot, body.data).drawings.evacuation_plan;
    expect(first).toBeTruthy();
    expect(body.drawings).toEqual([expect.objectContaining({ fileId: first, key: 'evacuation_plan', name: '疏散图.png', contentType: 'image/png' })]);
    // 文件记在客户组织名下，上传人是专家
    const [row] = await handle.db.select().from(files).where(eq(files.id, first!));
    expect(row).toMatchObject({ uploadedBy: uid['zhou@test.cn'], kind: 'customer_material' });

    body = (await up('drawing:evacuation_plan', '疏散图2.png', first).expect(201)).body;
    const ids = resourcesStepView(body.snapshot, body.data).drawings.evacuation_plan;
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(first);

    body = (await up('drawing:hospital_route', '路线.png').expect(201)).body;
    expect(body.data.resourcesExtra.drawings.hospital_route).toHaveLength(1);
    expect(body.drawings.map((d: { key: string }) => d.key)).toEqual(['evacuation_plan', 'hospital_route']);

    const history: HistoryEntry[] = (await zhou.get(`/api/tasks/${taskId}/history`).expect(200)).body;
    const texts = history.map((h) => h.what);
    expect(texts).toContain('代客户上传了紧急疏散示意图');
    expect(texts).toContain('上传了到就近医院路线图');
  });

  it('上传位置不对、类型不对、版本过期都拒绝；运营不能传', async () => {
    const zhou = await as('zhou@test.cn');
    const body = await current();
    const url = `/api/tasks/${taskId}/workup/files`;
    await zhou.post(url).query({ target: 'drawing:other', version: body.version }).attach('file', PNG, 'a.png').expect(400);
    await zhou.post(url).query({ target: 'msds:nope', version: body.version }).attach('file', Buffer.from('%PDF-1.7\n'), 'a.pdf').expect(400);
    await zhou.post(url).query({ target: 'firstAid', version: body.version }).attach('file', Buffer.from('hello'), 'a.txt').expect(400);
    await zhou.post(url).query({ target: 'firstAid', version: body.version + 5 }).attach('file', PNG, 'a.png').expect(409);
    await (await as('ops@test.cn')).post(url).query({ target: 'firstAid', version: body.version }).attach('file', PNG, 'a.png').expect(403);
    // 都没写进去
    const [row] = await handle.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
    expect(row!.version).toBe(body.version);
  });
});

describe('图纸候选认得资料表格流程上传页的文件', () => {
  it('总平面图、疏散图两个上传位算进图纸；客户删掉的不算', async () => {
    const zhou = await as('zhou@test.cn');
    const [task] = await handle.db.select().from(tasks).where(eq(tasks.id, taskId));
    const mk = async (name: string) =>
      (
        await handle.db
          .insert(files)
          .values({
            orgId: task!.orgId,
            kind: 'customer_material',
            originalName: name,
            contentType: 'image/png',
            sizeBytes: 1,
            sha256: name,
            storageKey: `k/${name}`,
            uploadedBy: uid['feiyu@test.cn']!,
          })
          .returning()
      )[0]!.id;
    const site = await mk('总平面图.png');
    const gone = await mk('旧疏散图.png');
    await handle.db.insert(taskIntakeFiles).values([
      { taskId, slot: 'site_plan', fileId: site, uploadedBy: uid['feiyu@test.cn']! },
      { taskId, slot: 'evacuation_map', fileId: gone, uploadedBy: uid['feiyu@test.cn']!, removedAt: new Date() },
    ]);
    const body = (await zhou.get(`/api/tasks/${taskId}/workup`).expect(200)).body;
    const drawings: { fileId: string; key: string; name: string }[] = body.drawings;
    expect(drawings).toContainEqual(expect.objectContaining({ fileId: site, key: 'site_plan', name: '总平面图.png' }));
    expect(drawings.some((d) => d.fileId === gone)).toBe(false);
  });
});

describe('属地机构的改写', () => {
  it('电话位数不对 400；对的存进去；只写名称也行', async () => {
    const zhou = await as('zhou@test.cn');
    const body = await current();
    const url = `/api/tasks/${taskId}/workup/facts`;
    const bad = await zhou.put(url).send({ version: body.version, key: 'agency.fireDept', value: '惠城区消防救援大队 · 12345678' }).expect(400);
    expect(bad.body.message).toBe('号码位数不对');
    let res = await zhou.put(url).send({ version: body.version, key: 'agency.fireDept', value: '惠城区消防救援大队 · 0752-2222222' }).expect(200);
    expect(res.body.data.overrides['agency.fireDept'].value).toBe('惠城区消防救援大队 · 0752-2222222');
    res = await zhou.put(url).send({ version: res.body.version, key: 'agency.streetOffice', value: '陈江街道办事处' }).expect(200);
    expect(res.body.data.overrides['agency.streetOffice'].value).toBe('陈江街道办事处');
  });
});

describe('专家代传、上传的文件', () => {
  it('负责专家能下载；别的专家 404；改派以后新专家能下载、原专家 404', async () => {
    const zhou = await as('zhou@test.cn');
    const wu = await as('wu@test.cn');
    const body = await current();
    const up = (
      await zhou.post(`/api/tasks/${taskId}/workup/files`).query({ target: 'firstAid', version: body.version }).attach('file', PNG, '药箱.png').expect(201)
    ).body;
    const fileId: string = up.data.expertUploads.at(-1).fileId;
    await zhou.get(`/api/files/${fileId}/download-url`).expect(200);
    await zhou.get(`/api/files/${fileId}`).expect(200);
    await wu.get(`/api/files/${fileId}/download-url`).expect(404);
    await handle.db.update(tasks).set({ assignedExpertId: uid['wu@test.cn']! }).where(eq(tasks.id, taskId));
    try {
      await wu.get(`/api/files/${fileId}/download-url`).expect(200);
      await zhou.get(`/api/files/${fileId}/download-url`).expect(404);
    } finally {
      await handle.db.update(tasks).set({ assignedExpertId: uid['zhou@test.cn']! }).where(eq(tasks.id, taskId));
    }
  });

  it('只记在第 4 步里（处理记录里的那条已经被挤掉）也认得', async () => {
    const zhou = await as('zhou@test.cn');
    const body = await current();
    const up = (
      await zhou.post(`/api/tasks/${taskId}/workup/files`).query({ target: 'drawing:traffic_map', version: body.version }).attach('file', PNG, '交通.png').expect(201)
    ).body;
    const fileId: string = up.data.resourcesExtra.drawings.traffic_map.at(-1);
    const [row] = await handle.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
    const data = row!.data as WorkupData;
    await handle.db
      .update(taskWorkups)
      .set({ data: { ...data, expertUploads: (data.expertUploads ?? []).filter((u) => u.fileId !== fileId) } })
      .where(eq(taskWorkups.taskId, taskId));
    await zhou.get(`/api/files/${fileId}/download-url`).expect(200);
    await (await as('wu@test.cn')).get(`/api/files/${fileId}/download-url`).expect(404);
  });
});

describe('专家传的图是多页 PDF', () => {
  it('周边环境图选页存得住', async () => {
    const zhou = await as('zhou@test.cn');
    let body = await current();
    body = (
      await zhou
        .post(`/api/tasks/${taskId}/workup/files`)
        .query({ target: 'drawing:surroundings_map', version: body.version })
        .attach('file', testPdf([LANDSCAPE, PORTRAIT, LANDSCAPE]), '周边环境.pdf')
        .expect(201)
    ).body;
    const fileId: string = body.data.resourcesExtra.drawings.surroundings_map.at(-1);
    const res = await zhou.put(`/api/tasks/${taskId}/workup/figures`).send({ version: body.version, drawings: { [fileId]: [2] } }).expect(200);
    expect(res.body.data.figures.drawings[fileId]).toEqual([2]);
  });
});

describe('第 3 步旧层并进新块', () => {
  it('改过的物料、x 开头的新增行各留一份，旧层清空，视图不变', async () => {
    const zhou = await as('zhou@test.cn');
    const [row] = await handle.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
    const data = row!.data as WorkupData;
    const stamp = { by: uid['zhou@test.cn']!, byName: '周工', at: '2026-11-01T08:00:00.000Z' };
    const firstId = feiyuProfile.productionStep!.step.materials[0]!.id;
    const { profile: _p, ...rest } = data;
    const legacy: WorkupData = {
      ...rest,
      profile: { ...data.profile, productionStep: undefined },
      production: {
        equipment: {},
        materials: {
          [firstId]: { ...stamp, value: { kind: 'material', name: '水性油漆', annualUsage: '3 t', maxStorage: '0.5 t' } },
          x1: { ...stamp, value: { kind: 'material', name: '稀释剂', annualUsage: '1 t', maxStorage: '50 kg' } },
        },
        hazardous: {},
        special: {},
        fireRatings: {},
      },
    } as WorkupData;
    await handle.db.update(taskWorkups).set({ data: legacy }).where(eq(taskWorkups.taskId, taskId));
    const body = await current();
    const before = productionStepView(body.snapshot, body.data);
    expect(before.materials.filter((m) => m.name === '稀释剂')).toHaveLength(1);
    const res = await zhou.put(`/api/tasks/${taskId}/workup/steps/production`).send({ version: body.version, step: before }).expect(200);
    const saved = res.body.data as WorkupData;
    expect(saved.production?.materials).toEqual({});
    const mats = saved.profile!.productionStep!.step.materials;
    expect(mats.filter((m) => m.name === '稀释剂')).toHaveLength(1);
    expect(mats.filter((m) => m.name === '水性油漆')).toHaveLength(1);
    expect(mats.find((m) => m.id === firstId)?.name).toBe('水性油漆');
    expect(productionStepView(res.body.snapshot, saved)).toEqual(before);
  });
});
