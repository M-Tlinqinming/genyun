import { chinaToday, contractState } from '@genyun/shared';
import { BadRequestException, Body, Controller, Get, Inject, Injectable, Post } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { enterpriseAssignments, memberships, notifications, organizations } from '../db/schema.ts';

const RECENT = 20;

// 发给原注安师的改派提醒；原注安师再打开这个任务时，靠它说明「已改派给 X」
export const REASSIGNED_TITLE = '任务已改派';

export interface NotificationInput {
  taskId?: string;
  title: string;
  body: string;
  link: string;
  dedupeKey?: string;
}

// 某家企业的事要提醒哪些客户账号：本组织机构管理员，加上分配到这家企业的成员（M3 第 7 项）。
// 没分配到这家企业的成员看不到它，也不收它的提醒
export async function enterpriseCustomerIds(db: Pick<Database, 'select'>, task: { orgId: string; enterpriseId: string }): Promise<string[]> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .leftJoin(
      enterpriseAssignments,
      and(
        eq(enterpriseAssignments.userId, memberships.userId),
        eq(enterpriseAssignments.orgId, memberships.orgId),
        eq(enterpriseAssignments.enterpriseId, task.enterpriseId),
      ),
    )
    .where(
      and(
        eq(memberships.orgId, task.orgId),
        or(eq(memberships.role, 'customer_admin'), and(eq(memberships.role, 'customer_member'), eq(enterpriseAssignments.enterpriseId, task.enterpriseId))),
      ),
    );
  return rows.map((r) => r.userId);
}

// 发给机构管理员、和某个组织有关的通知（年度服务到期、邀请过期请重发）的去重键都以这个前缀开头，
// 成员被移出组织或降为成员时按前缀删掉
export function orgNoticePrefix(orgId: string): string {
  return `org:${orgId}:`;
}

// 年度服务到期前 30 天提醒机构管理员（M3 第 7 项）：只在站内，同一组织同一到期日只提醒一次
export function contractReminderKey(orgId: string, endsAt: string): string {
  return `${orgNoticePrefix(orgId)}contract-expiring:${endsAt}`;
}

// 邀请过期、对方请求重发：同一封邀请的同一次过期只提醒一次
export function inviteExpiredKey(orgId: string, invitationId: string, expiresAt: Date): string {
  return `${orgNoticePrefix(orgId)}invite-expired:${invitationId}:${expiresAt.toISOString()}`;
}

const readSchema = z.object({ ids: z.array(z.uuid()).max(100).optional() });

// 站内提醒（顶栏铃铛）：补充请求、客户回答等业务提醒只在站内，不发邮件、短信（2026-10-28 Martin 确认）
@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // 传 tx 时和调用方的改动在同一个事务里写
  async notify(userIds: readonly string[], input: NotificationInput, tx: Pick<Database, 'insert'> = this.db) {
    if (userIds.length === 0) return;
    await tx.insert(notifications).values(userIds.map((userId) => ({ userId, ...input })));
  }

  async list(user: SessionUser) {
    await this.remindContracts(user);
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

  // 打开铃铛（每分钟轮询）时顺带检查：自己是机构管理员的组织，年度服务 30 天内到期的补一条提醒。
  // 靠 (user_id, dedupe_key) 唯一索引去重，不会每次请求都发；续约后到期日变了会再提醒一次
  private async remindContracts(user: SessionUser) {
    const orgIds = user.memberships.filter((m) => m.role === 'customer_admin').map((m) => m.orgId);
    if (orgIds.length === 0) return;
    const orgs = await this.db
      .select({ id: organizations.id, name: organizations.name, contractStartsAt: organizations.contractStartsAt, contractEndsAt: organizations.contractEndsAt })
      .from(organizations)
      .where(inArray(organizations.id, orgIds));
    const today = chinaToday();
    for (const o of orgs) {
      const { state, daysLeft } = contractState(o, today);
      if (state !== 'expiring' || !o.contractEndsAt) continue;
      const date = o.contractEndsAt.replaceAll('-', '.');
      const left = daysLeft === 0 ? '今天到期' : `还有 ${daysLeft} 天`;
      await this.db
        .insert(notifications)
        .values({
          userId: user.id,
          title: '年度服务即将到期',
          body: `${o.name}的年度服务将于 ${date} 到期（${left}）。到期后不能新建任务，办理中的任务按约定完成，已交付的成果仍可查看和下载。请联系耕云续约。`,
          link: '/customer/organization?tab=service',
          dedupeKey: contractReminderKey(o.id, o.contractEndsAt),
        })
        .onConflictDoNothing();
    }
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
