import {
  contactAnswerError,
  contactAnswerSchema,
  contactCreateError,
  contactCreateSchema,
  factDefOf,
  factSaveError,
  type ContactQuestion,
  type ContactRecord,
} from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { canEditOrganizationData } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { checklistItems, enterprises, files, memberships, taskContacts, tasks, users } from '../db/schema.ts';
import { DocumentsService } from '../documents/documents.service.ts';
import { NotificationsService } from '../notifications/notifications.service.ts';
import { TasksService } from './tasks.service.ts';
import { WorkupService } from './workup.service.ts';

const answerer = alias(users, 'answerer');

// 客户看到的补充请求：只有问题和自己的回答，不含专家电话记录与回填的值
export interface CustomerRequest {
  id: string;
  questions: Pick<ContactQuestion, 'id' | 'label' | 'question' | 'answer' | 'fileIds'>[];
  createdAt: Date;
  createdByName: string;
  answeredAt: Date | null;
  answeredByName: string | null;
  files: { id: string; name: string }[];
}

// 联系客户与联系记录（14 页 E18-00E）：负责专家发起，客户在任务里回答
@Injectable()
export class ContactsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WorkupService) private readonly workup: WorkupService,
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  // ---- 专家 ----

  // 联系记录（「处理记录」）：负责专家与运营可以看，客户看不到
  async list(user: SessionUser, taskId: string) {
    const task = await this.workup.task(user, taskId);
    return this.records(task.id);
  }

  async create(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.workup.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以联系客户');
    const parsed = contactCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const input = parsed.data;
    const error = contactCreateError(input);
    if (error) throw new BadRequestException(error);

    const snapshot = await this.workup.snapshotOf(task);
    const clarified = input.method === 'phone' && input.result === 'clarified';
    for (const q of input.questions) {
      if (!q.factKey) continue;
      const def = factDefOf(snapshot, q.factKey);
      const invalid = factSaveError(def, clarified ? (q.value ?? null) : null);
      if (invalid) throw new BadRequestException(`「${q.label}」：${invalid}`);
    }

    const questions: ContactQuestion[] = input.questions.map((q, i) => {
      const out: ContactQuestion = { id: `q${i + 1}`, label: q.label, question: q.question };
      if (q.factKey) out.factKey = q.factKey;
      if (q.itemKey) out.itemKey = q.itemKey;
      // 电话才记专家写下的回答；任务内补充等客户回答
      if (input.method === 'phone' && q.answer) out.answer = q.answer;
      if (clarified && q.value !== undefined) out.value = q.value;
      return out;
    });
    const [row] = await this.db
      .insert(taskContacts)
      .values({
        taskId: task.id,
        method: input.method,
        questions,
        target: input.method === 'phone' ? input.target : null,
        result: input.method === 'phone' ? input.result : null,
        createdBy: user.id,
      })
      .returning({ id: taskContacts.id });

    if (clarified) {
      const answers = questions.filter((q) => q.factKey && q.value !== undefined).map((q) => ({ key: q.factKey!, value: q.value! }));
      await this.workup.applyPhoneAnswers(user, task, row!.id, answers);
      // 客户请专家电话联系的资料项问清了：客户待补清单里变成「已补」，回答记作实际情况
      for (const q of questions.filter((x) => x.itemKey)) {
        await this.db
          .update(checklistItems)
          .set({ status: 'provided', note: q.answer ?? null, callRequested: false, updatedBy: user.id, updatedAt: new Date() })
          .where(and(eq(checklistItems.taskId, task.id), eq(checklistItems.itemKey, q.itemKey!)));
      }
    }
    if (input.method === 'request') {
      const [ent] = await this.db.select({ name: enterprises.name }).from(enterprises).where(eq(enterprises.id, task.enterpriseId));
      await this.notifications.notify(await this.customerUsers(task.orgId), {
        taskId: task.id,
        title: `${user.name}请您补充 ${questions.length} 项`,
        body: `${ent?.name ?? ''}：${questions.map((q) => q.label).join('、')}`,
        link: `/customer/tasks/${task.id}`,
      });
    }
    await this.db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    return this.records(task.id);
  }

  // ---- 客户 ----

  // 发给客户的补充请求（客户待补清单）
  async customerRequests(user: SessionUser, taskId: string): Promise<CustomerRequest[]> {
    const task = await this.tasks.load(user, taskId);
    if (!canEditOrganizationData(user, task.orgId)) throw new NotFoundException('找不到该任务');
    const records = (await this.records(task.id)).filter((r) => r.method === 'request');
    const fileIds = [...new Set(records.flatMap((r) => r.questions.flatMap((q) => q.fileIds ?? [])))];
    const names = fileIds.length
      ? await this.db.select({ id: files.id, name: files.originalName }).from(files).where(inArray(files.id, fileIds))
      : [];
    return records.map((r) => ({
      id: r.id,
      questions: r.questions.map(({ id, label, question, answer, fileIds }) => ({ id, label, question, answer, fileIds })),
      createdAt: new Date(r.createdAt),
      createdByName: r.createdByName,
      answeredAt: r.answeredAt ? new Date(r.answeredAt) : null,
      answeredByName: r.answeredByName,
      files: names.filter((n) => r.questions.some((q) => q.fileIds?.includes(n.id))),
    }));
  }

  async answer(user: SessionUser, taskId: string, contactId: string, body: unknown) {
    const task = await this.tasks.load(user, taskId);
    if (!canEditOrganizationData(user, task.orgId)) throw new NotFoundException('找不到该任务');
    const [contact] = await this.db
      .select()
      .from(taskContacts)
      .where(and(eq(taskContacts.id, contactId), eq(taskContacts.taskId, task.id), eq(taskContacts.method, 'request')))
      .limit(1);
    if (!contact) throw new NotFoundException('找不到这条补充请求');
    if (contact.answeredAt) throw new ConflictException('这条补充请求已经回答过了');
    const parsed = contactAnswerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const error = contactAnswerError(contact.questions, parsed.data);
    if (error) throw new BadRequestException(error);

    // 附的文件进企业资料库并关联到任务，专家在原件对照里能看到
    const fileIds = [...new Set(parsed.data.answers.flatMap((a) => a.fileIds))];
    for (const fileId of fileIds) await this.documents.addToTask(user, task.id, fileId);

    const questions = contact.questions.map((q) => {
      const a = parsed.data.answers.find((x) => x.questionId === q.id)!;
      const out: ContactQuestion = { ...q };
      if (a.text) out.answer = a.text;
      if (a.fileIds.length) out.fileIds = a.fileIds;
      return out;
    });
    const [saved] = await this.db
      .update(taskContacts)
      .set({ questions, answeredBy: user.id, answeredAt: new Date() })
      .where(and(eq(taskContacts.id, contact.id), eq(taskContacts.taskId, task.id)))
      .returning({ id: taskContacts.id });
    if (!saved) throw new NotFoundException('找不到这条补充请求');

    if (task.assignedExpertId) {
      await this.notifications.notify([task.assignedExpertId], {
        taskId: task.id,
        title: `${task.enterpriseName}回答了补充请求`,
        body: questions.map((q) => q.label).join('、'),
        link: `/expert/tasks/${task.id}`,
      });
    }
    await this.db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    return this.customerRequests(user, task.id);
  }

  // ---- 内部 ----

  async records(taskId: string): Promise<ContactRecord[]> {
    const rows = await this.db
      .select({
        id: taskContacts.id,
        method: taskContacts.method,
        questions: taskContacts.questions,
        target: taskContacts.target,
        result: taskContacts.result,
        createdAt: taskContacts.createdAt,
        createdByName: users.name,
        answeredAt: taskContacts.answeredAt,
        answeredByName: answerer.name,
      })
      .from(taskContacts)
      .innerJoin(users, eq(users.id, taskContacts.createdBy))
      .leftJoin(answerer, eq(answerer.id, taskContacts.answeredBy))
      .where(eq(taskContacts.taskId, taskId))
      .orderBy(asc(taskContacts.createdAt));
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      answeredAt: r.answeredAt?.toISOString() ?? null,
    }));
  }

  private async customerUsers(orgId: string) {
    const rows = await this.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), inArray(memberships.role, ['customer_admin', 'customer_member'])));
    return rows.map((r) => r.userId);
  }
}

@Controller('tasks/:id')
export class ContactsController {
  constructor(@Inject(ContactsService) private readonly service: ContactsService) {}

  @Get('contacts')
  list(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.list(user, id);
  }

  @Post('contacts')
  create(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.create(user, id, body);
  }

  @Get('requests')
  requests(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.customerRequests(user, id);
  }

  @Post('requests/:contactId/answer')
  answer(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() body: unknown,
  ) {
    return this.service.answer(user, id, contactId, body);
  }
}
