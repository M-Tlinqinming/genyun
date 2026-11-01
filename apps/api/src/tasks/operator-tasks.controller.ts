import { assignExpertSchema, assignmentBlockedReason, needsAssignment, operatorTaskStage } from '@genyun/shared';
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
} from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { canAssignTasks } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { enterprises, memberships, organizations, taskContacts, taskWorkups, tasks, users } from '../db/schema.ts';
import { NotificationsService } from '../notifications/notifications.service.ts';

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

// 运营任务中心（Paper 16 页 I04「待分派」「全部任务」、分配专业人员弹窗）。
// 只有运营能看和分派；客户、专业人员一律 403。超时兜底、上门工单在第 4 项
@Controller('operator/tasks')
export class OperatorTasksController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
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

  // 分配弹窗里的专业人员：在办任务数，以及正在处理这家客户的其他几家企业（同一客户交给同一人更顺）
  @Get(':id/experts')
  async experts(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const task = await this.load(id);
    const people = await this.db
      .selectDistinct({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(eq(memberships.role, 'expert'))
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

  // 分派或改派。专业整理、联系记录都挂在任务上，改派后自动归新专家；原专家从此看不到这个任务
  @Post(':id/assign')
  async assign(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.guard(user);
    const parsed = assignExpertSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '分派信息不完整');
    const { expertId, currentExpertId, note } = parsed.data;
    const task = await this.load(id);
    const blocked = assignmentBlockedReason(task);
    if (blocked) throw new ConflictException(blocked);
    if (expertId === task.assignedExpertId) throw new ConflictException(`${task.assignedExpertName ?? '这位专业人员'}已经是负责专家`);

    const [target] = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(users.id, expertId), eq(memberships.role, 'expert')))
      .limit(1);
    if (!target) throw new BadRequestException('请选择专业人员');

    // 只在负责专家仍是运营打开弹窗时看到的那位时才改，别人刚分派过就提示刷新
    const [updated] = await this.db
      .update(tasks)
      .set({ assignedExpertId: expertId, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, id),
          currentExpertId === null ? isNull(tasks.assignedExpertId) : eq(tasks.assignedExpertId, currentExpertId),
        ),
      )
      .returning({ id: tasks.id });
    if (!updated) {
      const now = await this.load(id);
      throw new ConflictException(
        now.assignedExpertName ? `这个任务刚被分派给${now.assignedExpertName}，请看最新情况再决定` : '这个任务的负责专家刚有变化，请刷新后再试',
      );
    }

    const what = `${task.enterpriseName} · ${task.name}`;
    const reassigned = task.assignedExpertId !== null;
    await this.notifications.notify([expertId], {
      taskId: id,
      title: reassigned ? '改派给你的任务' : '分配给你的新任务',
      body: [`${what}（${task.number}，${task.orgName}）`, reassigned ? '已有的专业整理和联系记录都在任务里。' : null, note ? `运营说明：${note}` : null]
        .filter(Boolean)
        .join(' '),
      link: `/expert/tasks/${id}`,
    });
    if (task.assignedExpertId) {
      // 原专家打不开这个任务了，提醒里不放任务链接
      await this.notifications.notify([task.assignedExpertId], {
        title: '任务已改派',
        body: `${what}（${task.number}）已改派给${target.name}，你不用再处理。`,
        link: '/expert',
      });
    }
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
