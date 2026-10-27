// 企业自填第 5 步「核对并提交」（Paper 12 页 S05）：把前 4 步的内容概括成几行，列出还缺的必需资料、
// 稍后补的内容和交给注册安全工程师判断的事项。稍后补的内容同时作为预约上门弹窗「需要帮忙整理」的默认值。
import { checkChecklist, ON_SITE_VISIT_THRESHOLD } from '../checklist/check.ts';
import { getItemDef, type ChecklistItemKey } from '../checklist/items.ts';
import type { ChecklistState } from '../checklist/status.ts';
import type { BasicStepStored } from './basic-step.ts';
import { INDUSTRY_NAMES } from './industries.ts';
import { compilationTeamOf, dutyPhoneOfStep, type OrganizationStep } from './organization-step.ts';
import { msdsHintOf, SPECIAL_CATEGORY_KEYS, type ProductionStep, type SpecialCategory } from './production-step.ts';
import { buildingsReady, DRAWING_KEYS, DRAWINGS, msdsNeedOf, neighborsReady, type ResourcesStep } from './resources-step.ts';

export type ReviewStepNo = 1 | 2 | 3 | 4;

// 资料清单各项在自填的哪一步填（耕云代办的项不列）
export const ITEM_STEP: Partial<Record<ChecklistItemKey, ReviewStepNo>> = {
  business_license: 1,
  basic_info: 1,
  emergency_groups: 2,
  duty_phone: 2,
  process_flow: 3,
  equipment: 3,
  special_equipment: 3,
  materials: 3,
  emergency_supplies: 4,
  site_plan: 4,
  evacuation_plan: 4,
};

const SPECIAL_SHORT: Record<SpecialCategory, string> = {
  pressureVessels: '压力容器',
  boilers: '锅炉',
  pressurePipelines: '压力管道',
  storageTanks: '储罐 / 油库',
};

// 第 1 步交付前要补的字段（设计稿 S05 只列这两项；技术管理人员、主管负责人专家整理时顺带问）
const BASIC_LATER_LABELS = {
  safetyManagementCount: '安全管理人员数',
  landAreaM2: '厂区占地面积',
} as const;
// 「其他工商与经营信息」折叠卡片里的字段，有一项没填就整体算一项稍后补
const OTHER_INFO_FIELDS = ['postalCode', 'economicNature', 'fax', 'website', 'email', 'fixedAssets', 'lastYearRevenue'] as const;

export interface ReviewInput {
  enterpriseName: string;
  basicStep?: BasicStepStored;
  organization?: OrganizationStep;
  production?: ProductionStep;
  resources?: ResourcesStep;
  checklist: ChecklistState;
}

export interface ReviewStepSummary {
  step: ReviewStepNo;
  // 已填内容的概括，如「86 人」「应急小组 3 个」
  facts: string[];
  // 开始编制必需、还没提供的资料
  missing: string[];
  // 稍后补的内容，提交后在任务页补
  later: string[];
}

export interface Review {
  steps: ReviewStepSummary[];
  // 交给注册安全工程师判断的事项（包含在服务内，客户不用管）
  expert: string[];
  laterCount: number;
  // 稍后补太多，提示预约耕云上门
  suggestOnSiteVisit: boolean;
  canSubmit: boolean;
}

const filled = (v: string | number | undefined | null) =>
  typeof v === 'number' ? true : Boolean(v && v.trim() !== '');

// 名称太多时只列前几个，如「油漆、稀释剂、胶水等 5 种」
function names(list: string[], max = 3, unit = '种'): string {
  if (list.length <= max) return list.join('、');
  return `${list.slice(0, max).join('、')}等 ${list.length} ${unit}`;
}

function basicSummary(name: string, stored: BasicStepStored | undefined) {
  const b = stored?.basic ?? {};
  const facts = [name];
  if (b.industry) facts.push(INDUSTRY_NAMES[b.industry as keyof typeof INDUSTRY_NAMES] ?? b.industry);
  if (b.employeeCount !== undefined) facts.push(`${b.employeeCount} 人`);
  if (filled(b.contactPerson)) facts.push(`联系人 ${b.contactPerson!.trim()}`);

  const later: string[] = [];
  for (const [f, label] of Object.entries(BASIC_LATER_LABELS) as [keyof typeof BASIC_LATER_LABELS, string][]) {
    if (!filled(b[f])) later.push(label);
  }
  if (OTHER_INFO_FIELDS.some((f) => !filled(b[f]))) later.push('其他工商与经营信息');
  return { facts, later };
}

function organizationSummary(step: OrganizationStep | undefined) {
  if (!step) return { facts: [], later: [] };
  if (step.mode === 'roster') return { facts: ['已上传花名册，由耕云整理'], later: [] };
  const facts: string[] = [];
  if (filled(step.commander?.name)) facts.push('总指挥');
  if (step.deputies.some((d) => filled(d.name))) facts.push('副总指挥');
  const groups = step.groups.filter((g) => filled(g.name));
  if (groups.length > 0) facts.push(`应急小组 ${groups.length} 个`);
  if (dutyPhoneOfStep(step)) facts.push('值班电话');
  if (compilationTeamOf(step).length > 0) facts.push('编制小组已生成');
  const later = groups.filter((g) => !filled(g.leader?.name)).map((g) => `${g.name.trim()}组长`);
  return { facts, later };
}

function productionSummary(step: ProductionStep | undefined) {
  if (!step) return { facts: [], later: [] };
  const facts: string[] = [];
  const siteCount = step.sites.length + step.customSites.length;
  if (siteCount > 0) facts.push(`${siteCount} 个场所`);
  const special = SPECIAL_CATEGORY_KEYS.filter((k) => step.specialEquipment[k].answer === 'yes');
  if (special.length > 0) facts.push(special.map((k) => SPECIAL_SHORT[k]).join('、'));
  const equipment = step.equipment.filter((e) => filled(e.name));
  if (equipment.length > 0) facts.push(`${equipment.length} 种设备`);
  if (step.ledgers.equipment.length > 0) facts.push('设备台账已上传');
  const materials = step.materials.filter((m) => filled(m.name));
  if (materials.length > 0) facts.push(`${materials.length} 种物料`);
  if (step.ledgers.materials.length > 0) facts.push('物料台账已上传');
  const processSteps = step.process.steps.filter((s) => filled(s.name)).length;
  if (processSteps > 0) facts.push(`${processSteps} 道工序`);
  else if (step.process.sketchFileIds.length > 0) facts.push('流程图已上传');
  if (step.leasesPremises) facts.push('有出租厂房');

  const later: string[] = [];
  for (const m of materials) {
    const name = m.name.trim();
    if (!filled(m.annualUsage)) later.push(`${name}年用量`);
    if (msdsHintOf(m) === 'label_needed') later.push(`${name}包装标签`);
  }
  return { facts, later };
}

function resourcesSummary(step: ResourcesStep | undefined, materials: ProductionStep['materials']) {
  if (!step) return { facts: [], later: [] };
  const facts: string[] = [];
  const supplies = step.supplies.filter((s) => filled(s.name));
  if (supplies.length > 0) facts.push(`${supplies.length} 项应急物资`);
  const kit = step.firstAidKit;
  if (kit.answer === 'no') facts.push('没有急救药箱');
  else if (kit.answer === 'yes') facts.push(kit.mode === 'standard' ? '常规药箱' : kit.mode === 'photo' ? '药箱已拍照' : '药箱已填写');
  const buildings = step.buildings.filter((b) => filled(b.name));
  if (buildings.length > 0) facts.push(`${buildings.length} 栋建筑`);
  const drawings = DRAWING_KEYS.filter((k) => step.drawings[k].length > 0).map((k) => DRAWINGS[k].short);
  if (drawings.length > 0) facts.push(`${drawings.join('、')}已上传`);

  const later: string[] = [];
  if (supplies.length > 0 && step.custodianId === undefined) later.push('应急物资保管人');
  if (kit.answer === undefined) later.push('急救药箱');
  if (step.firePool.answer === undefined) later.push('消防水池');
  else if (step.firePool.answer === 'yes' && step.firePool.volumeM3 === undefined) later.push('消防水池容积');
  if (!buildingsReady(step)) later.push('厂区建筑名称与面积');
  for (const m of materials) {
    if (!filled(m.name) || msdsNeedOf(m) !== 'supplier') continue;
    if ((step.msds[m.id]?.fileIds.length ?? 0) === 0) later.push(`${m.name.trim()}的安全技术说明书`);
  }
  if (step.drawings.fire_facility_plan.length === 0) later.push(DRAWINGS.fire_facility_plan.label);
  if (!neighborsReady(step.neighbors)) later.push('相邻企业');
  return { facts, later };
}

function expertItems(production: ProductionStep | undefined, resources: ResourcesStep | undefined): string[] {
  const out: string[] = [];
  if (production) {
    const labeled = production.materials
      .filter((m) => {
        const hint = msdsHintOf(m);
        return hint === 'label_done' || hint === 'label_needed';
      })
      .map((m) => m.name.trim());
    if (labeled.length > 0) out.push(`${names(labeled)}是否属于危化品（按包装标签）`);
    const special = production.specialEquipment;
    const yes = SPECIAL_CATEGORY_KEYS.filter((k) => special[k].answer === 'yes').map((k) => SPECIAL_SHORT[k]);
    if (yes.length > 0) out.push(`${yes.join('、')}的类别与检验要求（按铭牌）`);
    const photo = SPECIAL_CATEGORY_KEYS.filter((k) => special[k].answer === 'photo').map((k) => SPECIAL_SHORT[k]);
    if (photo.length > 0) out.push(`${photo.join('、')}是否属于特种设备（按照片）`);
  }
  if (resources) {
    if (resources.buildings.some((b) => filled(b.name) && b.fireRating === 'expert')) out.push('各栋建筑耐火等级');
    if (resources.firstAidKit.answer === 'yes' && resources.firstAidKit.mode === 'photo') {
      out.push('急救药箱药品清单（按照片整理）');
    }
  }
  return out;
}

export function reviewOf(input: ReviewInput): Review {
  const check = checkChecklist(input.checklist);
  const missing = new Map<ReviewStepNo, string[]>();
  for (const b of check.blocking) {
    const step = ITEM_STEP[b.key];
    if (step) missing.set(step, [...(missing.get(step) ?? []), getItemDef(b.key).label]);
  }

  const parts = [
    basicSummary(input.enterpriseName, input.basicStep),
    organizationSummary(input.organization),
    productionSummary(input.production),
    resourcesSummary(input.resources, input.production?.materials ?? []),
  ];
  const steps = parts.map((p, i) => {
    const step = (i + 1) as ReviewStepNo;
    return { step, facts: p.facts, missing: missing.get(step) ?? [], later: p.later };
  });
  const laterCount = steps.reduce((n, s) => n + s.later.length, 0);

  return {
    steps,
    expert: expertItems(input.production, input.resources),
    laterCount,
    suggestOnSiteVisit: laterCount > ON_SITE_VISIT_THRESHOLD || check.suggestOnSiteVisit,
    canSubmit: check.canSubmit,
  };
}
