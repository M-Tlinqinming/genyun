import type { Category, TaskDocumentSelection } from '@genyun/shared';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { canEditOrganizationData, canViewOrganization } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  enterpriseDocuments,
  enterpriseDocumentVersions,
  enterprises,
  files,
  taskDocuments,
  tasks,
} from '../db/schema.ts';
import { TasksService } from '../tasks/tasks.service.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

// 把一个已上传的文件登记进企业资料库（新资料的 V1）。同一文件已登记过的直接返回那个版本；
// 自填上传的文件带分类，之前没分类的顺带补上
export async function registerFile(
  db: Executor,
  userId: string,
  target: { orgId: string; enterpriseId: string },
  fileId: string,
  category: Category | null = null,
) {
  const [existing] = await db
    .select({
      id: enterpriseDocumentVersions.id,
      documentId: enterpriseDocumentVersions.documentId,
      category: enterpriseDocuments.category,
    })
    .from(enterpriseDocumentVersions)
    .innerJoin(enterpriseDocuments, eq(enterpriseDocuments.id, enterpriseDocumentVersions.documentId))
    .where(and(eq(enterpriseDocumentVersions.fileId, fileId), eq(enterpriseDocuments.enterpriseId, target.enterpriseId)))
    .limit(1);
  if (existing) {
    if (category && !existing.category) {
      await db.update(enterpriseDocuments).set({ category }).where(eq(enterpriseDocuments.id, existing.documentId));
    }
    return { id: existing.id, documentId: existing.documentId };
  }

  const [file] = await db
    .select({ originalName: files.originalName })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.orgId, target.orgId), eq(files.kind, 'customer_material')))
    .limit(1);
  if (!file) throw new NotFoundException('找不到该文件');
  const [doc] = await db
    .insert(enterpriseDocuments)
    .values({ orgId: target.orgId, enterpriseId: target.enterpriseId, name: file.originalName, category, createdBy: userId })
    .returning({ id: enterpriseDocuments.id });
  const [version] = await db
    .insert(enterpriseDocumentVersions)
    .values({ documentId: doc!.id, version: 1, fileId, createdBy: userId })
    .returning({ id: enterpriseDocumentVersions.id, documentId: enterpriseDocumentVersions.documentId });
  return version!;
}

// 企业资料库（TECH-PLAN 3.4.2）：企业名下的资料与版本；任务关联某份资料的某个版本，新版本不会自动替换
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TasksService) private readonly tasks: TasksService,
  ) {}

  // ---- 企业资料库（11 页 C03） ----

  async listForEnterprise(user: SessionUser, enterpriseId: string) {
    await this.enterprise(user, enterpriseId);
    const docs = await this.db
      .select({
        id: enterpriseDocuments.id,
        name: enterpriseDocuments.name,
        category: enterpriseDocuments.category,
        updatedAt: enterpriseDocuments.updatedAt,
      })
      .from(enterpriseDocuments)
      .where(eq(enterpriseDocuments.enterpriseId, enterpriseId))
      .orderBy(desc(enterpriseDocuments.updatedAt));
    const versions = await this.versionsOf(docs.map((d) => d.id));
    return docs.map((d) => {
      const own = versions.filter((v) => v.documentId === d.id);
      return { ...d, category: d.category as Category | null, latest: own[0]!, versionCount: own.length };
    });
  }

  // 客户在资料库直接上传，不关联任务；分类待整理
  async upload(user: SessionUser, enterpriseId: string, fileId: string) {
    const ent = await this.editableEnterprise(user, enterpriseId);
    await registerFile(this.db, user.id, { orgId: ent.orgId, enterpriseId }, fileId);
    return this.listForEnterprise(user, enterpriseId);
  }

  // 上传新版本：版本号加一；任务里用的还是原来的版本，要换需在任务里重新选用
  async addVersion(user: SessionUser, enterpriseId: string, documentId: string, fileId: string) {
    const ent = await this.editableEnterprise(user, enterpriseId);
    await this.documentOf(enterpriseId, documentId);
    const [file] = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.orgId, ent.orgId), eq(files.kind, 'customer_material')))
      .limit(1);
    if (!file) throw new NotFoundException('找不到该文件');
    const [used] = await this.db
      .select({ id: enterpriseDocumentVersions.id })
      .from(enterpriseDocumentVersions)
      .where(eq(enterpriseDocumentVersions.fileId, fileId))
      .limit(1);
    if (used) throw new BadRequestException('这个文件已经登记在资料库里，请选择新的文件');

    await this.db.transaction(async (tx) => {
      const [top] = await tx
        .select({ n: max(enterpriseDocumentVersions.version) })
        .from(enterpriseDocumentVersions)
        .where(eq(enterpriseDocumentVersions.documentId, documentId));
      await tx
        .insert(enterpriseDocumentVersions)
        .values({ documentId, version: (top?.n ?? 0) + 1, fileId, createdBy: user.id });
      await tx.update(enterpriseDocuments).set({ updatedAt: new Date() }).where(eq(enterpriseDocuments.id, documentId));
    });
    return this.detail(user, enterpriseId, documentId);
  }

  // 一份资料的全部版本，以及每个版本被哪些任务使用
  async detail(user: SessionUser, enterpriseId: string, documentId: string) {
    await this.enterprise(user, enterpriseId);
    const doc = await this.documentOf(enterpriseId, documentId);
    const versions = await this.versionsOf([documentId]);
    const usage = await this.db
      .select({
        versionId: taskDocuments.versionId,
        taskId: tasks.id,
        number: tasks.number,
        name: tasks.name,
        status: tasks.status,
      })
      .from(taskDocuments)
      .innerJoin(tasks, eq(tasks.id, taskDocuments.taskId))
      .where(eq(taskDocuments.documentId, documentId))
      .orderBy(asc(tasks.number));
    return {
      ...doc,
      category: doc.category as Category | null,
      versions: versions.map((v) => ({
        ...v,
        tasks: usage.filter((u) => u.versionId === v.versionId).map(({ versionId: _, ...t }) => t),
      })),
    };
  }

  // ---- 任务关联（12 页 P03、P03B、P04） ----

  async listForTask(user: SessionUser, taskId: string) {
    await this.tasks.load(user, taskId);
    return this.taskDocumentsOf(taskId);
  }

  // 刚上传的文件登记进任务所属企业的资料库并关联到任务。同一文件已登记过的，直接关联那个版本
  // 提交以后仍可以加新文件（补待补清单里的项），已提交的资料版本不动
  async addToTask(user: SessionUser, taskId: string, fileId: string) {
    const task = await this.editableTask(user, taskId, true);
    await this.db.transaction(async (tx) => {
      const version = await registerFile(tx, user.id, task, fileId);
      await tx
        .insert(taskDocuments)
        .values({ taskId, documentId: version.documentId, versionId: version.id, linkedBy: user.id })
        .onConflictDoUpdate({
          target: [taskDocuments.taskId, taskDocuments.documentId],
          set: { versionId: version.id, linkedBy: user.id, linkedAt: new Date() },
        });
    });
    return this.taskDocumentsOf(taskId);
  }

  // 从资料库选用：确认后任务关联的就是选中的这些资料与版本；没选的取消关联，原件保留
  async selectForTask(user: SessionUser, taskId: string, input: TaskDocumentSelection) {
    const task = await this.editableTask(user, taskId);
    const versionIds = input.selections.map((s) => s.versionId);
    const valid =
      versionIds.length === 0
        ? []
        : await this.db
            .select({ id: enterpriseDocumentVersions.id, documentId: enterpriseDocumentVersions.documentId })
            .from(enterpriseDocumentVersions)
            .innerJoin(enterpriseDocuments, eq(enterpriseDocuments.id, enterpriseDocumentVersions.documentId))
            .where(and(inArray(enterpriseDocumentVersions.id, versionIds), eq(enterpriseDocuments.enterpriseId, task.enterpriseId)));
    for (const s of input.selections) {
      if (!valid.some((v) => v.id === s.versionId && v.documentId === s.documentId)) {
        throw new NotFoundException('找不到所选资料，可能已被删除或不属于这家企业');
      }
    }

    await this.db.transaction(async (tx) => {
      const current = await tx
        .select({ documentId: taskDocuments.documentId, versionId: taskDocuments.versionId })
        .from(taskDocuments)
        .where(eq(taskDocuments.taskId, taskId));
      const chosen = new Map(input.selections.map((s) => [s.documentId, s.versionId]));
      const dropped = current.filter((c) => !chosen.has(c.documentId)).map((c) => c.documentId);
      if (dropped.length > 0) {
        await tx.delete(taskDocuments).where(and(eq(taskDocuments.taskId, taskId), inArray(taskDocuments.documentId, dropped)));
      }
      for (const s of input.selections) {
        const was = current.find((c) => c.documentId === s.documentId);
        if (was?.versionId === s.versionId) continue;
        await tx
          .insert(taskDocuments)
          .values({ taskId, documentId: s.documentId, versionId: s.versionId, linkedBy: user.id })
          .onConflictDoUpdate({
            target: [taskDocuments.taskId, taskDocuments.documentId],
            set: { versionId: s.versionId, linkedBy: user.id, linkedAt: new Date() },
          });
      }
    });
    return this.taskDocumentsOf(taskId);
  }

  // 只取消任务里的关联，资料库里的原件保留
  async removeFromTask(user: SessionUser, taskId: string, documentId: string) {
    await this.editableTask(user, taskId);
    await this.db
      .delete(taskDocuments)
      .where(and(eq(taskDocuments.taskId, taskId), eq(taskDocuments.documentId, documentId)));
    return this.taskDocumentsOf(taskId);
  }

  // ---- 内部 ----

  private async enterprise(user: SessionUser, enterpriseId: string) {
    const [ent] = await this.db
      .select({ id: enterprises.id, orgId: enterprises.orgId })
      .from(enterprises)
      .where(eq(enterprises.id, enterpriseId))
      .limit(1);
    if (!ent || !canViewOrganization(user, ent.orgId)) throw new NotFoundException('找不到该企业');
    return ent;
  }

  private async editableEnterprise(user: SessionUser, enterpriseId: string) {
    const ent = await this.enterprise(user, enterpriseId);
    if (!canEditOrganizationData(user, ent.orgId)) throw new ForbiddenException('企业资料由客户上传');
    return ent;
  }

  private async documentOf(enterpriseId: string, documentId: string) {
    const [doc] = await this.db
      .select({ id: enterpriseDocuments.id, name: enterpriseDocuments.name, category: enterpriseDocuments.category })
      .from(enterpriseDocuments)
      .where(and(eq(enterpriseDocuments.id, documentId), eq(enterpriseDocuments.enterpriseId, enterpriseId)))
      .limit(1);
    if (!doc) throw new NotFoundException('找不到该资料');
    return doc;
  }

  // 各资料的版本，新的在前
  private versionsOf(documentIds: string[]) {
    if (documentIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        documentId: enterpriseDocumentVersions.documentId,
        versionId: enterpriseDocumentVersions.id,
        version: enterpriseDocumentVersions.version,
        fileId: files.id,
        originalName: files.originalName,
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
        createdAt: enterpriseDocumentVersions.createdAt,
      })
      .from(enterpriseDocumentVersions)
      .innerJoin(files, eq(files.id, enterpriseDocumentVersions.fileId))
      .where(inArray(enterpriseDocumentVersions.documentId, documentIds))
      .orderBy(desc(enterpriseDocumentVersions.version));
  }

  // 客户才能改；已提交的任务，选用的资料版本锁定，只能再加新文件
  private async editableTask(user: SessionUser, taskId: string, addOnly = false) {
    const task = await this.tasks.load(user, taskId);
    if (!canEditOrganizationData(user, task.orgId)) throw new ForbiddenException('资料由客户上传');
    if (task.status !== 'preparing' && !addOnly) {
      throw new BadRequestException('申请已提交，已提交的资料不能更换或移除；需要更正请联系负责专家');
    }
    return task;
  }

  private async taskDocumentsOf(taskId: string) {
    const rows = await this.db
      .select({
        documentId: taskDocuments.documentId,
        versionId: taskDocuments.versionId,
        name: enterpriseDocuments.name,
        category: enterpriseDocuments.category,
        version: enterpriseDocumentVersions.version,
        fileId: files.id,
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
        linkedAt: taskDocuments.linkedAt,
      })
      .from(taskDocuments)
      .innerJoin(enterpriseDocuments, eq(enterpriseDocuments.id, taskDocuments.documentId))
      .innerJoin(enterpriseDocumentVersions, eq(enterpriseDocumentVersions.id, taskDocuments.versionId))
      .innerJoin(files, eq(files.id, enterpriseDocumentVersions.fileId))
      .where(eq(taskDocuments.taskId, taskId))
      .orderBy(asc(taskDocuments.linkedAt));
    // 资料库里有比任务所用更新的版本时提示（不自动替换）
    const latest = await this.versionsOf(rows.map((r) => r.documentId));
    return rows.map((r) => {
      const top = latest.find((v) => v.documentId === r.documentId)!;
      return { ...r, category: r.category as Category | null, latestVersion: top.version };
    });
  }
}

