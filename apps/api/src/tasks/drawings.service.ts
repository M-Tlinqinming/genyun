// 客户图纸（M2 第 10c 项）：图件页「客户图纸」列出任务里的总平面图、疏散图、消防设施布置图，
// 给每页缩略图，专家勾选放进附件 7 的页；生成应急预案时按锁定的页取高清图。
// 每页只转一次（CAD 导出的 PDF 一页可能要半分钟），转好的图存在文件存储里，记在 drawing_pages。
import {
  CUSTOMER_DRAWING_KEYS,
  isDrawingContentType,
  MAX_DRAWING_PAGES,
  selectedPages,
  type CustomerDrawing,
  type CustomerDrawingKey,
  type PlanDrawingRef,
  type WorkupData,
  type WorkupSnapshot,
} from '@genyun/shared';
import { Controller, Get, Inject, Injectable, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Res, type OnApplicationShutdown } from '@nestjs/common';
import type { Response } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { drawingPages, drawingSources, files, taskWorkups } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import type { PlanDrawings } from '../generation/plan/assemble.ts';
import { DRAWING_OF_ITEM } from '../generation/plan/attachments.ts';
import { DrawingRenderer } from '../generation/drawings/renderer.ts';
import { WorkupService } from './workup.service.ts';

export const DRAWING_RENDERER = Symbol('DRAWING_RENDERER');

// 任务里的一份图纸文件
export interface DrawingFile {
  fileId: string;
  orgId: string;
  name: string;
  contentType: string;
  storageKey: string;
  key: CustomerDrawingKey;
}

type PageRow = typeof drawingPages.$inferSelect;

@Injectable()
export class DrawingsService implements OnApplicationShutdown {
  // 同一页同时有几个请求（页面一次要好几张缩略图）时只转一次
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WorkupService) private readonly workup: WorkupService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(DRAWING_RENDERER) private readonly renderer: DrawingRenderer,
  ) {}

  async onApplicationShutdown() {
    await this.renderer.close();
  }

  // 图件页「客户图纸」
  async list(user: SessionUser, taskId: string): Promise<CustomerDrawing[]> {
    const task = await this.workup.task(user, taskId);
    const [row] = await this.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, task.id)).limit(1);
    if (!row) return [];
    return this.drawingsOf(task.id, task.orgId, row.snapshot, row.data);
  }

  // 确认生成时锁定、保存选页时校验都用这一份
  async drawingsOf(taskId: string, orgId: string, snapshot: WorkupSnapshot, data: WorkupData): Promise<CustomerDrawing[]> {
    const selection = data.figures?.drawings;
    const out: CustomerDrawing[] = [];
    for (const f of await this.files(taskId, orgId, snapshot)) {
      const { pageCount, error } = await this.pageCount(f);
      const selected = pageCount ? selectedPages(selection, f.fileId, pageCount) : [];
      out.push({
        fileId: f.fileId,
        name: f.name,
        contentType: f.contentType,
        key: f.key,
        pageCount,
        ...(error ? { error } : {}),
        selected,
        customized: selection?.[f.fileId] !== undefined,
      });
    }
    return out;
  }

  // 任务里的图纸文件：上传已有资料挂在资料项上的，加上企业自填第 4 步上传的；只认本组织的 PDF 与图片
  async files(taskId: string, orgId: string, snapshot: WorkupSnapshot): Promise<DrawingFile[]> {
    const candidates = await this.workup.drawingCandidates(taskId, orgId, snapshot);
    const keyOf = new Map(candidates.map((c) => [c.fileId, c.key]));
    const names = new Map(candidates.filter((c) => c.name).map((c) => [c.fileId, c.name!]));
    if (keyOf.size === 0) return [];
    const rows = await this.db
      .select({ id: files.id, orgId: files.orgId, name: files.originalName, contentType: files.contentType, storageKey: files.storageKey })
      .from(files)
      .where(and(inArray(files.id, [...keyOf.keys()]), eq(files.orgId, orgId)));
    const order = [...keyOf.keys()];
    return rows
      .filter((r) => isDrawingContentType(r.contentType))
      .map((r) => ({ fileId: r.id, orgId: r.orgId, name: names.get(r.id) ?? r.name, contentType: r.contentType, storageKey: r.storageKey, key: keyOf.get(r.id)! }))
      .sort((a, b) => CUSTOMER_DRAWING_KEYS.indexOf(a.key) - CUSTOMER_DRAWING_KEYS.indexOf(b.key) || order.indexOf(a.fileId) - order.indexOf(b.fileId));
  }

  // 缩略图（JPEG）：负责专家和运营能看，图纸必须是这个任务的
  async thumbnail(user: SessionUser, taskId: string, fileId: string, page: number): Promise<Buffer> {
    const file = await this.taskFile(user, taskId, fileId);
    const row = await this.page(file, page);
    return this.storage.read(row.thumbKey);
  }

  // 生成应急预案时取锁定的各页高清图，按附件 7 的种类分组
  async images(refs: PlanDrawingRef[]): Promise<PlanDrawings> {
    if (refs.length === 0) return {};
    const rows = await this.db
      .select({ id: files.id, orgId: files.orgId, name: files.originalName, contentType: files.contentType, storageKey: files.storageKey })
      .from(files)
      .where(inArray(files.id, [...new Set(refs.map((r) => r.fileId))]));
    const out: PlanDrawings = {};
    for (const ref of refs) {
      const f = rows.find((r) => r.id === ref.fileId);
      if (!f) throw new Error('客户图纸找不到了');
      const row = await this.page({ fileId: f.id, orgId: f.orgId, name: f.name, contentType: f.contentType, storageKey: f.storageKey, key: ref.key }, ref.page);
      const png = await this.storage.read(row.fullKey);
      (out[DRAWING_OF_ITEM[ref.key]] ??= []).push({ png, imageType: row.fullType === 'jpg' ? 'jpg' : 'png', width: row.width, height: row.height });
    }
    return out;
  }

  private async taskFile(user: SessionUser, taskId: string, fileId: string): Promise<DrawingFile> {
    const task = await this.workup.task(user, taskId);
    const [row] = await this.db.select({ snapshot: taskWorkups.snapshot }).from(taskWorkups).where(eq(taskWorkups.taskId, task.id)).limit(1);
    const file = row && (await this.files(task.id, task.orgId, row.snapshot)).find((f) => f.fileId === fileId);
    if (!file) throw new NotFoundException('这份图纸不在这个任务里');
    return file;
  }

  // 页数只算一次；转不出来的记下原因，页面提示专家
  private async pageCount(f: DrawingFile): Promise<{ pageCount: number | null; error?: string }> {
    const [cached] = await this.db.select().from(drawingSources).where(eq(drawingSources.fileId, f.fileId)).limit(1);
    if (cached) return { pageCount: cached.pageCount, ...(cached.error ? { error: cached.error } : {}) };
    return this.once(`count:${f.fileId}`, async () => {
      let pageCount: number | null = null;
      let error: string | null = null;
      try {
        pageCount = Math.min(await this.renderer.count(await this.storage.read(f.storageKey), f.contentType), MAX_DRAWING_PAGES);
        if (pageCount < 1) throw new Error('没有页面');
      } catch (err) {
        console.error('图纸读取失败', f.fileId, err);
        pageCount = null;
        error = '这份文件打不开，可能已损坏或设了密码，请联系客户重新上传';
      }
      await this.db.insert(drawingSources).values({ fileId: f.fileId, pageCount, error }).onConflictDoNothing();
      return { pageCount, ...(error ? { error } : {}) };
    });
  }

  private async page(f: DrawingFile, page: number): Promise<PageRow> {
    const where = and(eq(drawingPages.fileId, f.fileId), eq(drawingPages.page, page));
    const [cached] = await this.db.select().from(drawingPages).where(where).limit(1);
    if (cached) return cached;
    const { pageCount } = await this.pageCount(f);
    if (!pageCount || page < 1 || page > pageCount) throw new NotFoundException('没有这一页');
    return this.once(`page:${f.fileId}:${page}`, async () => {
      const rendered = await this.renderer.render(await this.storage.read(f.storageKey), f.contentType, page);
      const fullKey = `${f.orgId}/${randomUUID()}`;
      const thumbKey = `${f.orgId}/${randomUUID()}`;
      await this.storage.put(fullKey, Buffer.from(rendered.full), rendered.fullType === 'png' ? 'image/png' : 'image/jpeg');
      await this.storage.put(thumbKey, Buffer.from(rendered.thumb), 'image/jpeg');
      await this.db
        .insert(drawingPages)
        .values({ fileId: f.fileId, page, fullKey, fullType: rendered.fullType, width: rendered.width, height: rendered.height, thumbKey })
        .onConflictDoNothing();
      const [row] = await this.db.select().from(drawingPages).where(where).limit(1);
      return row!;
    });
  }

  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

@Controller('tasks/:id/drawings')
export class DrawingsController {
  constructor(@Inject(DrawingsService) private readonly service: DrawingsService) {}

  @Get()
  async list(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return { drawings: await this.service.list(user, id) };
  }

  // 每页内容不会变（文件只增不改），浏览器可以一直缓存
  @Get(':fileId/pages/:page/thumb')
  async thumb(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Param('page', ParseIntPipe) page: number,
    @Res() res: Response,
  ) {
    const data = await this.service.thumbnail(user, id, fileId, page);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(data);
  }
}
