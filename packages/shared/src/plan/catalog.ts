// 应急预案由哪些专项预案、现场处置方案组成：28 份模板（起重致害电梯与起重机 10-29 合成一份）与 20 个「适用范围」开关。
// 迁自旧仓库 lib/decision-engine/templates.ts 与 constants/e6-switches.ts，逻辑照搬，开关名改为业务含义。
// 编号（P1、SP01…）只在代码和模板文件名里用，不进界面和交付文档。

/** 适用范围开关：决定生成哪些专项预案与现场处置方案（专家在 M2 第 8 项确认） */
export const SCOPE_SWITCHES = {
  internalVehicle: '厂区内有叉车、电瓶车等车辆',
  highWork: '有 2 米以上的高处作业',
  fallRisk: '有楼梯、平台等跌落风险',
  pressureVessel: '有压力容器（空压机储气罐、锅炉、气瓶等）',
  pressurePipeline: '有压力管道（蒸汽、燃气、工艺气体）',
  elevator: '有电梯或升降设备',
  craneHoist: '有行车、电动葫芦等起重机械',
  dustProcess: '有喷砂、打磨、抛光等产尘工序',
  meltingProcess: '有熔炼、压铸、浇铸等熔融工序',
  waterHazard: '有消防水池、污水池等可能淹溺的水体',
  chemicalsOver1t: '危险化学品年用量超过 1 吨',
  combustibleGas: '使用天然气、液化气、乙炔等可燃气体',
  flammableLiquid: '使用酒精、天那水、汽油等可燃液体',
  toxicChemicals: '使用有毒化学品',
  confinedSpace: '有污水池、罐体、除尘器等有限空间',
  highRise: '有 7 层以上的高层厂房',
  collapseRisk: '有多层建筑、堆垛、临时搭建等坍塌风险',
  inertGas: '使用氮气、氩气、二氧化碳等惰性气体',
  landlord: '把厂房出租给其他单位',
  roadTransport: '有自备车队或道路运输业务',
} as const;
export type ScopeKey = keyof typeof SCOPE_SWITCHES;
export const SCOPE_KEYS = Object.keys(SCOPE_SWITCHES) as ScopeKey[];
export type Scope = Record<ScopeKey, boolean>;

export type PlanPartKind = 'specialty' | 'site';

export interface PlanTemplate {
  id: string;
  kind: PlanPartKind;
  title: string;
  /** 没有开关的模板每家都有；多个开关时任一打开即生成 */
  trigger?: ScopeKey | ScopeKey[];
}

// 顺序即交付文档里的顺序
export const PLAN_TEMPLATES: PlanTemplate[] = [
  // 名称按 Martin 10-29 给的新知识库（与实际交付成稿一致）
  { id: 'P1', kind: 'specialty', title: '火灾爆炸事故专项应急预案' },
  { id: 'P2', kind: 'specialty', title: '粉尘爆炸事故专项应急预案', trigger: 'dustProcess' },
  { id: 'P3', kind: 'specialty', title: '化学品泄漏事故专项应急预案', trigger: 'chemicalsOver1t' },
  { id: 'P4', kind: 'specialty', title: '有限空间专项应急预案', trigger: 'confinedSpace' },
  { id: 'P5', kind: 'specialty', title: '人员疏散专项应急预案', trigger: 'highRise' },
  { id: 'P6', kind: 'specialty', title: '承租企业生产安全事故专项应急预案', trigger: 'landlord' },

  { id: 'SP01', kind: 'site', title: '火灾事故现场处置方案' },
  { id: 'SP02', kind: 'site', title: '触电事故现场处置方案' },
  { id: 'SP03', kind: 'site', title: '机械致害事故现场处置方案' },
  { id: 'SP04', kind: 'site', title: '物体打击事故现场处置方案' },
  { id: 'SP05', kind: 'site', title: '容器爆炸事故现场处置方案', trigger: 'pressureVessel' },
  { id: 'SP06', kind: 'site', title: '灼烫事故现场处置方案' },
  { id: 'SP07', kind: 'site', title: '厂内车辆致害事故现场处置方案', trigger: 'internalVehicle' },
  // 电梯与起重机合成一份（Martin 10-29 定），正文按企业有哪种写对应内容
  { id: 'SP08', kind: 'site', title: '起重致害事故现场处置方案', trigger: ['elevator', 'craneHoist'] },
  { id: 'SP09', kind: 'site', title: '泄漏事故现场处置方案', trigger: 'chemicalsOver1t' },
  { id: 'SP10', kind: 'site', title: '粉尘爆炸事故现场处置方案', trigger: 'dustProcess' },
  { id: 'SP11', kind: 'site', title: '高处坠落事故现场处置方案', trigger: 'highWork' },
  { id: 'SP12', kind: 'site', title: '跌落事故现场处置方案', trigger: 'fallRisk' },
  { id: 'SP13', kind: 'site', title: '中毒事故现场处置方案', trigger: 'toxicChemicals' },
  { id: 'SP14', kind: 'site', title: '窒息事故现场处置方案', trigger: 'inertGas' },
  { id: 'SP15', kind: 'site', title: '坍塌事故现场处置方案', trigger: 'collapseRisk' },
  { id: 'SP16', kind: 'site', title: '道路（轨道）车辆致害事故现场处置方案', trigger: 'roadTransport' },
  { id: 'SP17', kind: 'site', title: '淹溺事故现场处置方案', trigger: 'waterHazard' },
  { id: 'SP18', kind: 'site', title: '管道爆炸事故现场处置方案', trigger: 'pressurePipeline' },
  { id: 'SP19', kind: 'site', title: '可燃气体爆炸事故现场处置方案', trigger: 'combustibleGas' },
  { id: 'SP20', kind: 'site', title: '可燃液体蒸气爆炸事故现场处置方案', trigger: 'flammableLiquid' },
  { id: 'SP21', kind: 'site', title: '高温熔融物爆炸事故现场处置方案', trigger: 'meltingProcess' },
  { id: 'SP22', kind: 'site', title: '其他伤害事故现场处置方案' },
];

export interface PlanSelection {
  specialty: PlanTemplate[];
  site: PlanTemplate[];
}

/** 按开关选出要生成的专项预案与现场处置方案（专家确认后的开关） */
export function selectPlans(scope: Scope): PlanSelection {
  const included = PLAN_TEMPLATES.filter((t) => !t.trigger || [t.trigger].flat().some((k) => scope[k]));
  return {
    specialty: included.filter((t) => t.kind === 'specialty'),
    site: included.filter((t) => t.kind === 'site'),
  };
}

/** 「火灾爆炸事故专项应急预案」→「火灾爆炸」：适用范围里的事故类别 */
export function accidentTypeOf(title: string): string {
  return title.replace(/事故(专项应急预案|现场处置方案)$/, '').replace(/专项应急预案$/, '').trim();
}
