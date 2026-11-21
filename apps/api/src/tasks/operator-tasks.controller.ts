import {
  type OperatorNote,
  REASSIGN_REASONS,
  assignExpertSchema,
  assignmentBlockedReason,
  type ExpertAvailability,
  type ExpertReviewStatus,
  isExpertPaused,
  isOperatorAssignableExpert,
  formatRegion,
  needsAssignment,
  operatorNoteSchema,
  operatorTaskGroup,
  regionPartsOf,
  sortOperatorTasks,
  taskView,
  type OperatorTaskGroup,
  type TaskViewTone,
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
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
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
  tasks,
  users,
} from '../db/schema.ts';
import { NotificationsService, REASSIGNED_TITLE } from '../notifications/notifications.service.ts';
import { loadTaskViewInputs, type TaskViewFacts } from './task-view-input.ts';

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
  orgRegionProvince: organizations.regionProvince,
  orgRegionCity: organizations.regionCity,
  orgRegionDistrict: organizations.regionDistrict,
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

type Row = { id: string; status: 'preparing' | 'submitted'; assignedExpertId: string | null; closedAt: Date | null };

/** 运营那一侧的状态（taskView），加上分组、排序用的几个时间和能不能改派 */
export interface OperatorTaskState {
  view: { key: string; label: string; tone: TaskViewTone; detail: string | null };
  group: OperatorTaskGroup;
  /** 待分配 = 提交时间，等客户补资料 = 列出缺项的时间，其余为空 */
  waitingSince: Date | null;
  activityAt: Date;
  /** 已交付的取最近一次交付时间 */
  deliveredAt: Date | null;
  /** 已分配、没交付、服务端也允许改派（和 assign 用同一个 assignmentBlockedReason） */
  canReassign: boolean;
  needsAssignment: boolean;
  assignBlockedReason: string | null;
}

/** 按 taskView（运营那一侧）算每个任务的状态；taskView 返回 null 的（已删除）不返回 */
export function operatorTaskState(t: Row, f: TaskViewFacts, now: Date): OperatorTaskState | null {
  const v = taskView({ ...f, now, viewer: { side: 'operator' } });
  if (!v) return null;
  const group = operatorTaskGroup(v.key, v.stage);
  const blocked = assignmentBlockedReason(t);
  return {
    view: { key: v.key, label: v.label, tone: v.tone, detail: v.detail },
    group,
    waitingSince: group === 'to_assign' ? f.submittedAt : group === 'awaiting' ? f.awaitingCustomerSince : null,
    activityAt: f.activityAt,
    deliveredAt: group === 'delivered' ? (f.lastDelivery?.at ?? null) : null,
    canReassign: !!t.assignedExpertId && group !== 'delivered' && !blocked,
    needsAssignment: needsAssignment(t),
    assignBlockedReason: blocked,
  };
}

/** 给一批任务算上运营那一侧的状态（任务中心、运营概览共用） */
export async function withOperatorTaskState<T extends Row>(db: Database, rows: T[], now: Date = new Date()): Promise<(T & OperatorTaskState)[]> {
  const facts = await loadTaskViewInputs(
    db,
    rows.map((r) => r.id),
  );
  return rows.flatMap((r) => {
    const f = facts.get(r.id);
    const state = f && operatorTaskState(r, f, now);
    return state ? [{ ...r, ...state }] : [];
  });
}

const regionFull = (t: {
  orgRegion: string | null;
  orgRegionProvince: string | null;
  orgRegionCity: string | null;
  orgRegionDistrict: string | null;
}) => {
  const parts = regionPartsOf({ regionProvince: t.orgRegionProvince, regionCity: t.orgRegionCity, regionDistrict: t.orgRegionDistrict });
  return parts ? formatRegion(parts, 'full') : t.orgRegion;
};

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

// 运营任务中心（Paper 16 页 I04 任务中心、I04b 抽屉、分配专家弹窗）。
// 只有运营能看和分派；客户、专家一律 403
@Controller('operator/tasks')
export class OperatorTasksController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // 全部任务（包括已交付），按运营任务中心的默认顺序：要运营动手的两组在前、等得最久的在前（数量少，不分页，前端再筛）
  @Get()
  async list(@CurrentUser() user: SessionUser) {
    this.guard(user);
    const rows = await this.select().where(and(ne(organizations.kind, 'internal'), isNull(tasks.deletedAt)));
    return sortOperatorTasks(await this.withState(rows));
  }

  // 抽屉：在列表那一行的基础上加地区全称、组织主联系人（完整手机号，页面上遮住中间四位）、缺项、有没有正文可看
  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const task = await this.load(id);
    const [org] = await this.db
      .select({ contactName: organizations.contactName, contactPhone: organizations.contactPhone })
      .from(organizations)
      .where(eq(organizations.id, task.orgId));
    const facts = (await loadTaskViewInputs(this.db, [id])).get(id);
    return {
      ...task,
      region: regionFull(task),
      contactName: org?.contactName ?? null,
      contactPhone: org?.contactPhone ?? null,
      awaitingCustomerSince: facts?.awaitingCustomerSince ?? null,
      awaitingCustomerItems: facts?.awaitingCustomerItems ?? null,
      // 运营查看正文页（/operator/tasks/<id>）打得开的条件：三份初稿生成完，或者已经交付过
      hasDraft: !!facts && (facts.draft === 'ready' || !!facts.lastDelivery),
    };
  }

  // 分配弹窗里的专家：头像、擅长的行业、在办任务数（分给他、还没交付、没删的；重新打开的算在办）。
  // 暂停接单的照常列出、标 paused（弹窗里置灰）；待审核、未通过、已下架的不列
  @Get(':id/experts')
  async experts(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    this.guard(user);
    const task = await this.load(id);
    const rows = await this.db
      .selectDistinct({
        id: users.id,
        name: users.name,
        email: users.email,
        avatar: expertProfiles.avatar,
        industries: expertProfiles.industries,
        ...availability,
      })
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
    // 在办按运营那一侧的状态算（不是已交付的）：交付时写的 closedAt 重新打开时不清，不能拿它判断
    const mine = await this.db
      .select({ id: tasks.id, status: tasks.status, assignedExpertId: tasks.assignedExpertId, closedAt: tasks.closedAt })
      .from(tasks)
      .where(and(inArray(tasks.assignedExpertId, people.map((p) => p.id)), isNull(tasks.deletedAt)));
    const states = await this.withState(mine);
    const open = new Map<string, number>();
    for (const t of states) {
      if (t.group === 'delivered' || !t.assignedExpertId) continue;
      open.set(t.assignedExpertId, (open.get(t.assignedExpertId) ?? 0) + 1);
    }
    // 接单中的在前、暂停的在后，各自仍按名字（sort 是稳定排序）
    const ordered = [...people].sort((a, b) => Number(isExpertPaused(a.profile)) - Number(isExpertPaused(b.profile)));
    return ordered.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      avatar: p.avatar ?? null,
      industries: p.industries ?? [],
      openTasks: open.get(p.id) ?? 0,
      current: p.id === task.assignedExpertId,
      paused: isExpertPaused(p.profile),
    }));
  }

  // 分配或改派。资料核对记录挂在任务上，改派后自动归新专家；原专家从此打不开这个任务（404）
  @Post(':id/assign')
  async assign(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    this.guard(user);
    const parsed = assignExpertSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '分配信息不完整');
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
        now.assignedExpertName ? `这个任务刚被分配给${now.assignedExpertName}，请看最新情况再决定` : '这个任务的负责专家刚有变化，请刷新后再试',
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
    return this.load(id);
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
    if (!canAssignTasks(user)) throw new ForbiddenException('只有耕云运营可以分配任务');
  }

  private select() {
    return selectTasks(this.db);
  }

  private withState<T extends Row>(rows: T[]) {
    return withOperatorTaskState(this.db, rows);
  }

  private async load(id: string) {
    const [task] = await this.select().where(and(eq(tasks.id, id), ne(organizations.kind, 'internal'), isNull(tasks.deletedAt)));
    const [withState] = task ? await this.withState([task]) : [];
    if (!withState) throw new NotFoundException(NOT_FOUND);
    return withState;
  }
}
