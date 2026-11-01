// 成果发布（M2 第 15 项，15 页 R03、R04、R04a、R04b）：审核结论有效时，负责注安师发布三份当前稿。
// 发布时把三份 Word 定稿（文件属性写上「AI 辅助起草、注册安全工程师审核」和审核人）存成文件，形成交付版本
// （同一任务第一次 V1，以后 V2、V3），任务进入已交付，给客户发一条站内提醒。
// 防重复：页面每次发布带一个 publishId；同一个 publishId 重发只返回那一次的结果。结果不确定时页面先按 publishId 查，
// 查到没收到才重新发布。同一批文稿只能形成一个交付版本，同一任务同一时间只有一次发布在进行（数据库唯一索引兜底）
import {
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  PUBLISH_STALE_MS,
  deliveryLabel,
  publishRequestSchema,
  reviewValid,
  type DeliveryVersion,
  type DraftKind,
  type PublishAttempt,
  type PublishView,
  type ReviewView,
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
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Request } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService, clientIp } from '../audit/audit.ts';
import { canPublishTask, canViewTaskWork } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  deliveries,
  deliveryFiles,
  draftEdits,
  draftReviews,
  enterprises,
  files,
  generationBatches,
  memberships,
  tasks,
  users,
} from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { NotificationsService } from '../notifications/notifications.service.ts';
import { EditingService } from './editing.service.ts';
import { ReviewService } from './review.service.ts';

const NOT_FOUND = '找不到该任务';
const ONLY_EXPERT = '只有负责这个任务的注安师可以发布';
const FAILED = '三份 Word 没能全部存好，本次没有形成交付。三份保存稿与审核结论仍有效，可以重新发布';
const INTERRUPTED = '发布中断，本次没有形成交付。三份保存稿与审核结论仍有效，可以重新发布';
const CHANGED_WHILE_PUBLISHING = '发布期间有文稿又保存了修订，本次没有形成交付。请重新核对并确认审核结论后再发布';

const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Task = { id: string; orgId: string; assignedExpertId: string | null; number: string; enterpriseName: string; closedAt: Date | null };
type Batch = typeof generationBatches.$inferSelect;
type Delivery = typeof deliveries.$inferSelect;

@Injectable()
export class PublishService {
  private readonly logger = new Logger('PublishService');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(EditingService) private readonly editing: EditingService,
    @Inject(ReviewService) private readonly review: ReviewService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 发布页：能不能发布、这批文稿最近一次（或 publishId 那一次）发布的情况、已形成的交付版本 */
  async view(user: SessionUser, taskId: string, publishId?: string): Promise<PublishView> {
    const task = await this.task(user, taskId);
    if (publishId !== undefined && !isUuid(publishId)) throw new BadRequestException('发布编号不正确');
    await this.expireStale(task.id);
    return this.build(user, task, publishId);
  }

  async publish(user: SessionUser, taskId: string, body: unknown, ip: string | null = null): Promise<PublishView> {
    const task = await this.task(user, taskId);
    if (!canPublishTask(user, task)) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = publishRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('请刷新页面后再发布');
    const { publishId, batchId, versions } = parsed.data;

    // 同一次发布重发（超时、断网后再点）：只返回那一次的结果，不再发布
    const replayed = await this.replay(user, task, publishId);
    if (replayed) return replayed;

    await this.expireStale(task.id);
    const review = await this.review.view(user, task.id);
    const refuse = async (message: string, reason: string) => {
      throw new ConflictException({ statusCode: 409, message, reason, view: await this.build(user, task) });
    };
    if (review.batchId !== batchId) return refuse('草稿已重新生成，请刷新后按新的一批核对、审核再发布', 'regenerated');
    if (review.published) return refuse(`这批文稿已发布为${deliveryLabel(review.published.version)}，不用重复发布`, 'already_published');
    if (!reviewValid(review)) return refuse(blockerOf(review) ?? '审核结论已失效，请重新核对并确认审核结论后再发布', 'review_invalid');
    if (review.docs.some((d) => versions[d.kind] !== d.version)) {
      return refuse('有文稿在你打开发布页后又保存了修订，请重新核对并确认审核结论后再发布', 'stale');
    }
    const [conclusion] = await this.db.select().from(draftReviews).where(eq(draftReviews.batchId, batchId)).limit(1);
    const batch = (await this.db.select().from(generationBatches).where(eq(generationBatches.id, batchId)).limit(1))[0]!;

    // 先记下「正在发布」：同一任务另一次发布、同一批文稿再发布都会被唯一索引拦下
    let row: Delivery;
    try {
      [row] = (await this.db
        .insert(deliveries)
        .values({
          publishId,
          taskId: task.id,
          batchId,
          version: await this.nextVersion(task.id),
          status: 'publishing',
          reviewedBy: conclusion!.reviewedBy,
          reviewedAt: conclusion!.reviewedAt,
          versions: conclusion!.versions,
          publishedBy: user.id,
        })
        .returning()) as [Delivery];
    } catch (err) {
      // 同一个 publishId 两个请求同时到：后到的按已收到返回
      if (isUniqueViolation(err, 'deliveries_publish_id_unique')) {
        const replayedLate = await this.replay(user, task, publishId);
        if (replayedLate) return replayedLate;
      }
      if (isUniqueViolation(err, 'deliveries_one_publishing') || isUniqueViolation(err, 'deliveries_batch_once')) {
        return refuse('这批文稿正在发布或已经发布，请刷新查看发布结果', 'publishing');
      }
      throw err;
    }

    const published = await this.finish(row, task, batch, review.review!.byName);
    // 操作日志：只记形成了交付版本的发布；重发同一个 publishId 走上面的 replay，不会再记
    if (published) {
      await this.audit.record({
        action: 'publish',
        actorId: user.id,
        actorEmail: user.email,
        ip,
        target: `${task.number} · ${deliveryLabel(row.version)}`,
      });
    }
    return this.build(user, task, publishId);
  }

  // 这个 publishId 已经收到过：属于本任务就返回那一次的结果；属于别的任务（页面串了编号）就拒绝，不当成本任务的发布
  private async replay(user: SessionUser, task: Task, publishId: string): Promise<PublishView | null> {
    const [same] = await this.db.select({ taskId: deliveries.taskId }).from(deliveries).where(eq(deliveries.publishId, publishId)).limit(1);
    if (!same) return null;
    if (same.taskId !== task.id) {
      throw new ConflictException({ statusCode: 409, message: '这次发布的编号属于另一个任务，请刷新页面后重新发布', reason: 'other_task' });
    }
    return this.build(user, task, publishId);
  }

  // 出三份定稿、存文件，再在一个事务里核对修订次数没变、记为已交付、关闭任务、提醒客户。形成交付版本时返回 true
  private async finish(row: Delivery, task: Task, batch: Batch, reviewerName: string): Promise<boolean> {
    const fail = (error: string) =>
      this.db
        .update(deliveries)
        .set({ status: 'failed', error, updatedAt: new Date() })
        .where(and(eq(deliveries.id, row.id), eq(deliveries.status, 'publishing')));
    let stored: { kind: DraftKind; fileId: string }[];
    try {
      stored = [];
      for (const kind of DRAFT_KIND_KEYS) {
        const word = await this.editing.deliveryWord(batch, kind, { reviewerName, version: row.version });
        stored.push({ kind, fileId: await this.store(task, row.publishedBy, word.name, word.data) });
      }
    } catch (err) {
      this.logger.warn(`发布 ${task.number} 失败：${err instanceof Error ? err.message : String(err)}`);
      await fail(FAILED);
      return false;
    }
    let published = false;

    const changed = await this.db.transaction(async (tx) => {
      // 锁住三份的修订记录，和保存修订不交错；发布期间又保存过就不算
      const edits = await tx
        .select({ kind: draftEdits.kind, version: draftEdits.version })
        .from(draftEdits)
        .where(eq(draftEdits.batchId, batch.id))
        .for('update');
      if (DRAFT_KIND_KEYS.some((k) => (edits.find((e) => e.kind === k)?.version ?? 0) !== row.versions[k])) return true;
      const now = new Date();
      const done = await tx
        .update(deliveries)
        .set({ status: 'done', error: null, publishedAt: now, updatedAt: now })
        .where(and(eq(deliveries.id, row.id), eq(deliveries.status, 'publishing')))
        .returning({ id: deliveries.id });
      // 中途被当成中断（超过 5 分钟）改成失败了：不再形成交付
      if (done.length === 0) return false;
      await tx.insert(deliveryFiles).values(stored.map((s) => ({ deliveryId: row.id, ...s })));
      // 任务进入已交付（以后再发布 V2 时已经是已交付，只更新时间）
      await tx.update(tasks).set({ updatedAt: now }).where(eq(tasks.id, task.id));
      await tx.update(tasks).set({ closedAt: now }).where(and(eq(tasks.id, task.id), isNull(tasks.closedAt)));
      const customers = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.orgId, task.orgId), inArray(memberships.role, ['customer_admin', 'customer_member'])));
      // 只在站内提醒，不发邮件；不写注安师电话
      await this.notifications.notify(
        customers.map((c) => c.userId),
        {
          taskId: task.id,
          title: `${task.enterpriseName}的成果已交付`,
          body: `应急预案、风险评估报告、应急资源调查报告已发布（${deliveryLabel(row.version)}），可在任务里查看。`,
          link: `/customer/tasks/${task.id}`,
        },
        tx,
      );
      published = true;
      return false;
    }).catch(async (err: unknown) => {
      published = false;
      this.logger.warn(`发布 ${task.number} 记录交付失败：${err instanceof Error ? err.message : String(err)}`);
      await fail(FAILED);
      return false;
    });
    if (changed) await fail(CHANGED_WHILE_PUBLISHING);
    return published;
  }

  private async store(task: Task, by: string, originalName: string, data: Buffer) {
    const id = randomUUID();
    const storageKey = `${task.orgId}/${id}`;
    await this.storage.put(storageKey, data, WORD_TYPE);
    await this.db.insert(files).values({
      id,
      orgId: task.orgId,
      kind: 'delivery',
      originalName,
      contentType: WORD_TYPE,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      storageKey,
      uploadedBy: by,
    });
    return id;
  }

  // 发布中断（服务重启）超过 5 分钟还停在「正在发布」：按失败处理，可以重新发布
  private async expireStale(taskId: string) {
    await this.db
      .update(deliveries)
      .set({ status: 'failed', error: INTERRUPTED, updatedAt: new Date() })
      .where(and(eq(deliveries.taskId, taskId), eq(deliveries.status, 'publishing'), lt(deliveries.updatedAt, new Date(Date.now() - PUBLISH_STALE_MS))));
  }

  private async nextVersion(taskId: string) {
    const [last] = await this.db
      .select({ version: deliveries.version })
      .from(deliveries)
      .where(and(eq(deliveries.taskId, taskId), eq(deliveries.status, 'done')))
      .orderBy(desc(deliveries.version))
      .limit(1);
    return (last?.version ?? 0) + 1;
  }

  private async build(user: SessionUser, task: Task, publishId?: string): Promise<PublishView> {
    const review = await this.review.view(user, task.id);
    const [attemptRow] = await this.db
      .select({ d: deliveries, byName: users.name })
      .from(deliveries)
      .innerJoin(users, eq(users.id, deliveries.publishedBy))
      .where(publishId ? and(eq(deliveries.publishId, publishId), eq(deliveries.taskId, task.id)) : eq(deliveries.batchId, review.batchId))
      .orderBy(desc(deliveries.createdAt))
      .limit(1);
    const done = await this.db
      .select({ d: deliveries, byName: users.name })
      .from(deliveries)
      .innerJoin(users, eq(users.id, deliveries.publishedBy))
      .where(and(eq(deliveries.taskId, task.id), eq(deliveries.status, 'done')))
      .orderBy(desc(deliveries.version));
    const doneFiles = done.length
      ? await this.db
          .select({ deliveryId: deliveryFiles.deliveryId, kind: deliveryFiles.kind, name: files.originalName })
          .from(deliveryFiles)
          .innerJoin(files, eq(files.id, deliveryFiles.fileId))
          .where(inArray(deliveryFiles.deliveryId, done.map((x) => x.d.id)))
      : [];
    const company = (await this.db.select({ input: generationBatches.input }).from(generationBatches).where(eq(generationBatches.id, review.batchId)).limit(1))[0]
      ?.input.basic.companyName;

    const editable = canPublishTask(user, task);
    const passed = reviewValid(review);
    const inFlight = attemptRow?.d.status === 'publishing';
    const blocker = !editable
      ? '只有负责这个任务的注安师可以发布'
      : review.published
        ? `这批文稿已发布为${deliveryLabel(review.published.version)}`
        : inFlight
          ? '这批文稿正在发布'
          : passed
            ? null
            : blockerOf(review);
    const attempt: PublishAttempt | null = attemptRow
      ? {
          publishId: attemptRow.d.publishId,
          status: attemptRow.d.status,
          version: attemptRow.d.version,
          error: attemptRow.d.error,
          byName: attemptRow.byName,
          startedAt: attemptRow.d.createdAt.toISOString(),
          publishedAt: attemptRow.d.publishedAt?.toISOString() ?? null,
        }
      : null;
    return {
      batchId: review.batchId,
      enterpriseName: task.enterpriseName,
      taskNumber: task.number,
      docs: review.docs.map((d) => ({ kind: d.kind, name: `${company ?? task.enterpriseName}${DRAFT_KINDS[d.kind]}.docx`, version: d.version, savedAt: d.savedAt })),
      review: review.review ? { byName: review.review.byName, at: review.review.at, valid: passed } : null,
      editable,
      canPublish: blocker === null,
      blocker,
      nextVersion: review.published ? review.published.version + 1 : await this.nextVersion(task.id),
      attempt,
      deliveries: done.map(
        (x): DeliveryVersion => ({
          version: x.d.version,
          publishedAt: x.d.publishedAt!.toISOString(),
          byName: x.byName,
          files: DRAFT_KIND_KEYS.flatMap((kind) => doneFiles.filter((f) => f.deliveryId === x.d.id && f.kind === kind).map((f) => ({ kind, name: f.name }))),
        }),
      ),
    };
  }

  // 负责注安师和运营能看发布页，其他人一律当作不存在
  private async task(user: SessionUser, taskId: string): Promise<Task> {
    const [task] = await this.db
      .select({
        id: tasks.id,
        orgId: tasks.orgId,
        assignedExpertId: tasks.assignedExpertId,
        number: tasks.number,
        enterpriseName: enterprises.name,
        closedAt: tasks.closedAt,
      })
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task || !canViewTaskWork(user, task)) throw new NotFoundException(NOT_FOUND);
    return task;
  }
}

// 审核结论为什么还不能发布
function blockerOf(review: ReviewView): string | null {
  if (reviewValid(review)) return null;
  if (review.factsChangedAt) return '事实已更新，草稿还没有重新生成。请先按新事实重新生成，再核对、审核后发布';
  if (!review.review) return '三份文稿核对完并确认审核结论后才能发布';
  return '审核结论已失效：有文稿在审核后又保存了修订，请重新核对并确认审核结论';
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

@Controller('tasks/:id')
export class PublishController {
  constructor(@Inject(PublishService) private readonly service: PublishService) {}

  @Get('publication')
  view(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Query('publishId') publishId?: string) {
    return this.service.view(user, id, publishId);
  }

  @Post('publication')
  publish(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.service.publish(user, id, body, clientIp(req));
  }
}
