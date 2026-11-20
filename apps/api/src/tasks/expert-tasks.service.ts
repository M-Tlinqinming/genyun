import {
  type ExpertCenterData,
  type ExpertCenterRow,
  expertAcceptingSchema,
  expertCenterButton,
  expertCenterStats,
  expertCenterTime,
  isDeliveredThisMonth,
  isExpertCenterOpen,
  sortExpertCenter,
  taskView,
} from '@genyun/shared';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Injectable, Put, Req } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { AuditService, clientIp } from '../audit/audit.ts';
import { isExpert } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { enterprises, expertProfiles, organizations, tasks } from '../db/schema.ts';
import { loadTaskViewInputs } from './task-view-input.ts';

const FORBIDDEN = '任务中心只对专家开放';

// 专家任务中心（13 页 E1 / E1b）：分给自己的任务、四格统计、接单开关
@Injectable()
export class ExpertTasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(user: SessionUser, now = new Date()): Promise<ExpertCenterData> {
    if (!isExpert(user)) throw new ForbiddenException(FORBIDDEN);
    const [list, acceptingOrders] = await Promise.all([
      this.db
        .select({
          id: tasks.id,
          number: tasks.number,
          name: tasks.name,
          enterpriseName: enterprises.name,
          orgName: organizations.name,
        })
        .from(tasks)
        .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
        .innerJoin(organizations, eq(organizations.id, tasks.orgId))
        .where(and(eq(tasks.assignedExpertId, user.id), isNull(tasks.deletedAt))),
      this.acceptingOrders(user.id),
    ]);
    const facts = await loadTaskViewInputs(
      this.db,
      list.map((t) => t.id),
    );

    const rows = list.flatMap((t) => {
      const f = facts.get(t.id);
      if (!f) return [];
      // 还在准备资料、撤回了的，taskView 返回 null，不显示
      const view = taskView({ ...f, now, viewer: { side: 'expert', userId: user.id } });
      if (!view) return [];
      const centerFacts = {
        view,
        draft: f.draft,
        assignedAt: f.assignedAt,
        activityAt: f.activityAt,
        awaitingCustomerSince: f.awaitingCustomerSince,
        lastDelivery: f.lastDelivery,
      };
      const row: ExpertCenterRow = {
        ...t,
        view,
        button: expertCenterButton(centerFacts),
        time: expertCenterTime(centerFacts, now),
        isOpen: isExpertCenterOpen(view),
        deliveredThisMonth: isDeliveredThisMonth(centerFacts, now),
      };
      return [{ ...centerFacts, row }];
    });

    const sorted = sortExpertCenter(rows).map((r) => r.row);
    return { acceptingOrders, rows: sorted, stats: expertCenterStats(sorted) };
  }

  // 暂停 / 恢复接单：没有资料行就建一行（其他字段留空），有就只改接单状态。立即生效，手上的任务照常
  async setAccepting(user: SessionUser, body: unknown, ip: string | null): Promise<{ acceptingOrders: boolean }> {
    if (!isExpert(user)) throw new ForbiddenException(FORBIDDEN);
    const parsed = expertAcceptingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('接单状态不正确');
    const { acceptingOrders } = parsed.data;
    const [row] = await this.db
      .insert(expertProfiles)
      .values({ userId: user.id, acceptingOrders })
      .onConflictDoUpdate({ target: expertProfiles.userId, set: { acceptingOrders, updatedAt: new Date() } })
      .returning({ acceptingOrders: expertProfiles.acceptingOrders });
    await this.audit.record({
      action: acceptingOrders ? 'expert_resume' : 'expert_pause',
      actorId: user.id,
      actorEmail: user.email,
      ip,
      target: user.name,
    });
    return { acceptingOrders: row!.acceptingOrders };
  }

  private async acceptingOrders(userId: string): Promise<boolean> {
    const [profile] = await this.db
      .select({ acceptingOrders: expertProfiles.acceptingOrders })
      .from(expertProfiles)
      .where(eq(expertProfiles.userId, userId));
    // 没有资料行算接单中
    return profile?.acceptingOrders ?? true;
  }
}

@Controller('expert')
export class ExpertTasksController {
  constructor(@Inject(ExpertTasksService) private readonly service: ExpertTasksService) {}

  @Get('tasks')
  list(@CurrentUser() user: SessionUser) {
    return this.service.list(user);
  }

  @Put('accepting')
  setAccepting(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: Request) {
    return this.service.setAccepting(user, body, clientIp(req));
  }
}
