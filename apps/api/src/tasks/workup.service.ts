import {
  factDefOf,
  factSaveError,
  factSaveSchema,
  type FactOverride,
  type WorkupData,
  type WorkupSnapshot,
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
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { isOperator } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  checklistItemFiles,
  enterpriseDocuments,
  enterpriseDocumentVersions,
  enterprises,
  files,
  taskDocuments,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';

const NOT_FOUND = '找不到该任务';
const STALE = '这份整理刚被其他人修改过，已为您显示最新内容，请确认后再改';

// 原件对照（右栏）：任务里能看到的客户文件
export interface WorkupOriginal {
  fileId: string;
  name: string;
  contentType: string;
  // 来自企业资料库的有版本号；直接挂在资料项上的没有
  version: number | null;
  itemKeys: string[];
  uploadedAt: Date;
}

// 专业整理（14 页 E18-00A）：每个任务一份，只有负责专家能改；运营可以看（M3 改派时接手）
@Injectable()
export class WorkupService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(user: SessionUser, taskId: string) {
    const task = await this.task(user, taskId);
    return this.view(task.id, await this.ensure(task));
  }

  async saveFact(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以修改专业整理');
    const parsed = factSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const { version, key, value, source, fileId } = parsed.data;

    const row = await this.ensure(task);
    if (version !== row.version) throw this.stale(row.version);
    const error = factSaveError(factDefOf(row.snapshot, key), value);
    if (error) throw new BadRequestException(error);
    if (fileId && !(await this.originals(task.id)).some((o) => o.fileId === fileId)) {
      throw new BadRequestException('对照的原件不在这个任务里');
    }

    const overrides = { ...row.data.overrides };
    if (value === null) delete overrides[key];
    else {
      const entry: FactOverride = { value, source, by: user.id, byName: user.name, at: new Date().toISOString() };
      if (fileId) entry.fileId = fileId;
      overrides[key] = entry;
    }
    const [saved] = await this.db
      .update(taskWorkups)
      .set({ data: { overrides }, version: version + 1, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, version)))
      .returning();
    // 读与写之间别人刚好保存了
    if (!saved) throw this.stale(version + 1);
    return this.view(task.id, saved);
  }

  // 第一次打开时复制企业资料作快照；两人同时打开只留先写入的那份
  private async ensure(task: { id: string; enterpriseId: string }) {
    const existing = await this.row(task.id);
    if (existing) return existing;
    const [ent] = await this.db.select().from(enterprises).where(eq(enterprises.id, task.enterpriseId)).limit(1);
    const snapshot: WorkupSnapshot = {
      identity: {
        name: ent!.name,
        socialCreditCode: ent!.socialCreditCode,
        legalRepresentative: ent!.legalRepresentative,
        registeredAddress: ent!.registeredAddress,
      },
      profile: ent!.profile,
    };
    const data: WorkupData = { overrides: {} };
    await this.db.insert(taskWorkups).values({ taskId: task.id, snapshot, data }).onConflictDoNothing();
    return (await this.row(task.id))!;
  }

  private async row(taskId: string) {
    const [row] = await this.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId)).limit(1);
    return row;
  }

  private async view(taskId: string, row: typeof taskWorkups.$inferSelect) {
    const [by] = row.updatedBy
      ? await this.db.select({ name: users.name }).from(users).where(eq(users.id, row.updatedBy)).limit(1)
      : [];
    return {
      version: row.version,
      snapshot: row.snapshot,
      snapshotAt: row.snapshotAt,
      data: row.data,
      updatedAt: row.updatedAt,
      updatedByName: by?.name ?? null,
      originals: await this.originals(taskId),
    };
  }

  // 挂在资料项上的文件 + 任务选用的企业资料（某一版本），按文件去重
  private async originals(taskId: string): Promise<WorkupOriginal[]> {
    const linked = await this.db
      .select({
        fileId: files.id,
        name: files.originalName,
        contentType: files.contentType,
        itemKey: checklistItemFiles.itemKey,
        uploadedAt: files.createdAt,
      })
      .from(checklistItemFiles)
      .innerJoin(files, eq(files.id, checklistItemFiles.fileId))
      .where(eq(checklistItemFiles.taskId, taskId))
      .orderBy(checklistItemFiles.linkedAt);
    const library = await this.db
      .select({
        fileId: files.id,
        name: enterpriseDocuments.name,
        contentType: files.contentType,
        version: enterpriseDocumentVersions.version,
        uploadedAt: files.createdAt,
      })
      .from(taskDocuments)
      .innerJoin(enterpriseDocuments, eq(enterpriseDocuments.id, taskDocuments.documentId))
      .innerJoin(enterpriseDocumentVersions, eq(enterpriseDocumentVersions.id, taskDocuments.versionId))
      .innerJoin(files, eq(files.id, enterpriseDocumentVersions.fileId))
      .where(eq(taskDocuments.taskId, taskId))
      .orderBy(taskDocuments.linkedAt);

    const byFile = new Map<string, WorkupOriginal>();
    for (const f of library) byFile.set(f.fileId, { ...f, itemKeys: [] });
    for (const f of linked) {
      const found = byFile.get(f.fileId);
      if (found) {
        if (!found.itemKeys.includes(f.itemKey)) found.itemKeys.push(f.itemKey);
      } else {
        byFile.set(f.fileId, { fileId: f.fileId, name: f.name, contentType: f.contentType, version: null, itemKeys: [f.itemKey], uploadedAt: f.uploadedAt });
      }
    }
    return [...byFile.values()];
  }

  // 负责专家、运营可以打开；客户和其他专家看不到（与不存在同样返回）。客户提交以后才开始整理
  private async task(user: SessionUser, id: string) {
    const [task] = await this.db
      .select({ id: tasks.id, enterpriseId: tasks.enterpriseId, assignedExpertId: tasks.assignedExpertId, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    const isAssigned = task && task.assignedExpertId === user.id && user.memberships.some((m) => m.role === 'expert');
    if (!task || !(isAssigned || isOperator(user))) throw new NotFoundException(NOT_FOUND);
    if (task.status !== 'submitted') throw new BadRequestException('客户还没有提交资料，提交后才能开始整理');
    return task;
  }

  private stale(version: number) {
    return new ConflictException({ statusCode: 409, message: STALE, reason: 'stale', version });
  }
}

@Controller('tasks/:id/workup')
export class WorkupController {
  constructor(@Inject(WorkupService) private readonly service: WorkupService) {}

  @Get()
  get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Put('facts')
  saveFact(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveFact(user, id, body);
  }
}
