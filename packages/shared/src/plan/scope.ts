// 适用范围的系统建议：按客户资料推出 21 个开关各开不开、为什么。专家确认或改动后才用于生成。
// 规则迁自旧仓库 lib/decision-engine/inference.ts（关键词照搬），按新资料格式重写：
// 特种设备、场所、消防水池、出租厂房、自备车辆都有了客户的明确回答，优先看回答，再看名称关键词；
// 化学品类开关按《危险化学品目录》查出的危险性（plan/hazchem.ts），目录查不到的再看名称关键词。
import { accidentTypeOf, PLAN_TEMPLATES, SCOPE_KEYS, type Scope, type ScopeKey } from './catalog.ts';
import { hazchemSuggestionOf, type HazchemKind } from './hazchem.ts';
import type { Hazard, PlanInput } from './input.ts';

/**
 * 建议从哪来，决定专家要不要逐个确认（M2 第 8 项）：
 * answer 客户明确回答 · default 工贸企业默认打开 · none 资料里没有依据 —— 直接算已确定；
 * cue 名称里有关键词（或按储量、危险源推出） · photo 客户拍照待专家看 —— 要专家确认
 */
export type ScopeBasis = 'answer' | 'default' | 'none' | 'cue' | 'photo';

export interface ScopeSuggestion {
  value: boolean;
  /** 给专家看的依据，业务语言 */
  reason: string;
  basis: ScopeBasis;
  /** 命中关键词的那一项（设备、物料、建筑或工序名称） */
  hit?: string;
  /** 命中的全部项（同类多台、多种物料），危险源按它们的所在位置推场所 */
  hits?: string[];
}

// 旧仓库 constants/e6-switches.ts 的关键词，10-31 按测试集补了几类
const CUES: Partial<Record<ScopeKey, string[]>> = {
  internalVehicle: ['叉车', '铲车', '电瓶车', '电动牵引车', 'AGV', '搬运车'],
  highWork: ['脚手架', '屋顶检修', '检修平台', '设备维护台', '高处吊装作业'],
  fallRisk: ['楼梯', '平台', '设备维护操作面', '物料堆垛通道', '装卸台', '货架'],
  pressureVessel: ['空压机', '空气压缩机', '压缩机', '储气罐', '压力容器', '锅炉', '蒸汽发生器', '反应釜', '气瓶'],
  elevator: ['电梯', '货梯', '客梯', '升降平台', '垂直升降机', '升降机'],
  craneHoist: ['行车', '起重机', '电动葫芦', '手拉葫芦', '塔吊', '龙门吊', '吊车', '天车', '悬臂吊'],
  dustProcess: ['喷砂', '攻牙', '木工', '金属切割', '研磨', '抛光', '打磨', '混合搅拌', '压制分块', '喷粉', '粉碎'],
  meltingProcess: ['熔炼', '熔融', '熔炉', '铸造', '浇注', '浇铸', '压铸', '玻璃熔炉'],
  waterHazard: ['消防水池', '污水处理站', '应急水池', '冷却池', '循环水池'],
  combustibleGas: ['液化石油气', '液化气', '天然气', '氢气', '乙炔', '甲烷', '丙烷', '丁烷', '一氧化碳'],
  flammableLiquid: ['酒精', '天那水', '洗枪水', '汽油', '丙酮', '甲苯', '乙酸乙酯', '香蕉水', '柴油'],
  // 废气处理、除尘设施内部和喷房按有限空间请专家确认（捷美奇专家成稿的做法）
  confinedSpace: ['除尘器', '污水池', '化粪池', '应急水池', '反应釜', '储罐内部', '废气塔', '喷淋塔', 'RTO', '活性炭吸附', '环保设施', '窨井', '地下室'],
  collapseRisk: ['多层建构筑物', '堆垛仓储', '脚手架', '老旧厂房', '临时搭建结构'],
  inertGas: ['氮气', '氩气', '二氧化碳', '氦气', '焊接保护气', '激光保护气', '食品充氮'],
};

// 设备里有这些说明粉尘量较大（粉尘专项的建议依据）
const DUST_REMOVAL_CUES = ['除尘'];

// 目录查不到的物料按名称认有毒物质（典型有毒化学品）
const TOXIC_CUES = ['氰', '硫化氢', '苯', '氯气', '氨气', '甲醛', '光气', '一氧化碳', '二氧化硫', '氮氧化物', '丙烯腈', '甲醇蒸气'];

// 可燃液体最大储存量合计低于这个数（吨）时，火灾方案已覆盖，建议不单出可燃液体蒸气爆炸方案。
// 取 20 kg：聚豪 0.5 kg、捷美奇 8 kg 的专家成稿都没有这份方案，飞宇 50 kg 的有（10-31 按测试集定）
export const FLAMMABLE_LIQUID_MIN_TONS = 0.02;

/** 名称里命中关键词的第一项 */
function findCue(names: string[], cues: string[]): string | undefined {
  return names.find((n) => cues.some((c) => n.includes(c)));
}

/** 是否危化品由专家判断；没判断前按《危险化学品目录》查名称、别名、CAS 号给建议 */
export function hazardousMaterialsOf(input: Pick<PlanInput, 'production' | 'expert'>): string[] {
  if (input.expert.hazardousMaterials) return input.expert.hazardousMaterials;
  return input.production.materials.filter((m) => hazchemSuggestionOf(m)?.value).map((m) => m.name);
}

const answered = (a: { answer: string } | undefined) => a?.answer === 'yes' || a?.answer === 'photo';
// 客户答了「否」才算明确回答，没答的按没有依据
const answerOf = (v: boolean | undefined): ScopeBasis => (v === false ? 'answer' : 'none');
const asDefault = (s: ScopeSuggestion | undefined) => s && { ...s, basis: 'default' as const };

// 「0.0005」吨 →「0.5 kg」
const weight = (tons: number) => (tons < 1 ? `${Math.round(tons * 1000 * 100) / 100} kg` : `${Math.round(tons * 100) / 100} t`);
const quote = (names: string[]) => names.map((n) => `「${n}」`).join('');

// 危险源辨识里的事故类型 → 对应方案的开关（GB 6441-2025 的「厂（场）内车辆致害」「其他」两种写法都认）
const typeKey = (factor: string) => factor.replace(/（场）|\(场\)|事故|\s/g, '').replace(/^其他$/, '其他伤害');
// 泄漏的开关是「危化品年用量超过 1 吨」，含专项预案，不按危险源带出；粉尘专项看粉尘量
const NOT_FROM_HAZARDS = new Set<ScopeKey>(['chemicalsOver1t', 'dustSpecialty']);

export function suggestScope(
  input: Pick<PlanInput, 'production' | 'business' | 'expert'>,
  /** 专家在危险源辨识里手动新增的事故类型：对应方案的开关没开时建议打开 */
  confirmedHazards: Pick<Hazard, 'factor' | 'workplace'>[] = [],
): Record<ScopeKey, ScopeSuggestion> {
  const { production: p, business } = input;
  const equipment = p.equipment.map((e) => e.name);
  const materials = p.materials.map((m) => m.name);
  const buildings = p.buildings.map((b) => `${b.name}${b.remarks ?? ''}`);
  const steps = p.processFlow.steps.map((s) => s.name);
  const names = [...equipment, ...materials, ...buildings, ...steps];
  const hazardous = hazardousMaterialsOf(input);
  const special = p.specialEquipment;

  // 危化品的危险性：目录里查得到的按目录，查不到的按名称关键词
  const kindsOf = (name: string) => hazchemSuggestionOf(p.materials.find((m) => m.name === name) ?? { name })?.kinds ?? [];
  const ofKind = (kind: HazchemKind, cues: string[]) =>
    hazardous.filter((n) => {
      const kinds = kindsOf(n);
      return kinds.length ? kinds.includes(kind) : cues.some((c) => n.includes(c));
    });
  const chemical = (list: string[], what: string): ScopeSuggestion | undefined =>
    list.length ? { value: true, reason: `危险化学品${quote(list)}属于${what}`, basis: 'cue', hit: list.join('、'), hits: list } : undefined;

  const byCue = (key: ScopeKey, pool = names): ScopeSuggestion | undefined => {
    const cues = CUES[key] ?? [];
    const hits = [...new Set(pool.filter((n) => cues.some((c) => n.includes(c))))];
    return hits.length ? { value: true, reason: `资料里有「${hits[0]}」`, basis: 'cue', hit: hits[0], hits } : undefined;
  };
  const off = (reason: string, basis: ScopeBasis = 'none'): ScopeSuggestion => ({ value: false, reason, basis });
  const yes = (reason: string, basis: ScopeBasis = 'answer'): ScopeSuggestion => ({ value: true, reason, basis });
  const usual = (what: string): ScopeSuggestion => yes(`工贸企业一般都有${what}，确认没有可关闭`, 'default');
  const steamBoiler = special.boilers?.answer === 'yes' && (special.boilers.items.length === 0 || special.boilers.items.some((b) => b.type !== 'hot_water'));

  const rules: Record<ScopeKey, () => ScopeSuggestion> = {
    // 默认打开的两项，名称里命中关键词也只是印证，不用专家再确认。
    // 捷美奇、泰瑞康、聚豪设备表都没有叉车，专家成稿仍列了厂区道路的车辆伤害和高处坠落，所以保留默认
    internalVehicle: () => asDefault(byCue('internalVehicle')) ?? usual('进出厂车辆和厂区道路'),
    highWork: () => asDefault(byCue('highWork')) ?? usual('高处作业'),
    // 跌落不再默认打开（三家专家成稿都没有这份方案），名称里有楼梯、平台等才建议
    fallRisk: () => byCue('fallRisk') ?? off('资料里没有楼梯、平台等跌落风险的记载，有可打开'),
    pressureVessel: () => {
      const pv = special.pressureVessels?.answer === 'yes';
      const boiler = special.boilers?.answer === 'yes';
      if (pv || boiler) return yes(`客户回答有${[pv && '压力容器', boiler && '锅炉'].filter(Boolean).join('、')}`);
      if (answered(special.pressureVessels) || answered(special.boilers)) {
        return yes('客户拍了压力容器或锅炉铭牌，待专家看照片确认', 'photo');
      }
      if (business.sites.includes('compressor_room')) return yes('客户勾选了空压机房');
      if (business.sites.includes('boiler_room')) return yes('客户勾选了锅炉房');
      const cylinder = p.materials.find((m) => m.cylinderSpec);
      if (cylinder) return yes(`物料「${cylinder.name}」是瓶装气体`);
      return byCue('pressureVessel', equipment) ?? off('资料里没有压力容器');
    },
    // 只按客户回答：有压力管道，或有蒸汽锅炉（蒸汽管道请专家确认是否属于压力管道，客户答了没有也提示）；名称关键词不再单独带出
    pressurePipeline: () => {
      const a = special.pressurePipelines?.answer;
      if (a === 'yes') return yes('客户回答有压力管道');
      if (a === 'photo') return yes('客户拍了压力管道照片，待专家确认', 'photo');
      if (steamBoiler) {
        const said = a === 'no' ? '客户回答没有压力管道，但有蒸汽锅炉' : '客户回答有蒸汽锅炉';
        return yes(`${said}，锅炉蒸汽管道可能属于压力管道，请专家确认`, 'cue');
      }
      if (a === 'no') return off('客户回答没有压力管道', 'answer');
      return off('客户没有回答有压力管道，也没有蒸汽锅炉');
    },
    elevator: () => byCue('elevator', [...equipment, ...buildings]) ?? off('资料里没有电梯'),
    craneHoist: () => byCue('craneHoist', equipment) ?? off('资料里没有起重机械'),
    dustProcess: () => byCue('dustProcess', [...equipment, ...steps]) ?? off('设备和工序里没有产尘工序'),
    // 有产尘工序时粉尘量大小都要专家确认（basis 记为 cue），没有产尘工序就不用
    dustSpecialty: () => {
      if (!rules.dustProcess().value) return off('没有产尘工序');
      const hit = findCue(equipment, DUST_REMOVAL_CUES);
      return hit
        ? { value: true, reason: `有产尘工序，设备里有「${hit}」，按粉尘量较大处理`, basis: 'cue', hit }
        : { value: false, reason: '有产尘工序，但设备里没有除尘系统，按粉尘量小处理，只出现场处置方案', basis: 'cue' };
    },
    meltingProcess: () => byCue('meltingProcess', [...equipment, ...steps]) ?? off('设备和工序里没有熔融工序'),
    // 有消防水池不等于有淹溺风险：消防水池多在地下或加盖，人员到不了，建议不出，露天的请专家打开。
    // 捷美奇、泰瑞康有消防水池，专家成稿都没有淹溺方案；飞宇的有（专家确认打开）
    waterHazard: () => {
      const cue = byCue('waterHazard', [...equipment, ...buildings, ...steps]);
      if (cue) return { ...cue, reason: `${cue.reason}，请专家确认有无淹溺风险` };
      const pool = p.firePool?.answer === 'yes' ? '消防水池' : p.hasEmergencyPool ? '应急水池' : undefined;
      if (pool) return off(`客户回答有${pool}；地下或加盖的水池人员到不了，建议不出淹溺方案，露天水池请打开`, 'cue');
      return off('没有消防水池等水体');
    },
    chemicalsOver1t: () => {
      const total = p.materials.filter((m) => hazardous.includes(m.name)).reduce((s, m) => s + (m.annualUsageTons ?? 0), 0);
      return total > 1
        ? { ...yes(`危险化学品年用量合计 ${total} 吨，超过 1 吨`, 'cue'), hit: hazardous.join('、') }
        : off(hazardous.length ? `危险化学品年用量合计 ${total} 吨，不到 1 吨` : '没有危险化学品');
    },
    // 专家判定不是危化品的物料不算可燃气体、可燃液体、有毒、惰性气体
    combustibleGas: () => chemical(ofKind('flammableGas', CUES.combustibleGas!), '易燃气体') ?? off('物料里没有可燃气体'),
    // 可燃液体按最大储存量设门槛：量很小时火灾方案已覆盖，建议不单出，仍请专家确认
    flammableLiquid: () => {
      const list = ofKind('flammableLiquid', CUES.flammableLiquid!);
      const on = chemical(list, '易燃液体');
      if (!on) return off('物料里没有可燃液体');
      const stored = list.map((n) => p.materials.find((m) => m.name === n)?.maxStorageTons);
      if (stored.some((t) => t === undefined)) return on;
      const total = stored.reduce((s: number, t) => s + t!, 0);
      if (total >= FLAMMABLE_LIQUID_MIN_TONS) return { ...on, reason: `${on.reason}，最大储存量合计 ${weight(total)}` };
      return {
        ...on,
        value: false,
        reason: `可燃液体${quote(list)}最大储存量合计 ${weight(total)}，量小，火灾方案已覆盖，建议不单出可燃液体蒸气爆炸方案，请专家确认`,
      };
    },
    toxicChemicals: () => {
      const list = hazardous.filter((n) => {
        const kinds = kindsOf(n);
        return kinds.length ? kinds.includes('toxic') : TOXIC_CUES.some((c) => n.includes(c));
      });
      return list.length
        ? { value: true, reason: `危险化学品${quote(list)}有急性毒性，请专家复核`, basis: 'cue', hit: list.join('、'), hits: list }
        : off('危险化学品里没有有毒物质');
    },
    confinedSpace: () => {
      if (business.sites.includes('confined_space')) return yes('客户勾选了有限空间');
      const cue = byCue('confinedSpace');
      if (cue) return { ...cue, reason: `${cue.reason}，内部检修清理属于有限空间作业，请专家确认` };
      if (business.sites.includes('spraying')) return yes('客户勾选了喷涂场所，喷房、废气处理设施内部可能属于有限空间，请专家确认', 'cue');
      return off('没有勾选有限空间');
    },
    highRise: () => {
      const tall = p.buildings.find((b) => (b.floors ?? 0) >= 7);
      return tall ? yes(`「${tall.name}」有 ${tall.floors} 层`) : off('没有 7 层以上的建筑');
    },
    collapseRisk: () => byCue('collapseRisk') ?? off('资料里没有坍塌风险'),
    inertGas: () => chemical(ofKind('inertGas', CUES.inertGas!), '不燃的压缩或液化气体，泄漏积聚可致窒息') ?? off('物料里没有惰性气体'),
    landlord: () => (business.leasesPremises ? yes('客户回答有出租厂房') : off('客户回答没有出租厂房', answerOf(business.leasesPremises))),
    roadTransport: () =>
      business.ownVehicles ? yes('客户回答有自备运输车辆') : off('客户回答没有自备运输车辆', answerOf(business.ownVehicles)),
  };

  const out = {} as Record<ScopeKey, ScopeSuggestion>;
  for (const key of SCOPE_KEYS) out[key] = rules[key]();

  // 专家在危险源里列了某类事故、对应方案却没出：建议打开对应开关（起重致害按场所分电梯和起重机）
  for (const h of confirmedHazards) {
    const t = PLAN_TEMPLATES.find((x) => x.kind === 'site' && x.trigger && typeKey(accidentTypeOf(x.title)) === typeKey(h.factor));
    if (!t) continue;
    const keys = [t.trigger!].flat().filter((k) => !NOT_FROM_HAZARDS.has(k));
    if (!keys.length || keys.some((k) => out[k].value)) continue;
    const key = keys.length > 1 ? (/电梯|货梯|客梯|升降/.test(`${h.factor}${h.workplace}`) ? 'elevator' : 'craneHoist') : keys[0]!;
    const where = h.workplace.trim() ? `（${h.workplace.trim()}）` : '';
    out[key] = { value: true, reason: `危险源辨识里列了「${h.factor.trim()}」${where}，对应的现场处置方案要出，请确认`, basis: 'cue' };
  }
  return out;
}

/** 生成用的开关：专家改过的以专家为准，其余用系统建议 */
export function resolveScope(input: PlanInput): Scope {
  const suggested = suggestScope(input);
  const scope = {} as Scope;
  for (const key of SCOPE_KEYS) scope[key] = input.expert.scope?.[key] ?? suggested[key].value;
  // 没有产尘工序就谈不上粉尘专项
  scope.dustSpecialty &&= scope.dustProcess;
  return scope;
}
