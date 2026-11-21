// Word 校对与审核结论（M2 第 12 项，14 页 E18-05、E18-06）：负责专家逐份看当前稿的 Word 版式并核对，
// 三份都核对过才能确认审核结论。核对和结论都记下当时的修订次数（draft_edits.version），之后再保存修订就失效。
// 校对页看的是当前稿转成的 PDF：没改过的用生成时转好的，改过的按当前修订次数在后台重新转，只留最近一份。
// 交付后重新打开（15 页 R12）：重新打开之前的核对和审核结论都作废，要重新核对、重新写结论再交付；
// 重新打开期间还给「上一版您改过的 N 节」和「这次更新了什么」系统先填好的那句。
import {
  blocksText,
  checkRequestSchema,
  checkValid,
  composeUpdateNote,
  planChanges,
  stripHeadingNumber,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  reviewRequestSchema,
  reviewValid,
  type DraftCheckView,
  type DraftKind,
  type PreviewView,
  type ReopenedView,
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
  Put,
  Res,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { canEditTaskWork, canViewTaskWork } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  deliveries,
  draftChecks,
  draftEdits,
  draftPreviews,
  draftReviews,
  draftRevisions,
  factSupplements,
  files,
  generatedDrafts,
  generationBatches,
  tasks,
  users,
} from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { PDF_CONVERTER, type PdfConverter } from '../generation/word/preview-pdf.ts';
import type { DrawingRenderer } from '../generation/drawings/renderer.ts';
import { taskLock, throwIfLocked } from './delivery-lock.ts';
import { DRAWING_RENDERER } from './drawings.service.ts';
import { EditingService } from './editing.service.ts';

const NOT_FOUND = '找不到该任务';
const ONLY_EXPERT = '只有负责这个任务的专家可以核对和确认审核结论';
const STALE_CHECK = '这份刚保存了新的修订，请看最新稿后再核对';
const STALE_REVIEW = '有文稿在核对后又保存了修订，请重新核对后再确认审核结论';
const FACTS_CHANGED = '事实已更新，草稿还没有重新生成。请先按新事实重新生成，再核对和确认审核结论';
const CONVERT_FAILED = '转换没有成功，请重试';
// 转换中途服务重启，记录会一直停在「正在转」：超过这么久按失败处理，可以重试
const CONVERT_STALE_MS = 5 * 60_000;

type Batch = typeof generationBatches.$inferSelect;
type Ctx = {
  task: { id: string; orgId: string; assignedExpertId: string | null; reopenedAt: Date | null };
  batch: Batch;
};

@Injectable()
export class ReviewService {
  private readonly logger = new Logger('ReviewService');
  // 正在转的「批次/份/修订次数」，同一份稿只转一次
  private readonly running = new Set<string>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(PDF_CONVERTER) private readonly converter: PdfConverter | null,
    @Inject(EditingService) private readonly editing: EditingService,
    @Inject(DRAWING_RENDERER) private readonly renderer: DrawingRenderer,
  ) {}

  async view(user: SessionUser, taskId: string): Promise<ReviewView> {
    const ctx = await this.context(user, taskId);
    return this.build(user, ctx);
  }

  async check(user: SessionUser, taskId: string, kind: string, body: unknown): Promise<ReviewView> {
    const ctx = await this.context(user, taskId);
    const k = this.kindOf(kind);
    if (!canEditTaskWork(user, ctx.task)) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = checkRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('请刷新页面后再核对');
    const ok = await this.db.transaction(async (tx) => {
      // 锁住这份的修订记录，核对和保存修订不会交错
      const [edits] = await tx
        .select({ version: draftEdits.version })
        .from(draftEdits)
        .where(and(eq(draftEdits.batchId, ctx.batch.id), eq(draftEdits.kind, k)))
        .for('update');
      if ((edits?.version ?? 0) !== parsed.data.version) return false;
      // 已发布（或正在发布）的这批文稿不再核对
      throwIfLocked(await taskLock(tx, ctx.task.id));
      await tx
        .insert(draftChecks)
        .values({
          batchId: ctx.batch.id,
          kind: k,
          version: parsed.data.version,
          checkedBy: user.id,
          // 时间用代码给的，和重新打开的时间比先后
          checkedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [draftChecks.batchId, draftChecks.kind],
          set: {
            version: parsed.data.version,
            checkedBy: user.id,
            checkedAt: new Date(),
          },
        });
      return true;
    });
    const view = await this.build(user, ctx);
    if (!ok)
      throw new ConflictException({
        statusCode: 409,
        message: STALE_CHECK,
        reason: 'stale',
        view,
      });
    return view;
  }

  async conclude(user: SessionUser, taskId: string, body: unknown): Promise<ReviewView> {
    const ctx = await this.context(user, taskId);
    if (!canEditTaskWork(user, ctx.task)) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = reviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请填写审核结论');
    // 已发布（或正在发布）的这批文稿不再确认结论，重复点击也一样答复
    throwIfLocked(await taskLock(this.db, ctx.task.id));
    const before = await this.build(user, ctx);
    // 已经有效通过（重复点击、两个窗口都点了）：原样返回，不改审核时间和审核人
    if (reviewValid(before)) return before;
    // 这批草稿生成以后采用过事实补件：草稿用的还是旧事实，不能确认结论
    if (before.factsChangedAt) {
      throw new ConflictException({ statusCode: 409, message: FACTS_CHANGED, reason: 'facts_changed', view: before });
    }
    const pending = before.docs.filter((d) => !checkValid(d));
    if (pending.length) {
      throw new ConflictException({
        statusCode: 409,
        message: `${pending.map((d) => DRAFT_KINDS[d.kind]).join('、')}还没有核对当前稿，三份都核对后才能确认审核结论`,
        reason: 'unchecked',
        view: before,
      });
    }
    if (before.docs.some((d) => parsed.data.versions[d.kind] !== d.version)) {
      throw new ConflictException({
        statusCode: 409,
        message: STALE_REVIEW,
        reason: 'stale',
        view: before,
      });
    }
    const versions = parsed.data.versions;
    await this.db
      .insert(draftReviews)
      .values({
        batchId: ctx.batch.id,
        note: parsed.data.note,
        versions,
        reviewedBy: user.id,
        reviewedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: draftReviews.batchId,
        set: {
          note: parsed.data.note,
          versions,
          reviewedBy: user.id,
          reviewedAt: new Date(),
        },
      });
    return this.build(user, ctx);
  }

  // 校对页的 PDF：当前稿还没转就开始转（没装转换工具时只能下载 Word）
  async preview(user: SessionUser, taskId: string, kind: string): Promise<PreviewView> {
    const ctx = await this.context(user, taskId);
    const k = this.kindOf(kind);
    const version = await this.versionOf(ctx.batch.id, k);
    const ready = await this.readyFile(ctx.batch.id, k, version);
    if (ready) return { status: 'ready', version, error: null };
    const row = await this.previewRow(ctx.batch.id, k);
    if (row?.version === version) {
      if (row.status === 'failed')
        return {
          status: 'failed',
          version,
          error: row.error ?? CONVERT_FAILED,
        };
      if (row.status === 'converting' && !this.convertingStale(row)) return { status: 'converting', version, error: null };
    }
    if (!this.converter) return { status: 'unavailable', version, error: null };
    await this.startConvert(ctx, k, version);
    return { status: 'converting', version, error: null };
  }

  async retryPreview(user: SessionUser, taskId: string, kind: string): Promise<PreviewView> {
    const ctx = await this.context(user, taskId);
    const k = this.kindOf(kind);
    const version = await this.versionOf(ctx.batch.id, k);
    if (await this.readyFile(ctx.batch.id, k, version)) return { status: 'ready', version, error: null };
    if (!this.converter) return { status: 'unavailable', version, error: null };
    await this.startConvert(ctx, k, version);
    return { status: 'converting', version, error: null };
  }

  async previewFile(user: SessionUser, taskId: string, kind: string): Promise<Buffer> {
    const ctx = await this.context(user, taskId);
    const k = this.kindOf(kind);
    const file = await this.readyFile(ctx.batch.id, k, await this.versionOf(ctx.batch.id, k));
    if (!file) throw new NotFoundException('当前稿的 PDF 还没有转好');
    return this.storage.read(file.storageKey);
  }

  private async startConvert(ctx: Ctx, kind: DraftKind, version: number) {
    const key = `${ctx.batch.id}/${kind}/${version}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    await this.db
      .insert(draftPreviews)
      .values({ batchId: ctx.batch.id, kind, version, status: 'converting' })
      .onConflictDoUpdate({
        target: [draftPreviews.batchId, draftPreviews.kind],
        set: {
          version,
          status: 'converting',
          fileId: null,
          error: null,
          updatedAt: new Date(),
        },
      });
    void this.convert(ctx, kind, version).finally(() => this.running.delete(key));
  }

  // 先读修订次数再出 Word：期间又有人保存，转出来的内容只会比记下的次数新，下次打开按新次数重转
  private async convert(ctx: Ctx, kind: DraftKind, version: number) {
    const done = (set: Partial<typeof draftPreviews.$inferInsert>) =>
      this.db
        .update(draftPreviews)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(draftPreviews.batchId, ctx.batch.id), eq(draftPreviews.kind, kind), eq(draftPreviews.version, version)));
    try {
      const word = await this.editing.batchWord(ctx.batch, kind);
      const pdf = await this.converter!(word.data);
      const fileId = await this.store(ctx, `${word.name.replace(/\.docx$/, '')}.pdf`, pdf);
      // 顺手数页数（已交付页和审核结论页签显示）；数不出来不影响预览
      let pages: number | null = null;
      try {
        pages = await this.renderer.count(pdf, 'application/pdf');
      } catch (err) {
        console.error(`当前稿数页数失败（${kind}）：${err instanceof Error ? err.message : String(err)}`);
      }
      await done({ status: 'done', fileId, error: null, pages });
    } catch (err) {
      this.logger.warn(`当前稿转 PDF 失败（${kind}）：${err instanceof Error ? err.message : String(err)}`);
      await done({ status: 'failed', error: CONVERT_FAILED }).catch(() => undefined);
    }
  }

  private async store({ task, batch }: Ctx, originalName: string, data: Buffer) {
    const id = randomUUID();
    const storageKey = `${task.orgId}/${id}`;
    await this.storage.put(storageKey, data, 'application/pdf');
    await this.db.insert(files).values({
      id,
      orgId: task.orgId,
      kind: 'draft',
      originalName,
      contentType: 'application/pdf',
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      storageKey,
      uploadedBy: batch.createdBy,
    });
    return id;
  }

  private convertingStale(row: { updatedAt: Date }) {
    return Date.now() - row.updatedAt.getTime() > CONVERT_STALE_MS;
  }

  // 当前稿已经转好的 PDF：没改过的先用生成时转好的
  private async readyFile(batchId: string, kind: DraftKind, version: number) {
    if (version === 0) {
      const [gen] = await this.db
        .select({ storageKey: files.storageKey })
        .from(generatedDrafts)
        .innerJoin(files, eq(files.id, generatedDrafts.pdfFileId))
        .where(and(eq(generatedDrafts.batchId, batchId), eq(generatedDrafts.kind, kind)))
        .limit(1);
      if (gen) return gen;
    }
    const [row] = await this.db
      .select({ storageKey: files.storageKey })
      .from(draftPreviews)
      .innerJoin(files, eq(files.id, draftPreviews.fileId))
      .where(and(eq(draftPreviews.batchId, batchId), eq(draftPreviews.kind, kind), eq(draftPreviews.version, version), eq(draftPreviews.status, 'done')))
      .limit(1);
    return row ?? null;
  }

  private async previewRow(batchId: string, kind: DraftKind) {
    const [row] = await this.db
      .select()
      .from(draftPreviews)
      .where(and(eq(draftPreviews.batchId, batchId), eq(draftPreviews.kind, kind)))
      .limit(1);
    return row;
  }

  private async versionOf(batchId: string, kind: DraftKind) {
    const [row] = await this.db
      .select({ version: draftEdits.version })
      .from(draftEdits)
      .where(and(eq(draftEdits.batchId, batchId), eq(draftEdits.kind, kind)))
      .limit(1);
    return row?.version ?? 0;
  }

  /**
   * 某一份某一版的页数：改过的取这一版转好的 PDF 记下的页数；没改过的（版本 0）取生成时数好的页数。拿不到返回 null
   */
  async pagesOf(batchId: string, kind: DraftKind, version: number): Promise<number | null> {
    if (version === 0) {
      const [gen] = await this.db
        .select({ pages: generatedDrafts.pages })
        .from(generatedDrafts)
        .where(and(eq(generatedDrafts.batchId, batchId), eq(generatedDrafts.kind, kind)))
        .limit(1);
      return gen?.pages ?? null;
    }
    const [row] = await this.db
      .select({ pages: draftPreviews.pages })
      .from(draftPreviews)
      .where(and(eq(draftPreviews.batchId, batchId), eq(draftPreviews.kind, kind), eq(draftPreviews.version, version), eq(draftPreviews.status, 'done')))
      .limit(1);
    return row?.pages ?? null;
  }

  private async build(user: SessionUser, ctx: Ctx): Promise<ReviewView> {
    const batchId = ctx.batch.id;
    const [drafts, edits, checks, [rawReview], [changed], lock, [last]] = await Promise.all([
      this.db
        .select({
          kind: generatedDrafts.kind,
          finishedAt: generatedDrafts.finishedAt,
        })
        .from(generatedDrafts)
        .where(eq(generatedDrafts.batchId, batchId)),
      this.db
        .select({
          kind: draftEdits.kind,
          version: draftEdits.version,
          updatedAt: draftEdits.updatedAt,
        })
        .from(draftEdits)
        .where(eq(draftEdits.batchId, batchId)),
      this.db
        .select({
          kind: draftChecks.kind,
          version: draftChecks.version,
          at: draftChecks.checkedAt,
          byName: users.name,
        })
        .from(draftChecks)
        .innerJoin(users, eq(users.id, draftChecks.checkedBy))
        .where(eq(draftChecks.batchId, batchId)),
      this.db
        .select({
          note: draftReviews.note,
          versions: draftReviews.versions,
          at: draftReviews.reviewedAt,
          byName: users.name,
        })
        .from(draftReviews)
        .innerJoin(users, eq(users.id, draftReviews.reviewedBy))
        .where(eq(draftReviews.batchId, batchId))
        .limit(1),
      // 这批草稿生成以后采用的事实补件（与补件页「已按新事实重新生成」同一个判断）
      this.db
        .select({ at: factSupplements.adoptedAt })
        .from(factSupplements)
        .where(and(eq(factSupplements.taskId, ctx.task.id), eq(factSupplements.status, 'adopted'), gt(factSupplements.adoptedAt, ctx.batch.createdAt)))
        .orderBy(desc(factSupplements.adoptedAt))
        .limit(1),
      taskLock(this.db, ctx.task.id),
      // 当前账号在这批稿子里最近一次保存（「回来接着做」）
      this.db
        .select({ kind: draftRevisions.kind, sectionId: draftRevisions.sectionId, sectionTitle: draftRevisions.sectionTitle, at: draftRevisions.createdAt })
        .from(draftRevisions)
        .where(and(eq(draftRevisions.batchId, batchId), eq(draftRevisions.createdBy, user.id)))
        .orderBy(desc(draftRevisions.createdAt))
        .limit(1),
    ]);
    // 重新打开以后，之前的核对和审核结论都作废（只认重新打开之后做的）
    const reopenedAt = ctx.task.reopenedAt;
    const fresh = (at: Date) => !reopenedAt || at > reopenedAt;
    const review = rawReview && fresh(rawReview.at) ? rawReview : undefined;
    const pages = await Promise.all(DRAFT_KIND_KEYS.map((kind) => this.pagesOf(batchId, kind, edits.find((x) => x.kind === kind)?.version ?? 0)));
    const docs: DraftCheckView[] = DRAFT_KIND_KEYS.map((kind, i) => {
      const e = edits.find((x) => x.kind === kind);
      const c = checks.find((x) => x.kind === kind && fresh(x.at));
      const version = e?.version ?? 0;
      const savedAt = version > 0 ? e!.updatedAt : (drafts.find((x) => x.kind === kind)?.finishedAt ?? null);
      return {
        kind,
        version,
        savedAt: savedAt?.toISOString() ?? null,
        check: c ? { byName: c.byName, at: c.at.toISOString(), version: c.version } : null,
        pages: pages[i] ?? null,
      };
    });
    const reopened = await this.reopenedOf(ctx);
    // 重新打开、还没写新结论：审核结论框预填上一次的结论（这一批作废的那条，没有就取上次交付那一批的）
    let previousNote: string | null = null;
    if (reopened && !review) {
      previousNote = rawReview?.note ?? null;
      if (previousNote === null && reopened.deliveredBatchId !== batchId) {
        const [prev] = await this.db.select({ note: draftReviews.note }).from(draftReviews).where(eq(draftReviews.batchId, reopened.deliveredBatchId)).limit(1);
        previousNote = prev?.note ?? null;
      }
    }
    return {
      batchId,
      docs,
      review: review
        ? {
            note: review.note,
            byName: review.byName,
            at: review.at.toISOString(),
            versions: review.versions,
          }
        : null,
      editable: canEditTaskWork(user, ctx.task) && !lock,
      factsChangedAt: changed?.at?.toISOString() ?? null,
      published: lock?.status === 'done' ? { version: lock.version, at: lock.publishedAt! } : null,
      lastSave: last ? { kind: last.kind, sectionId: last.sectionId, sectionTitle: last.sectionTitle, at: last.at.toISOString() } : null,
      previousNote,
      reopened: reopened?.view ?? null,
    };
  }

  // 交付后重新打开、还没再次交付（reopened_at 晚于最近一次成功交付）：上一版改过的节和系统先填好的更新说明
  private async reopenedOf(ctx: Ctx): Promise<{ view: ReopenedView; deliveredBatchId: string } | null> {
    const reopenedAt = ctx.task.reopenedAt;
    if (!reopenedAt) return null;
    const [last] = await this.db
      .select({ batchId: deliveries.batchId, versions: deliveries.versions, publishedAt: deliveries.publishedAt })
      .from(deliveries)
      .where(and(eq(deliveries.taskId, ctx.task.id), eq(deliveries.status, 'done')))
      .orderBy(desc(deliveries.version))
      .limit(1);
    if (!last?.publishedAt || reopenedAt <= last.publishedAt) return null;

    // 上一次交付的那一批里改过的节：draft_revisions.version 和交付记下的 versions[kind] 都是 draft_edits.version 那一套计数，
    // 取 version 不超过交付时那一版的修订，每份每节留最后一条（就是交付时的样子）
    const revisions = await this.db
      .select({
        kind: draftRevisions.kind,
        sectionId: draftRevisions.sectionId,
        title: draftRevisions.sectionTitle,
        after: draftRevisions.after,
        version: draftRevisions.version,
      })
      .from(draftRevisions)
      .where(eq(draftRevisions.batchId, last.batchId))
      .orderBy(asc(draftRevisions.version));
    const kept = new Map<string, (typeof revisions)[number]>();
    for (const r of revisions) {
      if (r.version > (last.versions[r.kind] ?? 0)) continue;
      const key = `${r.kind}/${r.sectionId}`;
      // 先删再放：同一份里按每节最后一次改的先后排
      kept.delete(key);
      kept.set(key, r);
    }
    const edits = DRAFT_KIND_KEYS.flatMap((kind) =>
      [...kept.values()].filter((r) => r.kind === kind).map((r) => ({ kind, sectionId: r.sectionId, title: r.title, text: blocksText(r.after) })),
    );

    // 「这次更新了什么」：重新生成过就比两批资料，再加上重新打开以后改过的节标题
    const changes: string[] = [];
    if (last.batchId !== ctx.batch.id) {
      const [prev] = await this.db.select({ input: generationBatches.input }).from(generationBatches).where(eq(generationBatches.id, last.batchId)).limit(1);
      if (prev) changes.push(...planChanges(prev.input, ctx.batch.input));
    }
    const since = await this.db
      .select({ title: draftRevisions.sectionTitle })
      .from(draftRevisions)
      .where(and(eq(draftRevisions.batchId, ctx.batch.id), gt(draftRevisions.createdAt, reopenedAt)))
      .orderBy(asc(draftRevisions.createdAt));
    changes.push(...since.map((r) => stripHeadingNumber(r.title)));

    return {
      deliveredBatchId: last.batchId,
      view: {
        at: reopenedAt.toISOString(),
        deliveredAt: last.publishedAt.toISOString(),
        edits,
        suggestedNote: composeUpdateNote(changes),
      },
    };
  }

  private kindOf(kind: string): DraftKind {
    if (!DRAFT_KIND_KEYS.includes(kind as DraftKind)) throw new NotFoundException('找不到这份文档');
    return kind as DraftKind;
  }

  // 最近一批草稿，三份都生成完才能核对；负责专家和运营能看，其他人一律当作不存在
  private async context(user: SessionUser, taskId: string): Promise<Ctx> {
    const [task] = await this.db
      .select({
        id: tasks.id,
        orgId: tasks.orgId,
        assignedExpertId: tasks.assignedExpertId,
        reopenedAt: tasks.reopenedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task || !canViewTaskWork(user, task)) throw new NotFoundException(NOT_FOUND);
    const [batch] = await this.db
      .select()
      .from(generationBatches)
      .where(eq(generationBatches.taskId, task.id))
      .orderBy(desc(generationBatches.createdAt))
      .limit(1);
    if (!batch) throw new BadRequestException('还没有生成草稿，请先确认采用资料并生成');
    const drafts = await this.db.select({ status: generatedDrafts.status }).from(generatedDrafts).where(eq(generatedDrafts.batchId, batch.id));
    if (drafts.length < DRAFT_KIND_KEYS.length || drafts.some((d) => d.status !== 'done')) {
      throw new BadRequestException('三份草稿都生成完才能核对');
    }
    return { task, batch };
  }
}

@Controller('tasks/:id')
export class ReviewController {
  constructor(@Inject(ReviewService) private readonly service: ReviewService) {}

  @Get('draft-review')
  view(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.view(user, id);
  }

  @Post('draft-review')
  conclude(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.conclude(user, id, body);
  }

  @Put('drafts/:kind/check')
  check(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Body() body: unknown) {
    return this.service.check(user, id, kind, body);
  }

  @Get('drafts/:kind/preview')
  preview(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string) {
    return this.service.preview(user, id, kind);
  }

  @Post('drafts/:kind/preview/retry')
  retry(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string) {
    return this.service.retryPreview(user, id, kind);
  }

  @Get('drafts/:kind/preview/file')
  async file(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Res() res: Response) {
    const data = await this.service.previewFile(user, id, kind);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('cache-control', 'private, no-store');
    res.send(data);
  }
}
