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
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { canEditOrganizationData, canViewOrganization, canViewTask } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { checklistItems, enterprises, organizations, taskNumberCounters, tasks, users } from '../db/schema.ts';

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

  async updateChecklistItem(user: SessionUser, id: string, key: string, input: ChecklistItemUpdate) {
    const task = await this.load(user, id);
    if (!canEditOrganizationData(user, task.orgId)) throw new ForbiddenException('资料状态由客户填写');
    if (!(CHECKLIST_ITEM_KEYS as readonly string[]).includes(key)) throw new NotFoundException('没有这一项资料');
    const itemKey = key as ChecklistItemKey;
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

  private async checklistResult(taskId: string) {
    const rows = await this.db.select().from(checklistItems).where(eq(checklistItems.taskId, taskId));
    const items: ChecklistState = {};
    for (const r of rows) {
      const state: ItemState = {
        status: r.status,
        // 文件关联在第 3 项（文件上传与存储）接入
        fileIds: [],
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
