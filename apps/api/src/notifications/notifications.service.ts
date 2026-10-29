import { BadRequestException, Body, Controller, Get, Inject, Injectable, Post } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { notifications } from '../db/schema.ts';

const RECENT = 20;

export interface NotificationInput {
  taskId?: string;
  title: string;
  body: string;
  link: string;
}

const readSchema = z.object({ ids: z.array(z.uuid()).max(100).optional() });

// 站内提醒（顶栏铃铛）：补充请求、客户回答等业务提醒只在站内，不发邮件、短信（2026-10-28 Martin 确认）
@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async notify(userIds: readonly string[], input: NotificationInput) {
    if (userIds.length === 0) return;
    await this.db.insert(notifications).values(userIds.map((userId) => ({ userId, ...input })));
  }

  async list(user: SessionUser) {
    const items = await this.db
      .select({
        id: notifications.id,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(RECENT);
    const [unread] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { items, unread: unread?.n ?? 0 };
  }

  // 不传 ids = 全部标为已读
  async markRead(user: SessionUser, body: unknown) {
    const parsed = readSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('提醒编号不正确');
    const { ids } = parsed.data;
    const mine = and(eq(notifications.userId, user.id), isNull(notifications.readAt));
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(ids ? and(mine, inArray(notifications.id, ids)) : mine);
    return this.list(user);
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.service.list(user);
  }

  @Post('read')
  markRead(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.service.markRead(user, body);
  }
}
