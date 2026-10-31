// 从设备、物料、工序名称推出现场处置方案里要写的具体内容（哪些金属液、哪些危险机械……），
// 用来填知识块里的空位。迁自旧仓库 lib/decision-engine/inference.ts 的 inferE5FromE4，关键词与防误判规则照搬：
// 「钢砂」不算钢水、「铝梯」「铝护栏」不算铝粉、「乙醇胺」不算酒精、「气瓶柜」不算压力容器。
import type { PlanInput } from './input.ts';
import { hazardousMaterialsOf } from './scope.ts';

export interface PlanSignals {
  /** 有熔融工序（高温熔融物知识块） */
  melting: boolean;
  meltTypes: string[];
  furnaceEquip: string[];
  cordonDist: string;
  flammableLiquids: string[];
  liquidStorage: string;
  hazardPositions: string;
  /** 压铸机等液压设备（火灾知识块的压铸场景） */
  hydraulicFireSources: string[];
  metalDustTypes: string[];
  dustWorkstations: string[];
  aluminumPresent: boolean;
  dangerMachines: string[];
  pressureVessels: string[];
  /** 有锅炉：容器爆炸知识块没有锅炉内容，要用完整模板 */
  boiler: boolean;
  /** 真正的可燃气体（液化石油气、天然气、乙炔、氢气…）；氧气、氩气、氮气等不算 */
  combustibleGases: string[];
  /** 可燃气体的存放位置 */
  gasLocations: string[];
  /** 可燃气体有储罐 / 罐区（含特种设备里登记的储罐） */
  gasTanks: boolean;
  /** 登记了压力管道，或有燃气管道、调压设施 */
  gasPipeline: boolean;
  /** 用气的炉窑（热处理炉、燃气炉…） */
  gasFurnaces: string[];
  /** 物料、设备或主要产品里有锂电池 / 电芯 */
  lithium: boolean;
  lithiumItems: string[];
  /** 粉尘种类（按物料与工序推，推不出时为「可燃粉尘」）；没有产尘依据时为空 */
  dustKinds: string[];
  /** 产尘的工序；没有工序时是产尘设备 */
  dustSources: string[];
  /** 产尘设备所在场所 */
  dustAreas: string[];
  /** 除尘、集尘设备 */
  dustCollectors: string[];
  /** 产生高温的设备（灼烫） */
  heatSources: string[];
  /** 危险机械所在场所 */
  dangerMachineAreas: string[];
  /** 厂内机动车辆（叉车等），设备表里有才写 */
  internalVehicles: string[];
}

const MELTING_CUES = ['熔融', '熔炼', '压铸', '熔铸', '熔炉', '浇铸', '浇注'];
const METAL_LIQUIDS = [
  { cue: '铝', liquid: '铝液' },
  { cue: '锌', liquid: '锌液' },
  { cue: '铜', liquid: '铜液' },
  { cue: '钢', liquid: '钢水' },
  { cue: '铁', liquid: '铁水' },
];
// 金属液只认真被熔 / 压铸的金属：设备名含金属且含熔 / 压铸语境，或材料是金属锭
const MELT_EQUIP_CUES = ['压铸机', '压铸', '熔炉', '熔铸', '保温炉'];
const FURNACE_EQUIP_CUES = ['熔炉', '压铸机', '压铸', '熔铸', '浇包', '浇注', '保温炉'];
const NON_METAL_MELT_CUES = ['玻璃熔', '玻璃液', '熔盐', '盐浴炉', '化工熔体'];

const FLAMMABLE_LIQUIDS: { cue: string; liquid: string; neg?: string[] }[] = [
  { cue: '酒精', liquid: '酒精' },
  { cue: '乙醇', liquid: '酒精', neg: ['胺', '醚'] },
  { cue: '甲醇', liquid: '甲醇' },
  { cue: '丙酮', liquid: '丙酮' },
  { cue: '甲苯', liquid: '甲苯' },
  { cue: '二甲苯', liquid: '二甲苯' },
  { cue: '汽油', liquid: '汽油' },
  { cue: '天那水', liquid: '天那水' },
  { cue: '稀释剂', liquid: '稀释剂' },
];
const BULK_STORAGE_CUES = ['储罐', '罐区', '罐组', '灌装线', '油罐', '卧罐', '立罐'];

const HYDRAULIC_OIL_CUES = ['压铸机', '液压', '液压站', '液压油'];

const DUST_PROCESS_CUES = ['喷砂', '抛光', '打磨', '研磨', '抛丸', 'CNC'];
const METAL_DUSTS = [
  { cue: '铝', dust: '铝粉' },
  { cue: '锌', dust: '锌粉' },
];
const METAL_PRODUCT_CUES = ['压铸', '锭', '合金', '铸件'];

const DANGER_MACHINES: { cue: string; machine: string }[] = [
  { cue: '压铸机', machine: '压铸机（合模、抽芯等运动部位挤压伤害）' },
  { cue: '冲床', machine: '冲床（冲压模具挤压伤害）' },
  { cue: '攻牙', machine: '钻孔攻牙机（旋转刀具与夹持伤害）' },
  { cue: 'CNC', machine: 'CNC 加工中心（高速旋转刀具切削伤害）' },
];

const PRESSURE_VESSELS: { cue: string; vessel: string; neg?: string[] }[] = [
  { cue: '空压机', vessel: '空压机（压缩空气压力容器）' },
  { cue: '压缩空气罐', vessel: '压缩空气罐' },
  { cue: '储气罐', vessel: '储气罐' },
  { cue: '气瓶', vessel: '气瓶', neg: ['柜', '架'] },
  { cue: '反应釜', vessel: '反应釜' },
];

// 可燃气体只认这些名称；「气」字匹配会把氧气、氩气、氮气、二氧化碳都算进来
const COMBUSTIBLE_GASES: { cue: string; gas: string }[] = [
  { cue: '液化石油气', gas: '液化石油气' },
  { cue: '液化气', gas: '液化石油气' },
  { cue: '天然气', gas: '天然气' },
  { cue: '燃气', gas: '燃气' },
  { cue: '煤气', gas: '煤气' },
  { cue: '乙炔', gas: '乙炔' },
  { cue: '氢气', gas: '氢气' },
  { cue: '丙烷', gas: '丙烷' },
  { cue: '丁烷', gas: '丁烷' },
  { cue: '甲烷', gas: '甲烷' },
  { cue: '沼气', gas: '沼气' },
  { cue: '环氧乙烷', gas: '环氧乙烷' },
];
const GAS_FURNACE_CUES = ['热处理炉', '燃气炉', '燃气灶', '燃气锅炉', '煤气炉', '退火炉', '淬火炉'];
const GAS_PIPELINE_CUES = ['燃气管道', '天然气管道', '调压', '燃气表'];

// 锂电池：「锂基润滑脂」「溴化锂」「氯化锂」等不是电池
const LITHIUM_CUES = ['锂电池', '锂离子', '锂电', '电芯', '锂聚合物'];
const LITHIUM_NEG = ['锂基', '溴化锂', '氯化锂', '碳酸锂', '氢氧化锂', '润滑脂'];

// 粉尘种类：按物料与工序分，各类的处置要点不同
const RESIN_DUST_CUES = ['喷粉', '粉末涂料', '塑粉', '静电喷涂', '环氧粉', '粉体'];
const SPRAY_CUES = ['喷涂', '喷粉', '喷塑'];
const POWDER_PROCESS_CUES = ['粉碎', '筛粉', '压粉', '打粉', '混粉', '磨粉', '组粉', '灌粉', '粉未灌装', '粉末灌装'];
const WOOD_CUES = ['木材', '木料', '木工', '木板', '实木', '板材开料', '砂光', '竹'];

const HEAT_SOURCE_CUES = ['炉', '焊', '烘', '加热', '注塑', '热压', '热熔', '熔', '锅炉', '蒸汽', '烙铁', '锡', '热缩', '干燥'];
const VEHICLE_CUES = ['叉车', '货车', '电瓶车', '搬运车', '牵引车', '铲车'];

const uniq = (xs: string[]) => [...new Set(xs)];
const hits = (name: string, cue: string, neg?: string[]) => name.includes(cue) && !(neg ?? []).some((x) => name.includes(x));

export function planSignals(input: PlanInput): PlanSignals {
  const p = input.production;
  const steps = p.processFlow.steps.map((s) => s.name);
  const equipment = p.equipment.map((e) => e.name);
  const materials = p.materials.map((m) => m.name);
  const hazardous = hazardousMaterialsOf(input);

  const melting = [...steps, ...equipment].some((n) => MELTING_CUES.some((c) => n.includes(c)));
  const meltTypes = uniq(
    METAL_LIQUIDS.filter(
      ({ cue }) =>
        equipment.some((n) => n.includes(cue) && MELT_EQUIP_CUES.some((m) => n.includes(m))) ||
        materials.some((n) => n.includes(cue) && n.includes('锭')),
    ).map((m) => m.liquid),
  );
  const nonMetal = [...equipment, ...materials].some((n) => NON_METAL_MELT_CUES.some((x) => n.includes(x)));

  // 明确不是危化品的物料不算可燃液体
  const liquidMaterials = p.materials.filter(
    (m) => hazardous.includes(m.name) && FLAMMABLE_LIQUIDS.some(({ cue, neg }) => hits(m.name, cue, neg)),
  );
  const flammableLiquids = uniq(
    liquidMaterials.flatMap((m) => FLAMMABLE_LIQUIDS.filter(({ cue, neg }) => hits(m.name, cue, neg)).map((f) => f.liquid)),
  );
  const storages = liquidMaterials.map((m) => m.storageLocation?.trim()).filter((s): s is string => Boolean(s));
  const bulk = storages.some((s) => BULK_STORAGE_CUES.some((b) => s.includes(b)));
  const storage = storages[0] ?? '可燃液体存放场所';

  const dustWorkstations = uniq(steps.filter((n) => DUST_PROCESS_CUES.some((c) => n.includes(c))));
  const metalDustTypes =
    dustWorkstations.length === 0
      ? []
      : METAL_DUSTS.filter(({ cue }) =>
          [...equipment, ...materials].some((n) => n.includes(cue) && METAL_PRODUCT_CUES.some((m) => n.includes(m))),
        ).map((d) => d.dust);

  const lithiumItems = uniq(
    [...materials, ...equipment, ...(input.basic.mainProducts ?? '').split(/[、，,；;\s]+/)].filter(
      (n) => LITHIUM_CUES.some((c) => n.includes(c)) && !LITHIUM_NEG.some((x) => n.includes(x)),
    ),
  );

  const gasMaterials = p.materials.filter((m) => COMBUSTIBLE_GASES.some(({ cue }) => m.name.includes(cue)));
  const tanks = p.specialEquipment.storageTanks;
  const gasTankRegistered =
    tanks?.answer === 'yes' && tanks.items.some((t) => COMBUSTIBLE_GASES.some(({ cue }) => (t.substance ?? '').includes(cue)));
  const pipelines = p.specialEquipment.pressurePipelines;

  // 产尘：工序、设备名含产尘关键词，或喷粉；带上设备所在场所
  const dustEquipment = p.equipment.filter((e) =>
    [...DUST_PROCESS_CUES, ...POWDER_PROCESS_CUES, '喷粉', '喷涂流水线', '除尘'].some((c) => e.name.includes(c)),
  );
  const resinDust =
    materials.some((n) => RESIN_DUST_CUES.some((c) => n.includes(c))) && [...steps, ...equipment].some((n) => SPRAY_CUES.some((c) => n.includes(c)));
  const powderDust = equipment.some((n) => POWDER_PROCESS_CUES.some((c) => n.includes(c)));
  const woodDust = [...steps, ...equipment, ...materials].some((n) => WOOD_CUES.some((c) => n.includes(c)));
  const dustSteps = uniq(steps.filter((n) => [...DUST_PROCESS_CUES, ...SPRAY_CUES, ...POWDER_PROCESS_CUES].some((c) => n.includes(c))));
  const hasDust = dustWorkstations.length > 0 || dustEquipment.length > 0 || resinDust || powderDust || woodDust;
  const dustKinds = !hasDust
    ? []
    : [
        ...(metalDustTypes.length ? [`${metalDustTypes.join('、')}等金属粉尘`] : []),
        ...(resinDust ? ['树脂粉尘（粉末涂料）'] : []),
        ...(powderDust ? ['有机粉尘（粉体原料）'] : []),
        ...(woodDust ? ['木粉尘'] : []),
      ];

  return {
    melting,
    meltTypes,
    furnaceEquip: uniq(equipment.filter((n) => FURNACE_EQUIP_CUES.some((c) => n.includes(c)))),
    cordonDist: nonMetal
      ? '向外延伸至少 10m（金属液类）或 15m（玻璃液、熔盐类，因可能伴生化学反应）'
      : '向外延伸至少 10m（金属液类）',
    flammableLiquids,
    liquidStorage: bulk ? `${storage}（含储罐/罐区，须按储罐 BLEVE 专门防控）` : `${storage}（小量瓶装）`,
    hazardPositions: '可燃液体保管与取用相关岗位人员',
    hydraulicFireSources: uniq(equipment.filter((n) => HYDRAULIC_OIL_CUES.some((c) => n.includes(c)))),
    metalDustTypes,
    dustWorkstations,
    aluminumPresent: metalDustTypes.includes('铝粉'),
    dangerMachines: uniq(DANGER_MACHINES.filter(({ cue }) => equipment.some((n) => n.includes(cue))).map((d) => d.machine)),
    pressureVessels: uniq(
      PRESSURE_VESSELS.filter(({ cue, neg }) => equipment.some((n) => hits(n, cue, neg))).map((v) => v.vessel),
    ),
    boiler: p.specialEquipment.boilers?.answer === 'yes' || p.specialEquipment.boilers?.answer === 'photo',
    // 每种物料只取第一个命中的名称（「液化石油气」不再算一次「液化气」）
    combustibleGases: uniq(gasMaterials.map((m) => COMBUSTIBLE_GASES.find(({ cue }) => m.name.includes(cue))!.gas)),
    gasLocations: uniq(gasMaterials.map((m) => m.storageLocation?.trim()).filter((s): s is string => Boolean(s))),
    gasTanks: gasTankRegistered || gasMaterials.some((m) => BULK_STORAGE_CUES.some((b) => (m.storageLocation ?? '').includes(b))),
    gasPipeline: pipelines?.answer === 'yes' || pipelines?.answer === 'photo' || equipment.some((n) => GAS_PIPELINE_CUES.some((c) => n.includes(c))),
    gasFurnaces: uniq(equipment.filter((n) => GAS_FURNACE_CUES.some((c) => n.includes(c)))),
    lithium: lithiumItems.length > 0,
    lithiumItems,
    dustKinds: dustKinds.length ? dustKinds : hasDust ? ['可燃粉尘'] : [],
    dustSources: dustSteps.length ? dustSteps : uniq(dustEquipment.map((e) => e.name.trim())),
    dustAreas: uniq(dustEquipment.map((e) => e.location?.trim()).filter((s): s is string => Boolean(s) && s !== '车间')),
    dustCollectors: uniq(equipment.filter((n) => /除尘|集尘|吸尘/.test(n))),
    heatSources: uniq(equipment.filter((n) => HEAT_SOURCE_CUES.some((c) => n.includes(c)) && !n.includes('炉渣'))),
    dangerMachineAreas: uniq(
      p.equipment
        .filter((e) => DANGER_MACHINES.some(({ cue }) => e.name.includes(cue)))
        .map((e) => e.location?.trim())
        .filter((s): s is string => Boolean(s) && s !== '车间'),
    ),
    internalVehicles: uniq(equipment.filter((n) => VEHICLE_CUES.some((c) => n.includes(c)))),
  };
}
