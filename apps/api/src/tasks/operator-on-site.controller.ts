import { onSiteUpdateSchema } from '@genyun/shared';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { canHandleOnSiteOrders } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { enterprises, onSiteRequests, organizations, tasks } from '../db/schema.ts';

// 上门工单（16 页 I04「上门工单」）：客户在任务里提交的上门需求。运营写内部备注、标记已转交公司、关闭；
// 报价、排期、现场交接全部线下。客户那边只显示「已收到上门需求」，看不到状态和内部备注
@Controller('operator/on-site')
export class OperatorOnSiteController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    this.guard(user);
    return this.select().orderBy(desc(onSiteRequests.createdAt));
  }

  // 改状态和 / 或内部备注，一次保存。转交、关闭记下时间；重新打开清空
  @Patch(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.guard(user);
    const parsed = onSiteUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不对');
    const { status, internalNote } = parsed.data;
    const now = new Date();
    const [current] = await this.db
      .select({ status: onSiteRequests.status, handedOverAt: onSiteRequests.handedOverAt })
      .from(onSiteRequests)
      .where(eq(onSiteRequests.id, id));
    if (!current) throw new NotFoundException('找不到这个上门工单');
    const times =
      status === undefined || status === current.status
        ? {}
        : status === 'new'
          ? { handedOverAt: null, closedAt: null }
          : status === 'handed_over'
            ? { handedOverAt: now, closedAt: null }
            : { closedAt: now };
    await this.db
      .update(onSiteRequests)
      .set({
        ...(status !== undefined && { status }),
        ...times,
        ...(internalNote !== undefined && { internalNote: internalNote || null }),
        updatedAt: now,
      })
      .where(eq(onSiteRequests.id, id));
    const [updated] = await this.select().where(eq(onSiteRequests.id, id));
    return updated!;
  }

  private guard(user: SessionUser) {
    if (!canHandleOnSiteOrders(user)) throw new ForbiddenException('只有耕云运营可以处理上门工单');
  }

  private select() {
    return this.db
      .select({
        id: onSiteRequests.id,
        orgId: onSiteRequests.orgId,
        orgName: organizations.name,
        enterpriseName: enterprises.name,
        taskId: onSiteRequests.taskId,
        taskNumber: tasks.number,
        taskName: tasks.name,
        contactName: onSiteRequests.contactName,
        contactPhone: onSiteRequests.contactPhone,
        callTime: onSiteRequests.callTime,
        helpItems: onSiteRequests.helpItems,
        note: onSiteRequests.note,
        status: onSiteRequests.status,
        internalNote: onSiteRequests.internalNote,
        handedOverAt: onSiteRequests.handedOverAt,
        closedAt: onSiteRequests.closedAt,
        createdAt: onSiteRequests.createdAt,
        updatedAt: onSiteRequests.updatedAt,
      })
      .from(onSiteRequests)
      .innerJoin(organizations, eq(organizations.id, onSiteRequests.orgId))
      .innerJoin(enterprises, eq(enterprises.id, onSiteRequests.enterpriseId))
      .leftJoin(tasks, eq(tasks.id, onSiteRequests.taskId));
  }
}
