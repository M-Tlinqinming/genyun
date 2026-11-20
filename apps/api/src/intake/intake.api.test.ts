// 准备资料接口：模板下载、上传资料表格和图纸、删除、「这张图我们没有」、权限、上次提交的表、任务的 flow
import { ARCHIVE_MESSAGE, INTAKE_SHEET_XLS_MESSAGE, type IntakeView } from '@genyun/shared';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  enterpriseAssignments,
  enterprises,
  memberships,
  organizations,
  taskIntakeFiles,
  taskIntakes,
  taskIntakeSubmissions,
  tasks,
  users,
} from '../db/schema.ts';
import { LocalDiskStorage } from '../files/storage.ts';
import { HAS_EVACUATION_MAP_MESSAGE, SHEET_UNDELETABLE_MESSAGE, SUBMITTED_MESSAGE } from './intake.service.ts';
import { newMissing, newNormal, notTemplate, oldSample, otherEnterprise, renamed, SAMPLE_NAME } from './test-workbooks.ts';

const PASSWORD = 'correct horse battery staple';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n% 图纸\n');
const DWG = Buffer.from('AC1032\0\0\0\0\0\0');
const OTHER_NAME = '耕云测试另一家有限公司';

let handle: DatabaseHandle;
let app: INestApplication;
let storageDir: string;
let orgId = '';
const uid: Record<string, string> = {};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例制造', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  orgId = customer!.id;
  const [strangerOrg] = await db
    .insert(organizations)
    .values({ name: '别家组织', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' })
    .returning();
  for (const p of [
    { email: 'admin@test.cn', name: '林管理员', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'member@test.cn', name: '王成员', orgId: customer!.id, role: 'customer_member' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'stranger@test.cn', name: '别家管理员', orgId: '', role: 'customer_admin' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId || strangerOrg!.id, role: p.role });
    uid[p.email] = u!.id;
  }
  storageDir = mkdtempSync(join(tmpdir(), 'genyun-intake-'));
  app = await createApp(db, { loginLimitPerMinute: 1000, storage: new LocalDiskStorage(storageDir, 'test-secret') });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function as(email = 'admin@test.cn') {
  let agent = agents.get(email);
  if (!agent) {
    agent = request.agent(app.getHttpServer());
    expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    agents.set(email, agent);
  }
  return agent;
}

async function newTask(name = SAMPLE_NAME) {
  const agent = await as();
  const ent = await agent.post(`/api/orgs/${orgId}/enterprises`).send({ name });
  expect(ent.status).toBe(201);
  const task = await agent.post(`/api/enterprises/${ent.body.id}/tasks`).send({ name: '2026 年应急预案编制' });
  expect(task.status).toBe(201);
  return { taskId: task.body.id as string, enterpriseId: ent.body.id as string };
}

async function put(taskId: string, slot: string, buf: Buffer, name: string, email?: string) {
  return (await as(email)).post(`/api/tasks/${taskId}/intake/files?slot=${slot}`).attach('file', buf, name);
}
const ok = (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as IntakeView;
};

describe('资料模板', () => {
  it('登录用户能下载，附件名是中文', async () => {
    const res = await (await as('ops@test.cn')).get('/api/intake/template').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('企业资料填报模板（2026.11）.xlsx'));
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });
  it('没登录不能下', async () => {
    expect((await request(app.getHttpServer()).get('/api/intake/template')).status).toBe(401);
  });
});

describe('上传资料表格', () => {
  it('缺项表 → 列出缺的必填和两张图；再传正常表以最后一次为准', async () => {
    const { taskId } = await newTask();
    const empty = (await (await as()).get(`/api/tasks/${taskId}/intake`)).body as IntakeView;
    expect(empty.dataSheet).toBeNull();
    expect(empty.requiredCheck).toBeNull();
    expect(empty.canEdit).toBe(true);

    const v1 = ok(await put(taskId, 'data_sheet', await newMissing(), '资料表格.xlsx'));
    expect(v1.dataSheet?.status).toBe('read');
    expect(v1.dataSheet?.sheets).toHaveLength(6);
    const fields = v1.requiredCheck!.missing.map((m) => m.field);
    expect(fields.slice(-2)).toEqual(['drawing.site_plan', 'drawing.evacuation_plan']);
    expect(v1.requiredCheck!.missing.length).toBeGreaterThan(2);

    const v2 = ok(await put(taskId, 'data_sheet', await newNormal(), '资料表格（改好）.xlsx'));
    expect(v2.dataSheet?.file.originalName).toBe('资料表格（改好）.xlsx');
    expect(v2.requiredCheck!.missing.map((m) => m.field)).toEqual(['drawing.site_plan', 'drawing.evacuation_plan']);
    const rows = await handle.db.select().from(taskIntakeFiles).where(eq(taskIntakeFiles.taskId, taskId));
    expect(rows.filter((r) => r.slot === 'data_sheet' && r.removedAt === null)).toHaveLength(1);
    expect(rows.filter((r) => r.slot === 'data_sheet')).toHaveLength(2);
    const [intake] = await handle.db.select().from(taskIntakes).where(eq(taskIntakes.taskId, taskId));
    expect(intake!.lastUploadedSide).toBe('customer');
    expect(intake!.dataSheetFileId).toBe(v2.dataSheet!.file.fileId);
  });

  it('不是模板：存下文件，不读取，清掉上一份的读表结果', async () => {
    const { taskId } = await newTask('耕云测试不是模板公司');
    ok(await put(taskId, 'data_sheet', await renamed('耕云测试不是模板公司'), '资料表格.xlsx'));
    const v = ok(await put(taskId, 'data_sheet', await notTemplate(), '自己做的表.xlsx'));
    expect(v.dataSheet?.status).toBe('not_template');
    expect(v.dataSheet?.sheets).toEqual([]);
    expect(v.requiredCheck).toBeNull();
    expect(v.warnings).toEqual([{ kind: 'not_template' }]);
  });

  it('别家企业：不读取，给出跳转目标', async () => {
    const other = await newTask(OTHER_NAME);
    const { taskId } = await newTask('耕云测试本家有限公司');
    const v = ok(await put(taskId, 'data_sheet', await otherEnterprise(OTHER_NAME), '资料表格.xlsx'));
    expect(v.dataSheet?.status).toBe('other_enterprise');
    expect(v.otherEnterprise).toEqual({ enterpriseId: other.enterpriseId, enterpriseName: OTHER_NAME, visible: true, openTaskId: other.taskId });
    const [ent] = await handle.db.select().from(enterprises).where(eq(enterprises.id, other.enterpriseId));
    expect(ent!.name).toBe(OTHER_NAME);
  });

  it('企业名称不一样：按表格改名并提示', async () => {
    const { taskId, enterpriseId } = await newTask('耕云测试旧名称有限公司');
    const v = ok(await put(taskId, 'data_sheet', await renamed('耕云测试新名称有限公司'), '资料表格.xlsx'));
    expect(v.warnings).toContainEqual({ kind: 'enterprise_renamed', previousName: '耕云测试旧名称有限公司', newName: '耕云测试新名称有限公司' });
    const [ent] = await handle.db.select().from(enterprises).where(eq(enterprises.id, enterpriseId));
    expect(ent!.name).toBe('耕云测试新名称有限公司');
  });

  it('旧版模板：记 old_template，右栏标旧版', async () => {
    const { taskId } = await newTask('耕云测试旧版有限公司');
    const v = ok(await put(taskId, 'data_sheet', await oldSample('耕云测试旧版有限公司'), '旧表.xlsx'));
    expect(v.dataSheet?.oldTemplate).toBe(true);
    expect(v.warnings.map((w) => w.kind)).toContain('old_template');
    expect(v.requiredCheck!.missing[0]!.mismatch).toBe(true);
  });

  it('拒收：xls、压缩包、类型不对、打不开的', async () => {
    const { taskId } = await newTask('耕云测试拒收有限公司');
    const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from('W\0o\0r\0k\0b\0o\0o\0k\0')]);
    expect((await put(taskId, 'data_sheet', xls, '老表.xls')).body.message).toBe(INTAKE_SHEET_XLS_MESSAGE);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('photos/a.jpg')]);
    expect((await put(taskId, 'data_sheet', zip, '资料.zip')).body.message).toBe(ARCHIVE_MESSAGE);
    expect((await put(taskId, 'site_plan', Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0]), '图.rar')).body.message).toBe(ARCHIVE_MESSAGE);
    expect((await put(taskId, 'data_sheet', PDF, '表.pdf')).status).toBe(400);
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml xl/workbook.xml')]);
    const res = await put(taskId, 'data_sheet', broken, '坏表.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('这份表格打不开');
    const rows = await handle.db.select().from(taskIntakeFiles).where(eq(taskIntakeFiles.taskId, taskId));
    expect(rows).toHaveLength(0);
  });
});

describe('图纸', () => {
  it('总平面图只留一张；疏散图和「我们没有」互斥；删图后重算；资料表格不能删', async () => {
    const { taskId } = await newTask('耕云测试图纸有限公司');
    ok(await put(taskId, 'data_sheet', await renamed('耕云测试图纸有限公司'), '资料表格.xlsx'));
    ok(await put(taskId, 'site_plan', PDF, '总平面图.pdf'));
    const v1 = ok(await put(taskId, 'site_plan', DWG, '总平面图.dwg'));
    expect(v1.sitePlan?.originalName).toBe('总平面图.dwg');
    expect(v1.requiredCheck!.missing.map((m) => m.field)).toEqual(['drawing.evacuation_plan']);

    const agent = await as();
    const v2 = (await agent.put(`/api/tasks/${taskId}/intake/no-evacuation-map`).send({ value: true })).body as IntakeView;
    expect(v2.noEvacuationMap).toBe(true);
    expect(v2.requiredCheck!.missing).toEqual([]);

    const v3 = ok(await put(taskId, 'evacuation_map', PNG, '疏散图.png'));
    expect(v3.noEvacuationMap).toBe(false);
    expect(v3.requiredCheck!.missing).toEqual([]);
    ok(await put(taskId, 'evacuation_map', PNG, '疏散图 2.png'));
    const conflict = await agent.put(`/api/tasks/${taskId}/intake/no-evacuation-map`).send({ value: true });
    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toBe(HAS_EVACUATION_MAP_MESSAGE);

    const v4 = ok(await put(taskId, 'other', PNG, '营业执照.png'));
    expect(v4.others).toHaveLength(1);
    expect(v4.evacuationMaps).toHaveLength(2);

    let v = v4;
    for (const f of v4.evacuationMaps) {
      v = (await agent.delete(`/api/tasks/${taskId}/intake/files/${f.id}`)).body as IntakeView;
    }
    expect(v.evacuationMaps).toEqual([]);
    expect(v.requiredCheck!.missing.map((m) => m.field)).toEqual(['drawing.evacuation_plan']);

    const del = await agent.delete(`/api/tasks/${taskId}/intake/files/${v.dataSheet!.file.id}`);
    expect(del.status).toBe(400);
    expect(del.body.message).toBe(SHEET_UNDELETABLE_MESSAGE);
    expect((await agent.delete(`/api/tasks/${taskId}/intake/files/${v4.evacuationMaps[0]!.id}`)).status).toBe(404);
  });

  it('没读到表格时图纸照样能传，requiredCheck 仍为空', async () => {
    const { taskId } = await newTask('耕云测试先传图有限公司');
    const v = ok(await put(taskId, 'site_plan', PNG, '总平面图.png'));
    expect(v.sitePlan).not.toBeNull();
    expect(v.requiredCheck).toBeNull();
  });

  it('传上来的文件，客户能拿下载地址', async () => {
    const { taskId } = await newTask('耕云测试下载有限公司');
    const v = ok(await put(taskId, 'site_plan', PNG, '总平面图.png'));
    const res = await (await as()).get(`/api/files/${v.sitePlan!.fileId}/download-url`);
    expect(res.status).toBe(200);
  });
});

describe('权限', () => {
  it('看得到但不能改的 403；看不到的 404；删除了、旧流程的 404；已提交的 409', async () => {
    const { taskId, enterpriseId } = await newTask('耕云测试权限有限公司');
    const sheet = await renamed('耕云测试权限有限公司');

    // 运营能看不能改
    const opsView = await (await as('ops@test.cn')).get(`/api/tasks/${taskId}/intake`);
    expect(opsView.status).toBe(200);
    expect(opsView.body.canEdit).toBe(false);
    const opsPut = await put(taskId, 'data_sheet', sheet, '表.xlsx', 'ops@test.cn');
    expect(opsPut.status).toBe(403);
    expect(opsPut.body.message).toBe('资料由客户自己上传');

    // 没分配到这家企业的成员看不到
    expect((await (await as('member@test.cn')).get(`/api/tasks/${taskId}/intake`)).status).toBe(404);
    await handle.db.insert(enterpriseAssignments).values({ enterpriseId, userId: uid['member@test.cn']!, orgId });
    ok(await put(taskId, 'data_sheet', sheet, '表.xlsx', 'member@test.cn'));

    // 已提交
    await handle.db.update(tasks).set({ status: 'submitted' }).where(eq(tasks.id, taskId));
    const after = await put(taskId, 'site_plan', PNG, '图.png');
    expect(after.status).toBe(409);
    expect(after.body.message).toBe(SUBMITTED_MESSAGE);
    expect((await (await as()).get(`/api/tasks/${taskId}/intake`)).body.canEdit).toBe(false);

    // 删除了
    await handle.db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
    expect((await (await as()).get(`/api/tasks/${taskId}/intake`)).status).toBe(404);
  });

  it('旧流程任务：intake 接口 404，任务详情 flow 为 legacy', async () => {
    const { taskId } = await newTask('耕云测试旧流程有限公司');
    const agent = await as();
    expect((await agent.get(`/api/tasks/${taskId}`)).body.flow).toBe('intake');
    await handle.db.delete(taskIntakes).where(eq(taskIntakes.taskId, taskId));
    expect((await agent.get(`/api/tasks/${taskId}`)).body.flow).toBe('legacy');
    expect((await agent.get(`/api/tasks/${taskId}/intake`)).status).toBe(404);
    expect((await put(taskId, 'site_plan', PNG, '图.png')).status).toBe(404);
  });
});

describe('同时到的请求', () => {
  const missingFields = (v: IntakeView) => v.requiredCheck!.missing.map((m) => m.field);

  it('传新表和删疏散图同时到：必填检查按最后的文件算', async () => {
    const name = '耕云测试并发表格有限公司';
    const { taskId } = await newTask(name);
    const agent = await as();
    // 先传一份缺项的表和两张图；再同时传改好的表、删掉疏散图
    ok(await put(taskId, 'data_sheet', await newMissing(name), '缺项.xlsx'));
    ok(await put(taskId, 'site_plan', PDF, '总平面图.pdf'));
    const withMap = ok(await put(taskId, 'evacuation_map', PNG, '疏散图.png'));
    const sheet = await renamed(name);
    const [up, del] = await Promise.all([
      put(taskId, 'data_sheet', sheet, '改好.xlsx'),
      agent.delete(`/api/tasks/${taskId}/intake/files/${withMap.evacuationMaps[0]!.id}`),
    ]);
    expect(up.status).toBe(201);
    expect(del.status).toBe(200);
    const v = (await agent.get(`/api/tasks/${taskId}/intake`)).body as IntakeView;
    expect(v.dataSheet!.file.originalName).toBe('改好.xlsx');
    expect(v.evacuationMaps).toEqual([]);
    expect(missingFields(v)).toEqual(['drawing.evacuation_plan']);
  });

  it('传疏散图和设「这张图我们没有」同时到：两者不会同时成立', async () => {
    const name = '耕云测试并发疏散图有限公司';
    const { taskId } = await newTask(name);
    const agent = await as();
    ok(await put(taskId, 'data_sheet', await renamed(name), '资料表格.xlsx'));
    ok(await put(taskId, 'site_plan', PDF, '总平面图.pdf'));
    const [up, no] = await Promise.all([
      put(taskId, 'evacuation_map', PNG, '疏散图.png'),
      agent.put(`/api/tasks/${taskId}/intake/no-evacuation-map`).send({ value: true }),
    ]);
    expect(up.status).toBe(201);
    expect([200, 409]).toContain(no.status);
    const v = (await agent.get(`/api/tasks/${taskId}/intake`)).body as IntakeView;
    expect(v.evacuationMaps).toHaveLength(1);
    expect(v.noEvacuationMap).toBe(false);
    expect(missingFields(v)).toEqual([]);
  });
});

describe('删除和「这张图我们没有」的权限', () => {
  it('看得到不能改 403；看不到 404；已提交 409', async () => {
    const { taskId, enterpriseId } = await newTask('耕云测试删除权限有限公司');
    const v = ok(await put(taskId, 'site_plan', PNG, '总平面图.png'));
    const recordId = v.sitePlan!.id;
    const del = (email: string) => as(email).then((a) => a.delete(`/api/tasks/${taskId}/intake/files/${recordId}`));
    const no = (email: string) => as(email).then((a) => a.put(`/api/tasks/${taskId}/intake/no-evacuation-map`).send({ value: true }));

    for (const res of [await del('ops@test.cn'), await no('ops@test.cn')]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('资料由客户自己上传');
    }
    for (const email of ['stranger@test.cn', 'zhou@test.cn']) {
      expect((await del(email)).status).toBe(404);
      expect((await no(email)).status).toBe(404);
    }
    // 没分到这家企业的成员
    const member = await newTask('耕云测试删除权限二有限公司');
    const mv = ok(await put(member.taskId, 'site_plan', PNG, '总平面图.png'));
    const memberAgent = await as('member@test.cn');
    expect((await memberAgent.delete(`/api/tasks/${member.taskId}/intake/files/${mv.sitePlan!.id}`)).status).toBe(404);
    expect((await memberAgent.put(`/api/tasks/${member.taskId}/intake/no-evacuation-map`).send({ value: true })).status).toBe(404);

    await handle.db.update(tasks).set({ status: 'submitted' }).where(eq(tasks.id, taskId));
    for (const res of [await del('admin@test.cn'), await no('admin@test.cn')]) {
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(SUBMITTED_MESSAGE);
    }
    // 文件还在
    const [rec] = await handle.db.select().from(taskIntakeFiles).where(eq(taskIntakeFiles.id, recordId));
    expect(rec!.removedAt).toBeNull();
    void enterpriseId;
  });
});

describe('准备资料文件的下载地址', () => {
  it('别的组织 404；没派这个任务的专家 404；已派的专家能下；没分到这家企业的成员 404', async () => {
    const { taskId } = await newTask('耕云测试下载权限有限公司');
    const v = ok(await put(taskId, 'site_plan', PNG, '总平面图.png'));
    const url = `/api/files/${v.sitePlan!.fileId}/download-url`;
    expect((await (await as('stranger@test.cn')).get(url)).status).toBe(404);
    expect((await (await as('zhou@test.cn')).get(url)).status).toBe(404);
    expect((await (await as('member@test.cn')).get(url)).status).toBe(404);
    await handle.db.update(tasks).set({ assignedExpertId: uid['zhou@test.cn']! }).where(eq(tasks.id, taskId));
    expect((await (await as('zhou@test.cn')).get(url)).status).toBe(200);
    expect((await (await as('wu@test.cn')).get(url)).status).toBe(404);
  });
});

describe('上次提交的表', () => {
  it('同一企业其他任务里最近一次没撤回的提交', async () => {
    const name = '耕云测试上次有限公司';
    const first = await newTask(name);
    const v = ok(await put(first.taskId, 'data_sheet', await renamed(name), '去年的表.xlsx'));
    const file = v.dataSheet!.file;
    const snapshot = (fileId: string, originalName: string) => ({
      files: [{ fileId, slot: 'data_sheet' as const, originalName }],
      parse: null,
      templateVersion: '2026.11',
      noEvacuationMap: false,
      preferredExpertId: null,
    });
    await handle.db.insert(taskIntakeSubmissions).values([
      { taskId: first.taskId, requestId: crypto.randomUUID(), submittedBy: uid['admin@test.cn']!, submittedAt: new Date('2025-06-01T02:00:00Z'), snapshot: snapshot(file.fileId, file.originalName) },
      {
        taskId: first.taskId,
        requestId: crypto.randomUUID(),
        submittedBy: uid['admin@test.cn']!,
        submittedAt: new Date('2025-07-01T02:00:00Z'),
        withdrawnAt: new Date('2025-07-01T03:00:00Z'),
        snapshot: snapshot(file.fileId, '撤回的.xlsx'),
      },
    ]);
    // 第一个任务办完了，同一企业再建一个
    await handle.db.update(tasks).set({ closedAt: new Date() }).where(eq(tasks.id, first.taskId));
    const agent = await as();
    const second = await agent.post(`/api/enterprises/${first.enterpriseId}/tasks`).send({ name: '2027 年应急预案编制' });
    expect(second.status).toBe(201);
    const view = (await agent.get(`/api/tasks/${second.body.id}/intake`)).body as IntakeView;
    expect(view.previousSheet).toEqual({ fileId: file.fileId, originalName: '去年的表.xlsx', submittedAt: '2025-06-01T02:00:00.000Z' });
    // 第一个任务自己不算「以前」
    expect(((await agent.get(`/api/tasks/${first.taskId}/intake`)).body as IntakeView).previousSheet).toBeNull();
  });
});
