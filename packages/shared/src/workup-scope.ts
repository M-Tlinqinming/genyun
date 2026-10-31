// 专业整理 ·「适用范围」（Paper 14 页 E18-00D）：系统按整理后的设备、物料与客户回答给 21 个开关提出建议，
// 名称推断的、客户拍照待看的、物料还没判定是否危化品的开关要专家逐个确认；客户明确回答的、工贸企业默认打开的、
// 资料里没有依据的直接算已确定，专家也可以改。确认后的开关决定生成哪些专项预案与现场处置方案，危险源候选跟着增减。
// 和其他整理内容一样只记在任务的专业整理里（WorkupData.scope），不写回企业资料。
import { z } from 'zod';
import { PLAN_TEMPLATES, SCOPE_KEYS, SCOPE_SWITCHES, selectPlans, type PlanTemplate, type Scope, type ScopeKey } from './plan/catalog.ts';
import { suggestScope, type ScopeSuggestion } from './plan/scope.ts';
import { isAddedRow, planProductionOf, productionView, type Judged, type ProductionWorkup } from './workup-production.ts';
import type { WorkupSnapshot } from './workup.ts';

// 界面上的短名称（设计稿 E18-00D），完整说明用 SCOPE_SWITCHES
export const SCOPE_SHORT: Record<ScopeKey, string> = {
  internalVehicle: '厂内车辆',
  highWork: '高处作业',
  fallRisk: '跌落坠落',
  pressureVessel: '有压力容器',
  pressurePipeline: '压力管道',
  elevator: '电梯',
  craneHoist: '有起重机械',
  dustProcess: '粉尘',
  dustSpecialty: '粉尘专项',
  meltingProcess: '熔融',
  waterHazard: '淹溺',
  chemicalsOver1t: '危化品 > 1 t',
  combustibleGas: '使用可燃气体',
  flammableLiquid: '使用可燃液体',
  toxicChemicals: '有毒化学品',
  confinedSpace: '有限空间作业',
  highRise: '高层',
  collapseRisk: '坍塌',
  inertGas: '惰性气体',
  landlord: '出租厂房',
  roadTransport: '道路运输',
};

// 左栏分组
export const SCOPE_GROUPS = {
  equipment: '设备资产',
  chemicals: '化学品库存',
  places: '结构与场所',
  business: '业务关系',
} as const;
export type ScopeGroup = keyof typeof SCOPE_GROUPS;
export const SCOPE_GROUP_KEYS = Object.keys(SCOPE_GROUPS) as ScopeGroup[];
const GROUP_OF: Record<ScopeKey, ScopeGroup> = {
  pressureVessel: 'equipment',
  pressurePipeline: 'equipment',
  elevator: 'equipment',
  craneHoist: 'equipment',
  internalVehicle: 'equipment',
  dustProcess: 'equipment',
  dustSpecialty: 'equipment',
  meltingProcess: 'equipment',
  chemicalsOver1t: 'chemicals',
  combustibleGas: 'chemicals',
  flammableLiquid: 'chemicals',
  toxicChemicals: 'chemicals',
  inertGas: 'chemicals',
  highWork: 'places',
  fallRisk: 'places',
  waterHazard: 'places',
  confinedSpace: 'places',
  highRise: 'places',
  collapseRisk: 'places',
  landlord: 'business',
  roadTransport: 'business',
};
// 依据是物料是否危化品的开关：物料都判定过了才算已确定
const CHEMICAL_KEYS = new Set<ScopeKey>(['chemicalsOver1t', 'combustibleGas', 'flammableLiquid', 'toxicChemicals', 'inertGas']);

export interface ScopeWorkup {
  switches: Partial<Record<ScopeKey, Judged<boolean>>>;
}

export const scopeSaveSchema = z.object({
  version: z.number().int().min(1),
  key: z.enum(SCOPE_KEYS as [ScopeKey, ...ScopeKey[]], { error: '没有这个开关' }),
  // null 撤回，回到系统建议
  value: z.boolean().nullable(),
});
export type ScopeSave = z.infer<typeof scopeSaveSchema>;

export interface ScopeSwitch {
  key: ScopeKey;
  label: string;
  description: string;
  group: ScopeGroup;
  suggestion: ScopeSuggestion;
  // 系统建议要专家确认（名称推断、照片待看、物料没判定）
  needsConfirm: boolean;
  judged?: Judged<boolean>;
  // 专家确认或改过的以专家为准，其余用系统建议
  value: boolean;
  status: 'pending' | 'confirmed';
  // 由它决定是否生成的专项预案与现场处置方案
  plans: PlanTemplate[];
}

// 右栏预览里的一份预案：始终生成、开关已定要生成，或取决于待确认的开关（按建议含 / 不含）
export interface PreviewPlan {
  template: PlanTemplate;
  state: 'always' | 'included' | 'pendingIn' | 'pendingOut';
  // 待确认时是哪个开关
  pendingKey?: ScopeKey;
}

export interface ScopeView {
  switches: ScopeSwitch[];
  pending: ScopeSwitch[];
  // 生成用的开关：待确认的按系统建议算，预览和确认后一致
  scope: Scope;
  // 要专家确认的开关数（含已确认的），顶部「必需项」计数用
  required: number;
  preview: { specialty: PreviewPlan[]; site: PreviewPlan[] };
}

// 危险源辨识里专家手动新增的行（结构同 workup-risk 的 RiskWorkup，这里只用名称与场所，避免循环引用）
type AddedHazards = { rows: Record<string, Judged<{ factor: string; workplace: string; excluded?: boolean }>> };

/** 专家在危险源辨识里手动新增、没标不适用的事故类型：对应方案没出时适用范围建议打开 */
export function addedHazardsOf(risks: AddedHazards | undefined): { factor: string; workplace: string }[] {
  return Object.entries(risks?.rows ?? {})
    .filter(([id, r]) => isAddedRow(id) && !r.value.excluded)
    .map(([, r]) => ({ factor: r.value.factor, workplace: r.value.workplace }));
}

export function scopeView(
  snapshot: WorkupSnapshot,
  data: { production?: ProductionWorkup; scope?: ScopeWorkup; risks?: AddedHazards },
): ScopeView {
  const production = productionView(snapshot, data);
  const plan = planProductionOf(snapshot, production);
  const suggested = suggestScope({ ...plan, expert: { hazardousMaterials: plan.hazardousMaterials } }, addedHazardsOf(data.risks));
  const undecided = new Set(production.materials.filter((m) => m.hazard.decidedBy === null).map((m) => m.name));
  const edits = data.scope?.switches ?? {};

  // 粉尘专项跟着「产尘工序」：专家关掉产尘工序后它也关掉、算已确定（必需项总数不变）
  const dustOff = (edits.dustProcess?.value ?? suggested.dustProcess.value) === false;
  const switches = SCOPE_KEYS.map((key): ScopeSwitch => {
    const followsDust = key === 'dustSpecialty' && dustOff;
    const suggestion = suggested[key];
    const judged = followsDust ? undefined : edits[key];
    // 化学品类：物料没判定是否危化品时要确认；按储量建议不出、按危险源建议打开的（basis 为 cue 但没有命中物料）也要确认
    const needsConfirm = CHEMICAL_KEYS.has(key)
      ? (suggestion.value && plan.hazardousMaterials.some((n) => undecided.has(n) && (suggestion.hit ?? '').includes(n))) ||
        (suggestion.basis === 'cue' && (!suggestion.value || !suggestion.hit))
      : suggestion.basis === 'cue' || suggestion.basis === 'photo';
    return {
      key,
      label: SCOPE_SHORT[key],
      description: SCOPE_SWITCHES[key],
      group: GROUP_OF[key],
      suggestion,
      needsConfirm,
      judged,
      value: followsDust ? false : (judged?.value ?? suggestion.value),
      status: needsConfirm && !judged && !followsDust ? 'pending' : 'confirmed',
      plans: PLAN_TEMPLATES.filter((t) => [t.trigger ?? []].flat().includes(key)),
    };
  });

  const scope = Object.fromEntries(switches.map((s) => [s.key, s.value])) as Scope;
  const pending = switches.filter((s) => s.status === 'pending');
  const isPending = new Set(pending.map((s) => s.key));
  const selected = new Set(Object.values(selectPlans(scope)).flat());

  const preview = (kind: PlanTemplate['kind']): PreviewPlan[] =>
    PLAN_TEMPLATES.filter((t) => t.kind === kind).flatMap((template): PreviewPlan[] => {
      if (!template.trigger) return [{ template, state: 'always' }];
      const keys = [template.trigger].flat();
      const settled = keys.filter((k) => !isPending.has(k));
      // 有一个已确定的开关打开就一定生成；否则看待确认的开关
      if (settled.some((k) => scope[k])) return [{ template, state: 'included' }];
      const pendingKey = keys.find((k) => isPending.has(k) && scope[k]) ?? keys.find((k) => isPending.has(k));
      if (!pendingKey) return [];
      return [{ template, state: selected.has(template) ? 'pendingIn' : 'pendingOut', pendingKey }];
    });

  return {
    switches,
    pending,
    scope,
    required: switches.filter((s) => s.needsConfirm).length,
    preview: { specialty: preview('specialty'), site: preview('site') },
  };
}

// 给第 10 项生成用：专家确认后的全部开关（PlanInput.expert.scope）
export function planScopeOf(view: ScopeView): Scope {
  return view.scope;
}
