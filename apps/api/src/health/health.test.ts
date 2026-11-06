import type { INestApplication } from '@nestjs/common';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase, type DatabaseHandle } from '../db/client.ts';
import { memberships, organizations, users } from '../db/schema.ts';
import { defaultProbes, diskFreeRatio, type HealthProbes, pingRedis, runHealthChecks } from './health.ts';

const ok = async () => {};
const fail = async () => {
  throw new Error('connect ECONNREFUSED 10.0.0.5:6379 /var/lib/secret');
};
const never = () => new Promise<void>(() => {});
const probes = (p: Partial<HealthProbes>): HealthProbes => ({ database: ok, redis: ok, diskFreeRatio: async () => 0.5, ...p });

describe('健康检查的判断', () => {
  it('都正常：ok', async () => {
    expect(await runHealthChecks(probes({}))).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok', disk: 'ok' } });
  });

  it('数据库连不上：down', async () => {
    expect(await runHealthChecks(probes({ database: fail }))).toMatchObject({ status: 'down', checks: { database: 'down' } });
  });

  it('Redis 连不上：down；没配 Redis：off，不影响总状态', async () => {
    expect(await runHealthChecks(probes({ redis: fail }))).toMatchObject({ status: 'down', checks: { redis: 'down' } });
    expect(await runHealthChecks(probes({ redis: null }))).toMatchObject({ status: 'ok', checks: { redis: 'off' } });
  });

  it('剩余空间低于 10%：degraded；正好 10% 不算', async () => {
    expect(await runHealthChecks(probes({ diskFreeRatio: async () => 0.09 }))).toMatchObject({ status: 'degraded', checks: { disk: 'low' } });
    expect(await runHealthChecks(probes({ diskFreeRatio: async () => 0.1 }))).toMatchObject({ status: 'ok', checks: { disk: 'ok' } });
  });

  it('量不出空间：unknown，不影响总状态', async () => {
    expect(await runHealthChecks(probes({ diskFreeRatio: () => Promise.reject(new Error('x')) }))).toMatchObject({
      status: 'ok',
      checks: { disk: 'unknown' },
    });
  });

  it('卡住的检查按超时算失败，不拖住整个接口', async () => {
    const started = Date.now();
    const report = await runHealthChecks(probes({ database: never, redis: never, diskFreeRatio: () => new Promise(() => {}) }), 50);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(report).toEqual({ status: 'down', checks: { database: 'down', redis: 'down', disk: 'unknown' } });
  });

  it('能量出本机临时目录所在分区的剩余比例', async () => {
    const ratio = await diskFreeRatio(tmpdir());
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });
});

describe('GET /api/health', () => {
  let handle: DatabaseHandle;
  const apps: INestApplication[] = [];

  const PASSWORD = 'correct horse battery staple';

  beforeAll(async () => {
    handle = await openDatabase('memory://');
    const passwordHash = await hashPassword(PASSWORD);
    const [customer, internal] = await handle.db
      .insert(organizations)
      .values([
        { name: '示例安全咨询机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2099-12-31', activatedAt: new Date() },
        { name: '耕云', kind: 'internal' },
      ])
      .returning();
    for (const p of [
      { email: 'admin@test.cn', orgId: customer!.id, role: 'customer_admin' as const },
      { email: 'zhou@test.cn', orgId: internal!.id, role: 'expert' as const },
      { email: 'ops@test.cn', orgId: internal!.id, role: 'operator' as const },
    ]) {
      const [u] = await handle.db.insert(users).values({ email: p.email, name: p.email, passwordHash }).returning();
      await handle.db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    }
  });
  afterAll(async () => {
    for (const a of apps) await a.close();
    await handle.close();
  });

  async function get(health?: HealthProbes) {
    const app = await createApp(handle.db, { health });
    await app.init();
    apps.push(app);
    return request(app.getHttpServer()).get('/api/health');
  }

  async function details(email: string | null, health?: HealthProbes) {
    const app = await createApp(handle.db, { health });
    await app.init();
    apps.push(app);
    const agent = request.agent(app.getHttpServer());
    if (email) expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    return agent.get('/api/health/details');
  }

  it('真实数据库，没配 Redis：200 ok，不用登录，不缓存', async () => {
    const res = await get(defaultProbes(handle.db, { FILE_STORAGE_DIR: tmpdir() }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('down 时 503；degraded 时 200', async () => {
    expect((await get(probes({ database: fail }))).status).toBe(503);
    const degraded = await get(probes({ diskFreeRatio: async () => 0.01 }));
    expect(degraded.status).toBe(200);
    expect(degraded.body.status).toBe('degraded');
  });

  it('不登录只返回总状态，不带各项、路径、地址、错误原文', async () => {
    const res = await get(probes({ redis: fail }));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'down' });
  });

  it('各项检查结果只给运营看：不登录 401，客户和专家 403', async () => {
    expect((await details(null)).status).toBe(401);
    expect((await details('admin@test.cn', probes({}))).status).toBe(403);
    expect((await details('zhou@test.cn', probes({}))).status).toBe(403);
  });

  it('运营看到各项，down 时也是 503；同样不带路径、地址、版本号、错误原文', async () => {
    const res = await details('ops@test.cn', probes({ redis: fail }));
    expect(res.status).toBe(503);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ status: 'down', checks: { database: 'ok', redis: 'down', disk: 'ok' } });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|6379|\/var|secret|version|\d+\.\d+\.\d+/);
  });

  it('Redis 地址连不上时按超时报 down，不卡住', async () => {
    const res = await details('ops@test.cn', defaultProbes(handle.db, { REDIS_URL: 'redis://127.0.0.1:1', FILE_STORAGE_DIR: tmpdir() }));
    expect(res.status).toBe(503);
    expect(res.body.checks).toMatchObject({ database: 'ok', redis: 'down' });
  });

  it('Redis 连不上：短连接查完就断开，不留下后台重连', async () => {
    const sockets = () => process.getActiveResourcesInfo().filter((r) => /TCP/.test(r)).length;
    const before = sockets();
    await expect(pingRedis('redis://127.0.0.1:1')).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 300));
    expect(sockets()).toBeLessThanOrEqual(before);
  });
});
