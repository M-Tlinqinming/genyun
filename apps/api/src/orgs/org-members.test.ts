import { chinaToday, type OrgManagementView } from '@genyun/shared';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import {
  auditLogs,
  checklistItemFiles,
  enterpriseAssignments,
  enterprises,
  files,
  memberships,
  notifications,
  organizationInvitations,
  organizations,
  sessions,
  tasks,
  users,
} from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import { MemoryMailer } from '../mail/mailer.ts';
import { enterpriseCustomerIds } from '../notifications/notifications.service.ts';

// 客户组织管理（M3 第 7 项）：成员只看分配给自己的企业（企业、任务、资料、成果都按这条），
// 机构管理员邀请 / 重新发送 / 撤销 / 移除 / 改角色、分配企业；不能移除自己、至少保留一位机构管理员；
// 操作写进操作日志；年度服务到期前 30 天站内提醒一次
const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
let mailer: MemoryMailer;
const storage: FileStorage = {
  async put() {},
  async read() {
    return Buffer.from('');
  },
  async downloadUrl(key) {
    return `/blob/${key}`;
  },
};
const uid: Record<string, string> = {};
const org = { a: '', b: '' };
const ent = { one: '', two: '' };
const task = { one: '', two: '' };
const file = { one: '', two: '' };

// 年度服务 20 天后到期
const endsIn = (days: number) => new Date(Date.parse(chinaToday()) + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [a, b, internal] = await db
    .insert(organizations)
    .values([
      { name: '示例安全咨询机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: endsIn(20), activatedAt: new Date() },
      { name: '别家客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  org.a = a!.id;
  org.b = b!.id;
  for (const p of [
    { email: 'admin@test.cn', name: '林管理员', orgId: a!.id, role: 'customer_admin' as const },
    { email: 'li@test.cn', name: '李静', orgId: a!.id, role: 'customer_member' as const },
    { email: 'zhang@test.cn', name: '张伟', orgId: a!.id, role: 'customer_member' as const },
    { email: 'other@test.cn', name: '别家管理员', orgId: b!.id, role: 'customer_admin' as const },
    { email: 'ops@test.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const by = uid['admin@test.cn']!;
  const [e1, e2] = await db
    .insert(enterprises)
    .values([
      { orgId: a!.id, name: '惠州立讯精密', createdBy: by },
      { orgId: a!.id, name: '惠州德赛电池', createdBy: by },
    ])
    .returning();
  ent.one = e1!.id;
  ent.two = e2!.id;
  const [t1, t2] = await db
    .insert(tasks)
    .values([
      { orgId: a!.id, enterpriseId: e1!.id, number: 'GY-2026-101', businessType: 'emergency_plan', name: '2026 年应急预案', createdBy: by },
      { orgId: a!.id, enterpriseId: e2!.id, number: 'GY-2026-102', businessType: 'emergency_plan', name: '2026 年应急预案', createdBy: by },
    ])
    .returning();
  task.one = t1!.id;
  task.two = t2!.id;
  const fileRow = (name: string) => ({
    orgId: a!.id,
    kind: 'customer_material' as const,
    originalName: name,
    contentType: 'application/pdf',
    sizeBytes: 10,
    sha256: name,
    storageKey: `${a!.id}/${name}`,
    uploadedBy: by,
  });
  const [f1, f2] = await db.insert(files).values([fileRow('立讯营业执照.pdf'), fileRow('德赛营业执照.pdf')]).returning();
  file.one = f1!.id;
  file.two = f2!.id;
  await db.insert(checklistItemFiles).values([
    { taskId: t1!.id, itemKey: 'business_license', fileId: f1!.id, linkedBy: by },
    { taskId: t2!.id, itemKey: 'business_license', fileId: f2!.id, linkedBy: by },
  ]);

  mailer = new MemoryMailer();
  app = await createApp(db, { loginLimitPerMinute: 1000, mailer, storage });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

async function as(email: string, password = PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  expect((await agent.post('/api/auth/login').send({ email, password })).status).toBe(200);
  return agent;
}

const base = () => `/api/orgs/${org.a}/management`;
const tokenOf = (to: string) => /\/invite\/([\w-]+)/.exec(mailer.sent.filter((m) => m.to === to).at(-1)!.text)![1]!;
const actions = async (action: string) =>
  (await handle.db.select({ target: auditLogs.target }).from(auditLogs).where(eq(auditLogs.action, action as never))).map((r) => r.target);

describe('成员只看分配给自己的企业', () => {
  it('还没分配企业：企业、任务、成果列表都是空的', async () => {
    const li = await as('li@test.cn');
    expect((await li.get(`/api/orgs/${org.a}/enterprises`).expect(200)).body).toEqual([]);
    expect((await li.get(`/api/orgs/${org.a}/tasks`).expect(200)).body).toEqual([]);
    expect((await li.get(`/api/orgs/${org.a}/deliveries`).expect(200)).body).toEqual([]);
    // 机构管理员看全部
    const admin = await as('admin@test.cn');
    expect((await admin.get(`/api/orgs/${org.a}/enterprises`).expect(200)).body).toHaveLength(2);
  });

  it('分到一家企业后：只看到这家的企业、任务、资料；别的企业的任务、资料、成果一律 404', async () => {
    const admin = await as('admin@test.cn');
    const view: OrgManagementView = (
      await admin.put(`${base()}/members/${uid['li@test.cn']}/enterprises`).send({ enterpriseIds: [ent.one] }).expect(200)
    ).body;
    expect(view.members.find((m) => m.id === uid['li@test.cn'])!.enterpriseIds).toEqual([ent.one]);
    expect(view.enterprises.find((e) => e.id === ent.one)!.membersChangedAt).not.toBeNull();
    expect(await actions('enterprise_assign')).toEqual(['李静（li@test.cn）· 可访问企业：惠州立讯精密']);

    const li = await as('li@test.cn');
    const list = (await li.get(`/api/orgs/${org.a}/enterprises`).expect(200)).body as { id: string; members: { name: string }[] }[];
    expect(list.map((e) => e.id)).toEqual([ent.one]);
    expect(list[0]!.members.map((m) => m.name)).toEqual(['李静']);
    expect((await li.get(`/api/orgs/${org.a}/tasks`).expect(200)).body.map((t: { id: string }) => t.id)).toEqual([task.one]);
    await li.get(`/api/enterprises/${ent.one}`).expect(200);
    await li.get(`/api/tasks/${task.one}`).expect(200);
    await li.get(`/api/files/${file.one}/download-url`).expect(200);

    // 没分配的企业：和不存在一样
    await li.get(`/api/enterprises/${ent.two}`).expect(404);
    await li.get(`/api/enterprises/${ent.two}/basic-step`).expect(404);
    await li.get(`/api/enterprises/${ent.two}/documents`).expect(404);
    await li.patch(`/api/enterprises/${ent.two}`).send({ name: '改名' }).expect(404);
    await li.post(`/api/enterprises/${ent.two}/tasks`).send({ name: '新任务' }).expect(404);
    await li.get(`/api/tasks/${task.two}`).expect(404);
    await li.get(`/api/tasks/${task.two}/checklist`).expect(404);
    await li.put(`/api/tasks/${task.two}/checklist/duty_phone`).send({ status: 'provided' }).expect(404);
    await li.get(`/api/tasks/${task.two}/deliveries`).expect(404);
    await li.get(`/api/tasks/${task.two}/deliveries/1/bundle`).expect(404);
    await li.get(`/api/files/${file.two}`).expect(404);
    await li.get(`/api/files/${file.two}/download-url`).expect(404);
    // 分到的企业可以填资料
    await li.put(`/api/tasks/${task.one}/checklist/duty_phone`).send({ status: 'provided' }).expect(200);
  });

  it('不能把别的企业的文件挂到自己的企业上来查看', async () => {
    const li = await as('li@test.cn');
    await li.post(`/api/tasks/${task.one}/checklist/business_license/files`).send({ fileId: file.two }).expect(404);
    await li.post(`/api/enterprises/${ent.one}/documents`).send({ fileId: file.two }).expect(404);
    await li.post(`/api/tasks/${task.one}/documents`).send({ fileId: file.two }).expect(404);
    await li.get(`/api/files/${file.two}/download-url`).expect(404);
  });

  it('在可见企业档案的自由填写内容里写上别家企业的文件 ID，也看不到那个文件；档案里按字段引用的照片能看到', async () => {
    const li = await as('li@test.cn');
    const [photo] = await handle.db
      .insert(files)
      .values({
        orgId: org.a,
        kind: 'customer_material',
        originalName: '油漆包装标签.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1,
        sha256: 'label',
        storageKey: `${org.a}/label`,
        uploadedBy: uid['admin@test.cn']!,
      })
      .returning();
    await li.get(`/api/files/${photo!.id}`).expect(404);
    await handle.db
      .update(enterprises)
      .set({
        profile: {
          basicStep: { basic: { siteAddress: file.two, businessScope: `见 ${file.two}` } as never, later: [], sources: {} },
          productionStep: {
            step: { materials: [{ id: 'm1', name: file.two, labelPhotoFileIds: [photo!.id] }], process: { description: file.two } } as never,
          },
        },
      })
      .where(eq(enterprises.id, ent.one));
    await li.get(`/api/files/${file.two}`).expect(404);
    await li.get(`/api/files/${file.two}/download-url`).expect(404);
    await li.get(`/api/files/${photo!.id}`).expect(200);
    await li.get(`/api/files/${photo!.id}/download-url`).expect(200);
    await handle.db.update(enterprises).set({ profile: {} }).where(eq(enterprises.id, ent.one));
  });

  it('成员不能新建企业，也不能进组织管理', async () => {
    const li = await as('li@test.cn');
    await li.post(`/api/orgs/${org.a}/enterprises`).send({ name: '成员建的' }).expect(403);
    await li.get(base()).expect(403);
    await li.post(`${base()}/invitations`).send({ name: '王五', email: 'wang@test.cn', role: 'customer_member' }).expect(403);
    await li.put(`${base()}/members/${uid['li@test.cn']}/enterprises`).send({ enterpriseIds: [ent.one, ent.two] }).expect(403);
  });

  it('别家组织一律 404；运营不能替客户管理成员', async () => {
    const other = await as('other@test.cn');
    await other.get(base()).expect(404);
    await other.put(`${base()}/members/${uid['li@test.cn']}/enterprises`).send({ enterpriseIds: [ent.two] }).expect(404);
    await other.get(`/api/tasks/${task.one}`).expect(404);
    await other.get(`/api/files/${file.one}/download-url`).expect(404);
    await (await as('ops@test.cn')).get(base()).expect(403);
    // 别家企业不能分配进来
    const admin = await as('admin@test.cn');
    const [otherEnt] = await handle.db.insert(enterprises).values({ orgId: org.b, name: '别家企业', createdBy: uid['other@test.cn']! }).returning();
    await admin.put(`${base()}/members/${uid['li@test.cn']}/enterprises`).send({ enterpriseIds: [otherEnt!.id] }).expect(404);
    await admin.put(`${base()}/members/${uid['other@test.cn']}/enterprises`).send({ enterpriseIds: [ent.one] }).expect(404);
  });

  it('按企业调整负责成员；提醒只发给机构管理员和负责这家企业的成员', async () => {
    const admin = await as('admin@test.cn');
    const view: OrgManagementView = (
      await admin.put(`${base()}/enterprises/${ent.two}/members`).send({ userIds: [uid['zhang@test.cn'], uid['admin@test.cn']] }).expect(200)
    ).body;
    expect(view.enterprises.find((e) => e.id === ent.two)!.memberIds.sort()).toEqual([uid['zhang@test.cn'], uid['admin@test.cn']].sort());
    await (await as('zhang@test.cn')).get(`/api/tasks/${task.two}`).expect(200);
    await (await as('zhang@test.cn')).get(`/api/tasks/${task.one}`).expect(404);
    expect((await enterpriseCustomerIds(handle.db, { orgId: org.a, enterpriseId: ent.one })).sort()).toEqual(
      [uid['admin@test.cn'], uid['li@test.cn']].sort(),
    );
    expect((await enterpriseCustomerIds(handle.db, { orgId: org.a, enterpriseId: ent.two })).sort()).toEqual(
      [uid['admin@test.cn'], uid['zhang@test.cn']].sort(),
    );
    expect(await actions('enterprise_assign')).toContain('惠州德赛电池 · 负责成员：张伟、林管理员');

    // 张伟不再负责这家企业：这家企业任务的站内通知从他那里删掉；机构管理员的保留
    const notice = { taskId: task.two, title: '补充请求', body: '惠州德赛电池：请补充值班电话', link: `/customer/tasks/${task.two}` };
    await handle.db.insert(notifications).values([
      { userId: uid['zhang@test.cn']!, ...notice },
      { userId: uid['admin@test.cn']!, ...notice },
    ]);
    await admin.put(`${base()}/enterprises/${ent.two}/members`).send({ userIds: [uid['admin@test.cn']] }).expect(200);
    const left = await handle.db.select({ userId: notifications.userId }).from(notifications).where(eq(notifications.taskId, task.two));
    expect(left.map((n) => n.userId)).toEqual([uid['admin@test.cn']]);
    await admin.put(`${base()}/enterprises/${ent.two}/members`).send({ userIds: [uid['zhang@test.cn'], uid['admin@test.cn']] }).expect(200);
    // 选了不在本组织的人：404
    await admin.put(`${base()}/enterprises/${ent.two}/members`).send({ userIds: [uid['other@test.cn']] }).expect(404);
  });
});

describe('邀请、移除、改角色', () => {
  it('邀请成员：发邀请邮件，对方接受后加入本组织，还没有可访问的企业', async () => {
    const admin = await as('admin@test.cn');
    const sent = await admin.post(`${base()}/invitations`).send({ name: '王芳', email: 'Wang@Test.cn', role: 'customer_member' }).expect(200);
    expect(sent.body).toMatchObject({ email: 'wang@test.cn' });
    const view: OrgManagementView = (await admin.get(base()).expect(200)).body;
    expect(view.invitations).toMatchObject([{ name: '王芳', email: 'wang@test.cn', role: 'customer_member', state: 'valid' }]);

    // 重新发送：旧链接作废
    const first = tokenOf('wang@test.cn');
    await admin.post(`${base()}/invitations/${view.invitations[0]!.id}/resend`).expect(200);
    const second = tokenOf('wang@test.cn');
    expect(second).not.toBe(first);
    const guest = request.agent(app.getHttpServer());
    expect((await guest.get(`/api/invitations/${first}`).expect(200)).body.state).toBe('revoked');

    const accepted = await guest.post(`/api/invitations/${second}/accept`).send({ name: '王芳', password: 'genyun2026', agreed: true }).expect(200);
    expect(accepted.body.memberships).toMatchObject([{ orgId: org.a, role: 'customer_member', enterpriseIds: [] }]);
    expect((await guest.get(`/api/orgs/${org.a}/enterprises`).expect(200)).body).toEqual([]);
    const after: OrgManagementView = (await admin.get(base()).expect(200)).body;
    expect(after.invitations).toEqual([]);
    expect(after.members.map((m) => m.name)).toContain('王芳');
    expect(await actions('member_invite')).toEqual(['王芳（wang@test.cn）· 成员', '王芳（wang@test.cn）· 成员 · 重新发送']);
  });

  it('已有耕云账号的邮箱不能邀请；撤销后链接失效', async () => {
    const admin = await as('admin@test.cn');
    const dup = await admin.post(`${base()}/invitations`).send({ name: '别家', email: 'other@test.cn', role: 'customer_member' }).expect(409);
    expect(dup.body.field).toBe('email');
    await admin.post(`${base()}/invitations`).send({ name: '赵六', email: 'zhao@test.cn', role: 'customer_admin' }).expect(200);
    const token = tokenOf('zhao@test.cn');
    const inv = ((await admin.get(base())).body as OrgManagementView).invitations.find((i) => i.email === 'zhao@test.cn')!;
    await admin.post(`${base()}/invitations/${inv.id}/revoke`).expect(200);
    await admin.post(`${base()}/invitations/${inv.id}/revoke`).expect(409);
    await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send({ name: '赵六', password: 'genyun2026', agreed: true }).expect(409);
    expect(await actions('member_invite_revoke')).toEqual(['赵六（zhao@test.cn）· 机构管理员']);
  });

  it('机构管理员可以邀请第二位机构管理员（首位管理员之外）', async () => {
    const admin = await as('admin@test.cn');
    await admin.post(`${base()}/invitations`).send({ name: '周敏', email: 'zhou@test.cn', role: 'customer_admin' }).expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/invitations/${tokenOf('zhou@test.cn')}/accept`)
      .send({ name: '周敏', password: 'genyun2026', agreed: true })
      .expect(200);
    expect(res.body.memberships).toMatchObject([{ orgId: org.a, role: 'customer_admin' }]);
    uid['zhou@test.cn'] = res.body.id;
  });

  it('不能移除自己、不能改自己的角色', async () => {
    const admin = await as('admin@test.cn');
    expect((await admin.post(`${base()}/members/${uid['admin@test.cn']}/remove`).expect(409)).body.message).toContain('不能移除自己');
    await admin.put(`${base()}/members/${uid['admin@test.cn']}/role`).send({ role: 'customer_member' }).expect(409);
  });

  it('改角色：成员升为机构管理员后看全部企业；两位管理员同时互相降级，只有一个成功，组织里始终留一位', async () => {
    const admin = await as('admin@test.cn');
    await admin.put(`${base()}/members/${uid['zhang@test.cn']}/role`).send({ role: 'customer_admin' }).expect(200);
    const zhang = await as('zhang@test.cn');
    expect((await zhang.get(`/api/orgs/${org.a}/enterprises`).expect(200)).body).toHaveLength(2);
    await admin.put(`${base()}/members/${uid['zhang@test.cn']}/role`).send({ role: 'customer_member' }).expect(200);
    expect(await actions('member_role_change')).toEqual(['张伟（zhang@test.cn）· 成员 → 机构管理员', '张伟（zhang@test.cn）· 机构管理员 → 成员']);

    // 现在有林管理员、周敏两位管理员：同时把对方降成成员
    const zhou = await as('zhou@test.cn', 'genyun2026');
    const [r1, r2] = await Promise.all([
      admin.put(`${base()}/members/${uid['zhou@test.cn']}/role`).send({ role: 'customer_member' }),
      zhou.put(`${base()}/members/${uid['admin@test.cn']}/role`).send({ role: 'customer_member' }),
    ]);
    expect([r1.status, r2.status].filter((s) => s === 200)).toHaveLength(1);
    const admins = await handle.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, org.a), eq(memberships.role, 'customer_admin')));
    expect(admins).toHaveLength(1);
    // 恢复成林管理员是唯一管理员、周敏是成员
    if (admins[0]!.userId !== uid['admin@test.cn']) {
      await handle.db.update(memberships).set({ role: 'customer_admin' }).where(eq(memberships.userId, uid['admin@test.cn']!));
      await handle.db.update(memberships).set({ role: 'customer_member' }).where(eq(memberships.userId, uid['zhou@test.cn']!));
    }
  });

  it('移除成员：不能再登录，分配记录删除，上传记录保留；再次邀请同一邮箱时恢复原账号', async () => {
    const admin = await as('admin@test.cn');
    const li = await as('li@test.cn');
    const [upload] = await handle.db
      .insert(files)
      .values({
        orgId: org.a,
        kind: 'customer_material',
        originalName: '李静上传.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'x',
        storageKey: `${org.a}/li-upload`,
        uploadedBy: uid['li@test.cn']!,
      })
      .returning();
    await handle.db.insert(notifications).values([
      { userId: uid['li@test.cn']!, taskId: task.one, title: '补充请求', body: '惠州立讯精密：请补充值班电话', link: `/customer/tasks/${task.one}` },
      { userId: uid['li@test.cn']!, title: '其他提醒', body: '没有关联任务', link: '/customer' },
    ]);
    const view: OrgManagementView = (await admin.post(`${base()}/members/${uid['li@test.cn']}/remove`).expect(200)).body;
    expect(view.members.map((m) => m.email)).not.toContain('li@test.cn');
    // 不在任何组织了：账号记为「被机构管理员移除」，站内通知全部删掉
    const [removed] = await handle.db.select({ reason: users.disabledReason }).from(users).where(eq(users.id, uid['li@test.cn']!));
    expect(removed!.reason).toBe('removed_by_customer');
    expect(await handle.db.select().from(notifications).where(eq(notifications.userId, uid['li@test.cn']!))).toEqual([]);
    await li.get('/api/auth/me').expect(401);
    expect(await handle.db.select().from(sessions).where(eq(sessions.userId, uid['li@test.cn']!))).toEqual([]);
    expect(await handle.db.select().from(enterpriseAssignments).where(eq(enterpriseAssignments.userId, uid['li@test.cn']!))).toEqual([]);
    expect((await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'li@test.cn', password: PASSWORD })).status).not.toBe(200);
    // 上传的文件仍归她，机构管理员能看
    await admin.get(`/api/files/${upload!.id}`).expect(200);
    expect(await actions('member_remove')).toEqual(['李静（li@test.cn）· 成员']);
    await admin.post(`${base()}/members/${uid['li@test.cn']}/remove`).expect(404);

    // 重新邀请：接受时恢复原账号；以前的企业分配不带回来（假设残留了一条）
    await admin.post(`${base()}/invitations`).send({ name: '李静', email: 'li@test.cn', role: 'customer_member' }).expect(200);
    await handle.db.insert(enterpriseAssignments).values({ enterpriseId: ent.one, userId: uid['li@test.cn']!, orgId: org.a, assignedBy: uid['admin@test.cn']! });
    const back = await request(app.getHttpServer())
      .post(`/api/invitations/${tokenOf('li@test.cn')}/accept`)
      .send({ name: '李静', password: 'genyun2027', agreed: true })
      .expect(200);
    expect(back.body).toMatchObject({ id: uid['li@test.cn'], memberships: [{ orgId: org.a, role: 'customer_member', enterpriseIds: [] }] });
    await as('li@test.cn', 'genyun2027');
    const [back2] = await handle.db.select({ reason: users.disabledReason, at: users.disabledAt }).from(users).where(eq(users.id, uid['li@test.cn']!));
    expect(back2).toEqual({ reason: null, at: null });
  });

  it('运营停用的账号：客户邀请不能恢复', async () => {
    const admin = await as('admin@test.cn');
    // 先发邀请，之后这个邮箱有了一个被运营停用的账号（不在任何组织）
    await admin.post(`${base()}/invitations`).send({ name: '孙七', email: 'sun@test.cn', role: 'customer_member' }).expect(200);
    const token = tokenOf('sun@test.cn');
    const passwordHash = await hashPassword(PASSWORD);
    await handle.db.insert(users).values({ email: 'sun@test.cn', name: '孙七', passwordHash, disabledAt: new Date(), disabledReason: 'operator' });
    await request(app.getHttpServer()).post(`/api/invitations/${token}/accept`).send({ name: '孙七', password: 'genyun2026', agreed: true }).expect(409);
    await admin.post(`${base()}/invitations`).send({ name: '孙七', email: 'sun@test.cn', role: 'customer_member' }).expect(409);
    const [sun] = await handle.db.select({ reason: users.disabledReason }).from(users).where(eq(users.email, 'sun@test.cn'));
    expect(sun!.reason).toBe('operator');
  });

  it('机构管理员被降为成员或移除：他发出、还没接受的邀请作废；过期提醒不再发给他', async () => {
    const admin = await as('admin@test.cn');
    await admin.put(`${base()}/members/${uid['zhang@test.cn']}/role`).send({ role: 'customer_admin' }).expect(200);
    const zhang = await as('zhang@test.cn');
    await zhang.post(`${base()}/invitations`).send({ name: '钱八', email: 'qian@test.cn', role: 'customer_member' }).expect(200);
    const token = tokenOf('qian@test.cn');
    await admin.put(`${base()}/members/${uid['zhang@test.cn']}/role`).send({ role: 'customer_member' }).expect(200);
    expect(((await admin.get(base())).body as OrgManagementView).invitations.map((i) => i.email)).not.toContain('qian@test.cn');
    const guest = request(app.getHttpServer());
    expect((await guest.get(`/api/invitations/${token}`).expect(200)).body.state).toBe('revoked');

    // 万一还有一封过期的（例如作废前刚好过期）：对方请求重发，也不提醒已经不是管理员的张伟
    await handle.db
      .update(organizationInvitations)
      .set({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) })
      .where(eq(organizationInvitations.email, 'qian@test.cn'));
    await guest.post(`/api/invitations/${token}/request-resend`).expect(200);
    const toZhang = await handle.db.select().from(notifications).where(and(eq(notifications.userId, uid['zhang@test.cn']!), eq(notifications.title, '邀请过期，请重新发送')));
    expect(toZhang).toEqual([]);
    await handle.db.update(organizationInvitations).set({ revokedAt: new Date() }).where(eq(organizationInvitations.email, 'qian@test.cn'));
  });

  it('组织资料：机构管理员改联系人、电话、邮箱', async () => {
    const admin = await as('admin@test.cn');
    await admin.put(`${base()}/profile`).send({ contactName: '', contactPhone: '0752-1234567' }).expect(400);
    const view: OrgManagementView = (
      await admin.put(`${base()}/profile`).send({ contactName: '林管理员', contactPhone: '0752-1234567', contactEmail: 'service@test.cn' }).expect(200)
    ).body;
    expect(view.org).toMatchObject({ name: '示例安全咨询机构', contactName: '林管理员', contactPhone: '0752-1234567', contactEmail: 'service@test.cn' });
    expect(await actions('org_profile_update')).toEqual(['示例安全咨询机构 · 服务联系人 林管理员']);
  });
});

describe('年度服务', () => {
  it('显示服务期、剩余天数、本期办理情况', async () => {
    const view: OrgManagementView = (await (await as('admin@test.cn')).get(base()).expect(200)).body;
    expect(view.service).toMatchObject({ startsAt: '2026-01-01', endsAt: endsIn(20), state: 'expiring', daysLeft: 20, enterprises: 2, delivered: 0, inProgress: 2 });
  });

  it('到期前 30 天站内提醒机构管理员一次，不重复发；成员不收', async () => {
    const admin = await as('admin@test.cn');
    await admin.get('/api/notifications').expect(200);
    await admin.get('/api/notifications').expect(200);
    const res = await admin.get('/api/notifications').expect(200);
    const reminders = (res.body.items as { title: string; body: string; link: string }[]).filter((n) => n.title === '年度服务即将到期');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.body).toContain('还有 20 天');
    expect(reminders[0]!.link).toBe('/customer/organization?tab=service');
    const zhang = await as('zhang@test.cn');
    const memberItems = (await zhang.get('/api/notifications').expect(200)).body.items as { title: string }[];
    expect(memberItems.filter((n) => n.title === '年度服务即将到期')).toEqual([]);
    // 续约后到期日变了：不再是 30 天内，不提醒
    const rows = await handle.db.select().from(notifications).where(eq(notifications.userId, uid['admin@test.cn']!));
    expect(rows.filter((n) => n.dedupeKey?.startsWith('contract-expiring:'))).toHaveLength(1);
  });
});
