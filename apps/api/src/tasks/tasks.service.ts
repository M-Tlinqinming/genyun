import {
  type ChecklistItemKey,
  type ChecklistItemUpdate,
  type ChecklistState,
  type ItemState,
  type OnSiteRequestInput,
  type TaskCreateInput,
  type TaskUpdateInput,
  CHECKLIST_ITEM_KEYS,
  checkChecklist,
  chinaToday,
  formatTaskNumber,
  getItemDef,
  isContractActive,
  reviewOf,
  statusNotAllowedReason,
  supplementProgress,
} from '@genyun/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { canEditOrganizationData, canViewOrganization, canViewTask, isExpert } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { REASSIGNED_TITLE } from '../notifications/notifications.service.ts';
import {
  checklistItemFiles,
  checklistItems,
  deliveries,
  enterprises,
  factSupplements,
  files,
  notifications,
  onSiteRequests,
  organizations,
  taskNumberCounters,
  taskSubmissions,
  tasks,
  users,
} from '../db/schema.ts';

const NOT_FOUND = '找不到该任务';

const expert = alias(users, 'expert');

const taskColumns = {
  id: tasks.id,
  orgId: tasks.orgId,
  enterpriseId: tasks.enterpriseId,
  enterpriseName: enterprises.name,
  number: tasks.number,
  businessType: tasks.businessType,
  name: tasks.name,
  startMethod: tasks.startMethod,
  status: tasks.status,
  assignedExpertId: tasks.assignedExpertId,
  assignedExpertName: expert.name,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  submittedAt: tasks.submittedAt,
  closedAt: tasks.closedAt,
};

export type TaskView = Awaited<ReturnType<TasksService['load']>>;

@Injectable()
export class TasksService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private selectTasks() {
    return this.db
      .select(taskColumns)
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
      .leftJoin(expert, eq(expert.id, tasks.assignedExpertId));
  }

  // 工作台与业务任务列表（11 页 C01、C04）：每个任务附带进展——还缺的必需资料、提交后还没补的项、
  // 最近一次有人动过资料的时间
  async listForOrg(user: SessionUser, orgId: string) {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    const list = await this.selectTasks().where(eq(tasks.orgId, orgId)).orderBy(desc(tasks.createdAt));
    if (list.length === 0) return [];
    const ids = list.map((t) => t.id);
    const rows = await this.db.select().from(checklistItems).where(inArray(checklistItems.taskId, ids));
    const submissions = await this.db
      .select({ taskId: taskSubmissions.taskId, pendingKeys: taskSubmissions.pendingKeys })
      .from(taskSubmissions)
      .where(inArray(taskSubmissions.taskId, ids));
    // 专家发起、正在等客户回应的事实补件（工作台「待我处理」：去回应）
    const asks = await this.db
      .select({ taskId: factSupplements.taskId, title: factSupplements.title })
      .from(factSupplements)
      .where(and(inArray(factSupplements.taskId, ids), eq(factSupplements.status, 'awaiting_customer')));
    // 已形成的交付版本（业务任务「已交付」、工作台「最近交付」显示最新一版）
    const delivered = await this.db
      .select({ taskId: deliveries.taskId, version: deliveries.version, publishedAt: deliveries.publishedAt })
      .from(deliveries)
      .where(and(inArray(deliveries.taskId, ids), eq(deliveries.status, 'done')))
      .orderBy(desc(deliveries.version));

    return list.map((t) => {
      const mine = rows.filter((r) => r.taskId === t.id);
      const items: ChecklistState = {};
      for (const r of mine) {
        items[r.itemKey as ChecklistItemKey] = { status: r.status, fileIds: [], callRequested: r.callRequested };
      }
      const pending = submissions.find((s) => s.taskId === t.id)?.pendingKeys ?? [];
      const progress = supplementProgress(pending, items);
      const times = [t.updatedAt, t.submittedAt, ...mine.map((r) => r.updatedAt)].filter((d): d is Date => d !== null);
      return {
        ...t,
        missing: checkChecklist(items).blocking.map((b) => b.label),
        remaining: progress.total - progress.done,
        supplement: asks.find((a) => a.taskId === t.id)?.title ?? null,
        delivery: latestDelivery(delivered.filter((d) => d.taskId === t.id)),
        activityAt: new Date(Math.max(...times.map((d) => d.getTime()))),
      };
    });
  }

  // 无权访问与不存在返回同样的结果，不暴露别家任务是否存在
  async load(user: SessionUser, id: string) {
    const [found] = await this.selectTasks().where(eq(tasks.id, id)).limit(1);
    if (!found) throw new NotFoundException(NOT_FOUND);
    if (!canViewTask(user, found)) {
      // 原负责注安师打开旧链接：说明已改派给谁（他收到过这个任务的改派提醒才说，别人一律「找不到」）
      if (isExpert(user) && found.assignedExpertName && (await this.wasReassignedFrom(user, id))) {
        throw new NotFoundException(`这个任务已改派给${found.assignedExpertName}`);
      }
      throw new NotFoundException(NOT_FOUND);
    }
    return found;
  }

  private async wasReassignedFrom(user: SessionUser, taskId: string) {
    const [hit] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.taskId, taskId), eq(notifications.title, REASSIGNED_TITLE)))
      .limit(1);
    return hit !== undefined;
  }

  async create(user: SessionUser, enterpriseId: string, input: TaskCreateInput) {
    const [ent] = await this.db
      .select({
        orgId: enterprises.orgId,
        contractStartsAt: organizations.contractStartsAt,
        contractEndsAt: organizations.contractEndsAt,
      })
      .from(enterprises)
      .innerJoin(organizations, eq(organizations.id, enterprises.orgId))
      .where(eq(enterprises.id, enterpriseId))
      .limit(1);
    if (!ent || !canViewOrganization(user, ent.orgId)) throw new NotFoundException('找不到该企业');
    if (!canEditOrganizationData(user, ent.orgId)) throw new ForbiddenException('编制任务由客户自己创建');

    // 已有没结束的同类任务：带客户去继续那个任务（12 页 P02B）
    const existing = await this.findOpenTask(enterpriseId, input.businessType);
    if (existing) throw this.duplicate(existing);

    const today = chinaToday();
    if (!isContractActive(ent, today)) {
      throw new ForbiddenException('合同不在有效期内，不能新建任务，请联系耕云续约；已交付的成果仍可下载');
    }

    try {
      const id = await this.db.transaction(async (tx) => {
        const year = Number(today.slice(0, 4));
        const [counter] = await tx
          .insert(taskNumberCounters)
          .values({ year, last: 1 })
          .onConflictDoUpdate({ target: taskNumberCounters.year, set: { last: sql`${taskNumberCounters.last} + 1` } })
          .returning({ last: taskNumberCounters.last });
        const [created] = await tx
          .insert(tasks)
          .values({
            orgId: ent.orgId,
            enterpriseId,
            number: formatTaskNumber(year, counter!.last),
            businessType: input.businessType,
            name: input.name,
            createdBy: user.id,
          })
          .returning({ id: tasks.id });
        return created!.id;
      });
      return this.load(user, id);
    } catch (err) {
      // 两人同时创建：后到的一方同样带到已有任务
      if (isUniqueViolation(err, 'tasks_one_open_per_enterprise')) {
        const winner = await this.findOpenTask(enterpriseId, input.businessType);
        if (winner) throw this.duplicate(winner);
      }
      throw err;
    }
  }

  async update(user: SessionUser, id: string, input: TaskUpdateInput) {
    const task = await this.load(user, id);
    if (!canEditOrganizationData(user, task.orgId)) throw new ForbiddenException('只有客户可以修改任务信息');
    await this.db
      .update(tasks)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tasks.id, id));
    return this.load(user, id);
  }

  async checklist(user: SessionUser, id: string) {
    await this.load(user, id);
    return this.checklistResult(id);
  }

  // 客户修改资料项前的共同检查：能看到任务、是本组织客户、有这一项。
  // 提交以后只有待补清单里的项还能补，其余随提交锁定
  private async editableItem(user: SessionUser, id: string, key: string) {
    const task = await this.load(user, id);
    if (!canEditOrganizationData(user, task.orgId)) throw new ForbiddenException('资料由客户填写');
    if (!(CHECKLIST_ITEM_KEYS as readonly string[]).includes(key)) throw new NotFoundException('没有这一项资料');
    const itemKey = key as ChecklistItemKey;
    const submission = task.status === 'preparing' ? null : await this.submissionOf(id);
    if (submission && !submission.pendingKeys.includes(itemKey)) {
      throw new BadRequestException(`${getItemDef(itemKey).label}已随申请提交，需要更正请联系负责专家`);
    }
    return { task, itemKey, submission };
  }

  private async submissionOf(taskId: string) {
    const [row] = await this.db
      .select({ pendingKeys: taskSubmissions.pendingKeys, items: taskSubmissions.items })
      .from(taskSubmissions)
      .where(eq(taskSubmissions.taskId, taskId))
      .limit(1);
    return row ?? null;
  }

  async updateChecklistItem(user: SessionUser, id: string, key: string, input: ChecklistItemUpdate) {
    const { itemKey } = await this.editableItem(user, id, key);
    const reason = statusNotAllowedReason(itemKey, input.status, input.callRequested);
    if (reason) throw new BadRequestException(reason);

    // 「已提供」「没有」由当前账号确认；改为其他状态时清掉确认记录
    const now = new Date();
    const confirms = input.status === 'provided' || input.status === 'none';
    const values = {
      status: input.status,
      callRequested: input.callRequested,
      // 说明只跟「由我确认」走，改成别的状态时清掉
      note: input.status === 'provided' && input.note ? input.note : null,
      synced: false,
      confirmedBy: confirms ? user.id : null,
      confirmedAt: confirms ? now : null,
      // 拍照给耕云看：等专家判断
      expertResult: input.status === 'photo_for_expert' ? ('pending' as const) : null,
      expertJudgedBy: null,
      expertJudgedAt: null,
      updatedBy: user.id,
      updatedAt: now,
    };
    await this.db
      .insert(checklistItems)
      .values({ taskId: id, itemKey, ...values })
      .onConflictDoUpdate({ target: [checklistItems.taskId, checklistItems.itemKey], set: values });
    return this.checklistResult(id);
  }

  // 把本组织已上传的文件挂到资料项上。还没回答、稍后补或没有的项随之变为「已提供」；
  // 「拍照给耕云看」的照片也走这里，状态不变
  async linkFile(user: SessionUser, id: string, key: string, fileId: string) {
    const { task, itemKey } = await this.editableItem(user, id, key);
    const def = getItemDef(itemKey);
    if (def.requirement === 'system') throw new BadRequestException(`${def.label}由耕云生成，不需要上传`);
    const [file] = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.orgId, task.orgId), eq(files.kind, 'customer_material')))
      .limit(1);
    if (!file) throw new NotFoundException('找不到该文件');

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(checklistItemFiles).values({ taskId: id, itemKey, fileId, linkedBy: user.id }).onConflictDoNothing();
      const [item] = await tx
        .select({ status: checklistItems.status })
        .from(checklistItems)
        .where(and(eq(checklistItems.taskId, id), eq(checklistItems.itemKey, itemKey)))
        .limit(1);
      if (item?.status === 'provided' || item?.status === 'photo_for_expert') return;
      // 有文件作凭证，不需要再记确认人
      const values = {
        status: 'provided' as const,
        synced: false,
        confirmedBy: null,
        confirmedAt: null,
        callRequested: false,
        updatedBy: user.id,
        updatedAt: now,
      };
      await tx
        .insert(checklistItems)
        .values({ taskId: id, itemKey, ...values })
        .onConflictDoUpdate({ target: [checklistItems.taskId, checklistItems.itemKey], set: values });
    });
    return this.checklistResult(id);
  }

  // 移除关联不删除文件本身。最后一个文件移除后，靠文件作凭证的「已提供」恢复为未回答
  async unlinkFile(user: SessionUser, id: string, key: string, fileId: string) {
    const { itemKey, submission } = await this.editableItem(user, id, key);
    if (submission?.items[itemKey]?.fileIds.includes(fileId)) {
      throw new BadRequestException('这份文件已随申请提交，不能移除');
    }
    await this.db.transaction(async (tx) => {
      await tx
        .delete(checklistItemFiles)
        .where(
          and(
            eq(checklistItemFiles.taskId, id),
            eq(checklistItemFiles.itemKey, itemKey),
            eq(checklistItemFiles.fileId, fileId),
          ),
        );
      const [left] = await tx
        .select({ fileId: checklistItemFiles.fileId })
        .from(checklistItemFiles)
        .where(and(eq(checklistItemFiles.taskId, id), eq(checklistItemFiles.itemKey, itemKey)))
        .limit(1);
      if (left) return;
      await tx
        .delete(checklistItems)
        .where(
          and(
            eq(checklistItems.taskId, id),
            eq(checklistItems.itemKey, itemKey),
            eq(checklistItems.status, 'provided'),
            isNull(checklistItems.confirmedBy),
          ),
        );
    });
    return this.checklistResult(id);
  }

  // 企业自填第 5 步「核对」：前 4 步概括、还缺的必需资料、稍后补、交给专家判断的事项；
  // 另带预约上门弹窗的默认联系人、合同有效期和这个任务最近一次上门需求
  async review(user: SessionUser, id: string) {
    const task = await this.load(user, id);
    const [ent] = await this.db
      .select({
        profile: enterprises.profile,
        contractStartsAt: organizations.contractStartsAt,
        contractEndsAt: organizations.contractEndsAt,
      })
      .from(enterprises)
      .innerJoin(organizations, eq(organizations.id, enterprises.orgId))
      .where(eq(enterprises.id, task.enterpriseId))
      .limit(1);
    const profile = ent!.profile;
    const { items } = await this.checklistResult(id);
    const review = reviewOf({
      enterpriseName: task.enterpriseName,
      basicStep: profile.basicStep,
      organization: profile.organizationStep?.step,
      production: profile.productionStep?.step,
      resources: profile.resourcesStep?.step,
      checklist: items,
    });
    const basic = profile.basicStep?.basic ?? {};
    return {
      review,
      contact: { name: basic.contactPerson ?? user.name, phone: basic.contactPhone ?? '' },
      contract: { startsAt: ent!.contractStartsAt, endsAt: ent!.contractEndsAt },
      onSiteRequest: (await this.onSiteRequestsOf(id))[0] ?? null,
    };
  }

  // 预约耕云上门：只登记工单，运营在 M3 处理。同一任务可以多次预约（如补充新的需要）
  async requestOnSite(user: SessionUser, id: string, input: OnSiteRequestInput) {
    const task = await this.load(user, id);
    if (!canEditOrganizationData(user, task.orgId)) throw new ForbiddenException('上门需求由客户提交');
    await this.db.insert(onSiteRequests).values({
      orgId: task.orgId,
      enterpriseId: task.enterpriseId,
      taskId: id,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      callTime: input.callTime,
      helpItems: input.helpItems,
      note: input.note || null,
      createdBy: user.id,
    });
    return (await this.onSiteRequestsOf(id))[0]!;
  }

  // 客户看得到的字段（不含工单状态和运营内部备注：客户只看到「已收到上门需求」），新的在前
  private onSiteRequestsOf(taskId: string) {
    return this.db
      .select({
        id: onSiteRequests.id,
        contactName: onSiteRequests.contactName,
        contactPhone: onSiteRequests.contactPhone,
        callTime: onSiteRequests.callTime,
        helpItems: onSiteRequests.helpItems,
        note: onSiteRequests.note,
        createdAt: onSiteRequests.createdAt,
      })
      .from(onSiteRequests)
      .where(eq(onSiteRequests.taskId, taskId))
      .orderBy(desc(onSiteRequests.createdAt));
  }

  // 资料检查页（12 页 P05）：各项状态，加上挂的文件名、确认人姓名，页面按类别汇总
  async check(user: SessionUser, id: string) {
    await this.load(user, id);
    const { items } = await this.checklistResult(id);
    const fileIds = [...new Set(Object.values(items).flatMap((i) => i?.fileIds ?? []))];
    const userIds = [...new Set(Object.values(items).flatMap((i) => (i?.confirmedBy ? [i.confirmedBy] : [])))];
    const fileRows = fileIds.length
      ? await this.db.select({ id: files.id, name: files.originalName }).from(files).where(inArray(files.id, fileIds))
      : [];
    const userRows = userIds.length
      ? await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : [];
    return {
      items,
      fileNames: Object.fromEntries(fileRows.map((f) => [f.id, f.name])),
      userNames: Object.fromEntries(userRows.map((u) => [u.id, u.name])),
    };
  }

  async checklistResult(taskId: string) {
    const rows = await this.db.select().from(checklistItems).where(eq(checklistItems.taskId, taskId));
    const links = await this.db
      .select({ itemKey: checklistItemFiles.itemKey, fileId: checklistItemFiles.fileId })
      .from(checklistItemFiles)
      .where(eq(checklistItemFiles.taskId, taskId))
      .orderBy(asc(checklistItemFiles.linkedAt));
    const items: ChecklistState = {};
    for (const r of rows) {
      const state: ItemState = {
        status: r.status,
        fileIds: links.filter((l) => l.itemKey === r.itemKey).map((l) => l.fileId),
        callRequested: r.callRequested,
        note: r.note ?? undefined,
        confirmedBy: r.confirmedBy ?? undefined,
        confirmedAt: r.confirmedAt?.toISOString(),
      };
      if (r.expertResult) {
        state.expertJudgement = {
          result: r.expertResult,
          judgedBy: r.expertJudgedBy ?? undefined,
          judgedAt: r.expertJudgedAt?.toISOString(),
        };
      }
      items[r.itemKey as ChecklistItemKey] = state;
    }
    return { items, check: checkChecklist(items) };
  }

  private async findOpenTask(enterpriseId: string, businessType: TaskCreateInput['businessType']) {
    const [found] = await this.db
      .select({ id: tasks.id, number: tasks.number, name: tasks.name })
      .from(tasks)
      .where(and(eq(tasks.enterpriseId, enterpriseId), eq(tasks.businessType, businessType), isNull(tasks.closedAt)))
      .limit(1);
    return found;
  }

  private duplicate(existing: { id: string; number: string; name: string }) {
    return new ConflictException({
      statusCode: 409,
      message: `这家企业已有进行中的同类任务（${existing.number}），可以继续该任务`,
      existingTask: existing,
    });
  }
}

// 最新一个交付版本（版本号、发布时间）；还没交付为 null
function latestDelivery(rows: { version: number; publishedAt: Date | null }[]): { version: number; publishedAt: string } | null {
  const [last] = rows;
  return last?.publishedAt ? { version: last.version, publishedAt: last.publishedAt.toISOString() } : null;
}
