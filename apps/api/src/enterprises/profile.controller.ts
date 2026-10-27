import {
  basicInfoStartReady,
  basicStepSaveSchema,
  defaultOrganizationStep,
  defaultProductionStep,
  dutyPhoneOfStep,
  emergencyGroupsStartReady,
  enterpriseInputSchema,
  equipmentStartReady,
  fileIdsOfProductionStep,
  LICENSE_FIELDS,
  materialsStartReady,
  organizationStepSaveSchema,
  productionStepSaveSchema,
  specialEquipmentStatus,
  type BasicStep,
  type BasicStepStored,
  type ChecklistItemKey,
  type EnterpriseInput,
  type EnterpriseProfile,
  type ItemStatus,
  type OrganizationStepStored,
  type ProductionStep,
  type RecognizedLicense,
} from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { and, eq, inArray, isNull, notExists } from 'drizzle-orm';
import { z } from 'zod';
import { canEditOrganizationData, canViewOrganization } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { checklistItemFiles, checklistItems, enterprises, files, tasks } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import { LICENSE_RECOGNIZER, type LicenseRecognizer } from '../license/recognizer.ts';

const NOT_FOUND = '找不到该企业';
const DUPLICATE_CODE = '本组织已有使用该统一社会信用代码的企业';
const STALE = '资料刚被其他人修改过，已为您显示最新内容，请核对后继续填写';

const IDENTITY_KEYS = ['name', 'socialCreditCode', 'legalRepresentative', 'registeredAddress'] as const;
const LICENSE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

const fileIdSchema = z.object({ fileId: z.uuid('请选择文件') });

// 资料清单里由自填内容自动得出的状态；清空时只撤回这几种，且有文件作凭证的不动
type SyncedStatus = Exclude<ItemStatus, 'later'>;
const SYNCED_STATUSES: SyncedStatus[] = ['provided', 'none', 'photo_for_expert'];

type Row = typeof enterprises.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function emptyStep(): BasicStepStored {
  return { basic: {}, later: [], sources: {} };
}

// 企业自填（12 页 S01、S02、S03a）：第 1 步读取、自动保存、上传营业执照并识别；第 2 步读取、自动保存、上传花名册；
// 第 3 步读取、自动保存（照片、台账先上传，再随内容一起保存）
@Controller('enterprises/:id')
export class EnterpriseProfileController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Optional() @Inject(LICENSE_RECOGNIZER) private readonly recognizer: LicenseRecognizer | null,
  ) {}

  @Get('basic-step')
  async get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.view(await this.load(user, id));
  }

  @Put('basic-step')
  async save(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const row = await this.editable(user, id);
    const parsed = basicStepSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const { version, identity, basic, later, sources } = parsed.data;
    if (version !== row.version) throw this.stale(row.version);

    const step: BasicStepStored = { ...(row.profile.basicStep ?? emptyStep()), basic, later, sources };
    const saved = await this.write(user, row, version, { basicStep: step }, identity);
    return this.view(saved);
  }

  // 营业执照挂到企业上并识别；识别出的字段覆盖到表单里，标「来自营业执照」
  @Post('license')
  async license(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const row = await this.editable(user, id);
    const parsed = fileIdSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择文件');
    const [file] = await this.db
      .select({ id: files.id, storageKey: files.storageKey, contentType: files.contentType })
      .from(files)
      .where(and(eq(files.id, parsed.data.fileId), eq(files.orgId, row.orgId), eq(files.kind, 'customer_material')))
      .limit(1);
    if (!file) throw new NotFoundException('找不到该文件');
    if (!LICENSE_TYPES.includes(file.contentType)) throw new BadRequestException('营业执照请上传 JPG、PNG 图片或 PDF');

    let recognized: RecognizedLicense = {};
    let status: 'recognized' | 'unrecognized' | 'unavailable' | 'failed' = 'unavailable';
    if (this.recognizer) {
      try {
        recognized = await this.recognizer.recognize(await this.storage.read(file.storageKey), file.contentType);
        status = 'recognized';
      } catch (err) {
        console.warn('营业执照识别失败', err);
        status = 'failed';
      }
    }

    const step: BasicStepStored = { ...(row.profile.basicStep ?? emptyStep()), licenseFileId: file.id };
    const identity: EnterpriseInput = {
      name: row.name,
      socialCreditCode: row.socialCreditCode,
      legalRepresentative: row.legalRepresentative,
      registeredAddress: row.registeredAddress,
    };
    const basic: BasicStep = { ...step.basic };
    const sources = { ...step.sources };
    let count = 0;
    for (const field of LICENSE_FIELDS) {
      const value = recognized[field]?.trim();
      if (!value) continue;
      // 识别结果也按同一套规则校验，格式不对的不填（如信用代码位数不对）
      if ((IDENTITY_KEYS as readonly string[]).includes(field)) {
        const key = field as (typeof IDENTITY_KEYS)[number];
        const check = enterpriseInputSchema.shape[key].safeParse(value);
        if (!check.success || !check.data) continue;
        identity[key] = check.data;
      } else {
        basic[field as 'companyType' | 'registeredCapital' | 'registrationAuthority' | 'businessScope'] = value;
      }
      sources[field] = 'license';
      count += 1;
    }
    if (status === 'recognized' && count === 0) status = 'unrecognized';

    const saved = await this.write(user, row, row.version, { basicStep: { ...step, basic, sources } }, identity);
    return { ...(await this.view(saved)), recognition: { status, count } };
  }

  @Get('organization-step')
  async getOrganization(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizationView(await this.load(user, id));
  }

  @Put('organization-step')
  async saveOrganization(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const row = await this.editable(user, id);
    const parsed = organizationStepSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    if (parsed.data.version !== row.version) throw this.stale(row.version);
    const stored: OrganizationStepStored = {
      rosterFileIds: row.profile.organizationStep?.rosterFileIds ?? [],
      step: parsed.data.step,
    };
    return this.organizationView(await this.write(user, row, row.version, { organizationStep: stored }));
  }

  // 上传花名册：文件记在企业资料里，页面另把它挂到任务的「各应急小组成员」上
  @Post('roster')
  async addRoster(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const row = await this.editable(user, id);
    const parsed = fileIdSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择文件');
    const [file] = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, parsed.data.fileId), eq(files.orgId, row.orgId), eq(files.kind, 'customer_material')))
      .limit(1);
    if (!file) throw new NotFoundException('找不到该文件');
    const current = this.organizationStored(row);
    if (current.rosterFileIds.includes(file.id)) return this.organizationView(row);
    const stored = { ...current, rosterFileIds: [...current.rosterFileIds, file.id] };
    return this.organizationView(await this.write(user, row, row.version, { organizationStep: stored }));
  }

  @Delete('roster/:fileId')
  async removeRoster(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    const row = await this.editable(user, id);
    const current = this.organizationStored(row);
    if (!current.rosterFileIds.includes(fileId)) return this.organizationView(row);
    const stored = { ...current, rosterFileIds: current.rosterFileIds.filter((f) => f !== fileId) };
    return this.organizationView(await this.write(user, row, row.version, { organizationStep: stored }));
  }

  @Get('production-step')
  async getProduction(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.productionView(await this.load(user, id));
  }

  @Put('production-step')
  async saveProduction(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const row = await this.editable(user, id);
    const parsed = productionStepSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    if (parsed.data.version !== row.version) throw this.stale(row.version);
    const { step } = parsed.data;
    // 照片、台账只能引用本组织上传的文件
    const ids = fileIdsOfProductionStep(step);
    if (ids.length > 0) {
      const found = await this.db
        .select({ id: files.id })
        .from(files)
        .where(and(inArray(files.id, ids), eq(files.orgId, row.orgId), eq(files.kind, 'customer_material')));
      if (found.length !== ids.length) throw new NotFoundException('找不到该文件');
    }
    return this.productionView(await this.write(user, row, row.version, { productionStep: { step } }));
  }

  private productionStep(row: Row): ProductionStep {
    return row.profile.productionStep?.step ?? defaultProductionStep(row.profile.basicStep?.basic.businessScope);
  }

  private async productionView(row: Row) {
    const step = this.productionStep(row);
    const ids = fileIdsOfProductionStep(step);
    const named =
      ids.length === 0
        ? []
        : await this.db
            .select({ id: files.id, originalName: files.originalName })
            .from(files)
            .where(inArray(files.id, ids));
    return {
      enterpriseId: row.id,
      version: row.version,
      step,
      // 页面显示照片、台账的文件名
      fileNames: Object.fromEntries(named.map((f) => [f.id, f.originalName])),
      // 第 1 步填的经营范围，用于说明预选了哪些场所
      businessScope: row.profile.basicStep?.basic.businessScope ?? null,
      saved: Boolean(row.profile.productionStep),
      updatedAt: row.updatedAt,
    };
  }

  private organizationStored(row: Row): OrganizationStepStored {
    const employeeCount = row.profile.basicStep?.basic.employeeCount;
    return row.profile.organizationStep ?? { step: defaultOrganizationStep(employeeCount), rosterFileIds: [] };
  }

  private async organizationView(row: Row) {
    const stored = this.organizationStored(row);
    const roster =
      stored.rosterFileIds.length === 0
        ? []
        : await this.db
            .select({ fileId: files.id, originalName: files.originalName })
            .from(files)
            .where(inArray(files.id, stored.rosterFileIds));
    return {
      enterpriseId: row.id,
      version: row.version,
      step: stored.step,
      // 按上传先后排列
      roster: stored.rosterFileIds.flatMap((fid) => roster.filter((f) => f.fileId === fid)),
      employeeCount: row.profile.basicStep?.basic.employeeCount ?? null,
      updatedAt: row.updatedAt,
    };
  }

  // 保存一块企业资料（identity 只有第 1 步会改），版本加 1，资料清单跟着变
  private async write(
    user: SessionUser,
    row: Row,
    version: number,
    patch: Partial<EnterpriseProfile>,
    identity?: EnterpriseInput,
  ) {
    const profile: EnterpriseProfile = { ...row.profile, ...patch };
    try {
      return await this.db.transaction(async (tx) => {
        const [saved] = await tx
          .update(enterprises)
          .set({
            ...identity,
            profile,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(enterprises.id, row.id), eq(enterprises.version, version)))
          .returning();
        // 读与写之间别人刚好保存了
        if (!saved) throw this.stale(version + 1);
        const provided = (ready: boolean) => (ready ? ('provided' as const) : null);
        if (patch.basicStep) {
          await this.syncItem(tx, user, row.id, 'basic_info', provided(basicInfoStartReady(patch.basicStep.basic)));
        }
        if (patch.organizationStep) {
          const { step } = patch.organizationStep;
          await this.syncItem(tx, user, row.id, 'emergency_groups', provided(emergencyGroupsStartReady(step)));
          await this.syncItem(tx, user, row.id, 'duty_phone', provided(Boolean(dutyPhoneOfStep(step))));
        }
        if (patch.productionStep) {
          const { step } = patch.productionStep;
          await this.syncItem(tx, user, row.id, 'equipment', provided(equipmentStartReady(step)));
          await this.syncItem(tx, user, row.id, 'materials', provided(materialsStartReady(step)));
          await this.syncItem(tx, user, row.id, 'special_equipment', specialEquipmentStatus(step.specialEquipment));
        }
        return saved;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'enterprises_org_credit_code_unique')) {
        throw new ConflictException({ statusCode: 409, message: DUPLICATE_CODE, field: 'socialCreditCode' });
      }
      throw err;
    }
  }

  // 资料清单跟着填写情况走：开始编制需要的内容都填了就是「已提供」（特种设备也可能是「没有」或
  // 「拍照给耕云看」），删掉其中一项又回到未回答（有文件作凭证的不动）。只改还在准备资料的任务
  private async syncItem(
    tx: Tx,
    user: SessionUser,
    enterpriseId: string,
    itemKey: ChecklistItemKey,
    target: SyncedStatus | null,
  ) {
    const open = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.enterpriseId, enterpriseId), eq(tasks.status, 'preparing'), isNull(tasks.closedAt)));
    if (open.length === 0) return;
    const ids = open.map((t) => t.id);

    if (!target) {
      await tx.delete(checklistItems).where(
        and(
          inArray(checklistItems.taskId, ids),
          eq(checklistItems.itemKey, itemKey),
          inArray(checklistItems.status, SYNCED_STATUSES),
          notExists(
            tx
              .select({ one: checklistItemFiles.fileId })
              .from(checklistItemFiles)
              .where(
                and(eq(checklistItemFiles.taskId, checklistItems.taskId), eq(checklistItemFiles.itemKey, itemKey)),
              ),
          ),
        ),
      );
      return;
    }

    const now = new Date();
    for (const taskId of ids) {
      const [item] = await tx
        .select({ status: checklistItems.status })
        .from(checklistItems)
        .where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.itemKey, itemKey)))
        .limit(1);
      if (item?.status === target) continue;
      // 客户直接填写的「已提供」「没有」由当前账号确认；「拍照给耕云看」等专家判断
      const confirms = target !== 'photo_for_expert';
      const values = {
        status: target,
        confirmedBy: confirms ? user.id : null,
        confirmedAt: confirms ? now : null,
        callRequested: false,
        expertResult: confirms ? null : ('pending' as const),
        expertJudgedBy: null,
        expertJudgedAt: null,
        updatedBy: user.id,
        updatedAt: now,
      };
      await tx
        .insert(checklistItems)
        .values({ taskId, itemKey, ...values })
        .onConflictDoUpdate({ target: [checklistItems.taskId, checklistItems.itemKey], set: values });
    }
  }

  private async view(row: Row) {
    const step = row.profile.basicStep ?? emptyStep();
    let license: { fileId: string; originalName: string } | null = null;
    if (step.licenseFileId) {
      const [file] = await this.db
        .select({ originalName: files.originalName })
        .from(files)
        .where(eq(files.id, step.licenseFileId))
        .limit(1);
      if (file) license = { fileId: step.licenseFileId, originalName: file.originalName };
    }
    return {
      enterpriseId: row.id,
      version: row.version,
      identity: {
        name: row.name,
        socialCreditCode: row.socialCreditCode,
        legalRepresentative: row.legalRepresentative,
        registeredAddress: row.registeredAddress,
      },
      basic: step.basic,
      later: step.later,
      sources: step.sources,
      license,
      recognizerAvailable: Boolean(this.recognizer),
      updatedAt: row.updatedAt,
    };
  }

  private stale(version: number) {
    return new ConflictException({ statusCode: 409, message: STALE, reason: 'stale', version });
  }

  // 无权访问与不存在返回同样的结果，不暴露别家企业是否存在
  private async load(user: SessionUser, id: string): Promise<Row> {
    const [row] = await this.db.select().from(enterprises).where(eq(enterprises.id, id)).limit(1);
    if (!row || !canViewOrganization(user, row.orgId)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async editable(user: SessionUser, id: string): Promise<Row> {
    const row = await this.load(user, id);
    if (!canEditOrganizationData(user, row.orgId)) throw new ForbiddenException('企业资料由客户填写');
    return row;
  }
}
