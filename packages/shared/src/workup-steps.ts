// 专家资料核对向导（五步）：专家逐步核对后，把整步内容存成「专家那份」（WorkupData.identity / profile），
// 读资料的地方一律先用 effectiveSnapshot 把专家那份盖在快照上，客户原表（快照）始终不动。
// 老的整理页按单项改的（data.overrides）在向导里合并显示；向导保存一步时整步写进专家那份，同时删掉这一步用过的单项修改。
import { z } from 'zod';
import type { BasicStep, BasicStepStored, EnterpriseProfile } from './profile/basic-step.ts';
import { basicStepSchema } from './profile/basic-step.ts';
import { YES_NO_UNKNOWN_LABELS, type YesNoUnknown } from './profile/basic.ts';
import { INDUSTRY_NAMES } from './profile/industries.ts';
import { PRESET_GROUPS } from './profile/organization.ts';
import {
  defaultOrganizationStep,
  type DraftPerson,
  type OrganizationStep,
  organizationStepSchema,
} from './profile/organization-step.ts';
import { productionStepSchema, type ProductionStep } from './profile/production-step.ts';
import { resourcesStepSchema, type ResourcesStep } from './profile/resources-step.ts';
import { emptyProductionWorkup, isAddedRow, type ProductionWorkup, type Stamp } from './workup-production.ts';
import { resourcesExtraSchema } from './workup-resources.ts';
import type { FactOverride, FactPerson, FactValue, WorkupData, WorkupSnapshot } from './workup.ts';

// 向导的五步（任务中心「资料核对 N / 5 步」、页头阶段条共用）
export const WORKUP_STEPS = ['企业基本信息', '人员与应急组织', '生产情况', '应急资源与图纸', '核对并生成'] as const;

// 专家那份：身份整份替换，企业资料按步替换（第 1 步 basicStep、第 2 步 organizationStep）
export type ExpertCopy = Pick<WorkupData, 'identity' | 'profile'>;

/** 把专家那份盖在快照上；没有专家那份就是快照本身。纯函数，重复调用结果不变 */
export function effectiveSnapshot(snapshot: WorkupSnapshot, data: Partial<ExpertCopy> | null | undefined): WorkupSnapshot {
  if (!data || (!data.identity && !data.profile)) return snapshot;
  const profile: EnterpriseProfile = { ...snapshot.profile };
  for (const [k, v] of Object.entries(data.profile ?? {})) {
    if (v !== undefined) (profile as Record<string, unknown>)[k] = v;
  }
  return { identity: data.identity ?? snapshot.identity, profile };
}

// ── 每一步用到的事实项（老整理页的单项修改按这些键合并、保存后删除） ──
export type WizardStep = 'basic' | 'organization' | 'production' | 'resources';

export const BASIC_STEP_KEYS = [
  'companyName',
  'socialCreditCode',
  'legalRepresentative',
  'registeredAddress',
  'siteAddress',
  'otherAddresses',
  'industry',
  'companyType',
  'mainProducts',
  'employeeCount',
  'technicalManagementCount',
  'contactPerson',
  'contactPhone',
  'responsiblePerson',
  'safetyManagementCount',
  'landArea',
] as const;

const ORG_KEYS = ['commander', 'dutyPhone', 'paSystem', 'imGroup'];

// 第 3、4 步没有老整理页的单项修改；「先留空」的键带步骤前缀（如 resources.firePool.volume）
export const PRODUCTION_STEP_PREFIX = 'production.';
export const RESOURCES_STEP_PREFIX = 'resources.';

/** 这一项事实属于向导的哪一步（agency.*、编制小组、专家判断等不属于第 1–4 步） */
export function wizardStepOfKey(key: string): WizardStep | undefined {
  if ((BASIC_STEP_KEYS as readonly string[]).includes(key)) return 'basic';
  if (ORG_KEYS.includes(key) || key.startsWith('deputy.') || key.startsWith('group.')) return 'organization';
  if (key.startsWith(PRODUCTION_STEP_PREFIX)) return 'production';
  if (key.startsWith(RESOURCES_STEP_PREFIX)) return 'resources';
  return undefined;
}

/** 删掉这一步用过的单项修改（向导保存这一步时一起做） */
export function stripStepOverrides(overrides: Record<string, FactOverride>, step: WizardStep): Record<string, FactOverride> {
  return Object.fromEntries(Object.entries(overrides).filter(([k]) => wizardStepOfKey(k) !== step));
}

/** 「先留空」：换掉这一步的键，别的步的保留 */
export function replaceStepBlank(blank: readonly string[] | undefined, step: WizardStep, next: readonly string[]): string[] {
  const kept = (blank ?? []).filter((k) => wizardStepOfKey(k) !== step);
  const mine = [...new Set(next.filter((k) => wizardStepOfKey(k) === step))];
  return [...kept, ...mine];
}

const text = (v: FactValue | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const count = (v: FactValue | undefined) => (typeof v === 'number' ? v : undefined);
const squareMeters = (v: FactValue | undefined) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// workup.ts answerText 的反向：「有 · 明细」「没有」「不清楚」
export function answerOf(v: FactValue | undefined): { answer: YesNoUnknown; detail?: string } | undefined {
  const s = text(v);
  if (!s) return undefined;
  const [head, ...rest] = s.split(' · ');
  const answer = (Object.keys(YES_NO_UNKNOWN_LABELS) as YesNoUnknown[]).find((k) => YES_NO_UNKNOWN_LABELS[k] === head);
  // 专家直接写了名称的，按「有」处理
  if (!answer) return { answer: 'yes', detail: s };
  return { answer, detail: rest.join(' · ') || undefined };
}

const industryCodeOf = (name: string | undefined) =>
  name ? (Object.entries(INDUSTRY_NAMES).find(([, n]) => n === name)?.[0] ?? undefined) : undefined;

export interface BasicStepView {
  identity: WorkupSnapshot['identity'];
  basic: BasicStep;
  stored?: BasicStepStored;
}

/** 第 1 步显示的内容：（专家那份 ?? 快照）+ 老整理页对基本信息、联系与规模的单项修改 */
export function basicStepView(snapshot: WorkupSnapshot, data: Pick<WorkupData, 'overrides'> & Partial<ExpertCopy>): BasicStepView {
  const eff = effectiveSnapshot(snapshot, data);
  const o = (key: string) => data.overrides[key]?.value;
  const stored = eff.profile.basicStep;
  const b: BasicStep = { ...(stored?.basic ?? {}) };
  const id = eff.identity;
  const others = text(o('otherAddresses'));
  const prev = b.otherAddresses ?? [];
  const basic: BasicStep = {
    ...b,
    siteAddress: text(o('siteAddress')) ?? b.siteAddress,
    otherAddresses:
      o('otherAddresses') === undefined
        ? b.otherAddresses
        : (others ?? '').split('；').map((s) => s.trim()).filter(Boolean).map((address, i) => ({ id: prev[i]?.id ?? `addr${i + 2}`, address })),
    industry: o('industry') === undefined ? b.industry : (industryCodeOf(text(o('industry'))) ?? b.industry),
    companyType: text(o('companyType')) ?? b.companyType,
    mainProducts: text(o('mainProducts')) ?? b.mainProducts,
    employeeCount: count(o('employeeCount')) ?? b.employeeCount,
    technicalManagementCount: count(o('technicalManagementCount')) ?? b.technicalManagementCount,
    contactPerson: text(o('contactPerson')) ?? b.contactPerson,
    contactPhone: text(o('contactPhone')) ?? b.contactPhone,
    responsiblePerson: text(o('responsiblePerson')) ?? b.responsiblePerson,
    safetyManagementCount: count(o('safetyManagementCount')) ?? b.safetyManagementCount,
    landAreaM2: o('landArea') === undefined ? b.landAreaM2 : squareMeters(o('landArea')),
  };
  for (const k of Object.keys(basic) as (keyof BasicStep)[]) if (basic[k] === undefined) delete basic[k];
  return {
    identity: {
      name: text(o('companyName')) ?? id.name,
      socialCreditCode: text(o('socialCreditCode')) ?? id.socialCreditCode,
      legalRepresentative: text(o('legalRepresentative')) ?? id.legalRepresentative,
      registeredAddress: text(o('registeredAddress')) ?? id.registeredAddress,
    },
    basic,
    stored,
  };
}

export function organizationOfSnapshot(snapshot: WorkupSnapshot): OrganizationStep {
  return snapshot.profile.organizationStep?.step ?? defaultOrganizationStep(snapshot.profile.basicStep?.basic.employeeCount);
}

/**
 * 第 2 步显示的内容：（专家那份 ?? 快照）+ 老整理页改过的总指挥、副总指挥、组长、值班电话、广播、工作群。
 * 同一个人兼任几处时只改这一处。生成也按这份拼组织（workup-plan.ts）
 */
export function organizationStepView(snapshot: WorkupSnapshot, data: Pick<WorkupData, 'overrides'> & Partial<ExpertCopy>): OrganizationStep {
  const step = organizationOfSnapshot(effectiveSnapshot(snapshot, data));
  const o = (key: string) => {
    const v = data.overrides[key]?.value;
    return typeof v === 'object' ? v : undefined;
  };
  const replace = (p: DraftPerson | undefined, v: FactPerson | undefined, id: string): DraftPerson | undefined =>
    v ? { id: p?.id ?? id, name: v.name, position: v.position, phone: v.phone } : p;
  const groupKey = (g: OrganizationStep['groups'][number]) =>
    `group.${g.kind === 'custom' || step.groups.find((x) => x.kind === g.kind) !== g ? g.id : g.kind}`;
  const duty = text(data.overrides.dutyPhone?.value);
  const yn = (key: string, stored: YesNoUnknown | undefined) => answerOf(data.overrides[key]?.value)?.answer ?? stored;
  return {
    ...step,
    commander: replace(step.commander, o('commander'), 'commander'),
    deputies: step.deputies.map((d, i) => replace(d, o(`deputy.${i + 1}`), `deputy${i + 1}`)!),
    groups: step.groups.map((g) => ({ ...g, leader: replace(g.leader, o(groupKey(g)), `${g.id}-leader`) })),
    dutyPhone: duty ?? step.dutyPhone,
    paSystem: yn('paSystem', step.paSystem),
    imGroup: yn('imGroup', step.imGroup),
  };
}

// ── 保存两步的接口参数 ──

// 企业身份：核对时可以暂时不完整，格式在页面上提示，后台只做长度检查
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const workupIdentitySchema = z.object({
  name: z.string().trim().min(1, '请填写企业名称').max(100, '企业名称不超过 100 字'),
  socialCreditCode: optionalText(30),
  legalRepresentative: optionalText(50),
  registeredAddress: optionalText(200),
});

const blankSchema = z.array(z.string().min(1).max(80)).max(100).default([]);

export const basicStepWorkupSaveSchema = z.object({
  version: z.number().int().min(1),
  identity: workupIdentitySchema,
  basic: basicStepSchema,
  // 「先留空，文稿标『待补充』」勾上的项（事实键）
  blank: blankSchema,
  // 走完这一步（点「下一步」）时带上；只记最多的那次
  stepsDone: z.number().int().min(0).max(5).optional(),
});
export type BasicStepWorkupSave = z.infer<typeof basicStepWorkupSaveSchema>;

export const organizationStepWorkupSaveSchema = z.object({
  version: z.number().int().min(1),
  // 不用客户那份的「同类小组不能重复」整体检查：分厂址各设一套的老资料要能保存，重复与否由 organizationStepSaveError 按厂址判断
  step: z.object(organizationStepSchema.shape),
  blank: blankSchema,
  stepsDone: z.number().int().min(0).max(5).optional(),
});
export type OrganizationStepWorkupSave = z.infer<typeof organizationStepWorkupSaveSchema>;

export const productionStepWorkupSaveSchema = z.object({
  version: z.number().int().min(1),
  step: productionStepSchema,
  stepsDone: z.number().int().min(0).max(5).optional(),
});
export type ProductionStepWorkupSave = z.infer<typeof productionStepWorkupSaveSchema>;

export const resourcesStepWorkupSaveSchema = z.object({
  version: z.number().int().min(1),
  step: resourcesStepSchema,
  // 客户表格里没有、只有专家填的项（外部联系方式补充、四邻、专家的三张图）
  extra: resourcesExtraSchema,
  stepsDone: z.number().int().min(0).max(5).optional(),
});
export type ResourcesStepWorkupSave = z.infer<typeof resourcesStepWorkupSaveSchema>;

// 只记走到第几步（第 5 步还用过渡页时，「下一步」用它）
export const stepsDoneSaveSchema = z.object({
  version: z.number().int().min(1),
  stepsDone: z.number().int().min(0).max(5),
});
export type StepsDoneSave = z.infer<typeof stepsDoneSaveSchema>;

/**
 * 第 2 步保存前的检查（后台和页面共用）：小组只能用五个预设、不能重复；
 * 原来就有的自定义小组可以留着或删掉，不能新加；分厂址各设一套的同类小组（带 addressId）照旧可以
 */
export function organizationStepSaveError(next: OrganizationStep, before: OrganizationStep): string | null {
  const known = new Set(before.groups.filter((g) => g.kind === 'custom').map((g) => g.id));
  for (const g of next.groups) {
    if (g.kind === 'custom' && !known.has(g.id)) return '小组只能从预设的五个里选';
  }
  const presets = next.groups.filter((g) => g.kind !== 'custom');
  const seen = new Set<string>();
  for (const g of presets) {
    const key = `${g.kind}:${g.addressId ?? ''}`;
    if (seen.has(key)) return `「${PRESET_GROUPS[g.kind as keyof typeof PRESET_GROUPS]}」不能添加两次`;
    seen.add(key);
  }
  return null;
}

// 每步谁、什么时候保存的（页头「已自动保存」与操作记录用）；review = 第 5 步第 1 页
export type StepStamps = Partial<Record<WizardStep | 'review', Stamp>>;

/**
 * 第 3 步显示和保存的内容。专家第一次保存第 3 步以前，老整理页对设备、物料的改动（data.production 的 equipment、materials）
 * 叠在（专家那份 ?? 快照）上：改过的行换成专家的值，专家新增的行（x 开头）接在后面；保存后这两样并进专家那份、从老整理层删掉
 */
export function productionStepView(
  snapshot: WorkupSnapshot,
  data: Partial<ExpertCopy> & { production?: ProductionWorkup },
): ProductionStep {
  const eff = effectiveSnapshot(snapshot, data);
  const base = productionStepSchema.parse(eff.profile.productionStep?.step ?? {});
  const w = data.production ?? emptyProductionWorkup();
  const added = <T>(edits: Record<string, { at: string; value: T }>) =>
    Object.entries(edits)
      .filter(([id]) => isAddedRow(id))
      .sort((a, b) => a[1].at.localeCompare(b[1].at));
  const equipment = [
    ...base.equipment.map((e) => (w.equipment[e.id] ? { ...e, ...w.equipment[e.id]!.value, id: e.id } : e)),
    ...added(w.equipment)
      .filter(([id]) => !base.equipment.some((e) => e.id === id))
      .map(([id, j]) => ({ ...j.value, id })),
  ];
  const materials = [
    ...base.materials.map((m) => (w.materials[m.id] ? { ...m, ...w.materials[m.id]!.value, id: m.id, labelPhotoFileIds: m.labelPhotoFileIds } : m)),
    ...added(w.materials)
      .filter(([id]) => !base.materials.some((m) => m.id === id))
      .map(([id, j]) => ({ ...j.value, id, labelPhotoFileIds: [] })),
  ];
  return { ...base, equipment, materials };
}

/** 第 4 步显示的内容：（专家那份 ?? 快照）；都没有时是空的一份 */
export function resourcesStepView(snapshot: WorkupSnapshot, data: Partial<ExpertCopy>): ResourcesStep {
  return resourcesStepSchema.parse(effectiveSnapshot(snapshot, data).profile.resourcesStep?.step ?? {});
}
