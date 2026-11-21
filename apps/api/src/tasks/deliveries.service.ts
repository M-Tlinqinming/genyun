// 客户成果文档（M2 第 16 项，11 页 C06；15 页 R05）：已交付的三份 Word 按交付先后列出（本组织的客户只拿最新一版），
// 单份下载（走 /files/:id/download-url）、整套下载（三份打包成一个压缩包）。在线阅读已取消。
// 谁能看由 access.ts 的 canViewDeliveries / canViewOrganization 决定；别家客户、其他专家一律 404，不暴露任务是否存在
import { DRAFT_KIND_KEYS, deliveryBundleName, safeFileName, type DeliveredVersion, type TaskDeliveries } from '@genyun/shared';
import {
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  type PipeTransform,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Response } from 'express';
import JSZip from 'jszip';
import { canViewDeliveries, canViewOrganization, customerMembership, enterpriseScope } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { assertDeliveryDownloadable, lockInfo } from '../credits/credits.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { deliveries, deliveryFiles, enterprises, files, tasks } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';

const NOT_FOUND = '找不到该成果';

type TaskRow = {
  id: string;
  orgId: string;
  assignedExpertId: string | null;
  number: string;
  name: string;
  enterpriseId: string;
  enterpriseName: string;
  chargeStatus: string | null;
};

@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /** 成果文档列表（C06）：本组织每个已交付任务的全部交付版本，最近发布的任务在前 */
  async listForOrg(user: SessionUser, orgId: string): Promise<TaskDeliveries[]> {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    // 成员只列出分配给自己的企业的成果
    const scope = enterpriseScope(user, orgId);
    if (Array.isArray(scope) && scope.length === 0) return [];
    const list = await this.tasks().where(and(eq(tasks.orgId, orgId), isNull(tasks.deletedAt), Array.isArray(scope) ? inArray(tasks.enterpriseId, scope) : undefined));
    const built = await this.build(user, list);
    return built.sort((a, b) => b.versions[0]!.publishedAt.localeCompare(a.versions[0]!.publishedAt));
  }

  /** 一个任务的成果（R05）；还没有交付版本时 versions 为空 */
  async forTask(user: SessionUser, taskId: string): Promise<TaskDeliveries> {
    const task = await this.task(user, taskId);
    const [built] = await this.build(user, [task], true);
    return built!;
  }

  /** 整套下载：同一个交付版本的三份 Word 打成一个压缩包，避免混用版本 */
  async bundle(user: SessionUser, taskId: string, version: number): Promise<{ name: string; data: Buffer }> {
    const task = await this.task(user, taskId);
    // 成果先锁住（等次数）时客户不能下载
    await assertDeliveryDownloadable(this.db, user, task);
    const delivery = await this.delivery(task.id, version);
    // 客户只拿得到最新一版：再次交付以后，旧的那一版不再提供下载（专家、运营照旧）
    if (customerMembership(user, task.orgId)) {
      const [latest] = await this.db
        .select({ version: deliveries.version })
        .from(deliveries)
        .where(and(eq(deliveries.taskId, task.id), eq(deliveries.status, 'done')))
        .orderBy(desc(deliveries.version))
        .limit(1);
      if (latest?.version !== delivery.version) throw new NotFoundException('找不到这次交付');
    }
    const rows = await this.db
      .select({ kind: deliveryFiles.kind, name: files.originalName, storageKey: files.storageKey })
      .from(deliveryFiles)
      .innerJoin(files, eq(files.id, deliveryFiles.fileId))
      .where(eq(deliveryFiles.deliveryId, delivery.id));
    const zip = new JSZip();
    for (const kind of DRAFT_KIND_KEYS) {
      const row = rows.find((r) => r.kind === kind);
      if (row) zip.file(safeFileName(row.name), await this.storage.read(row.storageKey));
    }
    // Word 本身已经压缩过，打包时不再压缩
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return { name: deliveryBundleName(task.enterpriseName, delivery.publishedAt ?? delivery.updatedAt), data };
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
        chargeStatus: tasks.chargeStatus,
      })
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId));
  }

  private async task(user: SessionUser, taskId: string): Promise<TaskRow> {
    const [task] = await this.tasks().where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt))).limit(1);
    if (!task || !canViewDeliveries(user, task)) throw new NotFoundException(NOT_FOUND);
    return task;
  }

  private async delivery(taskId: string, version: number) {
    const [row] = await this.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.taskId, taskId), eq(deliveries.version, version), eq(deliveries.status, 'done')))
      .limit(1);
    if (!row) throw new NotFoundException('找不到这次交付');
    return row;
  }

  // 每个任务只列已形成的交付版本（发布中、失败的不算）。keepEmpty：单个任务没有交付时也返回（versions 为空）
  private async build(user: SessionUser, list: TaskRow[], keepEmpty = false): Promise<TaskDeliveries[]> {
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

    // 等次数的任务：锁住的原因和管理员名字（同一组织只查一次）
    // 只给本组织的客户看：管理员看原因和管理员名字，成员只看管理员名字；专家、运营一律不带
    const locks = new Map<string, TaskDeliveries['lock']>();
    for (const t of list) {
      if (t.chargeStatus !== 'awaiting_credits' || locks.has(t.orgId)) continue;
      const m = customerMembership(user, t.orgId);
      if (!m) {
        locks.set(t.orgId, null);
        continue;
      }
      const info = await lockInfo(this.db, t.orgId);
      locks.set(t.orgId, m.role === 'customer_admin' ? info : { adminNames: info.adminNames });
    }

    return list.flatMap((t): TaskDeliveries[] => {
      // 本组织的客户只拿最新一版；专家、运营照旧拿全部
      const latestOnly = !!customerMembership(user, t.orgId);
      const versions = done
        .filter((d) => d.taskId === t.id)
        .slice(0, latestOnly ? 1 : undefined)
        .map(
          (d): DeliveredVersion => ({
            version: d.version,
            publishedAt: (d.publishedAt ?? d.updatedAt).toISOString(),
            files: DRAFT_KIND_KEYS.flatMap((kind) =>
              fileRows
                .filter((f) => f.deliveryId === d.id && f.kind === kind)
                .map((f) => ({ kind, name: f.name, fileId: f.fileId, sizeBytes: f.sizeBytes })),
            ),
            updateNote: d.updateNote?.trim() || null,
          }),
        );
      if (versions.length === 0 && !keepEmpty) return [];
      return [
        {
          taskId: t.id,
          taskNumber: t.number,
          taskName: t.name,
          enterpriseId: t.enterpriseId,
          enterpriseName: t.enterpriseName,
          versions,
          lock: t.chargeStatus === 'awaiting_credits' ? (locks.get(t.orgId) ?? null) : null,
        },
      ];
    });
  }
}

// 中文文件名按 RFC 5987 写入下载头；encodeURIComponent 不转义 '()*，这里补上
export function attachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// 交付版本号：不是正整数或超出整数范围，一律当作找不到
const MAX_VERSION = 2_147_483_647;
@Injectable()
class VersionPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > MAX_VERSION) throw new NotFoundException('找不到这次交付');
    return Number(value);
  }
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
    @Param('version', VersionPipe) version: number,
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
}
