import {
  type ChecklistItemKey,
  type ChecklistItemUpdate,
  type ChecklistState,
  type ItemState,
  type TaskCreateInput,
  type TaskUpdateInput,
  CHECKLIST_ITEM_KEYS,
  checkChecklist,
  chinaToday,
  formatTaskNumber,
  getItemDef,
  isContractActive,
  statusNotAllowedReason,
} from '@genyun/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { canEditOrganizationData, canViewOrganization, canViewTask } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  checklistItemFiles,
  checklistItems,
  enterprises,
  files,
  organizations,
  taskNumberCounters,
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

  async listForOrg(user: SessionUser, orgId: string) {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    return this.selectTasks().where(eq(tasks.orgId, orgId)).orderBy(desc(tasks.createdAt));
  }

  // 无权访问与不存在返回同样的结果，不暴露别家任务是否存在
  async load(user: SessionUser, id: string) {
    const [found] = await this.selectTasks().where(eq(tasks.id, id)).limit(1);
    if (!found || !canViewTask(user, found)) throw new NotFoundException(NOT_FOUND);
    return found;
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

  // 客户修改资料项前的共同检查：能看到任务、是本组织客户、有这一项
  private async editableItem(user: SessionUser, id: string, key: string) {
    const task = await this.load(user, id);
    if (!canEditOrganizationData(user, task.orgId)) throw new ForbiddenException('资料由客户填写');
    if (!(CHECKLIST_ITEM_KEYS as readonly string[]).includes(key)) throw new NotFoundException('没有这一项资料');
    return { task, itemKey: key as ChecklistItemKey };
  }

  async updateChecklistItem(user: SessionUser, id: string, key: string, input: ChecklistItemUpdate) {
    const { itemKey } = await this.editableItem(user, id, key);
    const reason = statusNotAllowedReason(itemKey, input.status);
    if (reason) throw new BadRequestException(reason);

    // 「已提供」「没有」由当前账号确认；改为其他状态时清掉确认记录
    const now = new Date();
    const confirms = input.status === 'provided' || input.status === 'none';
    const values = {
      status: input.status,
      callRequested: input.callRequested,
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
    const { itemKey } = await this.editableItem(user, id, key);
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

  private async checklistResult(taskId: string) {
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
