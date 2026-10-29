// 专业整理 ·「危险源辨识」（Paper 14 页 E18-00C）：系统按整理后的设备、物料与适用范围推荐候选，
// 专家用 LEC 法取值（D = L × E × C，等级自动定），可改场所、写改值说明、标为不适用或手动新增。
// 候选与要写的现场处置方案一一对应（每份方案一类事故），与飞宇实际风险评估报告表 2-1 的做法一致；
// 默认取值照该报告。和生产设备与物料一样只记在任务的专业整理里（WorkupData.risks），不写回企业资料。
import { z } from 'zod';
import { SITE_TYPES, type SiteType } from './profile/production-step.ts';
import { accidentTypeOf, selectPlans, SCOPE_KEYS, type Scope, type ScopeKey } from './plan/catalog.ts';
import { riskLevel, riskScore, type Hazard, type RiskLevel } from './plan/input.ts';
import { suggestScope } from './plan/scope.ts';
import { isAddedRow, planProductionOf, productionView, type Judged, type ProductionList, type ProductionWorkup } from './workup-production.ts';
import type { WorkupSnapshot } from './workup.ts';

// ---------- LEC 取值表（与风险评估报告表 2.2-1 ~ 2.2-3 一致） ----------
export type LecKey = 'l' | 'e' | 'c';
export const LEC_KEYS: LecKey[] = ['l', 'e', 'c'];
export const LEC_DIMENSIONS: Record<LecKey, string> = {
  l: '事故发生的可能性',
  e: '暴露于危险环境的频繁程度',
  c: '可能造成的后果',
};
export const LEC_OPTIONS: Record<LecKey, { value: number; label: string }[]> = {
  l: [
    { value: 10, label: '完全可以预料到' },
    { value: 6, label: '相当可能' },
    { value: 3, label: '可能，但不经常' },
    { value: 1, label: '可能性小，完全意外' },
    { value: 0.5, label: '很不可能，可以设想' },
    { value: 0.2, label: '极不可能' },
    { value: 0.1, label: '实际不可能' },
  ],
  e: [
    { value: 10, label: '连续暴露' },
    { value: 6, label: '每天工作时间内暴露' },
    { value: 3, label: '每周一次暴露' },
    { value: 2, label: '每月一次暴露' },
    { value: 1, label: '每年几次暴露' },
    { value: 0.5, label: '非常罕见的暴露' },
  ],
  c: [
    { value: 100, label: '大灾难，许多人死亡' },
    { value: 40, label: '灾难，数人死亡' },
    { value: 15, label: '非常严重，一人死亡' },
    { value: 7, label: '严重，重伤' },
    { value: 3, label: '重大，致残' },
    { value: 1, label: '需要救护' },
  ],
};
export const RISK_THRESHOLDS = 'D ≤ 20 稍有危险 · ≤ 70 一般危险 · ≤ 160 显著危险 · ≤ 320 高度危险 · > 320 极其危险';

const lec = (key: LecKey) =>
  z.number().refine((v) => LEC_OPTIONS[key].some((o) => o.value === v), `${key.toUpperCase()} 请从取值表里选`);

// 专家改过的候选或新增的一行：整行保存，撤回回到系统推荐（新增的就是删掉）
export const riskRowSchema = z.object({
  factor: z.string().trim().min(1, '请填写危险有害因素').max(30, '危险有害因素最多 30 个字'),
  workplace: z.string().trim().min(1, '请填写作业场所').max(30, '作业场所最多 30 个字'),
  l: lec('l'),
  e: lec('e'),
  c: lec('c'),
  note: z.string().trim().max(200, '说明最多 200 个字').optional(),
  // 不适用：不进风险评估报告，可恢复；不用写理由
  excluded: z.boolean().optional(),
});
export type RiskRowValue = z.infer<typeof riskRowSchema>;

export interface RiskWorkup {
  // 键是候选 id（对应的现场处置方案）或专家新增行的 id（x 开头）
  rows: Record<string, Judged<RiskRowValue>>;
}

export const riskSaveSchema = z.object({
  version: z.number().int().min(1),
  fileId: z.uuid().optional(),
  rowId: z.string().min(1).max(40),
  value: riskRowSchema.nullable(),
});
export type RiskSave = z.infer<typeof riskSaveSchema>;

// ---------- 系统推荐 ----------
type Lec = Pick<RiskRowValue, 'l' | 'e' | 'c'>;
const lecOf = (l: number, e: number, c: number): Lec => ({ l, e, c });

// 默认取值照飞宇实际风险评估报告表 2-1；没列出的按 0.5 / 3 / 7（稍有危险）
const DEFAULT_LEC: Record<string, Lec> = {
  SP01: lecOf(1, 6, 7),
  SP02: lecOf(1, 6, 7),
  SP03: lecOf(1, 3, 7),
  SP04: lecOf(1, 3, 7),
  SP06: lecOf(1, 6, 3),
  SP07: lecOf(0.5, 6, 7),
  SP09: lecOf(1, 3, 7),
  SP16: lecOf(0.5, 6, 7),
  SP22: lecOf(1, 6, 3),
};
const FALLBACK_LEC = lecOf(0.5, 3, 7);

// 每家都要写的现场处置方案没有开关，依据写成固定的话；场所按设备关键词或场所类型找
const ALWAYS_BASIS: Record<string, string> = {
  SP01: '每家企业都要辨识火灾风险，系统默认列入',
  SP02: '有用电设备与配电设施，系统默认列入',
  SP03: '有生产设备运转部位，系统默认列入',
  SP04: '有物料搬运与设备检修作业，系统默认列入',
  SP06: '有高温设备、热工件或腐蚀性物料，系统默认列入',
  SP22: '其他未列明的伤害，系统默认列入',
};
const LOCATE: Record<string, { equipment?: string[]; sites?: SiteType[]; fixed?: string }> = {
  SP02: { sites: ['power_room'] },
  SP03: { equipment: ['冲床', '压铸', 'CNC', '车床', '铣床', '钻床', '攻牙', '剪板', '折弯', '注塑', '切割'] },
  SP05: { sites: ['compressor_room', 'boiler_room'] },
  SP06: { equipment: ['压铸', '熔炉', '熔炼', '保温炉', '烘箱', '焊'] },
  SP07: { fixed: '厂区道路' },
  SP16: { fixed: '厂区道路及运输线路' },
  SP17: { fixed: '消防水池' },
};

export interface RiskRef {
  list: ProductionList;
  name: string;
}

export interface RiskRow extends RiskRowValue {
  id: string;
  d: number;
  level: RiskLevel;
  // 依据的设备或物料（「冲床 6 台」），没有具体的写场所即可
  item?: string;
  // 为什么出现这一项，业务语言
  basis: string;
  // 依据的清单行，右栏可以跳过去看
  ref?: RiskRef;
  // 对应的现场处置方案
  planTitle?: string;
  source: 'system' | 'expert';
  added: boolean;
  excluded: boolean;
  // 系统推荐的原值（新增行没有）
  suggested?: Pick<RiskRowValue, 'factor' | 'workplace' | 'l' | 'e' | 'c'>;
  edited?: Judged<RiskRowValue>;
  // 相对系统推荐改了哪些：「C 15 → 40」「场所 厂房一 → 冲压车间」
  changes: string[];
}

export interface RiskView {
  rows: RiskRow[];
  // 左栏按作业场所计数（不含不适用的）
  places: { name: string; count: number }[];
  levels: { level: RiskLevel; count: number }[];
}

const quoted = (reason: string) => reason.match(/「(.+?)」/)?.[1];

export function riskView(snapshot: WorkupSnapshot, data: { production?: ProductionWorkup; risks?: RiskWorkup }): RiskView {
  const production = productionView(snapshot, data);
  const plan = planProductionOf(snapshot, production);
  const suggested = suggestScope({ ...plan, expert: { hazardousMaterials: plan.hazardousMaterials } });
  // 第 8 项专家确认适用范围后，这里改为用确认后的开关
  const scope = Object.fromEntries(SCOPE_KEYS.map((k) => [k, suggested[k].value])) as Scope;
  const mainPlace = production.buildings[0]?.name || '生产车间';
  const sites = plan.business.sites;

  const equipmentHit = (cues: string[]) => production.equipment.find((e) => cues.some((c) => e.name.includes(c)));
  const withQuantity = (name: string, quantity?: string) => (quantity?.trim() ? `${name} ${quantity.trim()}` : name);

  // 依据里点名的设备 / 物料 / 建筑 → 场所与清单行
  const located = (name: string): { workplace?: string; item: string; ref?: RiskRef } => {
    const eq = production.equipment.find((e) => e.name === name);
    if (eq) return { workplace: eq.location?.trim(), item: withQuantity(eq.name, eq.quantity), ref: { list: 'equipment', name } };
    const m = production.materials.find((x) => x.name === name);
    if (m) return { workplace: m.storageLocation?.trim(), item: m.name, ref: { list: 'materials', name } };
    const b = production.buildings.find((x) => x.name === name);
    if (b) return { workplace: b.name, item: b.name, ref: { list: 'buildings', name } };
    return { item: name };
  };

  const candidates = selectPlans(scope).site.map((t) => {
    const keys = [t.trigger ?? []].flat() as ScopeKey[];
    const on = keys.find((k) => scope[k]);
    let basis = on ? suggested[on].reason : (ALWAYS_BASIS[t.id] ?? '系统默认列入');
    const rule = LOCATE[t.id] ?? {};
    const hitName = on ? quoted(basis) : undefined;
    let place = hitName ? located(hitName) : undefined;
    if (!place?.workplace && rule.equipment) {
      const eq = equipmentHit(rule.equipment);
      if (eq) {
        place = { workplace: eq.location?.trim(), item: withQuantity(eq.name, eq.quantity), ref: { list: 'equipment', name: eq.name } };
        if (!on) basis = `设备清单里有「${eq.name}」，系统默认列入`;
      }
    }
    const site = rule.sites?.find((s) => sites.includes(s));
    const workplace = place?.workplace || (site ? SITE_TYPES[site] : undefined) || rule.fixed || mainPlace;
    return {
      id: t.id,
      planTitle: t.title,
      basis,
      item: place?.item,
      ref: place?.ref,
      suggested: { factor: accidentTypeOf(t.title), workplace, ...(DEFAULT_LEC[t.id] ?? FALLBACK_LEC) },
    };
  });

  const edits = data.risks?.rows ?? {};
  const rows: RiskRow[] = candidates.map((c) => {
    const edited = edits[c.id];
    const value: RiskRowValue = edited?.value ?? c.suggested;
    return finish({ ...c, ...value, id: c.id, source: edited ? 'expert' : 'system', added: false, edited });
  });
  for (const [id, edited] of Object.entries(edits)) {
    if (!isAddedRow(id)) continue;
    rows.push(finish({ ...edited.value, id, basis: '专家手动新增', source: 'expert', added: true, edited }));
  }

  const included = rows.filter((r) => !r.excluded);
  const places = new Map<string, number>();
  for (const r of included) places.set(r.workplace, (places.get(r.workplace) ?? 0) + 1);
  const levels = new Map<RiskLevel, number>();
  for (const r of included) levels.set(r.level, (levels.get(r.level) ?? 0) + 1);
  return {
    rows,
    places: [...places].map(([name, count]) => ({ name, count })),
    levels: [...levels].map(([level, count]) => ({ level, count })),
  };
}

type Draft = Omit<RiskRow, 'd' | 'level' | 'excluded' | 'changes'> & { excluded?: boolean };

function finish(r: Draft): RiskRow {
  const d = riskScore(r)!;
  const changes: string[] = [];
  if (r.suggested && r.edited) {
    const s = r.suggested;
    if (r.factor !== s.factor) changes.push(`名称 ${s.factor} → ${r.factor}`);
    if (r.workplace !== s.workplace) changes.push(`场所 ${s.workplace} → ${r.workplace}`);
    for (const k of LEC_KEYS) if (r[k] !== s[k]) changes.push(`${k.toUpperCase()} ${s[k]} → ${r[k]}`);
  }
  return { ...r, d, level: riskLevel(d)!, excluded: Boolean(r.excluded), changes };
}

// 保存前校验：改的是现有候选或新增行
export function riskSaveError(snapshot: WorkupSnapshot, data: { production?: ProductionWorkup; risks?: RiskWorkup }, save: RiskSave): string | null {
  if (isAddedRow(save.rowId)) return null;
  return riskView(snapshot, data).rows.some((r) => r.id === save.rowId) ? null : '没有这一项危险源';
}

// 进风险评估报告（表 1.3-1、表 2-1）的危险源：不适用的去掉，名称与场所按专家改过的
export function planHazardsOf(view: RiskView): Hazard[] {
  return view.rows.filter((r) => !r.excluded).map(({ workplace, factor, l, e, c }) => ({ workplace, factor, l, e, c }));
}
