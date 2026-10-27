import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { canEditOrganizationData } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { enterpriseDocuments, enterpriseDocumentVersions, files, taskDocuments } from '../db/schema.ts';
import { TasksService } from '../tasks/tasks.service.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// 企业资料库（TECH-PLAN 3.4.2）。第 10a 项：「上传已有资料」路线把文件登记进资料库（V1）并关联到任务；
// 新版本、从资料库选用、自填文件进库在第 10b 项
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TasksService) private readonly tasks: TasksService,
  ) {}

  async listForTask(user: SessionUser, taskId: string) {
    await this.tasks.load(user, taskId);
    return this.taskDocumentsOf(taskId);
  }

  // 刚上传的文件登记进任务所属企业的资料库并关联到任务。同一文件已登记过的，直接关联那个版本
  async addToTask(user: SessionUser, taskId: string, fileId: string) {
    const task = await this.editableTask(user, taskId);
    const [file] = await this.db
      .select({ id: files.id, originalName: files.originalName })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.orgId, task.orgId), eq(files.kind, 'customer_material')))
      .limit(1);
    if (!file) throw new NotFoundException('找不到该文件');

    await this.db.transaction(async (tx) => {
      const version = await this.registerFile(tx, user, task, file);
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

  // 只取消任务里的关联，资料库里的原件保留
  async removeFromTask(user: SessionUser, taskId: string, documentId: string) {
    await this.editableTask(user, taskId);
    await this.db
      .delete(taskDocuments)
      .where(and(eq(taskDocuments.taskId, taskId), eq(taskDocuments.documentId, documentId)));
    return this.taskDocumentsOf(taskId);
  }

  private async registerFile(
    tx: Tx,
    user: SessionUser,
    task: { orgId: string; enterpriseId: string },
    file: { id: string; originalName: string },
  ) {
    const [existing] = await tx
      .select({ id: enterpriseDocumentVersions.id, documentId: enterpriseDocumentVersions.documentId })
      .from(enterpriseDocumentVersions)
      .innerJoin(enterpriseDocuments, eq(enterpriseDocuments.id, enterpriseDocumentVersions.documentId))
      .where(and(eq(enterpriseDocumentVersions.fileId, file.id), eq(enterpriseDocuments.enterpriseId, task.enterpriseId)))
      .limit(1);
    if (existing) return existing;

    const [doc] = await tx
      .insert(enterpriseDocuments)
      .values({ orgId: task.orgId, enterpriseId: task.enterpriseId, name: file.originalName, createdBy: user.id })
      .returning({ id: enterpriseDocuments.id });
    const [version] = await tx
      .insert(enterpriseDocumentVersions)
      .values({ documentId: doc!.id, version: 1, fileId: file.id, createdBy: user.id })
      .returning({ id: enterpriseDocumentVersions.id, documentId: enterpriseDocumentVersions.documentId });
    return version!;
  }

  // 客户才能改；已提交的任务资料锁定（提交后的更新走补件，M2）
  private async editableTask(user: SessionUser, taskId: string) {
    const task = await this.tasks.load(user, taskId);
    if (!canEditOrganizationData(user, task.orgId)) throw new ForbiddenException('资料由客户上传');
    if (task.status !== 'preparing') throw new BadRequestException('任务已提交，资料不能再改；需要更新请在补件中提交');
    return task;
  }

  private taskDocumentsOf(taskId: string) {
    return this.db
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
  }
}
