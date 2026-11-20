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
  type IntakeSubmissionSnapshot,
  type IntakeSubmissionView,
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
import {
  enterprises,
  files,
  notifications,
  taskIntakeFiles,
  taskIntakes,
  taskIntakeSubmissions,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';
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
// 提交、撤回、删除任务（「专家已经开始核对，不能撤回了」是设计稿原话，其余是说明里定的）
export const NO_SHEET_MESSAGE = '还没读到资料表格，请先上传填好的资料模板';
export const missingMessage = (n: number) => `还有 ${n} 项必填没填，改好再提交`;
export const SUBMIT_RETRY_MESSAGE = '这次没有提交成功，请重试';
export const WITHDRAW_USED_MESSAGE = '这次提交后不能再撤回了，有要改的地方请联系客服';
export const EXPERT_STARTED_MESSAGE = '专家已经开始核对，不能撤回了';
export const NOT_WITHDRAWABLE_MESSAGE = '这个任务现在不能撤回';
export const UNDELETABLE_MESSAGE = '提交给专家后不能删除任务';

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
  task: {
    id: string;
    orgId: string;
    enterpriseId: string;
    enterpriseName: string;
    status: string;
    businessType: string;
    closedAt: Date | null;
  };
  intake: typeof taskIntakes.$inferSelect;
  /** 能维护这家企业的资料（组织管理员或负责这家企业的成员），不论任务到了哪一步 */
  mayEdit: boolean;
  /** 现在能上传、删除：mayEdit 且任务还在准备资料 */
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
    return { task, intake: row.intake, mayEdit, canEdit: mayEdit && task.status === 'preparing' };
  }

  // 写操作在事务里先锁住这一行 task_intakes，再重读任务状态：同一任务的上传、删除、「这张图我们没有」排队执行，
  // 必填检查、noEvacuationMap 都按锁里读到的最新情况重算，后到的请求不会拿旧结果盖掉先到的
  // 提交、撤回、删除任务和专家开始核对也拿这把锁（lockTaskRow）
  private async lockIntake(tx: Tx, taskId: string, notPreparing = SUBMITTED_MESSAGE): Promise<typeof taskIntakes.$inferSelect> {
    const { intake, task } = await lockTaskRow(tx, taskId);
    if (task.status !== 'preparing') throw new ConflictException(notPreparing);
    return intake;
  }

  // ---------- 提交、撤回、删除任务 ----------

  /**
   * 提交给专家。同一个 requestId 重发、另一次提交先到了，都返回当前资料，不会多记一次。
   * 能不能提交和准备资料页「提交给专家」变亮是同一个规则（submitBlocker）。不发邮件、不发提醒、不扣次数
   */
  async submit(user: SessionUser, taskId: string, requestId: string): Promise<IntakeView> {
    // 不用 context(…, true)：已经提交了的重发要返回当前资料，不报 409
    const ctx = await this.context(user, taskId, false);
    if (!ctx.mayEdit) throw new ForbiddenException(READ_ONLY_MESSAGE);
    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        const { intake, task } = await lockTaskRow(tx, taskId);
        // 同一次提交重发，或另一次提交先到了
        const [same] = await tx
          .select({ id: taskIntakeSubmissions.id })
          .from(taskIntakeSubmissions)
          .where(and(eq(taskIntakeSubmissions.taskId, taskId), eq(taskIntakeSubmissions.requestId, requestId)))
          .limit(1);
        if (same || (await activeSubmission(tx, taskId))) return;
        if (task.status !== 'preparing') throw new ConflictException(SUBMITTED_MESSAGE);
        const current = await tx
          .select({ fileId: taskIntakeFiles.fileId, slot: taskIntakeFiles.slot, originalName: files.originalName })
          .from(taskIntakeFiles)
          .innerJoin(files, eq(files.id, taskIntakeFiles.fileId))
          .where(and(eq(taskIntakeFiles.taskId, taskId), isNull(taskIntakeFiles.removedAt)))
          .orderBy(taskIntakeFiles.uploadedAt);
        const blocked = submitBlocker(intake, current);
        if (blocked) throw new ConflictException(blocked);
        const snapshot: IntakeSubmissionSnapshot = {
          files: current,
          parse: intake.parseResult,
          templateVersion: intake.templateVersion,
          noEvacuationMap: intake.noEvacuationMap,
          preferredExpertId: intake.preferredExpertId,
        };
        await tx.insert(taskIntakeSubmissions).values({ taskId, requestId, submittedBy: user.id, submittedAt: now, snapshot });
        await tx
          .update(tasks)
          .set({ status: 'submitted', submittedAt: now, updatedAt: now })
          .where(and(eq(tasks.id, taskId), eq(tasks.status, 'preparing')));
      });
    } catch (err) {
      if (
        !isUniqueViolation(err, 'task_intake_submissions_request_id_unique') &&
        !isUniqueViolation(err, 'task_intake_submissions_one_active')
      ) {
        throw err;
      }
      if (!(await activeSubmission(this.db, taskId))) throw new ConflictException(SUBMIT_RETRY_MESSAGE);
    }
    return this.get(user, taskId);
  }

  /**
   * 撤回提交：专家开始核对之前、一个任务只能一次。任务回到准备资料，文件、读表结果、负责专家都不动。
   * 和专家开始核对用同一把锁，以先到的为准
   */
  async withdraw(user: SessionUser, taskId: string): Promise<IntakeView> {
    const ctx = await this.context(user, taskId, false);
    if (!ctx.mayEdit) throw new ForbiddenException(READ_ONLY_MESSAGE);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const { task } = await lockTaskRow(tx, taskId);
      const subs = await tx
        .select({ id: taskIntakeSubmissions.id, withdrawnAt: taskIntakeSubmissions.withdrawnAt })
        .from(taskIntakeSubmissions)
        .where(eq(taskIntakeSubmissions.taskId, taskId));
      const active = subs.find((s) => !s.withdrawnAt);
      const withdrawn = subs.some((s) => s.withdrawnAt);
      if (task.status !== 'submitted' || !active) {
        // 已经撤回了（重复点击、两个人同时点）：返回当前资料
        if (task.status === 'preparing' && withdrawn && !active) return;
        throw new ConflictException(NOT_WITHDRAWABLE_MESSAGE);
      }
      if (withdrawn) throw new ConflictException({ statusCode: 409, message: WITHDRAW_USED_MESSAGE, code: 'withdraw_used' });
      const [started] = await tx.select({ taskId: taskWorkups.taskId }).from(taskWorkups).where(eq(taskWorkups.taskId, taskId)).limit(1);
      if (started || task.closedAt) {
        throw new ConflictException({ statusCode: 409, message: EXPERT_STARTED_MESSAGE, code: 'expert_started' });
      }
      await tx.update(taskIntakeSubmissions).set({ withdrawnAt: now, withdrawnBy: user.id }).where(eq(taskIntakeSubmissions.id, active.id));
      await tx.update(tasks).set({ status: 'preparing', submittedAt: null, updatedAt: now }).where(eq(tasks.id, taskId));
    });
    return this.get(user, taskId);
  }

  /**
   * 删除任务：只有新流程、还在准备资料的（包括撤回以后的）。软删除，文件和提交记录都留着。
   * 软删除不触发外键 cascade，这个任务的站内提醒在同一事务里删掉。不扣次数、不记操作记录、不发邮件
   */
  async deleteTask(user: SessionUser, taskId: string): Promise<void> {
    const ctx = await this.context(user, taskId, false);
    if (!ctx.mayEdit) throw new ForbiddenException(READ_ONLY_MESSAGE);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await this.lockIntake(tx, taskId, UNDELETABLE_MESSAGE);
      await tx.update(tasks).set({ deletedAt: now, deletedBy: user.id, updatedAt: now }).where(eq(tasks.id, taskId));
      await tx.delete(notifications).where(eq(notifications.taskId, taskId));
    });
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
      ...(await this.submissionState(ctx)),
    };
  }

  // 已提交页要的：当前有效的提交、撤回过没有、专家开始核对没有、现在能不能撤回
  private async submissionState(ctx: Ctx): Promise<Pick<IntakeView, 'submission' | 'withdrawnAt' | 'canWithdraw' | 'expertStarted'>> {
    const taskId = ctx.task.id;
    const [subs, [workup]] = await Promise.all([
      this.db
        .select({
          submittedAt: taskIntakeSubmissions.submittedAt,
          withdrawnAt: taskIntakeSubmissions.withdrawnAt,
          snapshot: taskIntakeSubmissions.snapshot,
          submittedByName: users.name,
        })
        .from(taskIntakeSubmissions)
        .innerJoin(users, eq(users.id, taskIntakeSubmissions.submittedBy))
        .where(eq(taskIntakeSubmissions.taskId, taskId)),
      this.db.select({ taskId: taskWorkups.taskId }).from(taskWorkups).where(eq(taskWorkups.taskId, taskId)).limit(1),
    ]);
    const active = subs.find((s) => !s.withdrawnAt);
    const withdrawnAt = subs.find((s) => s.withdrawnAt)?.withdrawnAt ?? null;
    const expertStarted = Boolean(workup);
    const submission: IntakeSubmissionView | null = active
      ? {
          submittedAt: active.submittedAt.toISOString(),
          submittedByName: active.submittedByName,
          files: active.snapshot.files,
          noEvacuationMap: active.snapshot.noEvacuationMap,
        }
      : null;
    return {
      submission,
      withdrawnAt: withdrawnAt?.toISOString() ?? null,
      canWithdraw:
        ctx.mayEdit && ctx.task.status === 'submitted' && !ctx.task.closedAt && submission !== null && !withdrawnAt && !expertStarted,
      expertStarted,
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

/**
 * 锁住这个任务的 task_intakes 一行，再读任务。上传、删除文件、提交、撤回、删除任务、专家开始核对都先拿这把锁，
 * 同一任务的这些事排队执行。不存在、已删除的报 404；状态由调用方判断
 */
export async function lockTaskRow(tx: Tx, taskId: string) {
  const [intake] = await tx.select().from(taskIntakes).where(eq(taskIntakes.taskId, taskId)).for('update');
  if (!intake) throw new NotFoundException(NOT_FOUND);
  const [task] = await tx
    .select({ status: tasks.status, deletedAt: tasks.deletedAt, closedAt: tasks.closedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task || task.deletedAt) throw new NotFoundException(NOT_FOUND);
  return { intake, task };
}

async function activeSubmission(db: Database | Tx, taskId: string) {
  const [row] = await db
    .select({ id: taskIntakeSubmissions.id })
    .from(taskIntakeSubmissions)
    .where(and(eq(taskIntakeSubmissions.taskId, taskId), isNull(taskIntakeSubmissions.withdrawnAt)))
    .limit(1);
  return row;
}

/**
 * 能不能提交给专家；不能的话给客户看的那句。和准备资料页「提交给专家」变亮是同一个规则：
 * 资料表格读到了（不是「不像模板」，也不是「像别家企业的」），必填缺项为空（缺的两张图也算在里面）
 */
function submitBlocker(intake: typeof taskIntakes.$inferSelect, current: { fileId: string; slot: IntakeFileSlot }[]): string | null {
  const sheet = current.find((f) => f.slot === 'data_sheet');
  if (!sheet || intake.dataSheetFileId !== sheet.fileId || !intake.requiredCheck) return NO_SHEET_MESSAGE;
  const n = intake.requiredCheck.missing.length;
  return n > 0 ? missingMessage(n) : null;
}

/** 上传接口用：按位置取大小上限 */
export const intakeMaxBytes = (slot: IntakeFileSlot) => UPLOAD_RULES[INTAKE_SLOTS_RULE[slot]].maxBytes;

