// Word 校对与审核结论（M2 第 12 项，14 页 E18-05、E18-06）：负责专家逐份看当前稿的 Word 版式并核对，
// 三份都核对过才能确认审核结论。核对和结论都记下当时的修订次数（draft_edits.version），之后再保存修订就失效。
// 校对页看的是当前稿转成的 PDF：没改过的用生成时转好的，改过的按当前修订次数在后台重新转，只留最近一份。
import {
  checkRequestSchema,
  checkValid,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  reviewRequestSchema,
  reviewValid,
  type DraftCheckView,
  type DraftKind,
  type PreviewView,
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
import { and, desc, eq, gt } from 'drizzle-orm';
import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { canEditTaskWork, canViewTaskWork } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  draftChecks,
  draftEdits,
  draftPreviews,
  draftReviews,
  factSupplements,
  files,
  generatedDrafts,
  generationBatches,
  tasks,
  users,
} from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { PDF_CONVERTER, type PdfConverter } from '../generation/word/preview-pdf.ts';
import { batchLock, throwIfLocked } from './delivery-lock.ts';
import { EditingService } from './editing.service.ts';

const NOT_FOUND = '找不到该任务';
const ONLY_EXPERT = '只有负责这个任务的注安师可以核对和确认审核结论';
const STALE_CHECK = '这份刚保存了新的修订，请看最新稿后再核对';
const STALE_REVIEW = '有文稿在核对后又保存了修订，请重新核对后再确认审核结论';
const FACTS_CHANGED = '事实已更新，草稿还没有重新生成。请先按新事实重新生成，再核对和确认审核结论';
const CONVERT_FAILED = '转换没有成功，请重试';
// 转换中途服务重启，记录会一直停在「正在转」：超过这么久按失败处理，可以重试
const CONVERT_STALE_MS = 5 * 60_000;

type Batch = typeof generationBatches.$inferSelect;
type Ctx = {
  task: { id: string; orgId: string; assignedExpertId: string | null };
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
      throwIfLocked(await batchLock(tx, ctx.batch.id));
      await tx
        .insert(draftChecks)
        .values({
          batchId: ctx.batch.id,
          kind: k,
          version: parsed.data.version,
          checkedBy: user.id,
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
    throwIfLocked(await batchLock(this.db, ctx.batch.id));
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
      await done({ status: 'done', fileId, error: null });
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

  private async build(user: SessionUser, ctx: Ctx): Promise<ReviewView> {
    const batchId = ctx.batch.id;
    const [drafts, edits, checks, [review], [changed], lock] = await Promise.all([
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
      batchLock(this.db, batchId),
    ]);
    const docs: DraftCheckView[] = DRAFT_KIND_KEYS.map((kind) => {
      const e = edits.find((x) => x.kind === kind);
      const c = checks.find((x) => x.kind === kind);
      const version = e?.version ?? 0;
      const savedAt = version > 0 ? e!.updatedAt : (drafts.find((x) => x.kind === kind)?.finishedAt ?? null);
      return {
        kind,
        version,
        savedAt: savedAt?.toISOString() ?? null,
        check: c ? { byName: c.byName, at: c.at.toISOString(), version: c.version } : null,
      };
    });
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
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
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
