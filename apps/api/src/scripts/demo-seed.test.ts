import { chinaToday } from '@genyun/shared';
import { feiyuBasicInfo } from '@genyun/shared/fixtures/feiyu';
import { eq, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type Database, type DatabaseHandle } from '../db/client.ts';
import * as schema from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { InProcessQueue } from '../generation/queue.ts';
import { complete, testDocument } from '../tasks/test-workup.ts';
import { DEMO_EMAILS, DEMO_ORGS, demoContractPdf, seedDemo } from './demo-seed.ts';

const { enterprises, memberships, organizationContracts, organizations, taskNumberCounters, tasks, taskWorkups, users } = schema;

const PASSWORD = 'demo-password-1';
let handle: DatabaseHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

function memoryStorage() {
  const stored = new Map<string, Buffer>();
  const storage: FileStorage = {
    async put(key, data) {
      if (stored.has(key)) throw new Error(`已存在 ${key}`);
      stored.set(key, data);
    },
    async read(key) {
      return stored.get(key)!;
    },
    async downloadUrl(key) {
      return `/blob/${key}`;
    },
  };
  return { storage, stored };
}

// 每张表的行数
async function counts(db: Database) {
  const out: Record<string, number> = {};
  for (const t of Object.values(schema)) {
    if (!is(t, PgTable)) continue;
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(t);
    out[getTableName(t)] = row!.n;
  }
  return out;
}

const hashOf = async (db: Database, email: string) =>
  (await db.select({ h: users.passwordHash }).from(users).where(eq(users.email, email)))[0]?.h;

describe('演示数据', () => {
  it('空库：写入五个演示账号、两家已开通且登记了合同的客户组织、两个已提交并分派的任务', async () => {
    handle = await openDatabase('memory://');
    const { db } = handle;
    const { storage, stored } = memoryStorage();
    const report = await seedDemo(db, { passwordHash: await hashPassword(PASSWORD), storage });
    expect(report.skipped).toEqual([]);

    const people = await db.select({ email: users.email }).from(users);
    expect(people.map((p) => p.email).sort()).toEqual(Object.values(DEMO_EMAILS).sort());

    const orgs = await db.select().from(organizations);
    const customers = orgs.filter((o) => o.kind === 'customer');
    expect(customers.map((o) => o.name).sort()).toEqual([DEMO_ORGS.agency, DEMO_ORGS.feiyu].sort());
    for (const o of customers) expect(o).toMatchObject({ contractStartsAt: '2026-01-01', contractEndsAt: '2027-12-31', activatedAt: expect.any(Date) });
    expect(await db.select().from(organizationContracts)).toHaveLength(2);
    // 合同原件存进了文件存储，是一份 PDF
    expect([...stored.values()].every((b) => b.subarray(0, 5).toString() === '%PDF-')).toBe(true);

    const rows = await db
      .select({ number: tasks.number, status: tasks.status, enterprise: enterprises.name, expert: users.email })
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
      .innerJoin(users, eq(users.id, tasks.assignedExpertId))
      .orderBy(tasks.number);
    const year = Number(chinaToday().slice(0, 4));
    expect(rows).toEqual([
      { number: `GY-${year}-001`, status: 'submitted', enterprise: feiyuBasicInfo.companyName, expert: DEMO_EMAILS.expert },
      { number: `GY-${year}-002`, status: 'submitted', enterprise: '示例五金制品有限公司', expert: DEMO_EMAILS.expert2 },
    ]);
  }, 60_000);

  it('在预览环境已有数据上连跑两次：只补缺的，条数不变，已有账号的密码不变，测试人员的数据都在', async () => {
    handle = await openDatabase('memory://');
    const { db } = handle;
    const { storage } = memoryStorage();

    // 预览环境现状：最早一版演示数据（耕云、示例安全咨询机构、三个账号）+ 测试人员自己建的组织、企业、任务
    const oldHash = await hashPassword('old-preview-password');
    const [internal, agency, testerOrg] = await db
      .insert(organizations)
      .values([
        { name: DEMO_ORGS.internal, kind: 'internal' },
        { name: DEMO_ORGS.agency, kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2027-12-31', activatedAt: new Date('2026-10-23') },
        { name: '测试人员建的组织', kind: 'customer', region: '广东省深圳市' },
      ])
      .returning();
    const old = [
      { email: DEMO_EMAILS.agencyAdmin, orgId: agency!.id, role: 'customer_admin' as const },
      { email: DEMO_EMAILS.expert, orgId: internal!.id, role: 'expert' as const },
      { email: DEMO_EMAILS.operator, orgId: internal!.id, role: 'operator' as const },
    ];
    const ids: Record<string, string> = {};
    for (const p of old) {
      const [u] = await db.insert(users).values({ email: p.email, name: '旧名字', passwordHash: oldHash }).returning();
      await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
      ids[p.email] = u!.id;
    }
    const [testerEnt] = await db
      .insert(enterprises)
      .values({ orgId: agency!.id, name: '测试人员录的企业', profile: { basicStep: { basic: { employeeCount: 12 }, later: [], sources: {} } }, createdBy: ids[DEMO_EMAILS.agencyAdmin]! })
      .returning();
    const year = Number(chinaToday().slice(0, 4));
    await db.insert(tasks).values({
      orgId: agency!.id,
      enterpriseId: testerEnt!.id,
      number: `GY-${year}-001`,
      businessType: 'emergency_plan',
      name: '测试人员的任务',
      createdBy: ids[DEMO_EMAILS.agencyAdmin]!,
    });
    await db.insert(taskNumberCounters).values({ year, last: 1 });
    const before = await counts(db);

    const first = await seedDemo(db, { passwordHash: await hashPassword('new-password'), storage });
    expect(first.skipped).toEqual(
      expect.arrayContaining([`组织「${DEMO_ORGS.internal}」`, `账号 ${DEMO_EMAILS.agencyAdmin}`, `账号 ${DEMO_EMAILS.expert}`, `账号 ${DEMO_EMAILS.operator}`]),
    );
    const afterFirst = await counts(db);
    // 只多了缺的：飞宇组织、两个新账号、两份合同、两家企业、两个任务
    expect(afterFirst.users! - before.users!).toBe(2);
    expect(afterFirst.organizations! - before.organizations!).toBe(1);
    expect(afterFirst.organization_contracts! - before.organization_contracts!).toBe(2);
    expect(afterFirst.enterprises! - before.enterprises!).toBe(2);
    expect(afterFirst.tasks! - before.tasks!).toBe(2);

    const second = await seedDemo(db, { passwordHash: await hashPassword('third-password'), storage });
    expect(second.created).toEqual([]);
    expect(await counts(db)).toEqual(afterFirst);

    // 已有账号：密码、姓名都没动；用原来的密码还能登录
    for (const p of old) expect(await hashOf(db, p.email)).toBe(oldHash);
    expect((await db.select({ name: users.name }).from(users).where(eq(users.email, DEMO_EMAILS.expert)))[0]!.name).toBe('旧名字');
    // 新账号用第一次运行时的密码，第二次运行没有改
    const feiyuHash = await hashOf(db, DEMO_EMAILS.feiyu);
    const app = await createApp(db, { loginLimitPerMinute: 1000, storage, queue: new InProcessQueue() });
    await app.init();
    try {
      const login = (email: string, password: string) => request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
      expect((await login(DEMO_EMAILS.expert, 'old-preview-password')).status).toBe(200);
      expect((await login(DEMO_EMAILS.expert, 'third-password')).status).toBe(401);
      expect((await login(DEMO_EMAILS.feiyu, 'new-password')).status).toBe(200);
      expect(await hashOf(db, DEMO_EMAILS.feiyu)).toBe(feiyuHash);
    } finally {
      await app.close();
    }

    // 测试人员的数据都在；演示任务按流水往后编号，不和已有任务撞号
    expect((await db.select().from(organizations).where(eq(organizations.id, testerOrg!.id)))[0]).toMatchObject({ name: '测试人员建的组织', activatedAt: null });
    expect((await db.select().from(enterprises).where(eq(enterprises.id, testerEnt!.id)))[0]!.profile).toEqual({ basicStep: { basic: { employeeCount: 12 }, later: [], sources: {} } });
    const numbers = (await db.select({ number: tasks.number, name: tasks.name }).from(tasks).orderBy(tasks.number)).map((t) => `${t.number} ${t.name}`);
    expect(numbers).toEqual([`GY-${year}-001 测试人员的任务`, `GY-${year}-002 ${year} 年生产安全事故应急预案编制`, `GY-${year}-003 ${year} 年生产安全事故应急预案编制`]);
    // 机构原来的开通时间不改，只补上空着的地区和联系人
    expect((await db.select().from(organizations).where(eq(organizations.id, agency!.id)))[0]).toMatchObject({
      activatedAt: new Date('2026-10-23'),
      region: '广东省惠州市',
      contactName: '林管理员',
    });
  }, 60_000);

  it('周工打开飞宇任务：补齐专家判断和技术人员数后就能确认生成三份草稿', async () => {
    handle = await openDatabase('memory://');
    const { db } = handle;
    const { storage } = memoryStorage();
    await seedDemo(db, { passwordHash: await hashPassword(PASSWORD), storage });
    const queue = new InProcessQueue();
    const renderer: DraftRenderer = async (kind, input) => ({
      word: Buffer.from(`${kind}:${input.basic.companyName}`),
      pdf: Buffer.from(`${kind}:pdf`),
      notes: [],
      document: testDocument(kind),
    });
    const app = await createApp(db, { loginLimitPerMinute: 1000, storage, queue, renderer });
    await app.init();
    try {
      const zhou = request.agent(app.getHttpServer());
      await zhou.post('/api/auth/login').send({ email: DEMO_EMAILS.expert, password: PASSWORD }).expect(200);
      const list = await zhou.get('/api/expert/tasks').expect(200);
      const task = (list.body.tasks as { id: string; enterpriseName: string }[]).find((t) => t.enterpriseName === feiyuBasicInfo.companyName)!;
      expect(task).toBeTruthy();

      const opened = await zhou.get(`/api/tasks/${task.id}/workup`).expect(200);
      const [row] = await db.select().from(taskWorkups).where(eq(taskWorkups.taskId, task.id));
      const data = complete(row!.snapshot);
      // 客户资料里只差技术人员数要专家补（演示用），其余都是专家自己的判断
      expect(Object.keys(data.overrides)).toEqual(['technicalManagementCount']);
      await db.update(taskWorkups).set({ data, version: opened.body.version + 1 }).where(eq(taskWorkups.taskId, task.id));

      await zhou.post(`/api/tasks/${task.id}/generation`).send({ version: opened.body.version + 1 }).expect(201);
      await queue.idle();
      const done = await zhou.get(`/api/tasks/${task.id}/generation`).expect(200);
      expect(done.body.current.drafts.map((d: { kind: string; status: string }) => `${d.kind}:${d.status}`)).toEqual(['plan:done', 'risk:done', 'resource:done']);
    } finally {
      await app.close();
    }
  }, 60_000);

  it('演示合同原件是一份能解析的 PDF', () => {
    const pdf = demoContractPdf('GY-DEMO-2026-01').toString('latin1');
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const first = Number(pdf.match(/0000000000 65535 f \n(\d{10})/)![1]);
    expect(pdf.slice(first, first + 7)).toBe('1 0 obj');
  });
});
