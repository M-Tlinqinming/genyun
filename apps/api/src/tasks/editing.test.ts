import type { PlanInput } from '@genyun/shared';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { draftRevisions, draftEdits, enterprises, memberships, organizations, tasks, taskWorkups, users } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';
import type { ParagraphPolisher, PolishRequest } from '../generation/ai/drafter.ts';
import type { DraftRenderer } from '../generation/drafts.ts';
import { InProcessQueue } from '../generation/queue.ts';
import { peopleOf } from './editing.service.ts';
import { complete, testDocument } from './test-workup.ts';

// 正文编辑（M2 第 11 项）：按节保存修订、两人同时改不覆盖、同一次保存重试不重复记、帮我改写这段、越权
const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;
const queue = new InProcessQueue();
const stored = new Map<string, Buffer>();
const storage: FileStorage = {
  async put(key, data) {
    stored.set(key, data);
  },
  async read(key) {
    return stored.get(key)!;
  },
  async downloadUrl(key) {
    return `/blob/${key}`;
  },
};
// 带图的一节（第 2 章）：测锁定的图单独加载缩略图
const png = (() => {
  const c = createCanvas(960, 640);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#336699';
  ctx.fillRect(0, 0, 960, 640);
  return new Uint8Array(c.toBuffer('image/png'));
})();
const withFigure = (kind: 'plan' | 'risk' | 'resource') => {
  const doc = testDocument(kind);
  doc.sections.push({
    id: 'ch2',
    title: '2 组织机构',
    blocks: [
      { type: 'paragraph', text: ['组织机构如下图。'] },
      { type: 'figure', png, width: 960, height: 640, caption: '图 1 应急组织机构图' },
    ],
    sections: [],
  });
  return doc;
};
const renderer: DraftRenderer = async (kind) => ({ word: Buffer.from('word'), pdf: null, notes: [], document: withFigure(kind) });
const polished: PolishRequest[] = [];
const drafter: ParagraphPolisher = {
  polish: async (req) => {
    polished.push(req);
    return req.text.replace('原来的', '');
  },
};

let taskId = '';
let otherTaskId = '';
let batchId = '';
const uid: Record<string, string> = {};

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const { db } = handle;
  const passwordHash = await hashPassword(PASSWORD);
  const [customer, other, internal] = await db
    .insert(organizations)
    .values([
      { name: '飞宇演示客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '别家客户', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31' },
      { name: '耕云', kind: 'internal' },
    ])
    .returning();
  for (const p of [
    { email: 'feiyu@test.cn', name: '陈志刚', orgId: customer!.id, role: 'customer_admin' as const },
    { email: 'other@test.cn', name: '别家', orgId: other!.id, role: 'customer_admin' as const },
    { email: 'zhou@test.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
    { email: 'wu@test.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
    { email: 'ops@test.cn', name: '运营', orgId: internal!.id, role: 'operator' as const },
  ]) {
    const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
    await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    uid[p.email] = u!.id;
  }
  const [ent] = await db
    .insert(enterprises)
    .values({
      orgId: customer!.id,
      name: '惠阳飞宇电器有限公司',
      socialCreditCode: '91441300726483224B',
      legalRepresentative: '李文聪',
      registeredAddress: '惠州市仲恺高新区陈江街道正大路 17 号',
      profile: feiyuProfile,
      createdBy: uid['feiyu@test.cn']!,
    })
    .returning();
  const [task, second] = await db
    .insert(tasks)
    .values([
      {
        orgId: customer!.id,
        enterpriseId: ent!.id,
        businessType: 'emergency_plan',
        name: '2026 年应急预案',
        number: 'GY-2026-001',
        status: 'submitted',
        assignedExpertId: uid['zhou@test.cn']!,
        createdBy: uid['feiyu@test.cn']!,
      },
      {
        orgId: customer!.id,
        enterpriseId: ent!.id,
        businessType: 'emergency_plan',
        // 上一年的任务已结束，只用来测「还没生成草稿」
        closedAt: new Date('2025-12-31'),
        name: '还没生成',
        number: 'GY-2026-002',
        status: 'submitted',
        assignedExpertId: uid['zhou@test.cn']!,
        createdBy: uid['feiyu@test.cn']!,
      },
    ])
    .returning();
  taskId = task!.id;
  otherTaskId = second!.id;

  app = await createApp(db, { loginLimitPerMinute: 1000, storage, queue, renderer, drafter });
  await app.init();

  // 整理补齐后确认生成三份草稿
  const zhou = await as('zhou@test.cn');
  await zhou.get(`/api/tasks/${taskId}/workup`).expect(200);
  const [row] = await db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId));
  await db.update(taskWorkups).set({ data: complete(row!.snapshot), version: row!.version + 1 }).where(eq(taskWorkups.taskId, taskId));
  await zhou.post(`/api/tasks/${taskId}/generation`).send({ version: row!.version + 1 }).expect(201);
  await queue.idle();
  batchId = (await zhou.get(`/api/tasks/${taskId}/drafts/plan/edit`).expect(200)).body.batchId;
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

const url = (kind = 'plan', rest = '') => `/api/tasks/${taskId}/drafts/${kind}${rest}`;
const save = (blocks: unknown[], baseRev: number, note = '按名册更正联系人', saveId: string = randomUUID()) => ({ saveId, batchId, baseRev, blocks, note });
const lockedTable = { type: 'locked', index: 1, label: '随便写的' };

describe('正文编辑', () => {
  it('目录和一节的内容：表格锁定，标出业务名称', async () => {
    const zhou = await as('zhou@test.cn');
    const doc = (await zhou.get(url('plan', '/edit')).expect(200)).body;
    expect(doc).toMatchObject({ kind: 'plan', version: 0, editable: true, rewrite: true });
    expect(doc.outline[0]).toMatchObject({ id: 'ch1', title: '1 总则', edited: false });
    expect(doc.outline[0].children.map((c: { id: string }) => c.id)).toEqual(['ch1.1', 'ch1.2']);

    const section = (await zhou.get(url('plan', '/sections/ch1.2')).expect(200)).body;
    expect(section).toEqual({
      id: 'ch1.2',
      title: '1.2 应急通讯录',
      path: ['1 总则', '1.2 应急通讯录'],
      blocks: [
        { type: 'paragraph', text: ['应急办公室联系人：陈某，电话 13800000001。'] },
        { type: 'locked', index: 1, label: '表格：表 1 应急通讯录' },
      ],
      rev: 0,
      saved: null,
      // 表格内容只读显示
      locked: [{ index: 1, kind: 'table', header: [['姓名']], rows: [['陈某']] }],
    });
    await zhou.get(url('plan', '/sections/nope')).expect(404);
    // 图的缩略图单独加载；表格、段落的位置不是图
    await zhou.get(url('plan', '/sections/ch1.2/figures/1')).expect(404);
    await zhou.get(url('plan', '/sections/ch1.2/figures/0')).expect(404);
    await zhou.get(url('plan', '/sections/ch1.2/figures/x')).expect(400);
  });

  it('锁定的图：节内容只带缩略图地址，缩略图是长边 480 的 JPEG', async () => {
    const zhou = await as('zhou@test.cn');
    const section = (await zhou.get(url('plan', '/sections/ch2')).expect(200)).body;
    expect(JSON.stringify(section)).not.toContain('base64');
    expect(section.locked).toEqual([{ index: 1, kind: 'figure', src: expect.stringContaining('/sections/ch2/figures/1') }]);
    const img = await zhou.get(url('plan', '/sections/ch2/figures/1')).expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    // 有这一节、但这个位置是段落不是图
    await zhou.get(url('plan', '/sections/ch2/figures/0')).expect(404);
  });

  it('保存一节：记修订说明，刷新后还在，下载的 Word 用修订后的内容', async () => {
    const zhou = await as('zhou@test.cn');
    const body = save([{ type: 'paragraph', text: ['应急办公室联系人：李某，电话 13800002601。'] }, lockedTable], 0);
    const saved = (await zhou.put(url('plan', '/sections/ch1.2')).send(body).expect(200)).body;
    expect(saved).toMatchObject({ rev: 1, version: 1, saved: { note: '按名册更正联系人', byName: '周工' } });
    // 锁定块的名称按原文重新给，不信页面传来的
    expect(saved.blocks[1]).toEqual({ type: 'locked', index: 1, label: '表格：表 1 应急通讯录' });

    const again = (await zhou.get(url('plan', '/sections/ch1.2')).expect(200)).body;
    expect(again.blocks[0].text).toEqual(['应急办公室联系人：李某，电话 13800002601。']);
    const doc = (await zhou.get(url('plan', '/edit')).expect(200)).body;
    expect(doc.version).toBe(1);
    expect(doc.outline[0].children[1].edited).toBe(true);

    const word = await zhou.get(url('plan', '/word')).buffer(true).expect(200);
    expect(word.headers['content-type']).toContain('wordprocessingml');
    expect(word.headers['content-disposition']).toContain(encodeURIComponent('修订稿'));
    // 另两份不受影响
    expect((await zhou.get(url('risk', '/edit')).expect(200)).body.version).toBe(0);
  });

  it('同一次保存重试（结果不确定）不重复记修订，并能先查询', async () => {
    const zhou = await as('zhou@test.cn');
    const saveId = randomUUID();
    expect((await zhou.get(url('plan', `/saves/${saveId}`)).expect(200)).body).toEqual({ saved: false });
    const body = save([{ type: 'paragraph', text: ['新的编制目的。'] }], 0, '改写编制目的', saveId);
    await zhou.put(url('plan', '/sections/ch1.1')).send(body).expect(200);
    const retry = (await zhou.put(url('plan', '/sections/ch1.1')).send(body).expect(200)).body;
    expect(retry.rev).toBe(1);
    const query = (await zhou.get(url('plan', `/saves/${saveId}`)).expect(200)).body;
    expect(query).toMatchObject({ saved: true, section: { id: 'ch1.1', rev: 1 } });
    const rows = await handle.db.select().from(draftRevisions).where(eq(draftRevisions.saveId, saveId));
    expect(rows).toHaveLength(1);
  });

  it('查询和重试返回那一次保存的内容，不是这一节现在的样子；saveId 不能拿到另一节用', async () => {
    const zhou = await as('zhou@test.cn');
    const first = randomUUID();
    const body = save([{ type: 'paragraph', text: ['第一次的写法。'] }], 0, '第一次', first);
    await zhou.put(url('risk', '/sections/ch1.1')).send(body).expect(200);
    await zhou.put(url('risk', '/sections/ch1.1')).send(save([{ type: 'paragraph', text: ['第二次的写法。'] }], 1, '第二次')).expect(200);

    const query = (await zhou.get(url('risk', `/saves/${first}?batch=${batchId}`)).expect(200)).body;
    expect(query.section).toMatchObject({ rev: 1, version: 1, blocks: [{ type: 'paragraph', text: ['第一次的写法。'] }], saved: { note: '第一次', byName: '周工' } });
    const retry = (await zhou.put(url('risk', '/sections/ch1.1')).send(body).expect(200)).body;
    expect(retry).toMatchObject({ rev: 1, blocks: [{ text: ['第一次的写法。'] }] });

    const other = await zhou.put(url('risk', '/sections/ch1.2')).send(save([{ type: 'paragraph', text: ['别处'] }, lockedTable], 0, '别处', first)).expect(409);
    expect(other.body.reason).toBe('other_section');
  });

  it('打开页面以后重新生成过：保存和查询都拒绝，提示刷新', async () => {
    const zhou = await as('zhou@test.cn');
    const old = { ...save([{ type: 'paragraph', text: ['旧稿上的修改。'] }], 0), batchId: randomUUID() };
    const res = await zhou.put(url('resource', '/sections/ch1.1')).send(old).expect(409);
    expect(res.body).toMatchObject({ reason: 'regenerated', message: '草稿已重新生成，请刷新后再改' });
    const query = await zhou.get(url('resource', `/saves/${old.saveId}?batch=${old.batchId}`)).expect(409);
    expect(query.body.reason).toBe('regenerated');
    const [row] = await handle.db.select().from(draftEdits).where(eq(draftEdits.kind, 'resource'));
    expect(row).toBeUndefined();
  });

  it('两人同时改同一节：后保存的被拒绝，带回最新保存稿，不覆盖', async () => {
    const zhou = await as('zhou@test.cn');
    // 基于 rev 0 的旧页面再保存
    const res = await zhou
      .put(url('plan', '/sections/ch1.2'))
      .send(save([{ type: 'paragraph', text: ['另一个人的写法。'] }, lockedTable], 0))
      .expect(409);
    expect(res.body).toMatchObject({ reason: 'stale', latest: { rev: 1, saved: { byName: '周工' } } });
    expect(res.body.message).toMatch(/已被更新/);
    const now = (await zhou.get(url('plan', '/sections/ch1.2')).expect(200)).body;
    expect(now.blocks[0].text).toEqual(['应急办公室联系人：李某，电话 13800002601。']);
  });

  it('不能删表格、不能空着修订说明、没改不用保存', async () => {
    const zhou = await as('zhou@test.cn');
    const noTable = await zhou.put(url('plan', '/sections/ch1.2')).send(save([{ type: 'paragraph', text: ['只剩一段'] }], 1)).expect(400);
    expect(noTable.body.message).toMatch(/表格和图/);
    await zhou.put(url('plan', '/sections/ch1.1')).send(save([{ type: 'paragraph', text: ['再改'] }], 1, ' ')).expect(400);
    const same = await zhou.put(url('plan', '/sections/ch1.1')).send(save([{ type: 'paragraph', text: ['新的编制目的。'] }], 1)).expect(400);
    expect(same.body.message).toMatch(/没有修改/);
  });

  it('帮我改写这段：不发企业名称和人名，过检查后返回 AI 的写法', async () => {
    const zhou = await as('zhou@test.cn');
    const res = await zhou.post(url('plan', '/sections/ch1.1/rewrite')).send({ text: '原来的编制目的由陈志刚负责。' }).expect(201);
    expect(res.body).toMatchObject({ source: 'ai', text: '编制目的由陈志刚负责。', promptVersion: 'polish-v1' });
    expect(polished.at(-1)!.text).not.toContain('陈志刚');
    expect(polished.at(-1)!.section).toBe('1.1 编制目的');
  });

  it('采用了 AI 改写的修订记下提示词版本，没用的不记', async () => {
    const zhou = await as('zhou@test.cn');
    const withAi = { ...save([{ type: 'paragraph', text: ['编制目的由陈志刚负责。'] }], 1, '采用 AI 改写'), aiPromptVersion: 'polish-v1' };
    await zhou.put(url('plan', '/sections/ch1.1')).send(withAi).expect(200);
    const [ai] = await handle.db.select().from(draftRevisions).where(eq(draftRevisions.saveId, withAi.saveId));
    expect(ai!.aiPromptVersion).toBe('polish-v1');
    const plain = save([{ type: 'paragraph', text: ['编制目的由陈某负责。'] }], 2, '手改');
    await zhou.put(url('plan', '/sections/ch1.1')).send(plain).expect(200);
    const [manual] = await handle.db.select().from(draftRevisions).where(eq(draftRevisions.saveId, plain.saveId));
    expect(manual!.aiPromptVersion).toBeNull();
  });

  it('还没生成草稿：提示先生成', async () => {
    const zhou = await as('zhou@test.cn');
    const res = await zhou.get(`/api/tasks/${otherTaskId}/drafts/plan/edit`).expect(400);
    expect(res.body.message).toMatch(/还没有生成/);
  });
});

describe('正文编辑的权限', () => {
  const body = () => save([{ type: 'paragraph', text: ['越权'] }], 1);

  it('客户、别家客户、其他专家看不到也改不了', async () => {
    for (const email of ['feiyu@test.cn', 'other@test.cn', 'wu@test.cn']) {
      const agent = await as(email);
      await agent.get(url('plan', '/edit')).expect(404);
      await agent.get(url('plan', '/sections/ch1.1')).expect(404);
      await agent.get(url('plan', '/word')).expect(404);
      await agent.put(url('plan', '/sections/ch1.1')).send(body()).expect(404);
      await agent.post(url('plan', '/sections/ch1.1/rewrite')).send({ text: '一段需要改写的文字。' }).expect(404);
      await agent.get(url('plan', `/saves/${randomUUID()}`)).expect(404);
      // 真有这张图也一样 404（没有权限，不是「不是图」）
      await agent.get(url('plan', '/sections/ch2/figures/1')).expect(404);
    }
  });

  it('运营能看不能改', async () => {
    const ops = await as('ops@test.cn');
    expect((await ops.get(url('plan', '/edit')).expect(200)).body.editable).toBe(false);
    await ops.get(url('plan', '/sections/ch1.1')).expect(200);
    const img = await ops.get(url('plan', '/sections/ch2/figures/1')).expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    await ops.put(url('plan', '/sections/ch1.1')).send(body()).expect(403);
    await ops.post(url('plan', '/sections/ch1.1/rewrite')).send({ text: '一段需要改写的文字。' }).expect(403);
  });

  it('不认识的文档类型', async () => {
    const zhou = await as('zhou@test.cn');
    await zhou.get(url('contract', '/edit')).expect(404);
  });
});

describe('发给 AI 前遮掉的人名', () => {
  it('包括法定代表人、联系人和应急组织里的人，不包括小组名称', () => {
    const input = {
      basic: { companyName: '甲公司', legalRepresentative: '李文聪', contactPerson: '陈志刚', responsiblePerson: '李文聪' },
      organization: {
        commander: { id: 'c', name: '王总' },
        deputies: [{ id: 'd', name: '赵副' }],
        hasEmergencyOffice: true,
        groups: [{ kind: 'communication', name: '通讯联络组', leader: { id: 'l', name: '孙组长' }, members: [{ id: 'm', name: '钱成员' }] }],
        compilationTeam: { leader: { name: '周编' }, members: [{ name: '吴编' }] },
      },
    } as unknown as PlanInput;
    expect(peopleOf(input).sort()).toEqual(['吴编', '周编', '孙组长', '李文聪', '王总', '赵副', '钱成员', '陈志刚'].sort());
  });
});
