import {
  basicStepWorkupSaveSchema,
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
  type CustomerDrawingKey,
  type FactOverride,
  type FiguresWorkup,
  type IntakeFileSlot,
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
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { isOperator } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { lockTaskRow } from '../intake/intake.service.ts';
import { KnowledgeService } from '../knowledge/knowledge.service.ts';
import {
  checklistItemFiles,
  enterpriseDocuments,
  enterpriseDocumentVersions,
  enterprises,
  files,
  taskDocuments,
  taskIntakeFiles,
  taskIntakes,
  taskIntakeSubmissions,
  tasks,
  taskWorkups,
  users,
} from '../db/schema.ts';

const NOT_FOUND = '找不到该任务';

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
@Injectable()
export class WorkupService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
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
    const [saved] = await this.db
      .update(taskWorkups)
      .set({ data, version: row.version + 1, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(taskWorkups.taskId, taskId), eq(taskWorkups.version, row.version)))
      .returning();
    // 读与写之间别人刚好保存了
    if (!saved) throw this.stale(row.version + 1);
    return this.view(taskId, saved);
  }

  async saveFact(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = factSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const { version, key, value, fileId, source } = parsed.data;

    const row = await this.ensure(task);
    if (version !== row.version) throw this.stale(row.version);
    const error = factSaveError(factDefOf(row.snapshot, key, row.data), value);
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
    const [saved] = await this.db
      .update(taskWorkups)
      .set({ data: { ...row.data, overrides }, version: version + 1, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, version)))
      .returning();
    // 读与写之间别人刚好保存了
    if (!saved) throw this.stale(version + 1);
    return this.view(task.id, saved);
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

    const [saved] = await this.db
      .update(taskWorkups)
      .set({ data: { ...row.data, production }, version: save.version + 1, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, save.version)))
      .returning();
    if (!saved) throw this.stale(save.version + 1);
    return this.view(task.id, saved);
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
    const error = riskSaveError(row.snapshot, row.data, save);
    if (error) throw new BadRequestException(error);
    if (save.fileId && !(await this.originals(task.id, effectiveSnapshot(row.snapshot, row.data))).some((o) => o.fileId === save.fileId)) {
      throw new BadRequestException('对照的原件不在这个任务里');
    }

    const rows = { ...row.data.risks?.rows };
    if (save.value === null) delete rows[save.rowId];
    else rows[save.rowId] = { by: user.id, byName: user.name, at: new Date().toISOString(), ...(save.fileId ? { fileId: save.fileId } : {}), value: save.value };

    const [saved] = await this.db
      .update(taskWorkups)
      .set({ data: { ...row.data, risks: { rows } }, version: save.version + 1, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, save.version)))
      .returning();
    if (!saved) throw this.stale(save.version + 1);
    return this.view(task.id, saved);
  }

  // 适用范围（14 页 E18-00D）：一次确认或改一个开关，带版本号，value 为 null 撤回到系统建议
  async saveScope(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException(ONLY_EXPERT);
    const parsed = scopeSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;

    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const switches = { ...row.data.scope?.switches };
    if (save.value === null) delete switches[save.key];
    else switches[save.key] = { by: user.id, byName: user.name, at: new Date().toISOString(), value: save.value };

    const [saved] = await this.db
      .update(taskWorkups)
      .set({ data: { ...row.data, scope: { switches } }, version: save.version + 1, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, save.version)))
      .returning();
    if (!saved) throw this.stale(save.version + 1);
    return this.view(task.id, saved);
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
      const ours = new Set((await this.drawingCandidates(task.id, task.orgId, effectiveSnapshot(row.snapshot, row.data))).map((c) => c.fileId));
      if (Object.keys(save.drawings).some((id) => !ours.has(id))) throw new BadRequestException('这份图纸不在这个任务里');
      figures.drawings = { ...figures.drawings, ...save.drawings };
    }
    const view = figuresView(row.snapshot, { ...row.data, figures });
    const error = figuresSaveError(view, save);
    if (error) throw new BadRequestException(error);
    for (const key of save.adopt ?? []) {
      figures.adopted![key] = { by: user.id, byName: user.name, at: new Date().toISOString(), signature: figureSignature(view, key) };
    }

    const [saved] = await this.db
      .update(taskWorkups)
      .set({ data: { ...row.data, figures }, version: save.version + 1, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, save.version)))
      .returning();
    if (!saved) throw this.stale(save.version + 1);
    return this.view(task.id, saved);
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
      originals: await this.originals(taskId, effectiveSnapshot(row.snapshot, row.data)),
      // 知识库里的属地应急机构：整理页「企业事实」按它显示（与生成时一致）
      agencyDistricts: await this.knowledge.agencyDistricts(),
    };
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

  // 任务里的客户图纸（M2 第 10c 项）：上传已有资料挂在三项图纸上的（资料库的带资料名称），加上企业自填第 4 步上传的。
  // 只认本组织的文件（资料里写进别家的文件编号也不认）；是不是 PDF / 图片由 DrawingsService 再筛
  async drawingCandidates(taskId: string, orgId: string, snapshot: WorkupSnapshot): Promise<{ fileId: string; key: CustomerDrawingKey; name?: string }[]> {
    const out = new Map<string, { fileId: string; key: CustomerDrawingKey; name?: string }>();
    for (const o of await this.originals(taskId, snapshot)) {
      const key = drawingKeyOf(o.itemKeys);
      if (key && !out.has(o.fileId)) out.set(o.fileId, { fileId: o.fileId, key, name: o.name });
    }
    const step = snapshot.profile.resourcesStep?.step;
    for (const key of CUSTOMER_DRAWING_KEYS) {
      for (const fileId of step?.drawings[key] ?? []) if (!out.has(fileId)) out.set(fileId, { fileId, key });
    }
    if (out.size === 0) return [];
    const ours = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(inArray(files.id, [...out.keys()]), eq(files.orgId, orgId)));
    return [...out.values()].filter((c) => ours.some((o) => o.id === c.fileId));
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

  @Put('steps/done')
  saveStepsDone(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveStepsDone(user, id, body);
  }

  @Put('figures')
  saveFigures(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveFigures(user, id, body);
  }
}
