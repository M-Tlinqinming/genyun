import {
  type OperatorNote,
  CONTACT_WORKING_DAYS,
  REASSIGN_REASONS,
  assignExpertSchema,
  workingDaysBetween,
  assignmentBlockedReason,
  needsAssignment,
  operatorNoteSchema,
  operatorTaskStage,
  remindExpertSchema,
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
import { and, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Request } from 'express';
import { AuditService, clientIp } from '../audit/audit.ts';
import { canAssignTasks, canHandleOverdue } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  checklistItems,
  enterprises,
  memberships,
  organizations,
  taskContacts,
  taskOperatorNotes,
  taskWorkups,
  tasks,
  users,
} from '../db/schema.ts';
import { NotificationsService, REASSIGNED_TITLE } from '../notifications/notifications.service.ts';
import { pendingContactRequest } from './contact-request.ts';

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

// 超时兜底的任务（运营任务中心页签、运营概览共用）：客户请电话联系后 2 个工作日还没联系上（按 reachedCustomer，未接通不算）
export async function listOverdueTasks(db: Database, now: Date = new Date()) {
  const open = await selectTasks(db)
    .where(and(eq(tasks.status, 'submitted'), isNull(tasks.closedAt), ne(organizations.kind, 'internal')))
    .orderBy(tasks.submittedAt);
  if (open.length === 0) return [];
  const ids = open.map((t) => t.id);
  const calls = await db
    .select({
      taskId: checklistItems.taskId,
      itemKey: checklistItems.itemKey,
      updatedAt: checklistItems.updatedAt,
      updatedByName: users.name,
      expertResult: checklistItems.expertResult,
    })
    .from(checklistItems)
    .innerJoin(users, eq(users.id, checklistItems.updatedBy))
    .where(and(inArray(checklistItems.taskId, ids), eq(checklistItems.callRequested, true)));
  const contacts = await db
    .select({
      taskId: taskContacts.taskId,
      method: taskContacts.method,
      result: taskContacts.result,
      createdAt: taskContacts.createdAt,
      createdByName: users.name,
    })
    .from(taskContacts)
    .innerJoin(users, eq(users.id, taskContacts.createdBy))
    .where(inArray(taskContacts.taskId, ids))
    .orderBy(desc(taskContacts.createdAt));
  return open.flatMap((t) => {
    // 还没分派的在「待分派」里处理，不进超时兜底
    if (!t.assignedExpertId) return [];
    // 和专家任务中心同一套：专家已判定过的项不再等电话
    const mine = calls.filter((c) => c.taskId === t.id && (c.expertResult === null || c.expertResult === 'pending'));
    const records = contacts.filter((c) => c.taskId === t.id);
    const request = pendingContactRequest(t, mine, records);
    if (!request || request.deadline.getTime() > now.getTime()) return [];
    const unreachable = records.filter((r) => r.method === 'phone' && r.result === 'unreachable' && r.createdAt >= request.requestedAt);
    return [
      {
        ...withStage(t),
        request,
        // 原因：没打过电话 / 打了没接通
        reason: unreachable.length > 0 ? `打过 ${unreachable.length} 次电话都没接通` : '还没有联系过客户',
        // 客户已等了几个工作日、过了期限几个工作日（0 = 今天刚超时）
        waitedDays: workingDaysBetween(request.requestedAt, now),
        overdueDays: workingDaysBetween(request.deadline, now),
        contacts: records.map(({ taskId: _, ...r }) => r),
      },
    ];
  });
}

function selectTasks(db: Database) {
  return db
    .select(columns)
    .from(tasks)
    .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
    .innerJoin(organizations, eq(organizations.id, tasks.orgId))
    .leftJoin(expert, eq(expert.id, tasks.assignedExpertId));
}

// 能被分派的注安师：耕云内部组织里有 expert 角色、没有停用的人。客户组织里就算有人挂了 expert 角色也不算。
// 名单和分派校验都用这一条，停用的账号两边都排除（第 8 项）
const assignableExpert = and(eq(memberships.role, 'expert'), eq(organizations.kind, 'internal'), isNull(users.disabledAt));

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

  // 超时兜底：客户请电话联系后 2 个工作日还没联系上（按 reachedCustomer，未接通不算）。写在 ':id' 前面，免得被当成任务编号
  @Get('overdue')
  async overdue(@CurrentUser() user: SessionUser) {
    this.overdueGuard(user);
    return listOverdueTasks(this.db);
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
      // 锁住接手人的账号行，和停用排队：刚被停用的注安师不会再分到任务（停用时也锁这一行）
      const [active] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, expertId), isNull(users.disabledAt)))
        .for('update');
      if (!active) throw new BadRequestException(`${target.name}的账号已停用，请选择其他注安师`);
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
        // 改派记在任务的运营记录里（超时兜底里能看到谁、什么时候、为什么改派）
        await tx.insert(taskOperatorNotes).values({
          taskId: id,
          kind: 'reassign',
          body: [`${task.assignedExpertName ?? '原注安师'} → ${target.name}`, reason ? REASSIGN_REASONS[reason] : null, note]
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

  // 运营在任务上的记录：内部备注、提醒注安师、改派（新的在前）
  @Get(':id/notes')
  async notes(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string): Promise<OperatorNote[]> {
    this.overdueGuard(user);
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

  // 写内部备注，或记下「我先打给客户安抚」已经打过：只有运营看得到
  @Post(':id/notes')
  async addNote(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.overdueGuard(user);
    const parsed = operatorNoteSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请写备注内容');
    await this.load(id);
    await this.db.insert(taskOperatorNotes).values({ taskId: id, kind: parsed.data.kind, body: parsed.data.body, createdBy: user.id });
    return this.notes(user, id);
  }

  // 提醒注安师：给负责注安师发站内提醒，同时记在任务上
  @Post(':id/remind')
  async remind(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    this.overdueGuard(user);
    const parsed = remindExpertSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '提醒内容不对');
    const task = await this.load(id);
    if (task.closedAt) throw new ConflictException('任务已结束，不用再提醒');
    if (!task.assignedExpertId) throw new ConflictException('这个任务还没有负责注安师，请先分派');
    const said = parsed.data.body || null;
    await this.db.transaction(async (tx) => {
      await this.notifications.notify(
        [task.assignedExpertId!],
        {
          taskId: id,
          title: '运营提醒：请尽快联系客户',
          body: [said ? `运营说明：${said}` : null, `${task.enterpriseName} · ${task.name}（${task.number}）：客户请您电话联系，已超过 ${CONTACT_WORKING_DAYS} 个工作日，请今天联系客户。`]
            .filter(Boolean)
            .join(' '),
          link: `/expert/tasks/${id}`,
        },
        tx,
      );
      await tx.insert(taskOperatorNotes).values({
        taskId: id,
        kind: 'remind_expert',
        body: [task.assignedExpertName, said].filter(Boolean).join(' · '),
        createdBy: user.id,
      });
    });
    return this.notes(user, id);
  }

  private guard(user: SessionUser) {
    if (!canAssignTasks(user)) throw new ForbiddenException('只有耕云运营可以分派任务');
  }

  private overdueGuard(user: SessionUser) {
    if (!canHandleOverdue(user)) throw new ForbiddenException('只有耕云运营可以处理超时任务');
  }

  private select() {
    return selectTasks(this.db);
  }

  private async load(id: string) {
    const [task] = await this.select().where(and(eq(tasks.id, id), ne(organizations.kind, 'internal')));
    if (!task) throw new NotFoundException(NOT_FOUND);
    return withStage(task);
  }
}
