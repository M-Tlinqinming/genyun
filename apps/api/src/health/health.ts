import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { mkdir, statfs } from 'node:fs/promises';
import type { Database } from '../db/client.ts';

// 健康检查（M4 第 5 项）：数据库、Redis、数据目录所在分区的剩余空间。
// 返回体只有总状态和各项状态，不带路径、版本号、错误原文。
// - 数据库连不上：down（HTTP 503，容器判为不健康）
// - Redis 连不上：down（草稿生成队列不能用）；没配 REDIS_URL（本机、测试用进程内队列）：off，不影响总状态
// - 剩余空间低于 10%：low → 总状态 degraded（HTTP 200，服务还能用，但该清理或扩容了）；量不出来：unknown，不影响总状态

export type CheckState = 'ok' | 'down' | 'off' | 'low' | 'unknown';
export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthReport {
  status: HealthStatus;
  checks: { database: CheckState; redis: CheckState; disk: CheckState };
}

export interface HealthProbes {
  database(): Promise<void>;
  // 没配 Redis 时为 null
  redis: (() => Promise<void>) | null;
  // 数据目录所在分区：剩余比例（0–1）
  diskFreeRatio(): Promise<number>;
}

export const HEALTH_PROBES = Symbol('HEALTH_PROBES');

// 每项检查最多等这么久，超时算失败；整个接口不会被一项卡住
export const CHECK_TIMEOUT_MS = 2000;
// 剩余空间低于这个比例算 degraded
export const DISK_LOW_RATIO = 0.1;

export function withTimeout<T>(p: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function runHealthChecks(probes: HealthProbes, timeoutMs = CHECK_TIMEOUT_MS): Promise<HealthReport> {
  const pass = (p: () => Promise<unknown>) =>
    withTimeout(p(), timeoutMs).then(
      () => 'ok' as const,
      () => 'down' as const,
    );
  const [database, redis, disk] = await Promise.all([
    pass(probes.database),
    probes.redis ? pass(probes.redis) : Promise.resolve('off' as const),
    withTimeout(probes.diskFreeRatio(), timeoutMs).then(
      (ratio): CheckState => (ratio < DISK_LOW_RATIO ? 'low' : 'ok'),
      (): CheckState => 'unknown',
    ),
  ]);
  const status: HealthStatus = database === 'down' || redis === 'down' ? 'down' : disk === 'low' ? 'degraded' : 'ok';
  return { status, checks: { database, redis, disk } };
}

export async function diskFreeRatio(dir: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const s = await statfs(dir);
  return s.blocks > 0 ? s.bavail / s.blocks : 1;
}

// 按环境变量组装：数据目录用上传文件目录（和数据库同一块盘）；Redis 用一条单独的短连接，不占用队列的连接
export function defaultProbes(db: Database, env: NodeJS.ProcessEnv = process.env): HealthProbes {
  const redisUrl = env.REDIS_URL?.trim();
  let redis: Redis | undefined;
  return {
    database: async () => {
      await db.execute(sql`select 1`);
    },
    redis: redisUrl
      ? async () => {
          redis ??= new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: CHECK_TIMEOUT_MS, enableOfflineQueue: false });
          if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
          await redis.ping();
        }
      : null,
    diskFreeRatio: () => diskFreeRatio(env.FILE_STORAGE_DIR ?? '.data/files'),
  };
}
