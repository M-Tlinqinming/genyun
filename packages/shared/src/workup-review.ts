// 资料核对第 5 步「核对并生成」第 1 页（Paper 13 页 E2-5a）：只有专家能定的专业项。
// 预案编号、应急经费与两位责任人、重大危险源结论（和系统算的不同时才存）记在任务的 WorkupData.review；
// 适用范围、危险源辨识沿用 data.scope、data.risks。这一页的项都不挡生成，空着的文稿写「（待补充）」。
import { z } from 'zod';
import { peopleOf, type DraftPerson } from './profile/organization-step.ts';
import { majorHazardOf, type MajorHazardResult } from './plan/major-hazard.ts';
import type { ScopeKey } from './plan/catalog.ts';
import { parseTons, productionView, type ProductionWorkup } from './workup-production.ts';
import { scopeView, type ScopeSwitch, type ScopeWorkup } from './workup-scope.ts';
import { effectiveSnapshot, organizationStepView, type ExpertCopy } from './workup-steps.ts';
import type { FactOverride, WorkupSnapshot } from './workup.ts';

const text = (max: number, label: string) => z.string().trim().max(max, `${label}最多 ${max} 个字`).optional();
// 金额（万元）：数字，最多两位小数；空着不报错
const amount = (label: string) =>
  z
    .string()
    .trim()
    .max(12, `${label}太长`)
    .regex(/^(\d+(\.\d{1,2})?)?$/, `${label}请填数字（万元），最多两位小数`)
    .optional();

export const MAJOR_HAZARD_VALUES = ['构成', '不构成'] as const;
export type MajorHazardValue = (typeof MAJOR_HAZARD_VALUES)[number];

export const majorHazardOverrideSchema = z
  .object({
    value: z.enum(MAJOR_HAZARD_VALUES),
    reason: z.string().trim().min(1, '改了系统算的结果，请写一句理由').max(200, '理由最多 200 个字'),
    // 选「构成」时要填：物质名称与储存量，写进风险评估报告
    substances: z
      .array(
        z.object({
          name: z.string().trim().min(1, '请填写物质名称').max(50, '物质名称最多 50 个字'),
          storage: z.string().trim().min(1, '请填写储存量').max(30, '储存量最多 30 个字'),
        }),
      )
      .max(20, '最多 20 种')
      .optional(),
  })
  .refine((o) => o.value !== '构成' || (o.substances?.length ?? 0) > 0, { message: '选「构成」请填物质名称和储存量', path: ['substances'] });
export type MajorHazardOverride = z.infer<typeof majorHazardOverrideSchema>;

export const reviewSchema = z.object({
  planCode: text(30, '预案编号'),
  emergencyBudget: amount('应急经费'),
  fundingDepartment: text(30, '经费牵头部门'),
  trainingBudget: amount('培训演练经费'),
  // 第 2 步人员的 id；那个人删掉了算空
  ledgerOwnerId: z.string().max(40).optional(),
  archiverId: z.string().max(40).optional(),
  // 只有和系统算的结果不同时才存
  majorHazard: majorHazardOverrideSchema.optional(),
});
export type ReviewData = z.infer<typeof reviewSchema>;

export interface ReviewWorkup extends ReviewData {
  // 每项最后修改的人和时间（历史记录、「您 · 时间」用）
  majorHazardAt?: string;
}

export const reviewStepWorkupSaveSchema = z.object({
  version: z.number().int().min(1),
  review: reviewSchema,
});
export type ReviewStepWorkupSave = z.infer<typeof reviewStepWorkupSaveSchema>;

type ReviewInput = { overrides: Record<string, FactOverride>; production?: ProductionWorkup; review?: ReviewWorkup } & Partial<ExpertCopy>;

/** 系统算的重大危险源：判定为危化品的物料，按第 3 步的最大存放量 */
export function systemMajorHazard(snapshot: WorkupSnapshot, data: ReviewInput): MajorHazardResult {
  const view = productionView(effectiveSnapshot(snapshot, data), data);
  return majorHazardOf(
    view.materials
      .filter((m) => m.hazard.value ?? m.hazard.suggestion?.value)
      .map((m) => ({ name: m.name, maxStorageTons: parseTons(m.maxStorage), maxStorageText: m.maxStorage })),
  );
}

/** 第 2 步的人员（选经费台账负责人、培训档案归档人用） */
export function reviewPeopleOf(snapshot: WorkupSnapshot, data: ReviewInput): DraftPerson[] {
  return peopleOf(organizationStepView(snapshot, data));
}

export interface ReviewPerson {
  id: string;
  name: string;
  position?: string;
}

export interface MajorHazardFinal {
  value: MajorHazardValue;
  // 专家改过（和系统算的不同）
  overridden: boolean;
  reason?: string;
  substances?: { name: string; storage: string }[];
}

export function majorHazardFinal(system: MajorHazardResult, override: MajorHazardOverride | undefined): MajorHazardFinal {
  if (override && override.value !== system.conclusion) return { value: override.value, overridden: true, reason: override.reason, substances: override.substances };
  return { value: system.conclusion, overridden: false };
}

/** 保存前整理：人员 id 不在第 2 步里的去掉；重大危险源和系统算的一样就不存 */
export function normalizeReview(snapshot: WorkupSnapshot, data: ReviewInput, review: ReviewData): ReviewData {
  const people = new Set(reviewPeopleOf(snapshot, data).map((p) => p.id));
  const system = systemMajorHazard(snapshot, data);
  const out: ReviewData = { ...review };
  for (const k of ['planCode', 'emergencyBudget', 'fundingDepartment', 'trainingBudget'] as const) if (!out[k]) delete out[k];
  if (out.ledgerOwnerId && !people.has(out.ledgerOwnerId)) delete out.ledgerOwnerId;
  if (out.archiverId && !people.has(out.archiverId)) delete out.archiverId;
  if (!out.ledgerOwnerId) delete out.ledgerOwnerId;
  if (!out.archiverId) delete out.archiverId;
  if (!out.majorHazard || out.majorHazard.value === system.conclusion) delete out.majorHazard;
  else if (out.majorHazard.value === '不构成') out.majorHazard = { value: '不构成', reason: out.majorHazard.reason };
  return out;
}

/** 生成用：预案编号、经费与两位责任人、重大危险源结论（专家改过的） */
export interface PlanReview {
  planCode?: string;
  emergencyBudget?: string;
  fundingDepartment?: string;
  trainingBudget?: string;
  ledgerOwner?: { name: string; position?: string };
  archiver?: { name: string; position?: string };
  majorHazard?: MajorHazardOverride;
}

export function planReviewOf(snapshot: WorkupSnapshot, data: ReviewInput): PlanReview {
  const r = data.review;
  if (!r) return {};
  const people = reviewPeopleOf(snapshot, data);
  const person = (id: string | undefined) => {
    const p = id ? people.find((x) => x.id === id) : undefined;
    return p ? { name: p.name.trim(), position: p.position?.trim() || undefined } : undefined;
  };
  const system = systemMajorHazard(snapshot, data);
  const final = majorHazardFinal(system, r.majorHazard);
  const out: PlanReview = {
    planCode: r.planCode?.trim() || undefined,
    emergencyBudget: r.emergencyBudget?.trim() || undefined,
    fundingDepartment: r.fundingDepartment?.trim() || undefined,
    trainingBudget: r.trainingBudget?.trim() || undefined,
    ledgerOwner: person(r.ledgerOwnerId),
    archiver: person(r.archiverId),
    majorHazard: final.overridden ? r.majorHazard : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as PlanReview;
}

// ---------- 适用范围三组（E2-5a「适用范围」） ----------

// 第 3 步已经问过客户的五项：只读显示第 3 步的回答，不在这里改
export const STEP3_SCOPE_KEYS: ScopeKey[] = ['pressureVessel', 'pressurePipeline', 'confinedSpace', 'landlord', 'roadTransport'];

export interface ScopeGroups {
  // 要您确认（系统已预设）：名称推断、照片待看、物料没判定的
  confirm: ScopeSwitch[];
  // 第 3 步已经答过的五项
  step3: (ScopeSwitch & { step3Pending: boolean })[];
  // 其余已确定
  settled: ScopeSwitch[];
}

type ScopeInput = { production?: ProductionWorkup; scope?: ScopeWorkup } & Partial<ExpertCopy>;

export function scopeGroupsOf(snapshot: WorkupSnapshot, data: ScopeInput & { risks?: Parameters<typeof scopeView>[1]['risks'] }): ScopeGroups {
  const view = scopeView(snapshot, data);
  const production = productionView(effectiveSnapshot(snapshot, data), data);
  const step = effectiveSnapshot(snapshot, data).profile.productionStep?.step;
  const later = (cats: string[]) => production.special.some((s) => cats.includes(s.category) && s.later);
  const pendingOf: Record<string, () => boolean> = {
    pressureVessel: () => later(['pressureVessels', 'boilers']),
    pressurePipeline: () => later(['pressurePipelines']),
    confinedSpace: () => false,
    landlord: () => step?.leasesPremises === undefined,
    roadTransport: () => step?.ownVehicles === undefined,
  };
  // 粉尘专项跟着产尘工序：产尘工序关着就不显示
  const visible = view.switches.filter((s) => s.key !== 'dustSpecialty' || view.scope.dustProcess);
  return {
    confirm: visible.filter((s) => !STEP3_SCOPE_KEYS.includes(s.key) && s.needsConfirm),
    step3: visible.filter((s) => STEP3_SCOPE_KEYS.includes(s.key)).map((s) => ({ ...s, step3Pending: pendingOf[s.key]!() })),
    settled: visible.filter((s) => !STEP3_SCOPE_KEYS.includes(s.key) && !s.needsConfirm),
  };
}
