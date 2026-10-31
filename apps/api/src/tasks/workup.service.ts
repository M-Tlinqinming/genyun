import {
  CUSTOMER_DRAWING_KEYS,
  drawingKeyOf,
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
import { and, eq, inArray } from 'drizzle-orm';
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
  taskContacts,
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
    const { version, key, value, fileId, contactId } = parsed.data;
    // 采用客户在任务里的回答：来源是客户确认 · 任务内补充
    const source = contactId ? 'customer' : parsed.data.source;

    const row = await this.ensure(task);
    if (version !== row.version) throw this.stale(row.version);
    const error = factSaveError(factDefOf(row.snapshot, key), value);
    if (error) throw new BadRequestException(error);
    if (fileId && !(await this.originals(task.id, row.snapshot)).some((o) => o.fileId === fileId)) {
      throw new BadRequestException('对照的原件不在这个任务里');
    }
    if (contactId && value !== null) {
      const [contact] = await this.db
        .select({ answeredAt: taskContacts.answeredAt })
        .from(taskContacts)
        .where(and(eq(taskContacts.id, contactId), eq(taskContacts.taskId, task.id), eq(taskContacts.method, 'request')))
        .limit(1);
      if (!contact?.answeredAt) throw new BadRequestException('客户还没有回答这条补充请求');
    }

    const overrides = { ...row.data.overrides };
    if (value === null) delete overrides[key];
    else {
      const entry: FactOverride = { value, source, by: user.id, byName: user.name, at: new Date().toISOString() };
      if (fileId) entry.fileId = fileId;
      if (contactId) Object.assign(entry, { via: 'request', contactId });
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
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以修改专业整理');
    const parsed = productionSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;

    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const error = productionSaveError(row.snapshot, row.data, save);
    if (error) throw new BadRequestException(error);
    if (save.fileId && !(await this.originals(task.id, row.snapshot)).some((o) => o.fileId === save.fileId)) {
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
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以修改专业整理');
    const parsed = riskSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const save = parsed.data;

    const row = await this.ensure(task);
    if (save.version !== row.version) throw this.stale(row.version);
    const error = riskSaveError(row.snapshot, row.data, save);
    if (error) throw new BadRequestException(error);
    if (save.fileId && !(await this.originals(task.id, row.snapshot)).some((o) => o.fileId === save.fileId)) {
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
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以修改专业整理');
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
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以修改专业整理');
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
      const ours = new Set((await this.drawingCandidates(task.id, task.orgId, row.snapshot)).map((c) => c.fileId));
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

  // 电话问清后把回答回填到企业事实，来源记为「客户确认 · 电话确认」。和专家正在编辑的页面同时保存时重读再写
  async applyPhoneAnswers(
    user: SessionUser,
    task: { id: string; enterpriseId: string },
    contactId: string,
    answers: { key: string; value: FactOverride['value'] }[],
  ) {
    if (answers.length === 0) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.ensure(task);
      const overrides = { ...row.data.overrides };
      const at = new Date().toISOString();
      for (const a of answers) {
        overrides[a.key] = { value: a.value, source: 'customer', via: 'phone', contactId, by: user.id, byName: user.name, at };
      }
      const [saved] = await this.db
        .update(taskWorkups)
        .set({ data: { ...row.data, overrides }, version: row.version + 1, updatedBy: user.id, updatedAt: new Date() })
        .where(and(eq(taskWorkups.taskId, task.id), eq(taskWorkups.version, row.version)))
        .returning({ version: taskWorkups.version });
      if (saved) return;
    }
    throw this.stale((await this.row(task.id))!.version);
  }

  async snapshotOf(task: { id: string; enterpriseId: string }) {
    return (await this.ensure(task)).snapshot;
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
      originals: await this.originals(taskId, row.snapshot),
    };
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

  // 负责专家、运营可以打开；客户和其他专家看不到（与不存在同样返回）。客户提交以后才开始整理
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

  @Put('figures')
  saveFigures(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.saveFigures(user, id, body);
  }
}
