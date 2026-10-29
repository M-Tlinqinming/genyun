import {
  type ChecklistItemKey,
  CONTACT_WORKING_DAYS,
  addWorkingDays,
  getItemDef,
  reachedCustomer,
} from '@genyun/shared';
import { Controller, ForbiddenException, Get, Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { isExpert } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { checklistItems, enterprises, organizations, taskContacts, tasks, users } from '../db/schema.ts';

export interface VerifyItem {
  key: ChecklistItemKey;
  label: string;
  kind: 'photo' | 'call';
}

// 客户请专家电话联系：从提交（或提交后才点的那一刻）起算 2 个工作日
export interface ContactRequest {
  requestedAt: Date;
  requestedBy: string;
  labels: string[];
  deadline: Date;
}

export interface ExpertEvent {
  at: Date;
  taskId: string;
  text: string;
  kind: 'submitted' | 'contact' | 'photo' | 'delivered';
}

const RECENT_EVENTS = 6;

// 专家任务中心（14 页 I04）：只列分派给自己的任务；运营的任务中心在 M3 另做
@Injectable()
export class ExpertTasksService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(user: SessionUser) {
    if (!isExpert(user)) throw new ForbiddenException('任务中心只对专业人员开放');
    const list = await this.db
      .select({
        id: tasks.id,
        number: tasks.number,
        name: tasks.name,
        orgId: tasks.orgId,
        orgName: organizations.name,
        enterpriseName: enterprises.name,
        status: tasks.status,
        startMethod: tasks.startMethod,
        updatedAt: tasks.updatedAt,
        submittedAt: tasks.submittedAt,
        closedAt: tasks.closedAt,
      })
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
      .innerJoin(organizations, eq(organizations.id, tasks.orgId))
      .where(eq(tasks.assignedExpertId, user.id))
      .orderBy(desc(tasks.updatedAt));
    if (list.length === 0) return { tasks: [], events: [] };

    const items = await this.db
      .select({
        taskId: checklistItems.taskId,
        itemKey: checklistItems.itemKey,
        status: checklistItems.status,
        callRequested: checklistItems.callRequested,
        expertResult: checklistItems.expertResult,
        updatedAt: checklistItems.updatedAt,
        updatedByName: users.name,
      })
      .from(checklistItems)
      .innerJoin(users, eq(users.id, checklistItems.updatedBy))
      .where(
        inArray(
          checklistItems.taskId,
          list.map((t) => t.id),
        ),
      );
    const contacts = await this.db
      .select({ taskId: taskContacts.taskId, method: taskContacts.method, result: taskContacts.result, createdAt: taskContacts.createdAt })
      .from(taskContacts)
      .where(
        inArray(
          taskContacts.taskId,
          list.map((t) => t.id),
        ),
      );
    // 等专家核实的项：拍照给耕云看、请专家电话联系，且专家还没判定
    const pending = items.filter(
      (i) =>
        (i.status === 'photo_for_expert' || i.callRequested) && (i.expertResult === null || i.expertResult === 'pending'),
    );

    const events: ExpertEvent[] = [];
    const rows = list.map((t) => {
      const mine = pending.filter((p) => p.taskId === t.id);
      const verifyItems: VerifyItem[] = mine.map((p) => ({
        key: p.itemKey as ChecklistItemKey,
        label: getItemDef(p.itemKey as ChecklistItemKey).label,
        kind: p.callRequested ? 'call' : 'photo',
      }));

      let contact: ContactRequest | null = null;
      const calls = mine.filter((p) => p.callRequested);
      // 提交以后才轮到专家打电话，期限从提交起算
      if (t.submittedAt !== null && t.closedAt === null && calls.length > 0) {
        const first = calls.reduce((a, b) => (a.updatedAt <= b.updatedAt ? a : b));
        const requestedAt = new Date(Math.max(first.updatedAt.getTime(), t.submittedAt.getTime()));
        const records = contacts.filter((c) => c.taskId === t.id).map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
        // 电话联系上客户以后不再进倒计时横幅（未接通不算）
        if (!reachedCustomer(records, requestedAt)) {
          contact = {
            requestedAt,
            requestedBy: first.updatedByName,
            labels: calls.map((p) => getItemDef(p.itemKey as ChecklistItemKey).label),
            deadline: addWorkingDays(requestedAt, CONTACT_WORKING_DAYS),
          };
        }
      }

      if (t.submittedAt) events.push({ at: t.submittedAt, taskId: t.id, kind: 'submitted', text: `${t.enterpriseName}提交生成申请` });
      if (contact) {
        events.push({ at: contact.requestedAt, taskId: t.id, kind: 'contact', text: `${t.enterpriseName}请专家电话联系` });
      }
      const photos = mine.filter((p) => !p.callRequested);
      if (t.submittedAt && photos.length > 0) {
        const at = new Date(Math.max(t.submittedAt.getTime(), ...photos.map((p) => p.updatedAt.getTime())));
        events.push({ at, taskId: t.id, kind: 'photo', text: `${t.enterpriseName}有 ${photos.length} 项拍照资料待核实` });
      }
      if (t.closedAt) events.push({ at: t.closedAt, taskId: t.id, kind: 'delivered', text: `${t.enterpriseName}三份成果已发布` });

      const times = [t.updatedAt, t.submittedAt, ...items.filter((i) => i.taskId === t.id).map((i) => i.updatedAt)].filter(
        (d): d is Date => d !== null,
      );
      return {
        ...t,
        verifyItems,
        contact,
        activityAt: new Date(Math.max(...times.map((d) => d.getTime()))),
      };
    });

    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { tasks: rows, events: events.slice(0, RECENT_EVENTS) };
  }
}

@Controller('expert')
export class ExpertTasksController {
  constructor(@Inject(ExpertTasksService) private readonly service: ExpertTasksService) {}

  @Get('tasks')
  list(@CurrentUser() user: SessionUser) {
    return this.service.list(user);
  }
}
