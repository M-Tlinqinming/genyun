// 反馈受理（M3 第 6 项，Paper 16 页「反馈受理」）。
// 客户（机构管理员、成员）从成果文档页「反馈文稿问题」或顶栏「意见反馈」提交意见，可附文件、关联任务和交付版本；
// 运营在反馈受理页受理、转给注安师、写回复并关闭，客户在站内提醒和「我的反馈」里看到处理状态与结果（不发邮件）。
// 与编制交付分开：这里不改任务状态、不触发重新生成、不改已交付版本。权限都在 access.ts
import {
  compareFeedback,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUSES,
  feedbackActionSchema,
  feedbackCreateSchema,
  feedbackTitle,
  type CustomerFeedback,
  type FeedbackCategory,
  type FeedbackStatus,
  type OperatorFeedback,
  type OperatorFeedbackView,
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
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Request } from 'express';
import { AuditService, clientIp } from '../audit/audit.ts';
import { canFeedbackOnTask, canHandleFeedback, canSubmitFeedback, feedbackScope } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { deliveries, enterprises, feedback, files, organizations, tasks, users } from '../db/schema.ts';
import { assertFilesUsable } from '../files/file-links.ts';
import { NotificationsService } from '../notifications/notifications.service.ts';

const NOT_FOUND = '找不到这条反馈';
const ORG_NOT_FOUND = '找不到该组织';
const TASK_NOT_FOUND = '找不到这个任务';

const creator = alias(users, 'feedback_creator');
const handler = alias(users, 'feedback_handler');
const forwardee = alias(users, 'feedback_forwardee');
const closer = alias(users, 'feedback_closer');
const expert = alias(users, 'feedback_task_expert');

type Row = Awaited<ReturnType<typeof selectRows>>[number];

function selectRows(db: Database) {
  return db
    .select({
      id: feedback.id,
      orgId: feedback.orgId,
      orgName: organizations.name,
      content: feedback.content,
      status: feedback.status,
      category: feedback.category,
      source: feedback.source,
      createdAt: feedback.createdAt,
      createdBy: feedback.createdBy,
      createdByName: creator.name,
      enterpriseName: enterprises.name,
      taskId: feedback.taskId,
      taskNumber: tasks.number,
      taskExpertId: tasks.assignedExpertId,
      taskExpertName: expert.name,
      deliveryVersion: feedback.deliveryVersion,
      fileIds: feedback.fileIds,
      acceptedAt: feedback.acceptedAt,
      reply: feedback.reply,
      internalNote: feedback.internalNote,
      handlerName: handler.name,
      forwardedToName: forwardee.name,
      forwardedAt: feedback.forwardedAt,
      closedByName: closer.name,
      closedAt: feedback.closedAt,
    })
    .from(feedback)
    .innerJoin(organizations, eq(organizations.id, feedback.orgId))
    .innerJoin(creator, eq(creator.id, feedback.createdBy))
    .leftJoin(enterprises, eq(enterprises.id, feedback.enterpriseId))
    .leftJoin(tasks, eq(tasks.id, feedback.taskId))
    .leftJoin(expert, eq(expert.id, tasks.assignedExpertId))
    .leftJoin(handler, eq(handler.id, feedback.handledBy))
    .leftJoin(forwardee, eq(forwardee.id, feedback.forwardedTo))
    .leftJoin(closer, eq(closer.id, feedback.closedBy));
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// 附件的文件名：一次查出来
async function fileNames(db: Database, rows: Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => r.fileIds))];
  if (ids.length === 0) return new Map();
  const found = await db.select({ id: files.id, name: files.originalName }).from(files).where(inArray(files.id, ids));
  return new Map(found.map((f) => [f.id, f.name]));
}

function toCustomer(r: Row, names: Map<string, string>): CustomerFeedback {
  return {
    id: r.id,
    title: feedbackTitle(r.content),
    content: r.content,
    status: r.status,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    createdByName: r.createdByName,
    enterpriseName: r.enterpriseName,
    taskId: r.taskId,
    taskNumber: r.taskNumber,
    deliveryVersion: r.deliveryVersion,
    files: r.fileIds.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
    acceptedAt: iso(r.acceptedAt),
    // 回复只在关闭后给客户看（处理中写的是草稿）
    reply: r.status === 'closed' ? r.reply : null,
    closedAt: iso(r.closedAt),
  };
}

function toOperator(r: Row, names: Map<string, string>): OperatorFeedback {
  return {
    ...toCustomer(r, names),
    orgId: r.orgId,
    orgName: r.orgName,
    category: r.category,
    reply: r.reply,
    internalNote: r.internalNote,
    handlerName: r.handlerName,
    taskExpertName: r.taskExpertName,
    forwardedToName: r.forwardedToName,
    forwardedAt: iso(r.forwardedAt),
    closedByName: r.closedByName,
  };
}

// 客户：提交反馈、看自己（机构管理员看本组织全部）的反馈
@Controller('orgs/:orgId/feedback')
export class FeedbackController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<CustomerFeedback[]> {
    const scope = feedbackScope(user, orgId);
    if (!scope) throw new NotFoundException(ORG_NOT_FOUND);
    const rows = await selectRows(this.db)
      .where(and(eq(feedback.orgId, orgId), scope === 'own' ? eq(feedback.createdBy, user.id) : undefined))
      .orderBy(desc(feedback.createdAt));
    const names = await fileNames(this.db, rows);
    return rows.map((r) => toCustomer(r, names));
  }

  @Post()
  async create(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: unknown): Promise<CustomerFeedback> {
    if (!canSubmitFeedback(user, orgId)) throw new NotFoundException(ORG_NOT_FOUND);
    const parsed = feedbackCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '反馈内容不对');
    const input = parsed.data;

    // 关联的任务：必须是本组织、自己能处理的企业的任务（成员只限分配给自己的企业）；不然当作不存在
    let enterpriseId: string | null = null;
    if (input.taskId) {
      const [task] = await this.db
        .select({ id: tasks.id, orgId: tasks.orgId, enterpriseId: tasks.enterpriseId })
        .from(tasks)
        .where(eq(tasks.id, input.taskId));
      if (!task || task.orgId !== orgId || !canFeedbackOnTask(user, task)) throw new NotFoundException(TASK_NOT_FOUND);
      enterpriseId = task.enterpriseId;
      if (input.deliveryVersion !== undefined) {
        const [d] = await this.db
          .select({ id: deliveries.id })
          .from(deliveries)
          .where(and(eq(deliveries.taskId, task.id), eq(deliveries.version, input.deliveryVersion), eq(deliveries.status, 'done')));
        if (!d) throw new NotFoundException('找不到这个交付版本');
      }
    }

    // 附件：本组织的文件；成员只能附自己上传的或挂在自己企业上的（不能借反馈看别家企业的文件）
    const fileIds = [...new Set(input.fileIds)];
    if (fileIds.length > 0) {
      const own = await this.db.select({ id: files.id }).from(files).where(and(inArray(files.id, fileIds), eq(files.orgId, orgId)));
      if (own.length !== fileIds.length) throw new NotFoundException('找不到该文件');
      await assertFilesUsable(this.db, user, orgId, fileIds);
    }

    const category: FeedbackCategory = input.source === 'delivery' ? 'content' : 'platform';
    const [created] = await this.db
      .insert(feedback)
      .values({
        orgId,
        enterpriseId,
        taskId: input.taskId ?? null,
        deliveryVersion: input.deliveryVersion ?? null,
        source: input.source,
        category,
        content: input.content,
        fileIds,
        createdBy: user.id,
      })
      .returning({ id: feedback.id });
    const [row] = await selectRows(this.db).where(eq(feedback.id, created!.id));
    return toCustomer(row!, await fileNames(this.db, [row!]));
  }
}

// 运营：反馈列表、受理、转给注安师、保存、回复并关闭
@Controller('operator/feedback')
export class OperatorFeedbackController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser): Promise<OperatorFeedbackView> {
    this.guard(user);
    const rows = await selectRows(this.db).orderBy(desc(feedback.createdAt));
    const names = await fileNames(this.db, rows);
    const items = rows.map((r) => toOperator(r, names)).sort(compareFeedback);
    const counts = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, items.filter((i) => i.status === s).length])) as Record<FeedbackStatus, number>;
    return { items, counts };
  }

  @Patch(':id')
  async act(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request): Promise<OperatorFeedback> {
    this.guard(user);
    const parsed = feedbackActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不对');
    const { action, category, reply, internalNote } = parsed.data;
    const [current] = await selectRows(this.db).where(eq(feedback.id, id));
    if (!current) throw new NotFoundException(NOT_FOUND);
    if (current.status === 'closed') throw new ConflictException('这条反馈已经关闭，请刷新后查看处理结果');

    const now = new Date();
    const nextCategory = category ?? current.category;
    if (action === 'forward') {
      if (nextCategory !== 'content') throw new BadRequestException('只有「成果内容」类的反馈可以转给注安师');
      if (!current.taskId || !current.taskExpertId) throw new BadRequestException('这条反馈没有关联已分派注安师的任务，不能转给注安师');
    }
    const firstAccept = current.status === 'new' && action !== 'save';
    const set = {
      category: nextCategory,
      ...(reply !== undefined && { reply: reply || null }),
      ...(internalNote !== undefined && { internalNote: internalNote || null }),
      updatedAt: now,
      ...(firstAccept && { status: 'processing' as const, handledBy: user.id, acceptedAt: now }),
      ...(action === 'forward' && { forwardedTo: current.taskExpertId, forwardedAt: now }),
      ...(action === 'close' && { status: 'closed' as const, closedBy: user.id, closedAt: now, ...(!current.acceptedAt && { handledBy: user.id, acceptedAt: now }) }),
    };

    const title = feedbackTitle(current.content);
    const customerLink = `/customer/feedback?id=${id}`;
    await this.db.transaction(async (tx) => {
      // 两位运营同时处理：已经被别人关闭的不再改
      const updated = await tx
        .update(feedback)
        .set(set)
        .where(and(eq(feedback.id, id), ne(feedback.status, 'closed')))
        .returning({ id: feedback.id });
      if (updated.length === 0) throw new ConflictException('这条反馈已经关闭，请刷新后查看处理结果');
      // 站内提醒提交人（不发邮件）：第一次受理时一条，关闭时一条（带回复）
      if (action === 'close') {
        await this.notifications.notify([current.createdBy], { title: '您的反馈已处理', body: `「${title}」：${reply}`, link: customerLink }, tx);
      } else if (firstAccept) {
        await this.notifications.notify(
          [current.createdBy],
          { title: '耕云已受理您的反馈', body: `「${title}」已由耕云运营受理，处理结果会在这里通知您。`, link: customerLink },
          tx,
        );
      }
      if (action === 'forward') {
        const note = internalNote ?? current.internalNote;
        await this.notifications.notify(
          [current.taskExpertId!],
          {
            taskId: current.taskId!,
            title: '客户反馈了成果内容',
            body: `${current.enterpriseName ?? ''} ${current.taskNumber ?? ''}${current.deliveryVersion ? ` 交付 V${current.deliveryVersion}` : ''}：「${current.content}」${note ? `运营说明：${note}` : ''}。是否另建修订任务由您决定，请与运营沟通；已交付版本保持不变。`,
            link: `/expert/tasks/${current.taskId}`,
          },
          tx,
        );
      }
    });

    const target = `${current.orgName} · ${title}`;
    const ip = clientIp(req);
    if (firstAccept && action !== 'close') await this.audit.record({ action: 'feedback_accept', actorId: user.id, actorEmail: user.email, ip, target });
    if (action === 'forward') {
      await this.audit.record({ action: 'feedback_forward', actorId: user.id, actorEmail: user.email, ip, target: `${target} → ${current.taskExpertName ?? '注安师'}` });
    }
    if (action === 'close') await this.audit.record({ action: 'feedback_close', actorId: user.id, actorEmail: user.email, ip, target: `${target}（${FEEDBACK_CATEGORY_LABELS[nextCategory]}）` });

    const [row] = await selectRows(this.db).where(eq(feedback.id, id));
    return toOperator(row!, await fileNames(this.db, [row!]));
  }

  private guard(user: SessionUser) {
    if (!canHandleFeedback(user)) throw new ForbiddenException('只有耕云运营可以受理反馈');
  }
}
