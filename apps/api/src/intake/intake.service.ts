// 准备资料（新流程）：下载资料模板、上传资料表格和图纸、说明「这张图我们没有」。
// 读表、必填检查在 analyze.ts / check.ts，这里只管权限、存文件、写库和拼页面要的数据。
import {
  FILE_TYPES,
  UPLOAD_RULES,
  detectFileType,
  fileRejectionReason,
  type IntakeFileSlot,
  type IntakeFileView,
  type IntakeOtherEnterprise,
  type IntakePreviousSheet,
  type IntakeRequiredCheck,
  type IntakeSheetView,
  type IntakeView,
  type IntakeWarning,
} from '@genyun/shared';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { canEditEnterpriseData, canViewEnterprise } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { enterprises, files, taskIntakeFiles, taskIntakes, taskIntakeSubmissions, tasks } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { TasksService } from '../tasks/tasks.service.ts';
import { analyzeSheet, SheetRejectedError, type SheetAnalysis } from './analyze.ts';
import { composeCheck, recheckDrawings, type DrawingState } from './check.ts';
import { DATA_SHEETS } from './layout.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const NOT_FOUND = '找不到该任务';
export const READ_ONLY_MESSAGE = '资料由客户自己上传';
export const SUBMITTED_MESSAGE = '资料已提交，不能再改；要更正请联系客服';
// 下面几句是我拟的
export const SHEET_UNDELETABLE_MESSAGE = '资料表格不能删除。要换一份，直接重新上传，以最后一次为准。';
export const HAS_EVACUATION_MAP_MESSAGE = '已经传了紧急疏散示意图，不用再说明没有。确实没有的，先把传上来的图删掉。';
export const CONCURRENT_SHEET_MESSAGE = '刚才有人同时传了一份资料表格。请刷新页面看看现在是哪一份，需要的话再传一次。';
const FILE_NOT_FOUND = '找不到这个文件';

export const INTAKE_SLOTS_RULE: Record<IntakeFileSlot, 'intake_sheet' | 'intake_drawing'> = {
  data_sheet: 'intake_sheet',
  site_plan: 'intake_drawing',
  evacuation_map: 'intake_drawing',
  other: 'intake_drawing',
};

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

interface Ctx {
  task: { id: string; orgId: string; enterpriseId: string; enterpriseName: string; status: string; businessType: string };
  intake: typeof taskIntakes.$inferSelect;
  canEdit: boolean;
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(TasksService) private readonly tasks: TasksService,
  ) {}

  // 看不了、删除了、旧流程的任务一律 404；写操作另要求能维护这家企业的资料（403），且任务还在准备资料（409）
  private async context(user: SessionUser, taskId: string, write: boolean): Promise<Ctx> {
    const task = await this.tasks.load(user, taskId);
    const [row] = await this.db
      .select({ deletedAt: tasks.deletedAt, intake: taskIntakes })
      .from(tasks)
      .leftJoin(taskIntakes, eq(taskIntakes.taskId, tasks.id))
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!row || row.deletedAt || !row.intake) throw new NotFoundException(NOT_FOUND);
    const ent = { orgId: task.orgId, enterpriseId: task.enterpriseId };
    const mayEdit = canEditEnterpriseData(user, ent);
    if (write) {
      if (!mayEdit) throw new ForbiddenException(READ_ONLY_MESSAGE);
      if (task.status !== 'preparing') throw new ConflictException(SUBMITTED_MESSAGE);
    }
    return { task, intake: row.intake, canEdit: mayEdit && task.status === 'preparing' };
  }

  // 写操作在事务里先锁住这一行 task_intakes，再重读任务状态：同一任务的上传、删除、「这张图我们没有」排队执行，
  // 必填检查、noEvacuationMap 都按锁里读到的最新情况重算，后到的请求不会拿旧结果盖掉先到的
  private async lockIntake(tx: Tx, taskId: string): Promise<typeof taskIntakes.$inferSelect> {
    const [intake] = await tx.select().from(taskIntakes).where(eq(taskIntakes.taskId, taskId)).for('update');
    if (!intake) throw new NotFoundException(NOT_FOUND);
    const [task] = await tx.select({ status: tasks.status, deletedAt: tasks.deletedAt }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task || task.deletedAt) throw new NotFoundException(NOT_FOUND);
    if (task.status !== 'preparing') throw new ConflictException(SUBMITTED_MESSAGE);
    return intake;
  }

  async assertWritable(user: SessionUser, taskId: string): Promise<void> {
    await this.context(user, taskId, true);
  }

  async get(user: SessionUser, taskId: string): Promise<IntakeView> {
    const ctx = await this.context(user, taskId, false);
    return this.view(user, ctx);
  }

  async upload(user: SessionUser, taskId: string, slot: IntakeFileSlot, file: UploadedFile): Promise<IntakeView> {
    const ctx = await this.context(user, taskId, true);
    const rule = INTAKE_SLOTS_RULE[slot];
    const name = file.originalname.trim().slice(0, 200) || '未命名文件';
    const reason = fileRejectionReason(rule, name, file.buffer);
    if (reason) throw new BadRequestException(reason);
    const type = detectFileType(file.buffer)!;

    // 资料表格先读：打不开的直接拒收，不存文件
    let analysis: SheetAnalysis | null = null;
    if (slot === 'data_sheet') {
      const others = await this.db
        .select({ id: enterprises.id, name: enterprises.name })
        .from(enterprises)
        .where(eq(enterprises.orgId, ctx.task.orgId));
      try {
        analysis = await analyzeSheet(file.buffer, { enterprise: { id: ctx.task.enterpriseId, name: ctx.task.enterpriseName }, others });
      } catch (e) {
        if (e instanceof SheetRejectedError) throw new BadRequestException(e.message);
        throw e;
      }
    }

    const id = randomUUID();
    const storageKey = `${ctx.task.orgId}/${id}`;
    const contentType = FILE_TYPES[type].mime;
    await this.storage.put(storageKey, file.buffer, contentType);
    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        const intake = await this.lockIntake(tx, taskId);
        await tx.insert(files).values({
          id,
          orgId: ctx.task.orgId,
          kind: 'customer_material',
          originalName: name,
          contentType,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          storageKey,
          uploadedBy: user.id,
        });
        // 资料表格、总平面布置图只留一份：传新的就把旧的移除（只写 removed_at）
        if (slot === 'data_sheet' || slot === 'site_plan') {
          await tx
            .update(taskIntakeFiles)
            .set({ removedAt: now })
            .where(and(eq(taskIntakeFiles.taskId, taskId), eq(taskIntakeFiles.slot, slot), isNull(taskIntakeFiles.removedAt)));
        }
        await tx.insert(taskIntakeFiles).values({ taskId, slot, fileId: id, uploadedBy: user.id, uploadedAt: now });

        const patch: Partial<typeof taskIntakes.$inferInsert> = {
          updatedAt: now,
          updatedBy: user.id,
          lastUploadedSide: 'customer',
        };
        if (slot === 'evacuation_map') patch.noEvacuationMap = false;
        const drawings = await this.drawingState(tx, taskId, patch.noEvacuationMap ?? intake.noEvacuationMap);
        if (analysis) {
          Object.assign(patch, await this.applySheet(tx, ctx, analysis, id, drawings, now));
        } else {
          patch.requiredCheck = recheckDrawings(intake.requiredCheck, drawings, now);
        }
        await tx.update(taskIntakes).set(patch).where(eq(taskIntakes.taskId, taskId));
      });
    } catch (err) {
      // 记录没写成，存好的文件就没人引用了：尽量删掉，删不掉只记日志
      await this.discardStored(storageKey);
      // 两个人同时传资料表格：后到的那份撞上「只有一份当前表格」的唯一索引
      if (isUniqueViolation(err, 'task_intake_files_one_data_sheet')) throw new ConflictException(CONCURRENT_SHEET_MESSAGE);
      throw err;
    }
    return this.get(user, taskId);
  }

  // 读表结果写进 task_intakes；不是模板、像是别家企业的，记下提示、清掉上一份的读表结果（以最后一次为准）
  private async applySheet(
    tx: Tx,
    ctx: Ctx,
    analysis: SheetAnalysis,
    fileId: string,
    drawings: DrawingState,
    now: Date,
  ): Promise<Partial<typeof taskIntakes.$inferInsert>> {
    if (analysis.kind !== 'read') {
      return { dataSheetFileId: null, templateVersion: null, parseResult: null, requiredCheck: null, warnings: analysis.warnings };
    }
    if (analysis.rename) {
      // 与企业档案、自填第 1 步共用版本号
      await tx
        .update(enterprises)
        .set({ name: analysis.rename.newName, version: sql`${enterprises.version} + 1`, updatedAt: now })
        .where(eq(enterprises.id, ctx.task.enterpriseId));
    }
    return {
      dataSheetFileId: fileId,
      templateVersion: analysis.parse.templateVersion,
      parseResult: analysis.parse,
      requiredCheck: composeCheck(analysis.sheet, drawings, now),
      warnings: analysis.warnings,
    };
  }

  async remove(user: SessionUser, taskId: string, recordId: string): Promise<IntakeView> {
    await this.context(user, taskId, true);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const intake = await this.lockIntake(tx, taskId);
      const [rec] = await tx
        .select()
        .from(taskIntakeFiles)
        .where(and(eq(taskIntakeFiles.id, recordId), eq(taskIntakeFiles.taskId, taskId), isNull(taskIntakeFiles.removedAt)))
        .limit(1);
      if (!rec) throw new NotFoundException(FILE_NOT_FOUND);
      if (rec.slot === 'data_sheet') throw new BadRequestException(SHEET_UNDELETABLE_MESSAGE);
      await tx.update(taskIntakeFiles).set({ removedAt: now }).where(eq(taskIntakeFiles.id, recordId));
      const drawings = await this.drawingState(tx, taskId, intake.noEvacuationMap);
      await tx
        .update(taskIntakes)
        .set({ requiredCheck: recheckDrawings(intake.requiredCheck, drawings, now), updatedAt: now, updatedBy: user.id })
        .where(eq(taskIntakes.taskId, taskId));
    });
    return this.get(user, taskId);
  }

  async setNoEvacuationMap(user: SessionUser, taskId: string, value: boolean): Promise<IntakeView> {
    await this.context(user, taskId, true);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const intake = await this.lockIntake(tx, taskId);
      const drawings = await this.drawingState(tx, taskId, value);
      if (value && drawings.evacuationPlan) throw new ConflictException(HAS_EVACUATION_MAP_MESSAGE);
      await tx
        .update(taskIntakes)
        .set({ noEvacuationMap: value, requiredCheck: recheckDrawings(intake.requiredCheck, drawings, now), updatedAt: now, updatedBy: user.id })
        .where(eq(taskIntakes.taskId, taskId));
    });
    return this.get(user, taskId);
  }

  private async discardStored(key: string): Promise<void> {
    if (!this.storage.remove) return;
    try {
      await this.storage.remove(key);
    } catch (e) {
      this.logger.warn(`没删掉没有记录的上传文件 ${key}：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async drawingState(db: Database | Tx, taskId: string, noEvacuationMap: boolean): Promise<DrawingState> {
    const rows = await db
      .select({ slot: taskIntakeFiles.slot })
      .from(taskIntakeFiles)
      .where(and(eq(taskIntakeFiles.taskId, taskId), isNull(taskIntakeFiles.removedAt)));
    return {
      sitePlan: rows.some((r) => r.slot === 'site_plan'),
      evacuationPlan: rows.some((r) => r.slot === 'evacuation_map'),
      noEvacuationMap,
    };
  }

  private async view(user: SessionUser, ctx: Ctx): Promise<IntakeView> {
    const { task, intake } = ctx;
    const rows = await this.db
      .select({
        id: taskIntakeFiles.id,
        fileId: taskIntakeFiles.fileId,
        slot: taskIntakeFiles.slot,
        uploadedAt: taskIntakeFiles.uploadedAt,
        uploadedByExpert: taskIntakeFiles.uploadedByExpert,
        originalName: files.originalName,
        sizeBytes: files.sizeBytes,
        contentType: files.contentType,
      })
      .from(taskIntakeFiles)
      .innerJoin(files, eq(files.id, taskIntakeFiles.fileId))
      .where(and(eq(taskIntakeFiles.taskId, task.id), isNull(taskIntakeFiles.removedAt)))
      .orderBy(taskIntakeFiles.uploadedAt);
    const list: IntakeFileView[] = rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString() }));
    const sheetFile = list.find((f) => f.slot === 'data_sheet') ?? null;
    const warnings: IntakeWarning[] = intake.warnings ?? [];
    return {
      taskId: task.id,
      canEdit: ctx.canEdit,
      dataSheet: sheetFile ? sheetView(sheetFile, intake.dataSheetFileId, intake.templateVersion, intake.requiredCheck, warnings) : null,
      sitePlan: list.find((f) => f.slot === 'site_plan') ?? null,
      evacuationMaps: list.filter((f) => f.slot === 'evacuation_map'),
      others: list.filter((f) => f.slot === 'other'),
      requiredCheck: intake.requiredCheck,
      warnings,
      noEvacuationMap: intake.noEvacuationMap,
      otherEnterprise: await this.otherEnterprise(user, task, warnings),
      previousSheet: await this.previousSheet(task),
      updatedAt: intake.updatedAt.toISOString(),
    };
  }

  // 表格像是别家企业的：那家企业当前用户看不看得到，有没有在办任务
  private async otherEnterprise(user: SessionUser, task: Ctx['task'], warnings: IntakeWarning[]): Promise<IntakeOtherEnterprise | null> {
    const w = warnings.find((x) => x.kind === 'other_enterprise');
    if (!w?.matchedEnterpriseId) return null;
    const visible = canViewEnterprise(user, { orgId: task.orgId, enterpriseId: w.matchedEnterpriseId });
    let openTaskId: string | null = null;
    if (visible) {
      const open = await this.db
        .select({ id: tasks.id, businessType: tasks.businessType })
        .from(tasks)
        .where(and(eq(tasks.enterpriseId, w.matchedEnterpriseId), isNull(tasks.closedAt), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.createdAt));
      openTaskId = (open.find((t) => t.businessType === task.businessType) ?? open[0])?.id ?? null;
    }
    return { enterpriseId: w.matchedEnterpriseId, enterpriseName: w.matchedEnterpriseName ?? '', visible, openTaskId };
  }

  // 上次提交的表（U1b）：同一企业的其他任务（没删除的）里，最近一次没撤回的提交，取它的资料表格
  private async previousSheet(task: Ctx['task']): Promise<IntakePreviousSheet | null> {
    const subs = await this.db
      .select({ submittedAt: taskIntakeSubmissions.submittedAt, snapshot: taskIntakeSubmissions.snapshot })
      .from(taskIntakeSubmissions)
      .innerJoin(tasks, eq(tasks.id, taskIntakeSubmissions.taskId))
      .where(
        and(
          eq(tasks.enterpriseId, task.enterpriseId),
          ne(tasks.id, task.id),
          isNull(tasks.deletedAt),
          isNull(taskIntakeSubmissions.withdrawnAt),
        ),
      )
      .orderBy(desc(taskIntakeSubmissions.submittedAt));
    for (const s of subs) {
      const sheet = s.snapshot.files.find((f) => f.slot === 'data_sheet');
      if (sheet) return { fileId: sheet.fileId, originalName: sheet.originalName, submittedAt: s.submittedAt.toISOString() };
    }
    return null;
  }
}

function sheetView(
  file: IntakeFileView,
  readFileId: string | null,
  templateVersion: string | null,
  check: IntakeRequiredCheck | null,
  warnings: IntakeWarning[],
): IntakeSheetView {
  if (readFileId !== file.fileId) {
    const status = warnings.some((w) => w.kind === 'other_enterprise') ? 'other_enterprise' : 'not_template';
    return { file, status, templateVersion: null, oldTemplate: false, sheets: [] };
  }
  const missing = check?.missing ?? [];
  return {
    file,
    status: 'read',
    templateVersion,
    oldTemplate: warnings.some((w) => w.kind === 'old_template'),
    sheets: DATA_SHEETS.map((name) => ({ name, missing: missing.filter((m) => m.sheet === name).length })),
  };
}

/** 上传接口用：按位置取大小上限 */
export const intakeMaxBytes = (slot: IntakeFileSlot) => UPLOAD_RULES[INTAKE_SLOTS_RULE[slot]].maxBytes;

