// 确认采用资料并生成三份草稿（M2 第 10 项，14 页 E18-01、E18-02、E18-02b）。
// 专家确认时检查必需项和整理版本，锁定采用的资料并拼好生成输入；三份草稿各自排队生成，
// 哪份失败只重试那一份，已生成的保留。
import {
  chinaToday,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  draftActive,
  generationConfirmSchema,
  materialsFingerprint,
  planDrawingsOf,
  planInputOf,
  SELF_FILL_STEP_TITLES,
  workupGaps,
  type DraftKind,
  type GenerationMaterials,
  type GenerationProgress,
  type LockedMaterial,
  type AdoptedMaterial,
  type WorkupSnapshot,
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
import {
  enterpriseDocumentVersions,
  files,
  generatedDrafts,
  generationBatches,
  taskDocuments,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { serializeDocument } from '../generation/document-json.ts';
import { DRAFT_RENDERER, type DraftRenderer } from '../generation/drafts.ts';
import { DRAFT_QUEUE, type DraftJob, type DraftQueue } from '../generation/queue.ts';
import { DrawingsService } from './drawings.service.ts';
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
    // 专家看确认页以后客户又传了文件或新版本：不生成，留在本页把变了的行标出来
    if (parsed.data.materials !== undefined) {
      const now = await this.materialsOf(task.id, row.snapshot, row.snapshotAt);
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
    const drawings = planDrawingsOf(await this.drawings.drawingsOf(task.id, task.orgId, row.snapshot, row.data));
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
          input: { ...planInputOf(row.snapshot, row.data, chinaToday()), drawings },
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

  // 确认页左表：本次采用的资料，以及与整理时相比有没有变化
  async materials(user: SessionUser, id: string): Promise<GenerationMaterials> {
    const task = await this.workup.task(user, id);
    const [row] = await this.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, task.id)).limit(1);
    if (!row) throw new BadRequestException('还没有开始整理');
    return this.materialsOf(task.id, row.snapshot, row.snapshotAt);
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

    const rows: AdoptedMaterial[] = originals.map((o) => {
      const top = o.version !== null ? newest(o.fileId) : undefined;
      const change =
        top && top.version > o.version!
          ? ({ kind: 'newer', version: top.version, uploadedAt: top.createdAt.toISOString() } as const)
          : o.uploadedAt > snapshotAt
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
      };
    });
    const p = snapshot.profile;
    [p.basicStep, p.organizationStep, p.productionStep, p.resourcesStep].forEach((filled, i) => {
      if (!filled) return;
      rows.push({ key: `step-${i + 1}`, name: SELF_FILL_STEP_TITLES[i]!, fileId: null, version: null, step: i + 1, uploadedAt: null, change: null });
    });
    return { rows, fingerprint: materialsFingerprint(rows) };
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
      const drawings = kind === 'plan' ? await this.drawings.images(batch.input.drawings ?? []) : undefined;
      const rendered = await this.render(kind, batch.input, drawings);
      const name = `${batch.input.basic.companyName}${DRAFT_KINDS[kind]}（草稿）`;
      const wordFileId = await this.store(batch.orgId, batch.createdBy, `${name}.docx`, DOCX, rendered.word);
      const pdfFileId = rendered.pdf ? await this.store(batch.orgId, batch.createdBy, `${name}.pdf`, 'application/pdf', rendered.pdf) : null;
      const documentFileId = await this.store(batch.orgId, batch.createdBy, `${name}.json`, 'application/json', serializeDocument(rendered.document));
      await this.db
        .update(generatedDrafts)
        .set({ status: 'done', wordFileId, pdfFileId, documentFileId, notes: rendered.notes, error: null, finishedAt: new Date() })
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

  @Get('materials')
  async materials(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.materials(user, id);
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
