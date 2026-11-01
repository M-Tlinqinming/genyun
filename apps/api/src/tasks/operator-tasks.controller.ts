import { REASSIGN_REASONS, assignExpertSchema, assignmentBlockedReason, needsAssignment, operatorTaskStage } from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Request } from 'express';
import { AuditService, clientIp } from '../audit/audit.ts';
import { canAssignTasks } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { enterprises, memberships, organizations, taskContacts, taskWorkups, tasks, users } from '../db/schema.ts';
import { NotificationsService, REASSIGNED_TITLE } from '../notifications/notifications.service.ts';

const NOT_FOUND = '找不到该任务';

const expert = alias(users, 'expert');

const columns = {
  id: tasks.id,
  number: tasks.number,
  name: tasks.name,
  businessType: tasks.businessType,
  orgId: tasks.orgId,
  orgName: organizations.name,
  orgRegion: organizations.region,
  enterpriseId: tasks.enterpriseId,
  enterpriseName: enterprises.name,
  status: tasks.status,
  createdAt: tasks.createdAt,
  submittedAt: tasks.submittedAt,
  closedAt: tasks.closedAt,
  assignedExpertId: tasks.assignedExpertId,
  assignedExpertName: expert.name,
};

type Row = { status: 'preparing' | 'submitted'; assignedExpertId: string | null; closedAt: Date | null };
const withStage = <T extends Row>(t: T) => ({
  ...t,
  stage: operatorTaskStage(t),
  needsAssignment: needsAssignment(t),
  assignBlockedReason: assignmentBlockedReason(t),
});

// 能被分派的注安师：耕云内部组织里有 expert 角色的人。客户组织里就算有人挂了 expert 角色也不算。
// 第 5 项加账号停用时，这里和分派校验要一起排除已停用的账号
const assignableExpert = and(eq(memberships.role, 'expert'), eq(organizations.kind, 'internal'));

// 运营任务中心（Paper 16 页 I04「待分派」「全部任务」、分配注安师弹窗）。
// 只有运营能看和分派；客户、注安师一律 403。超时兜底、上门工单在第 4 项
@Controller('operator/tasks')
export class OperatorTasksController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // 全部任务，新提交的在前；待分派由前端按 needsAssignment 筛出来（数量少，不分页）
  @Get()
  async list(@CurrentUser() user: SessionUser) {
    this.guard(user);
    const rows = await this.select().orderBy(desc(sql`coalesce(${tasks.submittedAt}, ${tasks.createdAt})`));
    return rows.map(withStage);
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const task = await this.load(id);
    // 改派时随任务带给新专家的内容（运营只看数量，不看内容）
    const [contacts] = await this.db.select({ n: count() }).from(taskContacts).where(eq(taskContacts.taskId, id));
    const [workup] = await this.db
      .select({ updatedAt: taskWorkups.updatedAt })
      .from(taskWorkups)
      .where(eq(taskWorkups.taskId, id));
    return { ...task, contactCount: contacts?.n ?? 0, workupStartedAt: workup?.updatedAt ?? null };
  }

  // 分配弹窗里的注安师：在办任务数，以及正在处理这家客户的其他几家企业（同一客户交给同一人更顺）
  @Get(':id/experts')
  async experts(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const task = await this.load(id);
    const people = await this.db
      .selectDistinct({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(assignableExpert)
      .orderBy(users.name);
    if (people.length === 0) return [];
    const open = await this.db
      .select({ expertId: tasks.assignedExpertId, orgId: tasks.orgId, enterpriseId: tasks.enterpriseId })
      .from(tasks)
      .where(and(inArray(tasks.assignedExpertId, people.map((p) => p.id)), isNull(tasks.closedAt)));
    return people.map((p) => {
      const mine = open.filter((t) => t.expertId === p.id);
      const sameOrg = new Set(
        mine.filter((t) => t.orgId === task.orgId && t.enterpriseId !== task.enterpriseId).map((t) => t.enterpriseId),
      );
      return { ...p, openTasks: mine.length, sameOrgEnterprises: sameOrg.size, current: p.id === task.assignedExpertId };
    });
  }

  // 分派或改派。专业整理、联系记录都挂在任务上，改派后自动归新注安师；原注安师从此打不开这个任务（404）
  @Post(':id/assign')
  async assign(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    this.guard(user);
    const parsed = assignExpertSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '分派信息不完整');
    const { expertId, currentExpertId, note, reason } = parsed.data;
    const task = await this.load(id);
    const blocked = assignmentBlockedReason(task);
    if (blocked) throw new ConflictException(blocked);
    if (expertId === task.assignedExpertId) throw new ConflictException(`${task.assignedExpertName ?? '这位注安师'}已经是负责注安师`);

    const [target] = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(users.id, expertId), assignableExpert))
      .limit(1);
    if (!target) throw new BadRequestException('请选择注安师');

    const what = `${task.enterpriseName} · ${task.name}`;
    const previous = task.assignedExpertId;
    const why = reason ? `改派理由：${REASSIGN_REASONS[reason]}` : null;
    const said = note ? `运营说明：${note}` : null;
    // 改任务和发提醒在同一个事务里：不会出现分派生效、提醒却没发的情况
    const updated = await this.db.transaction(async (tx) => {
      // 只在负责注安师仍是运营打开弹窗时看到的那位时才改，别人刚分派过就提示刷新
      const [row] = await tx
        .update(tasks)
        .set({ assignedExpertId: expertId, assignedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, id),
            currentExpertId === null ? isNull(tasks.assignedExpertId) : eq(tasks.assignedExpertId, currentExpertId),
          ),
        )
        .returning({ id: tasks.id });
      if (!row) return false;
      // 运营说明放在正文第一句，铃铛里最多显示 3 行
      await this.notifications.notify(
        [expertId],
        {
          taskId: id,
          title: previous ? '改派给你的任务' : '分配给你的新任务',
          body: [said, `${what}（${task.number}，${task.orgName}）`, previous ? '已有的专业整理和联系记录都在任务里。' : null]
            .filter(Boolean)
            .join(' '),
          link: `/expert/tasks/${id}`,
        },
        tx,
      );
      if (previous) {
        // 原注安师点开会看到「这个任务已改派给 X」
        await this.notifications.notify(
          [previous],
          {
            taskId: id,
            title: REASSIGNED_TITLE,
            body: [why, `${what}（${task.number}）已改派给${target.name}，你不用再处理。`].filter(Boolean).join(' '),
            link: `/expert/tasks/${id}`,
          },
          tx,
        );
      }
      return true;
    });
    if (!updated) {
      const now = await this.load(id);
      throw new ConflictException(
        now.assignedExpertName ? `这个任务刚被分派给${now.assignedExpertName}，请看最新情况再决定` : '这个任务的负责注安师刚有变化，请刷新后再试',
      );
    }
    // 操作日志：对象写任务编号和接手的注安师；改派时带上原来的注安师
    await this.audit.record({
      action: previous ? 'task_reassign' : 'task_assign',
      actorId: user.id,
      actorEmail: user.email,
      ip: clientIp(req),
      target: previous
        ? `${task.number} · ${task.assignedExpertName ?? '原注安师'} → ${target.name}`
        : `${task.number} · ${target.name}`,
    });
    return withStage(await this.load(id));
  }

  private guard(user: SessionUser) {
    if (!canAssignTasks(user)) throw new ForbiddenException('只有耕云运营可以分派任务');
  }

  private select() {
    return this.db
      .select(columns)
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
      .innerJoin(organizations, eq(organizations.id, tasks.orgId))
      .leftJoin(expert, eq(expert.id, tasks.assignedExpertId));
  }

  private async load(id: string) {
    const [task] = await this.select().where(and(eq(tasks.id, id), ne(organizations.kind, 'internal')));
    if (!task) throw new NotFoundException(NOT_FOUND);
    return withStage(task);
  }
}
