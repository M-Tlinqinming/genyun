import {
  basicStepWorkupSaveSchema,
  contactPhoneError,
  detectFileType,
  FILE_TYPES,
  fileIdsOfProductionStep,
  fileIdsOfResourcesStep,
  fileRejectionReason,
  parseUploadTarget,
  productionStepView,
  productionStepWorkupSaveSchema,
  resourcesStepView,
  resourcesStepWorkupSaveSchema,
  UPLOAD_RULE_OF_TARGET,
  withUploadedFile,
  type ResourcesExtra,
  CUSTOMER_DRAWING_KEYS,
  drawingKeyOf,
  effectiveSnapshot,
  organizationOfSnapshot,
  organizationStepSaveError,
  organizationStepWorkupSaveSchema,
  replaceStepBlank,
  stepsDoneSaveSchema,
  stripStepOverrides,
  workupStepsDone,
  emptyProductionWorkup,
  factDefOf,
  factSaveError,
  factSaveSchema,
  figureSignature,
  figuresSaveError,
  figuresSaveSchema,
  figuresView,
  isAddedRow,
  productionSaveError,
  productionSaveSchema,
  riskSaveError,
  riskSaveSchema,
  scopeSaveSchema,
  SPECIAL_CATEGORY_KEYS,
  type DrawingFileKey,
  EXPERT_DRAWING_KEYS,
  type FactOverride,
  type FiguresWorkup,
  type IntakeFileSlot,
  type WorkupData,
  type WorkupSnapshot,
  type IntakeCellRef,
  companyNameInputOf,
  currentGaps,
  missingContactOf,
  missingItemsOf,
  normalizeReview,
  recomputeMissingList,
  reviewStepWorkupSaveSchema,
  riskView,
  STEP3_SCOPE_KEYS,
  type MissingList,
  type ReviewWorkup,
  type RiskSave,
  type WorkupEvent,
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
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';
import { receiveOne } from '../files/files.controller.ts';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { isOperator } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import type { UploadedFile } from '../intake/intake.service.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lockTaskRow } from '../intake/intake.service.ts';
import { KnowledgeService } from '../knowledge/knowledge.service.ts';
import { suggestPlanCode } from './plan-code.ts';
import {
  checklistItemFiles,
  enterpriseDocuments,
  enterpriseDocumentVersions,
  enterprises,
  files,
  generationBatches,
  taskDocuments,
  taskIntakeFiles,
  taskIntakes,
  taskIntakeSubmissions,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';

const NOT_FOUND = '找不到该任务';

// 处理记录里资料核对的几件事，只留最近 200 条
function withEvent(events: WorkupEvent[] | undefined, e: WorkupEvent): WorkupEvent[] {
  return [...(events ?? []), e].slice(-200);
}

// 改了系统候选的分值（L、E、C 或可能性、严重性）要写一句理由，存在行的说明里
function riskNoteError(snapshot: WorkupSnapshot, data: WorkupData, save: RiskSave): string | null {
  if (!save.value || save.value.excluded) return null;
  const row = riskView(snapshot, data).rows.find((r) => r.id === save.rowId);
  const s = row?.suggested;
  if (!s) return null;
  const v = save.value;
  const changed = (['l', 'e', 'c', 'likelihood', 'severity'] as const).some((k) => v[k] !== undefined && v[k] !== s[k]);
  return changed && !v.note?.trim() ? '改了分值，请写一句理由' : null;
}

// 自填第 3、4 步拍的照片只存在企业资料里，不挂资料项（M1 第 7a 项说明），按所在位置归到资料项
function profilePhotos(snapshot: WorkupSnapshot): { fileId: string; itemKey: string }[] {
  const step = snapshot.profile.productionStep?.step;
  const res = snapshot.profile.resourcesStep?.step;
  const of = (itemKey: string, ids: readonly string[] | undefined) => (ids ?? []).map((fileId) => ({ fileId, itemKey }));
  return [
    ...of('special_equipment', step && SPECIAL_CATEGORY_KEYS.flatMap((k) => step.specialEquipment[k].photoFileIds)),
    ...of('materials', step?.materials.flatMap((m) => m.labelPhotoFileIds)),
    ...of('first_aid_kit', res?.firstAidKit.photoFileIds),
    ...of('buildings', res?.fireAcceptanceFileIds),
  ];
}
const WORKUP_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const STALE = '资料刚被其他人修改过，已为您显示最新内容，请确认后再改';
const ONLY_EXPERT = '只有负责专家可以修改资料核对';

// 新流程（上传资料表格）任务里客户传的文件：第 1 步找营业执照、右栏「客户原表」用
export interface WorkupIntakeFile {
  fileId: string;
  name: string;
  contentType: string;
  slot: IntakeFileSlot;
  uploadedAt: Date;
}

type WorkupRow = typeof taskWorkups.$inferSelect;

export interface WorkupDrawingFile {
  fileId: string;
  key: DrawingFileKey;
  name: string;
  contentType: string;
}

// 资料表格流程上传页的两个图纸上传位
const INTAKE_DRAWING_SLOTS: Partial<Record<IntakeFileSlot, DrawingFileKey>> = {
  site_plan: 'site_plan',
  evacuation_map: 'evacuation_plan',
};

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

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

// 我拟的。专家开始核对时客户已经撤回（先后只差一点，或者专家开着旧页面）
export const CUSTOMER_WITHDREW_MESSAGE = '客户撤回了这次提交，正在改资料。重新提交后会回到您的列表。';
const customerWithdrew = () => new ConflictException({ statusCode: 409, message: CUSTOMER_WITHDREW_MESSAGE, code: 'customer_withdrew' });

// 资料核对：每个任务一份，只有负责专家能改；运营可以看（M3 改派时接手）
// 属地三家机构的改写存成「名称 · 电话」，电话和外部联系方式走同一个检查
const AGENCY_PHONE_KEYS = new Set(['agency.emergencyBureau', 'agency.fireDept', 'agency.streetOffice']);
function agencyPhoneError(key: string, value: unknown): string | null {
  if (!AGENCY_PHONE_KEYS.has(key) || typeof value !== 'string') return null;
  const [, ...rest] = value.split(' · ');
  return contactPhoneError(rest.join(' · ').trim() || undefined);
}

@Injectable()
export class WorkupService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // 负责专家第一次打开时写快照（snapshot_at 就是「专家开始核对」）；运营等其他人先打开时只在内存里算，不写
  async get(user: SessionUser, taskId: string) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId === user.id) return this.view(task.id, await this.ensure(task));
    const row = await this.row(task.id);
    if (row) return this.view(task.id, row);
    const snapshot = await this.buildSnapshot(task);
    const draft: WorkupRow = {
      taskId: task.id,
      snapshot,
      snapshotAt: new Date(),
      data: { overrides: {} },
      version: 1,
      updatedBy: null,
      updatedAt: new Date(),
    } as WorkupRow;
    return this.view(task.id, draft);
  }

  // 向导第 1 步「企业基本信息」：整步写进专家那份，删掉这一步用过的单项修改，「先留空」按这一步替换
  async saveBasicStep(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = basicStepWorkupSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;
    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);

    const before = effectiveSnapshot(row.snapshot, row.data).profile.basicStep;
    const stamp = { by: user.id, byName: user.name, at: new Date().toISOString() };
    const data: WorkupData = {
      ...row.data,
      overrides: stripStepOverrides(row.data.overrides, 'basic'),
      identity: save.identity,
      profile: { ...row.data.profile, basicStep: { later: [], sources: {}, ...before, basic: save.basic } },
      blank: replaceStepBlank(row.data.blank, 'basic', save.blank),
      steps: { ...row.data.steps, basic: stamp },
      stepsDone: Math.max(workupStepsDone(row.data), save.stepsDone ?? 0),
    };
    return this.write(task.id, row, data, user.id);
  }

  // 向导第 2 步「人员与应急组织」：小组只能用五个预设、不能重复；少于 3 组也能保存（页面上挡「下一步」）
  async saveOrganizationStep(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = organizationStepWorkupSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;
    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);

    const eff = effectiveSnapshot(row.snapshot, row.data);
    const error = organizationStepSaveError(save.step, organizationOfSnapshot(eff));
    if (error) throw new BadRequestException(error);
    const stamp = { by: user.id, byName: user.name, at: new Date().toISOString() };
    const data: WorkupData = {
      ...row.data,
      overrides: stripStepOverrides(row.data.overrides, 'organization'),
      profile: {
        ...row.data.profile,
        organizationStep: { rosterFileIds: eff.profile.organizationStep?.rosterFileIds ?? [], step: save.step },
      },
      blank: replaceStepBlank(row.data.blank, 'organization', save.blank),
      steps: { ...row.data.steps, organization: stamp },
      stepsDone: Math.max(workupStepsDone(row.data), save.stepsDone ?? 0),
    };
    return this.write(task.id, row, data, user.id);
  }

  // 向导第 3 步「生产与工艺」：整步写进专家那份。第一次保存时，老整理页对设备、物料的改动并进来（productionStepView 已叠好），
  // 并从老整理层删掉；是否危化品、特种设备判定、耐火等级照旧在老整理层
  async saveProductionStep(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = productionStepWorkupSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;
    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const before = productionStepView(row.snapshot, row.data);
    await this.assertOwnFiles(task.orgId, fileIdsOfProductionStep(save.step), fileIdsOfProductionStep(before));

    const production = row.data.production ? { ...row.data.production, equipment: {}, materials: {} } : undefined;
    const data: WorkupData = {
      ...row.data,
      ...(production ? { production } : {}),
      profile: { ...row.data.profile, productionStep: { step: save.step } },
      steps: { ...row.data.steps, production: this.stamp(user) },
      stepsDone: Math.max(workupStepsDone(row.data), save.stepsDone ?? 0),
    };
    return this.write(task.id, row, data, user.id);
  }

  // 向导第 4 步「物资、设施与图纸」：整步写进专家那份，只有专家填的项（外部联系方式补充、四邻、专家的三张图）整份写进 resourcesExtra
  async saveResourcesStep(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = resourcesStepWorkupSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;
    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    for (const c of [save.extra.police, save.extra.brigade, save.step.hospital]) {
      const error = contactPhoneError(c?.phone);
      if (error) throw new BadRequestException(error);
    }
    const before = resourcesStepView(row.snapshot, row.data);
    const extraFiles = (x: ResourcesExtra | undefined) => EXPERT_DRAWING_KEYS.flatMap((k) => x?.drawings[k] ?? []);
    await this.assertOwnFiles(
      task.orgId,
      [...fileIdsOfResourcesStep(save.step), ...extraFiles(save.extra)],
      [...fileIdsOfResourcesStep(before), ...extraFiles(row.data.resourcesExtra)],
    );
    const data: WorkupData = {
      ...row.data,
      profile: { ...row.data.profile, resourcesStep: { step: save.step } },
      resourcesExtra: save.extra,
      steps: { ...row.data.steps, resources: this.stamp(user) },
      stepsDone: Math.max(workupStepsDone(row.data), save.stepsDone ?? 0),
    };
    return this.write(task.id, row, data, user.id);
  }

  // 代客户上传（S03）和专家上传的三张图：文件记在任务所属组织名下、上传人是专家，文件编号写进专家那份；
  // task_intake_files 不动。replace = 替换掉的那个文件（从同一处去掉）
  async uploadFile(user: SessionUser, taskId: string, query: { target?: string; version?: string; replace?: string }, file: UploadedFile) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const target = parseUploadTarget(query.target);
    if (!target) throw new BadRequestException('不支持的上传位置');
    const version = Number(query.version);
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException('内容不正确');
    const name = file.originalname.trim().slice(0, 200) || '未命名文件';
    const reason = fileRejectionReason(UPLOAD_RULE_OF_TARGET[target.kind], name, file.buffer);
    if (reason) throw new BadRequestException(reason);

    const row = await this.ensure(task);
    if (version !== row.version) throw this.stale(row.version);
    const id = randomUUID();
    const data = withUploadedFile(row.snapshot, row.data, target, id, query.replace);
    if (!data) throw new BadRequestException('这一行已经不在了，请刷新后再传');
    data.expertUploads = [
      ...(row.data.expertUploads ?? []),
      { fileId: id, target: query.target!, name, ...this.stamp(user) },
    ].slice(-200);

    const type = detectFileType(file.buffer)!;
    const storageKey = `${task.orgId}/${id}`;
    const contentType = FILE_TYPES[type].mime;
    await this.storage.put(storageKey, file.buffer, contentType);
    try {
      await this.db.insert(files).values({
        id,
        orgId: task.orgId,
        kind: 'customer_material',
        originalName: name,
        contentType,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        storageKey,
        uploadedBy: user.id,
      });
      return await this.write(task.id, row, data, user.id);
    } catch (err) {
      // 版本撞上了或记录没写成：存好的文件没人引用，尽量删掉
      await this.discardStored(storageKey);
      throw err;
    }
  }

  async assertExpert(user: SessionUser, taskId: string) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
  }

  private stamp(user: SessionUser) {
    return { by: user.id, byName: user.name, at: new Date().toISOString() };
  }

  // 步骤里新出现的文件必须是这个组织上传的（原来就在的不再查）
  private async assertOwnFiles(orgId: string, next: readonly string[], before: readonly string[]) {
    const added = [...new Set(next.filter((id) => !before.includes(id)))];
    if (added.length === 0) return;
    const ours = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(inArray(files.id, added), eq(files.orgId, orgId)));
    if (ours.length !== added.length) throw new BadRequestException('有文件不在这个任务里');
  }

  private async discardStored(key: string): Promise<void> {
    if (!this.storage.remove) return;
    try {
      await this.storage.remove(key);
    } catch (e) {
      console.warn(`没删掉没有记录的上传文件 ${key}：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 只记走到第几步（第 3–5 步暂用原来的整理页时，向导的「下一步」用它）；只增不减
  async saveStepsDone(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = stepsDoneSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const row = await this.ensure(task);
    if (parsed.data.version !== row.version) throw this.stale(row.version);
    const data: WorkupData = { ...row.data, stepsDone: Math.max(workupStepsDone(row.data), parsed.data.stepsDone) };
    return this.write(task.id, row, data, user.id);
  }

  private async write(taskId: string, row: WorkupRow, data: WorkupData, userId: string) {
    // 复制过缺项清单的：按这次保存后的资料重算，补上的划掉；都补上了自动取消「等客户补资料」
    // 缺项按资料算（要读文件和知识库，放在事务外）；核对数据和任务上的两列在同一个事务里写
    let current: { key: string }[] | null = null;
    if (data.missingList) {
      const [t] = await this.db.select({ orgId: tasks.orgId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (t) current = await this.currentGapsOf(taskId, t.orgId, row.snapshot, data);
    }
    const { saved, cleared } = await this.db.transaction(async (tx) => {
      let next = data;
      let cleared = false;
      let remaining: number | null = null;
      if (current && data.missingList) {
        const [t] = await tx
          .select({ since: tasks.awaitingCustomerSince, items: tasks.awaitingCustomerItems })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .limit(1);
        const now = new Date().toISOString();
        const { list, changed, allFilled } = recomputeMissingList(data.missingList, current, now);
        const awaiting = Boolean(t?.since);
        cleared = allFilled && awaiting;
        if (changed || cleared) {
          const events = cleared ? withEvent(data.events, { at: now, what: '「等客户补资料」自动取消', extra: '缺项清单里的项都补上了' }) : data.events;
          next = { ...data, missingList: list, ...(events ? { events } : {}) };
        }
        const open = list.items.filter((i) => !i.filledAt).length;
        if (awaiting && !cleared && open !== t?.items) remaining = open;
      }
      const [saved] = await tx
        .update(taskWorkups)
        .set({ data: next, version: row.version + 1, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(taskWorkups.taskId, taskId), eq(taskWorkups.version, row.version)))
        .returning();
      // 读与写之间别人刚好保存了：整个回滚
      if (!saved) throw this.stale(row.version + 1);
      const stillAwaiting = and(eq(tasks.id, taskId), isNotNull(tasks.awaitingCustomerSince));
      if (cleared) {
        await tx.update(tasks).set({ awaitingCustomerSince: null, awaitingCustomerItems: null }).where(stillAwaiting);
      } else if (remaining !== null) {
        // 还在等客户补：任务上的「缺 N 项」跟着清单里还没补上的项数走
        await tx.update(tasks).set({ awaitingCustomerItems: remaining }).where(stillAwaiting);
      }
      return { saved, cleared };
    });
    const view = await this.view(taskId, saved);
    return cleared ? { ...view, awaitingCleared: true as const } : view;
  }

  // 现在的缺项（门槛缺的 + 客户未填）：图纸按 drawingCandidates，属地按知识库
  async currentGapsOf(taskId: string, orgId: string, snapshot: WorkupSnapshot, data: WorkupData) {
    const drawings = await this.drawingFiles(taskId, orgId, effectiveSnapshot(snapshot, data), data);
    return currentGaps(snapshot, data, await this.knowledge.agencyDistricts(), drawings);
  }

  // 第 5 步第 1 页「专业项」：预案编号、经费与两位责任人、重大危险源结论（和系统算的不同时才存）
  async saveReviewStep(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = reviewStepWorkupSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;
    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const review: ReviewWorkup = normalizeReview(row.snapshot, row.data, save.review);
    const now = new Date().toISOString();
    const before = row.data.review?.majorHazard;
    let events = row.data.events;
    if (review.majorHazard) {
      const same = before && before.value === review.majorHazard.value && before.reason === review.majorHazard.reason;
      review.majorHazardAt = same ? (row.data.review?.majorHazardAt ?? now) : now;
      if (!same) {
        events = withEvent(events, { at: now, by: user.id, byName: user.name, what: `重大危险源改为「${review.majorHazard.value}」`, extra: review.majorHazard.reason });
      }
    } else if (before) {
      events = withEvent(events, { at: now, by: user.id, byName: user.name, what: '重大危险源改回系统算的结果' });
    }
    const data: WorkupData = {
      ...row.data,
      review,
      ...(events ? { events } : {}),
      steps: { ...row.data.steps, review: this.stamp(user) },
      stepsDone: Math.max(workupStepsDone(row.data), save.stepsDone ?? 0),
    };
    return this.write(task.id, row, data, user.id);
  }

  // 复制缺项清单（第 5 步第 2 页）：资料表格流程的任务记下清单，任务标为「等客户补资料」；逐项填写的老任务只复制文字，不来这里
  async copyMissingList(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = stepsDoneSaveSchema.pick({ version: true }).safeParse(body);
    if (!parsed.success) throw new BadRequestException('内容不正确');
    if (!(await this.isIntake(task.id))) throw new BadRequestException('逐项填写的任务只复制清单文字，不标「等客户补资料」');
    // 生成过（包括已交付、重新打开的）：只复制文字，不再标「等客户补资料」，免得盖掉核对文稿的状态
    const [generated] = await this.db.select({ id: generationBatches.id }).from(generationBatches).where(eq(generationBatches.taskId, task.id)).limit(1);
    if (generated) {
      throw new ConflictException({ statusCode: 409, message: '已经生成过初稿，缺项清单只复制文字，任务不再标为「等客户补资料」', reason: 'generated' });
    }
    const row = await this.ensure(task);
    if (parsed.data.version !== row.version) throw this.stale(row.version);
    const items = missingItemsOf(await this.currentGapsOf(task.id, task.orgId, row.snapshot, row.data));
    if (items.length === 0) throw new BadRequestException('资料都齐了，没有要补的项');
    const at = new Date();
    const list: MissingList = { at: at.toISOString(), by: user.id, byName: user.name, items };
    const events = withEvent(row.data.events, {
      at: list.at,
      by: user.id,
      byName: user.name,
      kind: 'missing_list',
      what: `复制了缺项清单，共 ${items.length} 项，任务标为等客户补资料`,
    });
    const saved = await this.db.transaction(async (tx) => {
      const [saved] = await tx
        .update(taskWorkups)
        .set({ data: { ...row.data, missingList: list, events }, version: row.version + 1, updatedBy: user.id, updatedAt: at })
        .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, row.version)))
        .returning();
      if (!saved) throw this.stale(row.version + 1);
      await tx.update(tasks).set({ awaitingCustomerSince: at, awaitingCustomerItems: items.length }).where(eq(tasks.id, task.id));
      return saved;
    });
    return this.view(task.id, saved);
  }

  // S02 查看缺项：清单和现在的补上情况（任务中心抽屉打开时取）
  async missingList(user: SessionUser, taskId: string) {
    const task = await this.task(user, taskId);
    return this.missingListView(task.id, task.orgId);
  }

  // 缺项清单的内容（专家接口查过权限后、运营任务中心抽屉都调这里）
  async missingListView(taskId: string, orgId: string) {
    const task = { id: taskId, orgId };
    const row = await this.row(task.id);
    const [t] = await this.db
      .select({ number: tasks.number, since: tasks.awaitingCustomerSince, items: tasks.awaitingCustomerItems })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    if (!row?.data.missingList) return { list: null, awaitingSince: t?.since ?? null, awaitingItems: null, taskNumber: t?.number ?? '' };
    // 打开时再按现在的资料算一遍（只显示，不写）
    const current = await this.currentGapsOf(task.id, task.orgId, row.snapshot, row.data);
    const { list } = recomputeMissingList(row.data.missingList, current, new Date().toISOString());
    const name = companyNameInputOf(row.snapshot, row.data);
    return {
      list,
      awaitingSince: t?.since ?? null,
      awaitingItems: t?.items ?? null,
      taskNumber: t?.number ?? '',
      companyName: name.name,
      addresses: name.addresses,
      contact: missingContactOf(row.snapshot, row.data),
    };
  }

  async saveFact(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = factSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const { version, key, value, fileId, source } = parsed.data;

    const row = await this.ensure(task);
    if (version !== row.version) throw this.stale(row.version);
    const error = factSaveError(factDefOf(row.snapshot, key, row.data), value) ?? agencyPhoneError(key, value);
    if (error) throw new BadRequestException(error);
    if (fileId && !(await this.originals(task.id, effectiveSnapshot(row.snapshot, row.data))).some((o) => o.fileId === fileId)) {
      throw new BadRequestException('对照的原件不在这个任务里');
    }

    const overrides = { ...row.data.overrides };
    if (value === null) delete overrides[key];
    else {
      const entry: FactOverride = { value, source, by: user.id, byName: user.name, at: new Date().toISOString() };
      if (fileId) entry.fileId = fileId;
      overrides[key] = entry;
    }
    return this.write(task.id, row, { ...row.data, overrides }, user.id);
  }

  // 生产设备与物料（14 页 E18-00B）：一次保存一条判断或一行修改，带版本号，value 为 null 撤回
  async saveProduction(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = productionSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;

    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const error = productionSaveError(row.snapshot, row.data, save);
    if (error) throw new BadRequestException(error);
    if (save.fileId && !(await this.originals(task.id, effectiveSnapshot(row.snapshot, row.data))).some((o) => o.fileId === save.fileId)) {
      throw new BadRequestException('对照的原件不在这个任务里');
    }

    const production = structuredClone(row.data.production ?? emptyProductionWorkup());
    const stamp = { by: user.id, byName: user.name, at: new Date().toISOString(), ...(save.fileId ? { fileId: save.fileId } : {}) };
    const put = <T>(map: Record<string, unknown>, key: string, value: T | null) => {
      if (value === null) delete map[key];
      else map[key] = { ...stamp, value };
    };
    switch (save.kind) {
      case 'equipment':
        put(production.equipment, save.rowId, save.value);
        break;
      case 'material':
        put(production.materials, save.rowId, save.value);
        // 删掉专家新增的物料，连同对它的危化品判断
        if (save.value === null && isAddedRow(save.rowId)) delete production.hazardous[save.rowId];
        break;
      case 'hazardous':
        put(production.hazardous, save.rowId, save.value);
        break;
      case 'special':
        put(production.special, save.category, save.value);
        break;
      case 'fireRating':
        put(production.fireRatings, save.rowId, save.value);
        break;
    }

    return this.write(task.id, row, { ...row.data, production }, user.id);
  }

  // 危险源辨识（14 页 E18-00C）：一次保存一行（改过的候选或新增行），带版本号，value 为 null 撤回到系统推荐 / 删掉新增行
  async saveRisk(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = riskSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;

    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const error = riskSaveError(row.snapshot, row.data, save) ?? riskNoteError(row.snapshot, row.data, save);
    if (error) throw new BadRequestException(error);
    if (save.fileId && !(await this.originals(task.id, effectiveSnapshot(row.snapshot, row.data))).some((o) => o.fileId === save.fileId)) {
      throw new BadRequestException('对照的原件不在这个任务里');
    }

    const rows = { ...row.data.risks?.rows };
    if (save.value === null) delete rows[save.rowId];
    else rows[save.rowId] = { by: user.id, byName: user.name, at: new Date().toISOString(), ...(save.fileId ? { fileId: save.fileId } : {}), value: save.value };

    return this.write(task.id, row, { ...row.data, risks: { rows } }, user.id);
  }

  // 适用范围（14 页 E18-00D）：一次确认或改一个开关，带版本号，value 为 null 撤回到系统建议
  async saveScope(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = scopeSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;
    if (STEP3_SCOPE_KEYS.includes(save.key)) throw new BadRequestException('这一项按第 3 步的回答定，请到第 3 步修改');

    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const switches = { ...row.data.scope?.switches };
    if (save.value === null) delete switches[save.key];
    else switches[save.key] = { by: user.id, byName: user.name, at: new Date().toISOString(), value: save.value };

    return this.write(task.id, row, { ...row.data, scope: { switches } }, user.id);
  }

  // 图件（14 页 E18-00F）：改一张或两张图的画法（null 恢复自动排版）、采用图；采用时记下当时的图，之后图有变化回到待采用
  async saveFigures(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = figuresSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;

    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const figures: FiguresWorkup = { ...row.data.figures, adopted: { ...row.data.figures?.adopted } };
    if (save.org === null) delete figures.org;
    else if (save.org) figures.org = save.org;
    if (save.process === null) delete figures.process;
    else if (save.process) figures.process = save.process;
    if (save.drawings) {
      const ours = new Set((await this.drawingCandidates(task.id, task.orgId, effectiveSnapshot(row.snapshot, row.data), row.data)).map((c) => c.fileId));
      if (Object.keys(save.drawings).some((id) => !ours.has(id))) throw new BadRequestException('这份图纸不在这个任务里');
      figures.drawings = { ...figures.drawings, ...save.drawings };
    }
    const view = figuresView(row.snapshot, { ...row.data, figures });
    const error = figuresSaveError(view, save);
    if (error) throw new BadRequestException(error);
    for (const key of save.adopt ?? []) {
      figures.adopted![key] = { by: user.id, byName: user.name, at: new Date().toISOString(), signature: figureSignature(view, key) };
    }

    return this.write(task.id, row, { ...row.data, figures }, user.id);
  }

  // 快照的来源：新流程（上传资料表格且已读出内容）取读表结果；老流程复制企业资料
  // db：在事务里调用时传 tx（PGlite 只有一个连接，事务里再用 this.db 会卡住）
  async buildSnapshot(task: { id: string; enterpriseId: string }, db: Executor = this.db): Promise<WorkupSnapshot> {
    const [intake] = await db
      .select({ parseResult: taskIntakes.parseResult })
      .from(taskIntakes)
      .where(eq(taskIntakes.taskId, task.id))
      .limit(1);
    if (intake?.parseResult) return { identity: intake.parseResult.identity, profile: intake.parseResult.profile };
    const [ent] = await db.select().from(enterprises).where(eq(enterprises.id, task.enterpriseId)).limit(1);
    return {
      identity: {
        name: ent!.name,
        socialCreditCode: ent!.socialCreditCode,
        legalRepresentative: ent!.legalRepresentative,
        registeredAddress: ent!.registeredAddress,
      },
      profile: ent!.profile,
    };
  }

  // 负责专家第一次打开时写快照；两人同时打开只留先写入的那份。只在负责专家的路径上调用。
  // 新流程（有 task_intakes 行）：和客户撤回用同一把锁，锁里再看一次任务还是已提交才算快照、插入；
  // 客户先撤回了就 409 customer_withdrew。快照在锁里算，免得插进撤回前的旧资料
  private async ensure(task: { id: string; enterpriseId: string }) {
    const existing = await this.row(task.id);
    if (existing) return existing;
    const data: WorkupData = { overrides: {} };
    const [intake] = await this.db.select({ taskId: taskIntakes.taskId }).from(taskIntakes).where(eq(taskIntakes.taskId, task.id)).limit(1);
    if (!intake) {
      const snapshot = await this.buildSnapshot(task);
      await this.db.insert(taskWorkups).values({ taskId: task.id, snapshot, data }).onConflictDoNothing();
      return (await this.row(task.id))!;
    }
    await this.db.transaction(async (tx) => {
      const { task: locked } = await lockTaskRow(tx, task.id);
      const [started] = await tx.select({ taskId: taskWorkups.taskId }).from(taskWorkups).where(eq(taskWorkups.taskId, task.id)).limit(1);
      if (started) return;
      if (locked.status !== 'submitted') throw customerWithdrew();
      const snapshot = await this.buildSnapshot(task, tx);
      await tx.insert(taskWorkups).values({ taskId: task.id, snapshot, data }).onConflictDoNothing();
    });
    return (await this.row(task.id))!;
  }

  private async row(taskId: string) {
    const [row] = await this.db.select().from(taskWorkups).where(eq(taskWorkups.taskId, taskId)).limit(1);
    return row;
  }

  // 客户原表（快照）和专家的修改（data）原样返回，页面自己算盖上后的内容
  private async view(taskId: string, row: WorkupRow) {
    const [by] = row.updatedBy
      ? await this.db.select({ name: users.name }).from(users).where(eq(users.id, row.updatedBy)).limit(1)
      : [];
    const effective = effectiveSnapshot(row.snapshot, row.data);
    const [task] = await this.db
      .select({ orgId: tasks.orgId, awaitingSince: tasks.awaitingCustomerSince, awaitingItems: tasks.awaitingCustomerItems, submittedAt: tasks.submittedAt })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const company = companyNameInputOf(row.snapshot, row.data);
    return {
      version: row.version,
      snapshot: row.snapshot,
      snapshotAt: row.snapshotAt,
      data: row.data,
      updatedAt: row.updatedAt,
      updatedByName: by?.name ?? null,
      // 新流程（上传资料表格）还是老流程（逐项填写）
      flow: (await this.isIntake(taskId)) ? ('intake' as const) : ('legacy' as const),
      intakeFiles: await this.intakeFiles(taskId),
      originals: await this.originals(taskId, effective),
      // 任务里现有的图纸（客户的、代传的、专家的三张），第 4 步图纸卡和客户未填用
      drawings: task ? await this.drawingFiles(taskId, task.orgId, effective, row.data) : [],
      // 知识库里的属地应急机构：整理页「企业事实」按它显示（与生成时一致）
      agencyDistricts: await this.knowledge.agencyDistricts(),
      // 新流程：每个字段读自资料表格的哪一格（对照客户原表用）；老流程为空
      sources: await this.sheetSources(taskId),
      // 第 5 步预案编号的建议值（字号拼音首字母 + 今年）；算不出为空串
      planCodeSuggestion: suggestPlanCode(company.name, company.addresses),
      // 等客户补资料（向导顶部提示）：复制缺项清单的时间和条数；没标为空
      awaiting: task?.awaitingSince ? { since: task.awaitingSince, items: task.awaitingItems ?? 0 } : null,
      // 客户提交的时间（老流程「客户在线填写，X 月 X 日提交」）
      submittedAt: task?.submittedAt ?? null,
    };
  }

  private async sheetSources(taskId: string): Promise<Record<string, IntakeCellRef>> {
    const [row] = await this.db.select({ parseResult: taskIntakes.parseResult }).from(taskIntakes).where(eq(taskIntakes.taskId, taskId)).limit(1);
    return row?.parseResult?.sources ?? {};
  }

  private async isIntake(taskId: string) {
    const [row] = await this.db.select({ taskId: taskIntakes.taskId }).from(taskIntakes).where(eq(taskIntakes.taskId, taskId)).limit(1);
    return Boolean(row);
  }

  // 新流程任务里客户（或专家代传）的文件，按上传先后；撤掉的不算
  async intakeFiles(taskId: string): Promise<WorkupIntakeFile[]> {
    return this.db
      .select({
        fileId: taskIntakeFiles.fileId,
        name: files.originalName,
        contentType: files.contentType,
        slot: taskIntakeFiles.slot,
        uploadedAt: taskIntakeFiles.uploadedAt,
      })
      .from(taskIntakeFiles)
      .innerJoin(files, eq(files.id, taskIntakeFiles.fileId))
      .where(and(eq(taskIntakeFiles.taskId, taskId), isNull(taskIntakeFiles.removedAt)))
      .orderBy(asc(taskIntakeFiles.uploadedAt));
  }

  // 挂在资料项上的文件 + 任务选用的企业资料（某一版本）+ 快照里自填时拍的照片（铭牌、标签、药箱），按文件去重
  async originals(taskId: string, snapshot: WorkupSnapshot): Promise<WorkupOriginal[]> {
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
    const photos = profilePhotos(snapshot).filter((p) => !byFile.has(p.fileId));
    if (photos.length > 0) {
      const rows = await this.db
        .select({ fileId: files.id, name: files.originalName, contentType: files.contentType, uploadedAt: files.createdAt })
        .from(files)
        .where(inArray(files.id, [...new Set(photos.map((p) => p.fileId))]));
      for (const p of photos) {
        const f = rows.find((r) => r.fileId === p.fileId);
        const found = byFile.get(p.fileId);
        if (found) {
          if (!found.itemKeys.includes(p.itemKey)) found.itemKeys.push(p.itemKey);
        } else if (f) byFile.set(p.fileId, { ...f, version: null, itemKeys: [p.itemKey] });
      }
    }
    return [...byFile.values()];
  }

  // 任务里的图纸（M2 第 10c 项）：上传已有资料挂在三项图纸上的（资料库的带资料名称），企业自填第 4 步上传的
  // （专家代传的在专家那份第 4 步里，叠上快照后一起算），资料表格流程上传页传的（总平面图、疏散图两个上传位），
  // 再加专家在第 4 步上传的三张图（data.resourcesExtra）。
  // 只认本组织的文件（资料里写进别家的文件编号也不认）；是不是 PDF / 图片由 DrawingsService 再筛
  async drawingCandidates(
    taskId: string,
    orgId: string,
    snapshot: WorkupSnapshot,
    data?: Pick<WorkupData, 'resourcesExtra'>,
  ): Promise<{ fileId: string; key: DrawingFileKey; name?: string }[]> {
    const out = new Map<string, { fileId: string; key: DrawingFileKey; name?: string }>();
    for (const o of await this.originals(taskId, snapshot)) {
      const key = drawingKeyOf(o.itemKeys);
      if (key && !out.has(o.fileId)) out.set(o.fileId, { fileId: o.fileId, key, name: o.name });
    }
    for (const f of await this.intakeFiles(taskId)) {
      const key = INTAKE_DRAWING_SLOTS[f.slot];
      if (key && !out.has(f.fileId)) out.set(f.fileId, { fileId: f.fileId, key, name: f.name });
    }
    const step = snapshot.profile.resourcesStep?.step;
    for (const key of CUSTOMER_DRAWING_KEYS) {
      for (const fileId of step?.drawings[key] ?? []) if (!out.has(fileId)) out.set(fileId, { fileId, key });
    }
    for (const key of EXPERT_DRAWING_KEYS) {
      for (const fileId of data?.resourcesExtra?.drawings[key] ?? []) if (!out.has(fileId)) out.set(fileId, { fileId, key });
    }
    if (out.size === 0) return [];
    const ours = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(inArray(files.id, [...out.keys()]), eq(files.orgId, orgId)));
    return [...out.values()].filter((c) => ours.some((o) => o.id === c.fileId));
  }

  // 图纸带上文件名和类型（页面判断能不能预览）
  async drawingFiles(taskId: string, orgId: string, snapshot: WorkupSnapshot, data: WorkupData): Promise<WorkupDrawingFile[]> {
    const candidates = await this.drawingCandidates(taskId, orgId, snapshot, data);
    if (candidates.length === 0) return [];
    const rows = await this.db
      .select({ id: files.id, name: files.originalName, contentType: files.contentType })
      .from(files)
      .where(inArray(files.id, candidates.map((c) => c.fileId)));
    return candidates.flatMap((c) => {
      const f = rows.find((r) => r.id === c.fileId);
      return f ? [{ fileId: c.fileId, key: c.key, name: c.name ?? f.name, contentType: f.contentType }] : [];
    });
  }

  // 负责专家、运营可以打开；客户和其他专家看不到（与不存在同样返回）。客户提交以后才开始核对
  async task(user: SessionUser, id: string) {
    const [task] = await this.db
      .select({
        id: tasks.id,
        orgId: tasks.orgId,
        enterpriseId: tasks.enterpriseId,
        assignedExpertId: tasks.assignedExpertId,
        status: tasks.status,
        submittedAt: tasks.submittedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .limit(1);
    const isAssigned = task && task.assignedExpertId === user.id && user.memberships.some((m) => m.role === 'expert');
    if (!task || !(isAssigned || isOperator(user))) throw new NotFoundException(NOT_FOUND);
    if (task.status !== 'submitted') {
      // 新流程的任务被客户撤回了：和锁里撞上撤回同一句话
      const [withdrawn] = await this.db
        .select({ id: taskIntakeSubmissions.id })
        .from(taskIntakeSubmissions)
        .where(and(eq(taskIntakeSubmissions.taskId, id), isNotNull(taskIntakeSubmissions.withdrawnAt)))
        .limit(1);
      if (withdrawn && task.status === 'preparing') throw customerWithdrew();
      throw new BadRequestException('客户还没有提交资料，提交后才能开始核对');
    }
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

  @Put('production')
  saveProduction(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveProduction(user, id, body);
  }

  @Put('risks')
  saveRisk(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveRisk(user, id, body);
  }

  @Put('scope')
  saveScope(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveScope(user, id, body);
  }

  @Put('steps/basic')
  saveBasicStep(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveBasicStep(user, id, body);
  }

  @Put('steps/organization')
  saveOrganizationStep(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveOrganizationStep(user, id, body);
  }

  @Put('steps/production')
  saveProductionStep(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveProductionStep(user, id, body);
  }

  @Put('steps/resources')
  saveResourcesStep(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveResourcesStep(user, id, body);
  }

  // 代客户上传 / 专家上传的图：一次一个文件，target 决定写到哪里，带 version
  @Post('files')
  async upload(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: { target?: string; version?: string; replace?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 先查权限再收文件
    await this.service.assertExpert(user, id);
    let file: Express.Multer.File | undefined;
    try {
      file = await receiveOne(req, res, WORKUP_UPLOAD_MAX_BYTES);
    } catch (err) {
      if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
        throw new BadRequestException(`文件超过单个文件 ${WORKUP_UPLOAD_MAX_BYTES / 1024 / 1024} MB 限制。请压缩后重新选择`);
      }
      if (err instanceof MulterError) throw new BadRequestException('请一次上传一个文件');
      throw err;
    }
    if (!file) throw new BadRequestException('请选择要上传的文件');
    return this.service.uploadFile(user, id, query, file);
  }

  @Put('steps/review')
  saveReviewStep(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveReviewStep(user, id, body);
  }

  @Post('missing-list')
  copyMissingList(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.copyMissingList(user, id, body);
  }

  @Get('missing-list')
  missingList(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.missingList(user, id);
  }

  @Put('steps/done')
  saveStepsDone(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveStepsDone(user, id, body);
  }

  @Put('figures')
  saveFigures(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveFigures(user, id, body);
  }
}
