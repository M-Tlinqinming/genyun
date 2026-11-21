// 资料核对、生成初稿的写接口守卫：任务已交付（没重新打开）时这些写请求一律拦下，回 409 和
// 「这个任务已交付。要修改，请先点「重新打开」」；正在交付时也拦下。读请求不管。
// 看不了这个任务的账号放过，让接口自己回 404，不在这里透露任务状态
import { type CanActivate, ConflictException, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { canViewTaskWork } from '../auth/access.ts';
import type { Request } from 'express';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { tasks } from '../db/schema.ts';
import { DELIVERED_MESSAGE, taskLock, throwIfTaskPublishing } from './delivery-lock.ts';

type AuthedRequest = Request & { user?: SessionUser };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DeliveredWriteGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.method === 'GET' || req.method === 'HEAD') return true;
    const id = (req.params as Record<string, string | undefined>)?.id;
    if (!id || !UUID.test(id)) return true;
    const user = req.user;
    if (!user) return true;
    const [task] = await this.db
      .select({ id: tasks.id, assignedExpertId: tasks.assignedExpertId })
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task || !canViewTaskWork(user, task)) return true;
    const lock = await taskLock(this.db, task.id);
    if (lock?.status === 'done') {
      throw new ConflictException({ statusCode: 409, code: 'delivered', reason: 'delivered', message: DELIVERED_MESSAGE });
    }
    if (lock?.status === 'publishing') await throwIfTaskPublishing(this.db, task.id);
    return true;
  }
}
