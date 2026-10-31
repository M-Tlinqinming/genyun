// 确认采用资料并生成三份草稿（M2 第 10 项，14 页 E18-01、E18-02、E18-02b）。
// 专家确认时检查必需项和整理版本，锁定采用的资料并拼好生成输入；三份草稿各自排队生成，
// 哪份失败只重试那一份，已生成的保留。
import {
  chinaToday,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  draftActive,
  generationConfirmSchema,
  planInputOf,
  workupGaps,
  type DraftKind,
  type GenerationProgress,
  type LockedMaterial,
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
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { files, generatedDrafts, generationBatches, tasks, taskWorkups, users } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { DRAFT_RENDERER, type DraftRenderer } from '../generation/drafts.ts';
import { DRAFT_QUEUE, type DraftJob, type DraftQueue } from '../generation/queue.ts';
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
    const { gaps } = workupGaps(row.snapshot, row.data);
    if (gaps.length > 0) {
      throw new BadRequestException({ statusCode: 400, message: `还差 ${gaps.length} 项没有整理完，补齐后才能生成`, reason: 'gaps', gaps });
    }
    const current = await this.latest(task.id);
    if (current && (await this.drafts(current.id)).some(draftActive)) {
      throw new ConflictException('草稿正在生成，请等这一批生成完');
    }

    const materials: LockedMaterial[] = (await this.workup.originals(task.id, row.snapshot)).map((o) => ({
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
          input: planInputOf(row.snapshot, row.data, chinaToday()),
          materials,
          createdBy: user.id,
        })
        .returning();
      await tx.insert(generatedDrafts).values(DRAFT_KIND_KEYS.map((kind) => ({ batchId: b!.id, kind })));
      return b!;
    });
    for (const kind of DRAFT_KIND_KEYS) await this.queue.add({ batchId: batch.id, kind });
    return this.view(batch);
  }

  // 只把失败的份重新排队，已生成的不动
  async retry(user: SessionUser, id: string): Promise<GenerationProgress> {
    const task = await this.workup.task(user, id);
    const batch = await this.latest(task.id);
    if (!batch) throw new BadRequestException('还没有生成过草稿');
    const queued = await this.db
      .update(generatedDrafts)
      .set({ status: 'queued', error: null, startedAt: null, finishedAt: null })
      .where(and(eq(generatedDrafts.batchId, batch.id), eq(generatedDrafts.status, 'failed')))
      .returning({ kind: generatedDrafts.kind });
    if (queued.length === 0) throw new BadRequestException('没有失败的草稿需要重试');
    for (const { kind } of queued) await this.queue.add({ batchId: batch.id, kind });
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
      const rendered = await this.render(kind, batch.input);
      const name = `${batch.input.basic.companyName}${DRAFT_KINDS[kind]}（草稿）`;
      const wordFileId = await this.store(batch.orgId, batch.createdBy, `${name}.docx`, DOCX, rendered.word);
      const pdfFileId = rendered.pdf ? await this.store(batch.orgId, batch.createdBy, `${name}.pdf`, 'application/pdf', rendered.pdf) : null;
      await this.db
        .update(generatedDrafts)
        .set({ status: 'done', wordFileId, pdfFileId, notes: rendered.notes, error: null, finishedAt: new Date() })
        .where(where);
    } catch (err) {
      console.error('草稿生成失败', batchId, kind, err);
      const reason = err instanceof Error && err.message ? err.message.slice(0, 200) : '未知原因';
      await this.db.update(generatedDrafts).set({ status: 'failed', error: `生成没有完成：${reason}`, finishedAt: new Date() }).where(where);
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
    return {
      id: batch.id,
      workupVersion: batch.workupVersion,
      snapshotAt: batch.snapshotAt.toISOString(),
      materials: batch.materials,
      createdAt: batch.createdAt.toISOString(),
      createdByName: by?.name ?? '',
      drafts: (await this.drafts(batch.id)).map((d) => ({
        kind: d.kind as DraftKind,
        status: d.status,
        attempts: d.attempts,
        wordFileId: d.wordFileId,
        pdfFileId: d.pdfFileId,
        error: d.error,
        startedAt: iso(d.startedAt),
        finishedAt: iso(d.finishedAt),
      })),
    };
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

  @Post()
  async confirm(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return { current: await this.service.confirm(user, id, body) };
  }

  @Post('retry')
  async retry(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return { current: await this.service.retry(user, id) };
  }
}
