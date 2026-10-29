import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { memberships, organizations, users } from '../db/schema.ts';

const PASSWORD = 'correct horse battery staple';

let handle: DatabaseHandle;
let app: INestApplication;

beforeAll(async () => {
  handle = await openDatabase('memory://');
  const [org] = await handle.db.insert(organizations).values({ name: '耕云', kind: 'internal' }).returning();
  const [u] = await handle.db
    .insert(users)
    .values({ email: 'expert@test.cn', name: '周工', passwordHash: await hashPassword(PASSWORD) })
    .returning();
  await handle.db.insert(memberships).values({ userId: u!.id, orgId: org!.id, role: 'expert' });
  app = await createApp(handle.db, { loginLimitPerMinute: 1000 });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

async function login() {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/login').send({ email: 'expert@test.cn', password: PASSWORD }).expect(200);
  return agent;
}

describe('Word 预览方式小样', () => {
  it('未登录不能取样例', async () => {
    await request(app.getHttpServer()).get('/api/preview-trial/plan.docx').expect(401);
  });

  it('给出飞宇应急预案的 Word', async () => {
    const res = await (await login()).get('/api/preview-trial/plan.docx').responseType('blob').expect(200);
    expect(res.headers['content-type']).toContain('wordprocessingml');
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  }, 60_000);

  // 需要本机装了 LibreOffice（apps/api/.env 里的 SOFFICE_PATH）
  it.skipIf(!process.env.SOFFICE_PATH)('转成 PDF', async () => {
    const res = await (await login()).get('/api/preview-trial/plan.pdf').responseType('blob').expect(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(Number(res.headers['x-convert-ms'])).toBeGreaterThan(0);
  }, 180_000);
});
