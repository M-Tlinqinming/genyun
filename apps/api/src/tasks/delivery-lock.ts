// 发布以后（以及正在发布时）这批文稿定下来了：正文不能再改、核对和审核结论不能再动。
// 要改就走新一轮（事实补件后重新生成，或第 14 项新旧稿对照），新一批草稿再发布是下一个交付版本
import { PUBLISH_STALE_MS, deliveryLabel } from '@genyun/shared';
import { ConflictException } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { deliveries } from '../db/schema.ts';

export interface BatchLock {
  status: 'publishing' | 'done';
  version: number;
  publishedAt: string | null;
}

export async function batchLock(db: Pick<Database, 'select'>, batchId: string): Promise<BatchLock | null> {
  const [row] = await db
    .select({ status: deliveries.status, version: deliveries.version, publishedAt: deliveries.publishedAt, updatedAt: deliveries.updatedAt })
    .from(deliveries)
    .where(and(eq(deliveries.batchId, batchId), ne(deliveries.status, 'failed')))
    .limit(1);
  if (!row) return null;
  // 发布中断（服务重启）太久的不算
  if (row.status === 'publishing' && Date.now() - row.updatedAt.getTime() > PUBLISH_STALE_MS) return null;
  return { status: row.status as BatchLock['status'], version: row.version, publishedAt: row.publishedAt?.toISOString() ?? null };
}

export function lockedMessage(lock: BatchLock) {
  return lock.status === 'done'
    ? `这批文稿已发布为${deliveryLabel(lock.version)}，不能再修改。需要更正请发起事实补件，重新生成后再发布`
    : '这批文稿正在发布，请等发布完成';
}

export function throwIfLocked(lock: BatchLock | null) {
  if (lock) throw new ConflictException({ statusCode: 409, message: lockedMessage(lock), reason: 'published' });
}

// 这个任务正在发布（不论哪一批）：采用补件会改企业事实、让审核结论作废，等发布完成后再采用
export const PUBLISHING_MESSAGE = '这个任务正在发布三份 Word，请等发布完成后再采用补件';

export async function throwIfTaskPublishing(db: Pick<Database, 'select'>, taskId: string) {
  const [row] = await db
    .select({ updatedAt: deliveries.updatedAt })
    .from(deliveries)
    .where(and(eq(deliveries.taskId, taskId), eq(deliveries.status, 'publishing')))
    .limit(1);
  if (row && Date.now() - row.updatedAt.getTime() <= PUBLISH_STALE_MS) {
    throw new ConflictException({ statusCode: 409, message: PUBLISHING_MESSAGE, reason: 'publishing' });
  }
}
