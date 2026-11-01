import { ON_SITE_STATUSES } from '@genyun/shared';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { canAssignTasks } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { enterprises, onSiteRequests, organizations, tasks } from '../db/schema.ts';

const updateSchema = z
  .object({
    status: z.enum(ON_SITE_STATUSES).optional(),
    internalNote: z.string().trim().max(500, '内部备注最多 500 个字').optional(),
  })
  .refine((v) => v.status !== undefined || v.internalNote !== undefined, '没有要改的内容');

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

  @Patch(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.guard(user);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不对');
    const { status, internalNote } = parsed.data;
    const [row] = await this.db
      .update(onSiteRequests)
      .set({
        ...(status !== undefined && { status }),
        ...(internalNote !== undefined && { internalNote: internalNote || null }),
        updatedAt: new Date(),
      })
      .where(eq(onSiteRequests.id, id))
      .returning({ id: onSiteRequests.id });
    if (!row) throw new NotFoundException('找不到这个上门工单');
    const [updated] = await this.select().where(eq(onSiteRequests.id, id));
    return updated!;
  }

  private guard(user: SessionUser) {
    if (!canAssignTasks(user)) throw new ForbiddenException('只有耕云运营可以处理上门工单');
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
        contactName: onSiteRequests.contactName,
        contactPhone: onSiteRequests.contactPhone,
        callTime: onSiteRequests.callTime,
        helpItems: onSiteRequests.helpItems,
        note: onSiteRequests.note,
        status: onSiteRequests.status,
        internalNote: onSiteRequests.internalNote,
        createdAt: onSiteRequests.createdAt,
        updatedAt: onSiteRequests.updatedAt,
      })
      .from(onSiteRequests)
      .innerJoin(organizations, eq(organizations.id, onSiteRequests.orgId))
      .innerJoin(enterprises, eq(enterprises.id, onSiteRequests.enterpriseId))
      .leftJoin(tasks, eq(tasks.id, onSiteRequests.taskId));
  }
}
