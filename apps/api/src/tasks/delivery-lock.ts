// 交付锁：任务交付以后（以及正在交付时）只读，正文不能改、不能核对、不能写审核结论，资料核对和生成初稿也不能改。
// 要修改，专家在已交付页点「重新打开」：tasks.reopened_at 晚于最近一次成功交付，任务就又可以改，
// 改完重新核对、写结论后再次交付，形成新的交付版本。锁按任务算，不按批次算
import { PUBLISH_STALE_MS } from '@genyun/shared';
import { ConflictException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { deliveries, tasks } from '../db/schema.ts';

export interface BatchLock {
  status: 'publishing' | 'done';
  version: number;
  publishedAt: string | null;
}

/**
 * 任务现在锁没锁：有没过期的「正在交付」是 publishing；最近一次成功交付之后没重新打开过是 done；
 * 从没交付过，或者交付后已经重新打开，返回 null（可以改）
 */
export async function taskLock(db: Pick<Database, 'select'>, taskId: string): Promise<BatchLock | null> {
  const [publishing] = await db
    .select({ version: deliveries.version, updatedAt: deliveries.updatedAt })
    .from(deliveries)
    .where(and(eq(deliveries.taskId, taskId), eq(deliveries.status, 'publishing')))
    .limit(1);
  // 交付中断（服务重启）太久的不算
  if (publishing && Date.now() - publishing.updatedAt.getTime() <= PUBLISH_STALE_MS) {
    return { status: 'publishing', version: publishing.version, publishedAt: null };
  }
  const [last] = await db
    .select({ version: deliveries.version, publishedAt: deliveries.publishedAt })
    .from(deliveries)
    .where(and(eq(deliveries.taskId, taskId), eq(deliveries.status, 'done')))
    .orderBy(desc(deliveries.version))
    .limit(1);
  if (!last) return null;
  const [task] = await db.select({ reopenedAt: tasks.reopenedAt }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (task?.reopenedAt && last.publishedAt && task.reopenedAt > last.publishedAt) return null;
  return { status: 'done', version: last.version, publishedAt: last.publishedAt?.toISOString() ?? null };
}

export const DELIVERED_MESSAGE = '这个任务已交付。要修改，请先点「重新打开」';

export function lockedMessage(lock: BatchLock) {
  return lock.status === 'done' ? DELIVERED_MESSAGE : '这批文稿正在交付，请等交付完成';
}

export function throwIfLocked(lock: BatchLock | null) {
  if (lock) throw new ConflictException({ statusCode: 409, message: lockedMessage(lock), reason: 'published' });
}

// 这个任务正在交付（不论哪一批）：改企业事实会让审核结论作废，等交付完成后再改
export const PUBLISHING_MESSAGE = '这个任务正在交付三份 Word，请等交付完成后再修改';

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
