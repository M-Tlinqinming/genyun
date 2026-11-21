// 确认采用资料并生成三份草稿（M2 第 10 项，14 页 E18-01、E18-02、E18-02b）。
// 专家确认时检查必需项和整理版本，锁定采用的资料并拼好生成输入；三份草稿各自排队生成，
// 哪份失败只重试那一份，已生成的保留。
import {
  chinaToday,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  draftActive,
  generationConfirmSchema,
  generationRetrySchema,
  materialsFingerprint,
  pendingCount,
  pendingOf,
  planDrawingsOf,
  planInputOf,
  SELF_FILL_STEP_TITLES,
  workupGaps,
  type DraftKind,
  type DraftStepProgress,
  type GenerationMaterials,
  type GenerationProgress,
  type LockedMaterial,
  type AdoptedMaterial,
  type WorkupSnapshot,
  effectiveSnapshot,
} from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  enterpriseDocumentVersions,
  factSupplements,
  files,
  generatedDrafts,
  draftEdits,
  generationBatches,
  taskDocuments,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { serializeDocument } from '../generation/document-json.ts';
import { DRAFT_RENDERER, type DraftRenderer } from '../generation/drafts.ts';
import type { DrawingRenderer } from '../generation/drawings/renderer.ts';
import { DRAFT_QUEUE, type DraftJob, type DraftQueue } from '../generation/queue.ts';
import { KnowledgeService } from '../knowledge/knowledge.service.ts';
import { DRAWING_RENDERER, DrawingsService } from './drawings.service.ts';
import { WorkupService } from './workup.service.ts';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const INTERRUPTED = '服务重启，这一份没有生成完，请重试';

@Injectable()
export class GenerationService implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WorkupService) private readonly workup: WorkupService,
    @Inject(DRAFT_QUEUE) private readonly queue: DraftQueue,
    @Inject(DRAFT_RENDERER) private readonly render: DraftRenderer,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(DrawingsService) private readonly drawings: DrawingsService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(DRAWING_RENDERER) private readonly pdfPages: DrawingRenderer,
  ) {}

  async onModuleInit() {
    // 进程内队列重启就丢了：上次没跑完的标为失败，专家点重试即可
    if (!this.queue.durable) {
      await this.db
        .update(generatedDrafts)
        .set({ status: 'failed', error: INTERRUPTED, finishedAt: new Date() })
        .where(inArray(generatedDrafts.status, ['queued', 'running']));
    }
    this.queue.start((job) => this.run(job));
  }

  async onApplicationShutdown() {
    await this.queue.close();
  }

  async progress(user: SessionUser, id: string): Promise<GenerationProgress | null> {
    const task = await this.workup.task(user, id);
    const batch = await this.latest(task.id);
    return batch ? this.view(batch) : null;
  }

  async confirm(user: SessionUser, id: string, body: unknown): Promise<GenerationProgress> {
    const task = await this.workup.task(user, id);
    const parsed = generationConfirmSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('请求格式不正确');
    const [row] = await this.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, task.id)).limit(1);
    if (!row) throw new BadRequestException('还没有开始整理');
    if (row.version !== parsed.data.version) {
      throw new ConflictException({ statusCode: 409, message: '这份整理刚被修改过，已为您显示最新内容，请看过后再确认生成', reason: 'stale', version: row.version });
    }
    // 属地应急机构按知识库现在的内容检查、写进这一批（之后运营再改，已生成的这批不变）
    const districts = await this.knowledge.agencyDistricts();
    // 专家核对向导保存的那份盖在快照上（客户原表不动）
    const snapshot = effectiveSnapshot(row.snapshot, row.data);
    // 门槛里的两张图：和第 4 步图纸卡、附图同一份（drawingCandidates）
    const { gaps } = workupGaps(snapshot, row.data, districts, await this.workup.drawingFiles(task.id, task.orgId, snapshot, row.data));
    if (gaps.length > 0) {
      throw new BadRequestException({ statusCode: 400, message: `还差 ${gaps.length} 项没有整理完，补齐后才能生成`, reason: 'gaps', gaps });
    }
    // 专家看确认页以后客户又传了文件或新版本：不生成，留在本页把变了的行标出来
    if (parsed.data.materials !== undefined) {
      const now = await this.materialsOf(task.id, snapshot, row.snapshotAt);
      if (now.fingerprint !== parsed.data.materials) {
        throw new ConflictException({
          statusCode: 409,
          message: '客户刚更新了资料，已标出有变化的资料，请看过后再确认',
          reason: 'materials',
          materials: now,
        });
      }
    }
    const current = await this.latest(task.id);
    if (current && (await this.drafts(current.id)).some(draftActive)) {
      throw new ConflictException('草稿正在生成，请等这一批生成完');
    }

    // 附件 7 的客户图纸：按专家选的页锁定（第 10c 项）；页数第一次算要读文件，放在事务外
    const drawings = planDrawingsOf(await this.drawings.drawingsOf(task.id, task.orgId, snapshot, row.data));
    const materials: LockedMaterial[] = (await this.workup.originals(task.id, snapshot)).map((o) => ({
      fileId: o.fileId,
      name: o.name,
      version: o.version,
      itemKeys: o.itemKeys,
    }));
    const batch = await this.db.transaction(async (tx) => {
      const [b] = await tx
        .insert(generationBatches)
        .values({
          taskId: task.id,
          workupVersion: row.version,
          snapshotAt: row.snapshotAt,
          input: { ...planInputOf(snapshot, row.data, chinaToday(), districts), drawings },
          materials,
          createdBy: user.id,
        })
        .returning();
      const queuedAt = new Date();
      await tx.insert(generatedDrafts).values(DRAFT_KIND_KEYS.map((kind) => ({ batchId: b!.id, kind, queuedAt })));
      // 还标着「等客户补资料」：专家决定不等了，一并取消，处理记录里记一条（只加记录，整理的版本号不变）
      const [t] = await tx.select({ since: tasks.awaitingCustomerSince }).from(tasks).where(eq(tasks.id, task.id)).limit(1);
      if (t?.since) {
        const events = [
          ...(row.data.events ?? []),
          { at: new Date().toISOString(), by: user.id, byName: user.name, what: '确认生成，「等客户补资料」一并取消' },
        ].slice(-200);
        const written = await tx
          .update(taskWorkups)
          .set({ data: { ...row.data, events } })
          .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, row.version)))
          .returning({ taskId: taskWorkups.taskId });
        // 这期间整理被改过：记录写不进去，整个确认回滚，不能只清标记不留记录
        if (written.length === 0) {
          const [now] = await tx.select({ version: taskWorkups.version }).from(taskWorkups).where(eq(taskWorkups.taskId, task.id)).limit(1);
          throw new ConflictException({ statusCode: 409, message: '这份整理刚被修改过，已为您显示最新内容，请看过后再确认生成', reason: 'stale', version: now?.version ?? row.version });
        }
        await tx.update(tasks).set({ awaitingCustomerSince: null, awaitingCustomerItems: null }).where(eq(tasks.id, task.id));
      }
      return b!;
    });
    for (const kind of DRAFT_KIND_KEYS) await this.queue.add({ batchId: batch.id, kind });
    return this.view(batch);
  }

  // 确认页左表：本次采用的资料，以及与整理时相比有没有变化
  async materials(user: SessionUser, id: string): Promise<GenerationMaterials> {
    const task = await this.workup.task(user, id);
    const [row] = await this.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, task.id)).limit(1);
    if (!row) throw new BadRequestException('还没有开始整理');
    return this.materialsOf(task.id, effectiveSnapshot(row.snapshot, row.data), row.snapshotAt);
  }

  private async materialsOf(taskId: string, snapshot: WorkupSnapshot, snapshotAt: Date): Promise<GenerationMaterials> {
    const originals = await this.workup.originals(taskId, snapshot);
    // 任务用的资料库文件，各自对应的资料现在最新是第几版
    const linked = await this.db
      .select({ documentId: taskDocuments.documentId, fileId: enterpriseDocumentVersions.fileId })
      .from(taskDocuments)
      .innerJoin(enterpriseDocumentVersions, eq(enterpriseDocumentVersions.id, taskDocuments.versionId))
      .where(eq(taskDocuments.taskId, taskId));
    const versions = linked.length
      ? await this.db
          .select({
            documentId: enterpriseDocumentVersions.documentId,
            version: enterpriseDocumentVersions.version,
            createdAt: enterpriseDocumentVersions.createdAt,
          })
          .from(enterpriseDocumentVersions)
          .where(inArray(enterpriseDocumentVersions.documentId, [...new Set(linked.map((l) => l.documentId))]))
      : [];
    const newest = (fileId: string) => {
      const doc = linked.find((l) => l.fileId === fileId)?.documentId;
      return versions.filter((v) => v.documentId === doc).sort((a, b) => b.version - a.version)[0];
    };

    // 事实补件里客户提供的文件：第几轮、专家是否已采用（已采用的不再算变化）
    const supplementRows = await this.db
      .select({ round: factSupplements.round, status: factSupplements.status, fileIds: factSupplements.responseFileIds })
      .from(factSupplements)
      .where(eq(factSupplements.taskId, taskId));
    const supplementOf = (fileId: string) => {
      const r = supplementRows.filter((s) => (s.fileIds ?? []).includes(fileId)).sort((a, b) => b.round - a.round)[0];
      return r ? { round: r.round, adopted: r.status === 'adopted' } : undefined;
    };

    const rows: AdoptedMaterial[] = originals.map((o) => {
      const top = o.version !== null ? newest(o.fileId) : undefined;
      const supplement = supplementOf(o.fileId);
      const change =
        top && top.version > o.version!
          ? ({ kind: 'newer', version: top.version, uploadedAt: top.createdAt.toISOString() } as const)
          : o.uploadedAt > snapshotAt && !supplement?.adopted
            ? ({ kind: 'added' } as const)
            : null;
      return {
        key: o.fileId,
        name: o.name,
        fileId: o.fileId,
        version: o.version,
        step: null,
        uploadedAt: o.uploadedAt.toISOString(),
        change,
        ...(supplement ? { supplement } : {}),
      };
    });
    const p = snapshot.profile;
    [p.basicStep, p.organizationStep, p.productionStep, p.resourcesStep].forEach((filled, i) => {
      if (!filled) return;
      rows.push({ key: `step-${i + 1}`, name: SELF_FILL_STEP_TITLES[i]!, fileId: null, version: null, step: i + 1, uploadedAt: null, change: null });
    });
    return { rows, fingerprint: materialsFingerprint(rows) };
  }

  // 只把失败的份重新排队，已生成的不动。带 kind 只重做这一份（别的份还在排队、生成也可以）
  async retry(user: SessionUser, id: string, body: unknown): Promise<GenerationProgress> {
    const task = await this.workup.task(user, id);
    const parsed = generationRetrySchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('请求格式不正确');
    const { kind } = parsed.data;
    const batch = await this.latest(task.id);
    if (!batch) throw new BadRequestException('还没有生成过草稿');
    const reset = { status: 'queued' as const, error: null, startedAt: null, finishedAt: null, progress: null, queuedAt: new Date() };
    // 一条语句只改失败的份：连点两下时第二下改不到，不会重复进队列
    const queued = await this.db
      .update(generatedDrafts)
      .set(reset)
      .where(and(eq(generatedDrafts.batchId, batch.id), eq(generatedDrafts.status, 'failed'), ...(kind ? [eq(generatedDrafts.kind, kind)] : [])))
      .returning({ kind: generatedDrafts.kind });
    if (queued.length === 0) {
      if (!kind) throw new BadRequestException('没有失败的草稿需要重试');
      const [now] = await this.db
        .select({ status: generatedDrafts.status })
        .from(generatedDrafts)
        .where(and(eq(generatedDrafts.batchId, batch.id), eq(generatedDrafts.kind, kind)))
        .limit(1);
      const message = now?.status === 'done' ? '这一份已经生成好了，刷新看看' : '这一份已经在重新生成了';
      throw new ConflictException({ statusCode: 409, message, code: 'draft_not_failed' });
    }
    for (const q of queued) await this.queue.add({ batchId: batch.id, kind: q.kind });
    return this.view(batch);
  }

  // 队列里跑一份：排队中的才接（重复的任务直接跳过），Word 和 PDF 一起存
  private async run({ batchId, kind }: DraftJob) {
    const [claimed] = await this.db
      .update(generatedDrafts)
      .set({ status: 'running', startedAt: new Date(), finishedAt: null })
      .where(and(eq(generatedDrafts.batchId, batchId), eq(generatedDrafts.kind, kind), eq(generatedDrafts.status, 'queued')))
      .returning({ attempts: generatedDrafts.attempts });
    if (!claimed) return;
    const where = and(eq(generatedDrafts.batchId, batchId), eq(generatedDrafts.kind, kind));
    await this.db.update(generatedDrafts).set({ attempts: claimed.attempts + 1 }).where(where);
    try {
      const [batch] = await this.db
        .select({ input: generationBatches.input, createdBy: generationBatches.createdBy, orgId: tasks.orgId })
        .from(generationBatches)
        .innerJoin(tasks, eq(tasks.id, generationBatches.taskId))
        .where(eq(generationBatches.id, batchId))
        .limit(1);
      if (!batch) return;
      const drawings = kind === 'plan' ? await this.drawings.images(batch.input.drawings ?? []) : undefined;
      // 每一步开始时记下来给生成页看；只写生成中的份（失败或重做以后不再写），写不进去也不影响生成
      const onProgress = async (p: DraftStepProgress) => {
        try {
          await this.db
            .update(generatedDrafts)
            .set({ progress: p })
            .where(and(where, eq(generatedDrafts.status, 'running')));
        } catch (err) {
          console.error('记生成进度失败', batchId, kind, err);
        }
      };
      const rendered = await this.render(kind, batch.input, drawings, onProgress);
      const name = `${batch.input.basic.companyName}${DRAFT_KINDS[kind]}（草稿）`;
      const wordFileId = await this.store(batch.orgId, batch.createdBy, `${name}.docx`, DOCX, rendered.word);
      const pdfFileId = rendered.pdf ? await this.store(batch.orgId, batch.createdBy, `${name}.pdf`, 'application/pdf', rendered.pdf) : null;
      const documentFileId = await this.store(batch.orgId, batch.createdBy, `${name}.json`, 'application/json', serializeDocument(rendered.document));
      const pages = rendered.pdf ? await this.countPages(rendered.pdf) : null;
      let pending: number | null = null;
      try {
        // 和核对定稿刚打开时的「待补充」是同一个数
        pending = pendingCount(pendingOf(rendered.document, rendered.document));
      } catch (err) {
        console.error('数待补充失败', batchId, kind, err);
      }
      await this.db
        .update(generatedDrafts)
        .set({ status: 'done', wordFileId, pdfFileId, documentFileId, notes: rendered.notes, error: null, finishedAt: new Date(), pages, pendingCount: pending })
        .where(where);
    } catch (err) {
      console.error('草稿生成失败', batchId, kind, err);
      const reason = err instanceof Error && err.message ? err.message.slice(0, 200) : '未知原因';
      await this.db.update(generatedDrafts).set({ status: 'failed', error: `生成没有完成：${reason}`, finishedAt: new Date() }).where(where);
    }
  }

  // PDF 页数；数不出来只记日志
  private async countPages(pdf: Buffer): Promise<number | null> {
    try {
      return await this.pdfPages.count(pdf, 'application/pdf');
    } catch (err) {
      console.error('数 PDF 页数失败', err);
      return null;
    }
  }

  private async store(orgId: string, uploadedBy: string, originalName: string, contentType: string, data: Buffer) {
    const id = randomUUID();
    const storageKey = `${orgId}/${id}`;
    await this.storage.put(storageKey, data, contentType);
    await this.db.insert(files).values({
      id,
      orgId,
      kind: 'draft',
      originalName,
      contentType,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      storageKey,
      uploadedBy,
    });
    return id;
  }

  private async latest(taskId: string) {
    const [batch] = await this.db
      .select()
      .from(generationBatches)
      .where(eq(generationBatches.taskId, taskId))
      .orderBy(desc(generationBatches.createdAt))
      .limit(1);
    return batch;
  }

  private async drafts(batchId: string) {
    const rows = await this.db.select().from(generatedDrafts).where(eq(generatedDrafts.batchId, batchId));
    return DRAFT_KIND_KEYS.map((k) => rows.find((r) => r.kind === k)!).filter(Boolean);
  }

  private async view(batch: typeof generationBatches.$inferSelect): Promise<GenerationProgress> {
    const [by] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, batch.createdBy)).limit(1);
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    // 三份里专家保存过修订的节数：重新生成前提醒专家这些修订要在新稿里重新对照
    const edits = await this.db.select({ sections: draftEdits.sections }).from(draftEdits).where(eq(draftEdits.batchId, batch.id));
    const editedSections = edits.reduce((n, e) => n + Object.keys(e.sections).length, 0);
    const drafts = await this.drafts(batch.id);
    return {
      id: batch.id,
      workupVersion: batch.workupVersion,
      snapshotAt: batch.snapshotAt.toISOString(),
      materials: batch.materials,
      createdAt: batch.createdAt.toISOString(),
      createdByName: by?.name ?? '',
      editedSections,
      drafts: drafts.map((d) => ({
        kind: d.kind as DraftKind,
        status: d.status,
        attempts: d.attempts,
        wordFileId: d.wordFileId,
        pdfFileId: d.pdfFileId,
        error: d.error,
        startedAt: iso(d.startedAt),
        finishedAt: iso(d.finishedAt),
        progress: d.progress ?? null,
        queuedAt: (d.queuedAt ?? batch.createdAt).toISOString(),
        pages: d.pages ?? null,
        pendingCount: d.pendingCount ?? null,
      })),
      queueAhead: await this.queueAhead(batch, drafts),
    };
  }

  // 前面还有几个任务：别的批次里有一份在生成、或有一份排得比我最早的排队份还早的，按批次去重计数。
  // 一个任务同时只有一批在生成，批次数就是任务数。只返回一个数，不透露别的任务的任何信息
  private async queueAhead(batch: typeof generationBatches.$inferSelect, drafts: (typeof generatedDrafts.$inferSelect)[]): Promise<number | null> {
    const queued = drafts.filter((d) => d.status === 'queued');
    if (queued.length === 0) return null;
    const mine = new Date(Math.min(...queued.map((d) => (d.queuedAt ?? batch.createdAt).getTime())));
    const [row] = await this.db
      .select({ n: sql<number>`count(distinct ${generatedDrafts.batchId})::int` })
      .from(generatedDrafts)
      .innerJoin(generationBatches, eq(generationBatches.id, generatedDrafts.batchId))
      .where(
        and(
          ne(generatedDrafts.batchId, batch.id),
          sql`(${generatedDrafts.status} = 'running' or (${generatedDrafts.status} = 'queued' and coalesce(${generatedDrafts.queuedAt}, ${generationBatches.createdAt}) < ${mine.toISOString()}::timestamptz))`,
        ),
      );
    return Number(row?.n ?? 0);
  }
}

@Controller('tasks/:id/generation')
export class GenerationController {
  constructor(@Inject(GenerationService) private readonly service: GenerationService) {}

  // 都返回 { current }：最近一批的进度，还没生成过为 null
  @Get()
  async progress(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return { current: await this.service.progress(user, id) };
  }

  @Get('materials')
  async materials(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.materials(user, id);
  }

  @Post()
  async confirm(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return { current: await this.service.confirm(user, id, body) };
  }

  // 请求体 { kind? }：带 kind 只重做这一份
  @Post('retry')
  async retry(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return { current: await this.service.retry(user, id, body) };
  }
}
