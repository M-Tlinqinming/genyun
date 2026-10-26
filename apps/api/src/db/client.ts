import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as schema from './schema.ts';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close(): Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * DATABASE_URL 以 postgres:// 开头时连真实 PostgreSQL（预览与正式环境）；
 * 否则用 PGlite（进程内的 PostgreSQL，本机开发与自动测试用）：
 * 'memory://' 为内存库，其他值视为本地目录。
 * 启动时自动执行数据库迁移。
 */
export async function openDatabase(url: string): Promise<DatabaseHandle> {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzleNodePg(pool, { schema });
    await migrateNodePg(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Database, close: () => pool.end() };
  }
  const dataDir = url === 'memory://' ? undefined : url;
  if (dataDir) mkdirSync(dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Database, close: () => client.close() };
}

export const DATABASE = Symbol('DATABASE');
