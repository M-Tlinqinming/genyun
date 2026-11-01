// 客户成果文档（M2 第 16 项，11 页 C06；15 页 R05、R06）：已交付的三份 Word 按交付版本（V1、V2…）列出，
// 在线阅读（发布时那一版的 PDF）、单份下载（走 /files/:id/download-url）、整套下载（三份打包成一个压缩包）。
// 谁能看由 access.ts 的 canViewDeliveries / canViewOrganization 决定；别家客户、其他注安师一律 404，不暴露任务是否存在
import { DRAFT_KIND_KEYS, deliveryBundleName, type DeliveredVersion, type DraftKind, type TaskDeliveries } from '@genyun/shared';
import { Controller, Get, Inject, Injectable, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Res } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Response } from 'express';
import JSZip from 'jszip';
import { canViewDeliveries, canViewOrganization } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { deliveries, deliveryFiles, draftPreviews, enterprises, files, generatedDrafts, tasks } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';

const NOT_FOUND = '找不到该成果';

type TaskRow = { id: string; orgId: string; assignedExpertId: string | null; number: string; name: string; enterpriseId: string; enterpriseName: string };

@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /** 成果文档列表（C06）：本组织每个已交付任务的全部交付版本，最近发布的任务在前 */
  async listForOrg(user: SessionUser, orgId: string): Promise<TaskDeliveries[]> {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    const list = await this.tasks().where(eq(tasks.orgId, orgId));
    const built = await this.build(list);
    return built.sort((a, b) => b.versions[0]!.publishedAt.localeCompare(a.versions[0]!.publishedAt));
  }

  /** 一个任务的成果（R05）；还没有交付版本时 versions 为空 */
  async forTask(user: SessionUser, taskId: string): Promise<TaskDeliveries> {
    const task = await this.task(user, taskId);
    const [built] = await this.build([task], true);
    return built!;
  }

  /** 在线阅读（R06）：发布时那一版的 PDF。没有转好的版式时 404，页面提示下载 Word */
  async readingPdf(user: SessionUser, taskId: string, version: number, kind: string): Promise<Buffer> {
    const task = await this.task(user, taskId);
    if (!isKind(kind)) throw new NotFoundException(NOT_FOUND);
    const delivery = await this.delivery(task.id, version);
    const pdf = await this.pdfFor(delivery.batchId, kind, delivery.versions[kind]);
    if (!pdf) throw new NotFoundException('这份成果暂时不能在线阅读，请下载 Word 查看');
    return this.storage.read(pdf.storageKey);
  }

  /** 整套下载：同一个交付版本的三份 Word 打成一个压缩包，避免混用版本 */
  async bundle(user: SessionUser, taskId: string, version: number): Promise<{ name: string; data: Buffer }> {
    const task = await this.task(user, taskId);
    const delivery = await this.delivery(task.id, version);
    const rows = await this.db
      .select({ kind: deliveryFiles.kind, name: files.originalName, storageKey: files.storageKey })
      .from(deliveryFiles)
      .innerJoin(files, eq(files.id, deliveryFiles.fileId))
      .where(eq(deliveryFiles.deliveryId, delivery.id));
    const zip = new JSZip();
    for (const kind of DRAFT_KIND_KEYS) {
      const row = rows.find((r) => r.kind === kind);
      if (row) zip.file(row.name, await this.storage.read(row.storageKey));
    }
    // Word 本身已经压缩过，打包时不再压缩
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return { name: deliveryBundleName(task.enterpriseName, version), data };
  }

  private tasks() {
    return this.db
      .select({
        id: tasks.id,
        orgId: tasks.orgId,
        assignedExpertId: tasks.assignedExpertId,
        number: tasks.number,
        name: tasks.name,
        enterpriseId: tasks.enterpriseId,
        enterpriseName: enterprises.name,
      })
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId));
  }

  private async task(user: SessionUser, taskId: string): Promise<TaskRow> {
    const [task] = await this.tasks().where(eq(tasks.id, taskId)).limit(1);
    if (!task || !canViewDeliveries(user, task)) throw new NotFoundException(NOT_FOUND);
    return task;
  }

  private async delivery(taskId: string, version: number) {
    const [row] = await this.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.taskId, taskId), eq(deliveries.version, version), eq(deliveries.status, 'done')))
      .limit(1);
    if (!row) throw new NotFoundException('找不到这个交付版本');
    return row;
  }

  // 每个任务只列已形成的交付版本（发布中、失败的不算）。keepEmpty：单个任务没有交付时也返回（versions 为空）
  private async build(list: TaskRow[], keepEmpty = false): Promise<TaskDeliveries[]> {
    if (list.length === 0) return [];
    const done = await this.db
      .select()
      .from(deliveries)
      .where(and(inArray(deliveries.taskId, list.map((t) => t.id)), eq(deliveries.status, 'done')))
      .orderBy(desc(deliveries.version));
    const fileRows = done.length
      ? await this.db
          .select({ deliveryId: deliveryFiles.deliveryId, kind: deliveryFiles.kind, fileId: files.id, name: files.originalName, sizeBytes: files.sizeBytes })
          .from(deliveryFiles)
          .innerJoin(files, eq(files.id, deliveryFiles.fileId))
          .where(inArray(deliveryFiles.deliveryId, done.map((d) => d.id)))
      : [];
    const readable = await this.readableSet(done);

    return list.flatMap((t): TaskDeliveries[] => {
      const versions = done
        .filter((d) => d.taskId === t.id)
        .map(
          (d): DeliveredVersion => ({
            version: d.version,
            publishedAt: (d.publishedAt ?? d.updatedAt).toISOString(),
            files: DRAFT_KIND_KEYS.flatMap((kind) =>
              fileRows
                .filter((f) => f.deliveryId === d.id && f.kind === kind)
                .map((f) => ({ kind, name: f.name, fileId: f.fileId, sizeBytes: f.sizeBytes, readable: readable.has(`${d.id}/${kind}`) })),
            ),
          }),
        );
      if (versions.length === 0 && !keepEmpty) return [];
      return [{ taskId: t.id, taskNumber: t.number, taskName: t.name, enterpriseId: t.enterpriseId, enterpriseName: t.enterpriseName, versions }];
    });
  }

  // 哪些交付版本的哪几份有可以在线阅读的 PDF：没改过的用生成时转好的，改过的用核对时按那一版转好的
  private async readableSet(done: (typeof deliveries.$inferSelect)[]): Promise<Set<string>> {
    const set = new Set<string>();
    if (done.length === 0) return set;
    const batchIds = done.map((d) => d.batchId);
    const generated = await this.db
      .select({ batchId: generatedDrafts.batchId, kind: generatedDrafts.kind, pdfFileId: generatedDrafts.pdfFileId })
      .from(generatedDrafts)
      .where(inArray(generatedDrafts.batchId, batchIds));
    const previews = await this.db
      .select({ batchId: draftPreviews.batchId, kind: draftPreviews.kind, version: draftPreviews.version, status: draftPreviews.status, fileId: draftPreviews.fileId })
      .from(draftPreviews)
      .where(inArray(draftPreviews.batchId, batchIds));
    for (const d of done) {
      for (const kind of DRAFT_KIND_KEYS) {
        const v = d.versions[kind];
        const fromGenerated = v === 0 && generated.some((g) => g.batchId === d.batchId && g.kind === kind && g.pdfFileId);
        const fromPreview = previews.some((p) => p.batchId === d.batchId && p.kind === kind && p.version === v && p.status === 'done' && p.fileId);
        if (fromGenerated || fromPreview) set.add(`${d.id}/${kind}`);
      }
    }
    return set;
  }

  private async pdfFor(batchId: string, kind: DraftKind, version: number) {
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
}

const isKind = (k: string): k is DraftKind => (DRAFT_KIND_KEYS as string[]).includes(k);

// 中文文件名按 RFC 5987 写入下载头
function attachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller()
export class DeliveriesController {
  constructor(@Inject(DeliveriesService) private readonly service: DeliveriesService) {}

  @Get('orgs/:orgId/deliveries')
  list(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.listForOrg(user, orgId);
  }

  @Get('tasks/:id/deliveries')
  forTask(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.forTask(user, id);
  }

  @Get('tasks/:id/deliveries/:version/bundle')
  async bundle(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Res() res: Response,
  ) {
    const { name, data } = await this.service.bundle(user, id, version);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(name),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(data);
  }

  @Get('tasks/:id/deliveries/:version/:kind/pdf')
  async pdf(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Param('kind') kind: string,
    @Res() res: Response,
  ) {
    const data = await this.service.readingPdf(user, id, version, kind);
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(data);
  }
}
