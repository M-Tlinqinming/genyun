import {
  type OperatorNote,
  REASSIGN_REASONS,
  assignExpertSchema,
  assignmentBlockedReason,
  type ExpertAvailability,
  type ExpertReviewStatus,
  isExpertPaused,
  isOperatorAssignableExpert,
  needsAssignment,
  operatorNoteSchema,
  operatorTaskStage,
} from '@genyun/shared';
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
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Request } from 'express';
import { AuditService, clientIp } from '../audit/audit.ts';
import { canAssignTasks } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  enterprises,
  expertProfiles,
  memberships,
  organizations,
  taskOperatorNotes,
  taskWorkups,
  tasks,
  users,
} from '../db/schema.ts';
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
  assignedAt: tasks.assignedAt,
};

type Row = { status: 'preparing' | 'submitted'; assignedExpertId: string | null; closedAt: Date | null };
const withStage = <T extends Row>(t: T) => ({
  ...t,
  stage: operatorTaskStage(t),
  needsAssignment: needsAssignment(t),
  assignBlockedReason: assignmentBlockedReason(t),
});

function selectTasks(db: Database) {
  return db
    .select(columns)
    .from(tasks)
    .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
    .innerJoin(organizations, eq(organizations.id, tasks.orgId))
    .leftJoin(expert, eq(expert.id, tasks.assignedExpertId));
}

// 能被分派的专家：耕云内部组织里有 expert 角色、没有停用的人。客户组织里就算有人挂了 expert 角色也不算。
// 名单和分派校验都用这一条，停用的账号两边都排除（第 8 项）
const assignableExpert = and(eq(memberships.role, 'expert'), eq(organizations.kind, 'internal'), isNull(users.disabledAt));

// 专家资料里判断能不能派的两项；没有资料行为 null（算接单中）
const availability = { reviewStatus: expertProfiles.reviewStatus, acceptingOrders: expertProfiles.acceptingOrders };
function profileOf(r: { reviewStatus: ExpertReviewStatus | null; acceptingOrders: boolean | null }): ExpertAvailability {
  return r.acceptingOrders === null ? null : { reviewStatus: r.reviewStatus, acceptingOrders: r.acceptingOrders };
}

// 运营任务中心（Paper 16 页 I04「待分派」「全部任务」、分配专家弹窗）。
// 只有运营能看和分派；客户、专家一律 403
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
    const rows = await this.select().where(isNull(tasks.deletedAt)).orderBy(desc(sql`coalesce(${tasks.submittedAt}, ${tasks.createdAt})`));
    return rows.map(withStage);
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const task = await this.load(id);
    // 专业整理随任务带给新专家（运营只看有没有开始，不看内容）
    const [workup] = await this.db
      .select({ updatedAt: taskWorkups.updatedAt })
      .from(taskWorkups)
      .where(eq(taskWorkups.taskId, id));
    return { ...task, workupStartedAt: workup?.updatedAt ?? null };
  }

  // 分配弹窗里的专家：在办任务数，以及正在处理这家客户的其他几家企业（同一客户交给同一人更顺）。
  // 暂停接单的照常列出、标 paused（弹窗里置灰）；待审核、未通过、已下架的不列
  @Get(':id/experts')
  async experts(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const task = await this.load(id);
    const rows = await this.db
      .selectDistinct({ id: users.id, name: users.name, email: users.email, ...availability })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .leftJoin(expertProfiles, eq(expertProfiles.userId, users.id))
      .where(assignableExpert)
      .orderBy(users.name);
    const people = rows
      .map(({ reviewStatus, acceptingOrders, ...p }) => ({ ...p, profile: profileOf({ reviewStatus, acceptingOrders }) }))
      // 审核状态不能派的不列；暂停的留着、置灰
      .filter((p) => isOperatorAssignableExpert(p.profile && { ...p.profile, acceptingOrders: true }));
    if (people.length === 0) return [];
    const open = await this.db
      .select({ expertId: tasks.assignedExpertId, orgId: tasks.orgId, enterpriseId: tasks.enterpriseId })
      .from(tasks)
      .where(and(inArray(tasks.assignedExpertId, people.map((p) => p.id)), isNull(tasks.closedAt), isNull(tasks.deletedAt)));
    // 接单中的在前、暂停的在后，各自仍按名字（sort 是稳定排序）
    const ordered = [...people].sort((a, b) => Number(isExpertPaused(a.profile)) - Number(isExpertPaused(b.profile)));
    return ordered.map((p) => {
      const mine = open.filter((t) => t.expertId === p.id);
      const sameOrg = new Set(
        mine.filter((t) => t.orgId === task.orgId && t.enterpriseId !== task.enterpriseId).map((t) => t.enterpriseId),
      );
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        openTasks: mine.length,
        sameOrgEnterprises: sameOrg.size,
        current: p.id === task.assignedExpertId,
        paused: isExpertPaused(p.profile),
      };
    });
  }

  // 分派或改派。专业整理挂在任务上，改派后自动归新专家；原专家从此打不开这个任务（404）
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
    if (expertId === task.assignedExpertId) throw new ConflictException(`${task.assignedExpertName ?? '这位专家'}已经是负责专家`);

    const [target] = await this.db
      .select({ id: users.id, name: users.name, ...availability })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .leftJoin(expertProfiles, eq(expertProfiles.userId, users.id))
      .where(and(eq(users.id, expertId), assignableExpert))
      .limit(1);
    if (!target) throw new BadRequestException('请选择专家');
    // 暂停接单、审核状态不能派的专家不派
    const unavailable = assignmentBlockedReason(task, { name: target.name, profile: profileOf(target) });
    if (unavailable) throw new ConflictException(unavailable);

    const what = `${task.enterpriseName} · ${task.name}`;
    const previous = task.assignedExpertId;
    const why = reason ? `改派理由：${REASSIGN_REASONS[reason]}` : null;
    const said = note ? `运营说明：${note}` : null;
    // 改任务和发提醒在同一个事务里：不会出现分派生效、提醒却没发的情况
    const updated = await this.db.transaction(async (tx) => {
      // 锁住接手人的账号行，和停用、改角色排队（两者也锁这一行），锁住后再按分派名单的条件查一遍：
      // 仍是耕云内部的专家、没有停用
      const [active] = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .where(and(eq(users.id, expertId), assignableExpert))
        .for('update', { of: users });
      if (!active) throw new BadRequestException(`${target.name}已停用或不再是专家，请选择其他专家`);
      // 锁住后再看一次接单状态：弹窗打开后专家刚暂停的，也不派
      const [profile] = await tx.select(availability).from(expertProfiles).where(eq(expertProfiles.userId, expertId));
      const stillBlocked = assignmentBlockedReason(task, { name: target.name, profile: profile ?? null });
      if (stillBlocked) throw new ConflictException(stillBlocked);
      // 只在负责专家仍是运营打开弹窗时看到的那位时才改，别人刚分派过就提示刷新
      const [row] = await tx
        .update(tasks)
        .set({ assignedExpertId: expertId, assignedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, id),
            isNull(tasks.deletedAt),
            currentExpertId === null ? isNull(tasks.assignedExpertId) : eq(tasks.assignedExpertId, currentExpertId),
          ),
        )
        .returning({ id: tasks.id });
      if (!row) {
        // 分派和客户删除撞在同一瞬间：和找不到任务一样；否则是别人刚分派过，提示刷新
        const [gone] = await tx.select({ deletedAt: tasks.deletedAt }).from(tasks).where(eq(tasks.id, id));
        if (!gone || gone.deletedAt) throw new NotFoundException(NOT_FOUND);
        return false;
      }
      // 运营说明放在正文第一句，铃铛里最多显示 3 行
      await this.notifications.notify(
        [expertId],
        {
          taskId: id,
          title: previous ? '改派给你的任务' : '分配给你的新任务',
          body: [said, `${what}（${task.number}，${task.orgName}）`, previous ? '已有的核对记录都在任务里。' : null]
            .filter(Boolean)
            .join(' '),
          link: `/expert/tasks/${id}`,
        },
        tx,
      );
      if (previous) {
        // 原专家点开会看到「这个任务已改派给 X」
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
        // 改派记在任务的运营记录里（任务详情里能看到谁、什么时候、为什么改派）
        await tx.insert(taskOperatorNotes).values({
          taskId: id,
          kind: 'reassign',
          body: [`${task.assignedExpertName ?? '原专家'} → ${target.name}`, reason ? REASSIGN_REASONS[reason] : null, note]
            .filter(Boolean)
            .join(' · '),
          createdBy: user.id,
        });
      }
      return true;
    });
    if (!updated) {
      const now = await this.load(id);
      throw new ConflictException(
        now.assignedExpertName ? `这个任务刚被分派给${now.assignedExpertName}，请看最新情况再决定` : '这个任务的负责专家刚有变化，请刷新后再试',
      );
    }
    // 操作日志：对象写任务编号和接手的专家；改派时带上原来的专家
    await this.audit.record({
      action: previous ? 'task_reassign' : 'task_assign',
      actorId: user.id,
      actorEmail: user.email,
      ip: clientIp(req),
      target: previous
        ? `${task.number} · ${task.assignedExpertName ?? '原专家'} → ${target.name}`
        : `${task.number} · ${target.name}`,
    });
    return withStage(await this.load(id));
  }

  // 运营在任务上的记录：内部备注、改派（以前的提醒专家记录照常显示），新的在前
  @Get(':id/notes')
  async notes(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string): Promise<OperatorNote[]> {
    this.guard(user);
    await this.load(id);
    const rows = await this.db
      .select({
        id: taskOperatorNotes.id,
        kind: taskOperatorNotes.kind,
        body: taskOperatorNotes.body,
        createdAt: taskOperatorNotes.createdAt,
        createdByName: users.name,
      })
      .from(taskOperatorNotes)
      .innerJoin(users, eq(users.id, taskOperatorNotes.createdBy))
      .where(eq(taskOperatorNotes.taskId, id))
      .orderBy(desc(taskOperatorNotes.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  // 写内部备注：只有运营看得到
  @Post(':id/notes')
  async addNote(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.guard(user);
    const parsed = operatorNoteSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请写备注内容');
    await this.load(id);
    await this.db.insert(taskOperatorNotes).values({ taskId: id, kind: parsed.data.kind, body: parsed.data.body, createdBy: user.id });
    return this.notes(user, id);
  }

  private guard(user: SessionUser) {
    if (!canAssignTasks(user)) throw new ForbiddenException('只有耕云运营可以分派任务');
  }

  private select() {
    return selectTasks(this.db);
  }

  private async load(id: string) {
    const [task] = await this.select().where(and(eq(tasks.id, id), ne(organizations.kind, 'internal'), isNull(tasks.deletedAt)));
    if (!task) throw new NotFoundException(NOT_FOUND);
    return withStage(task);
  }
}
