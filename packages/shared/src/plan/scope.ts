// 适用范围的系统建议：按客户资料推出 20 个开关各开不开、为什么。专家确认或改动后才用于生成。
// 规则迁自旧仓库 lib/decision-engine/inference.ts（关键词照搬），按新资料格式重写：
// 特种设备、场所、消防水池、出租厂房、自备车辆都有了客户的明确回答，优先看回答，再看名称关键词。
import { SCOPE_KEYS, type Scope, type ScopeKey } from './catalog.ts';
import type { PlanInput } from './input.ts';

/**
 * 建议从哪来，决定专家要不要逐个确认（M2 第 8 项）：
 * answer 客户明确回答 · default 工贸企业默认打开 · none 资料里没有依据 —— 直接算已确定；
 * cue 名称里有关键词 · photo 客户拍照待专家看 —— 要专家确认
 */
export type ScopeBasis = 'answer' | 'default' | 'none' | 'cue' | 'photo';

export interface ScopeSuggestion {
  value: boolean;
  /** 给专家看的依据，业务语言 */
  reason: string;
  basis: ScopeBasis;
  /** 命中关键词的那一项（设备、物料、建筑或工序名称） */
  hit?: string;
}

// 旧仓库 constants/e6-switches.ts 的关键词
const CUES: Partial<Record<ScopeKey, string[]>> = {
  internalVehicle: ['叉车', '铲车', '电瓶车', '电动牵引车', 'AGV', '搬运车'],
  highWork: ['脚手架', '屋顶检修', '检修平台', '设备维护台', '高处吊装作业'],
  fallRisk: ['楼梯', '平台', '设备维护操作面', '物料堆垛通道'],
  pressureVessel: ['空压机', '空气压缩机', '压缩机', '储气罐', '压力容器', '锅炉', '蒸汽发生器', '反应釜', '气瓶'],
  pressurePipeline: ['蒸汽管道', '压缩气体管道', '天然气管道', '液化气管道', '工艺气体管道'],
  elevator: ['电梯', '货梯', '客梯', '升降平台', '垂直升降机'],
  craneHoist: ['行车', '桥式起重机', '电动葫芦', '塔吊', '门式起重机', '龙门吊'],
  dustProcess: ['喷砂', '攻牙', '木工', '金属切割', '研磨', '抛光', '打磨', '混合搅拌', '压制分块'],
  meltingProcess: ['熔炼', '熔融', '熔炉', '铸造', '浇注', '浇铸', '压铸', '玻璃熔炉'],
  waterHazard: ['消防水池', '污水处理站', '应急水池', '冷却池', '循环水池'],
  combustibleGas: ['液化石油气', '液化气', '天然气', '氢气', '乙炔', '甲烷', '丙烷', '丁烷', '一氧化碳'],
  flammableLiquid: ['酒精', '天那水', '洗枪水', '汽油', '丙酮', '甲苯', '乙酸乙酯', '香蕉水', '柴油'],
  confinedSpace: ['除尘器', '污水池', '化粪池', '应急水池', '反应釜', '储罐内部'],
  collapseRisk: ['多层建构筑物', '堆垛仓储', '脚手架', '老旧厂房', '临时搭建结构'],
  inertGas: ['氮气', '氩气', '二氧化碳', '氦气', '焊接保护气', '激光保护气', '食品充氮'],
};

// 设备里有这些说明粉尘量较大（粉尘专项的建议依据）
const DUST_REMOVAL_CUES = ['除尘'];

// 典型有毒化学品（第一版简化，化学品知识库上线后改为查库）
const TOXIC_CUES = ['氰', '硫化氢', '苯', '氯气', '氨气', '甲醛', '光气', '一氧化碳', '二氧化硫', '氮氧化物', '丙烯腈', '甲醇蒸气'];

/** 名称里命中关键词的第一项 */
function findCue(names: string[], cues: string[]): string | undefined {
  return names.find((n) => cues.some((c) => n.includes(c)));
}

/** 是否危化品由专家判断；没判断前按名称建议（可燃液体、可燃气体、有毒、惰性气体） */
export function hazardousMaterialsOf(input: Pick<PlanInput, 'production' | 'expert'>): string[] {
  if (input.expert.hazardousMaterials) return input.expert.hazardousMaterials;
  const cues = [...CUES.flammableLiquid!, ...CUES.combustibleGas!, ...CUES.inertGas!, ...TOXIC_CUES];
  return input.production.materials.filter((m) => cues.some((c) => m.name.includes(c))).map((m) => m.name);
}

const answered = (a: { answer: string } | undefined) => a?.answer === 'yes' || a?.answer === 'photo';
// 客户答了「否」才算明确回答，没答的按没有依据
const answerOf = (v: boolean | undefined): ScopeBasis => (v === false ? 'answer' : 'none');
const asDefault = (s: ScopeSuggestion | undefined) => s && { ...s, basis: 'default' as const };

export function suggestScope(input: Pick<PlanInput, 'production' | 'business' | 'expert'>): Record<ScopeKey, ScopeSuggestion> {
  const { production: p, business } = input;
  const equipment = p.equipment.map((e) => e.name);
  const materials = p.materials.map((m) => m.name);
  const buildings = p.buildings.map((b) => `${b.name}${b.remarks ?? ''}`);
  const steps = p.processFlow.steps.map((s) => s.name);
  const names = [...equipment, ...materials, ...buildings, ...steps];
  const hazardous = hazardousMaterialsOf(input);
  const special = p.specialEquipment;

  const byCue = (key: ScopeKey, pool = names): ScopeSuggestion | undefined => {
    const hit = findCue(pool, CUES[key] ?? []);
    return hit ? { value: true, reason: `资料里有「${hit}」`, basis: 'cue', hit } : undefined;
  };
  const off = (reason: string, basis: ScopeBasis = 'none'): ScopeSuggestion => ({ value: false, reason, basis });
  const yes = (reason: string, basis: ScopeBasis = 'answer'): ScopeSuggestion => ({ value: true, reason, basis });
  const usual = (what: string): ScopeSuggestion => yes(`工贸企业一般都有${what}，确认没有可关闭`, 'default');

  const rules: Record<ScopeKey, () => ScopeSuggestion> = {
    // 默认打开的三项，名称里命中关键词也只是印证，不用专家再确认
    internalVehicle: () => asDefault(byCue('internalVehicle')) ?? usual('厂内车辆'),
    highWork: () => asDefault(byCue('highWork')) ?? usual('高处作业'),
    fallRisk: () => asDefault(byCue('fallRisk')) ?? usual('跌落风险'),
    pressureVessel: () => {
      if (special.pressureVessels?.answer === 'yes') return yes('客户回答有压力容器');
      if (special.boilers?.answer === 'yes') return yes('客户回答有锅炉');
      if (answered(special.pressureVessels) || answered(special.boilers)) {
        return yes('客户拍了压力容器或锅炉铭牌，待专家看照片确认', 'photo');
      }
      if (business.sites.includes('compressor_room')) return yes('客户勾选了空压机房');
      if (business.sites.includes('boiler_room')) return yes('客户勾选了锅炉房');
      const cylinder = p.materials.find((m) => m.cylinderSpec);
      if (cylinder) return yes(`物料「${cylinder.name}」是瓶装气体`);
      return byCue('pressureVessel', equipment) ?? off('资料里没有压力容器');
    },
    pressurePipeline: () => {
      if (special.pressurePipelines?.answer === 'yes') return yes('客户回答有压力管道');
      if (special.pressurePipelines?.answer === 'photo') return yes('客户拍了压力管道照片，待专家确认', 'photo');
      return (
        byCue('pressurePipeline') ??
        (special.pressurePipelines?.answer === 'no' ? off('客户回答没有压力管道', 'answer') : off('资料里没有压力管道'))
      );
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
    waterHazard: () => {
      if (p.firePool?.answer === 'yes') return yes('客户回答有消防水池');
      if (p.hasEmergencyPool) return yes('客户回答有应急水池');
      return byCue('waterHazard') ?? off('没有消防水池等水体');
    },
    chemicalsOver1t: () => {
      const total = p.materials.filter((m) => hazardous.includes(m.name)).reduce((s, m) => s + (m.annualUsageTons ?? 0), 0);
      return total > 1
        ? { ...yes(`危险化学品年用量合计 ${total} 吨，超过 1 吨`, 'cue'), hit: hazardous.join('、') }
        : off(hazardous.length ? `危险化学品年用量合计 ${total} 吨，不到 1 吨` : '没有危险化学品');
    },
    // 专家判定不是危化品的物料不算可燃气体、可燃液体、惰性气体
    combustibleGas: () => byCue('combustibleGas', hazardous) ?? off('物料里没有可燃气体'),
    flammableLiquid: () => byCue('flammableLiquid', hazardous) ?? off('物料里没有可燃液体'),
    toxicChemicals: () => {
      const hit = findCue(hazardous, TOXIC_CUES);
      return hit ? { value: true, reason: `危险化学品「${hit}」有毒性，请专家复核`, basis: 'cue', hit } : off('危险化学品里没有典型有毒物质');
    },
    confinedSpace: () =>
      business.sites.includes('confined_space')
        ? yes('客户勾选了有限空间')
        : (byCue('confinedSpace') ?? off('没有勾选有限空间')),
    highRise: () => {
      const tall = p.buildings.find((b) => (b.floors ?? 0) >= 7);
      return tall ? yes(`「${tall.name}」有 ${tall.floors} 层`) : off('没有 7 层以上的建筑');
    },
    collapseRisk: () => byCue('collapseRisk') ?? off('资料里没有坍塌风险'),
    inertGas: () => byCue('inertGas', hazardous) ?? off('物料里没有惰性气体'),
    landlord: () => (business.leasesPremises ? yes('客户回答有出租厂房') : off('客户回答没有出租厂房', answerOf(business.leasesPremises))),
    roadTransport: () =>
      business.ownVehicles ? yes('客户回答有自备运输车辆') : off('客户回答没有自备运输车辆', answerOf(business.ownVehicles)),
  };

  const out = {} as Record<ScopeKey, ScopeSuggestion>;
  for (const key of SCOPE_KEYS) out[key] = rules[key]();
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
