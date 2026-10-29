// 企业自填第 4 步「应急资源与图纸」（Paper 12 页 S04）：应急物资、急救药箱、消防水池、厂区建筑、MSDS、三张图纸、相邻企业。
// 边填边保存，数量大概即可；交付前由注册安全工程师按 productionSchema 整理。耐火等级、是否危化品不要求客户判断。
import { z } from 'zod';
import { newId } from './organization-step.ts';
import { msdsHintOf, type DraftMaterial, type SiteType } from './production-step.ts';

const id = z.string().min(1).max(40);
const text = (max: number, label: string) => z.string().trim().max(max, `${label}最多 ${max} 个字`).optional();
const fileIds = z.array(z.uuid()).max(20, '每处最多 20 个文件').default([]);
const count = z.number().int().min(0).max(100_000).optional();
const amount = z.number().min(0).max(10_000_000).optional();

// 常用应急物资 20 项（第一版内置，M3「常用应急物资清单」知识库上线后改为查库）。
// sites：勾了这些场所的排在前面；common：几乎每家都有，第一次打开直接勾上
export const SUPPLY_CATALOG = {
  fire_ext_portable: { name: '手提式干粉灭火器', unit: '具', common: true },
  fire_ext_cart: { name: '推车式干粉灭火器', unit: '具', sites: ['warehouse', 'hazmat_store', 'workshop'] },
  hydrant_indoor: { name: '室内消火栓', unit: '个', common: true },
  emergency_light: { name: '应急照明灯', unit: '盏', common: true },
  exit_sign: { name: '疏散指示 / 安全出口标志', unit: '个', common: true },
  eyewash: { name: '洗眼器', unit: '台', sites: ['hazmat_store', 'spraying'] },
  gas_mask: { name: '防毒面具', unit: '个', sites: ['spraying', 'hazmat_store', 'confined_space'] },
  radio: { name: '对讲机', unit: '台' },
  stretcher: { name: '担架', unit: '副' },
  barrier_tape: { name: '警示隔离带', unit: '卷' },
  fire_sand: { name: '消防沙', unit: '桶', sites: ['hazmat_store', 'spraying', 'power_room'] },
  co2_ext: { name: '二氧化碳灭火器', unit: '具', sites: ['power_room'] },
  hydrant_outdoor: { name: '室外消火栓', unit: '个' },
  fire_blanket: { name: '灭火毯', unit: '块', sites: ['canteen', 'welding'] },
  insulated_gloves: { name: '绝缘手套', unit: '副', sites: ['power_room'] },
  insulated_boots: { name: '绝缘靴', unit: '双', sites: ['power_room'] },
  scba: { name: '正压式空气呼吸器', unit: '套', sites: ['confined_space', 'hazmat_store'] },
  gas_detector: { name: '气体检测仪', unit: '台', sites: ['confined_space', 'spraying'] },
  safety_rope: { name: '安全绳', unit: '条', sites: ['confined_space'] },
  absorbent: { name: '吸附棉 / 堵漏材料', unit: '包', sites: ['hazmat_store'] },
} as const satisfies Record<string, { name: string; unit: string; common?: boolean; sites?: readonly SiteType[] }>;
export type SupplyKey = keyof typeof SUPPLY_CATALOG;
const SUPPLY_KEYS = Object.keys(SUPPLY_CATALOG) as [SupplyKey, ...SupplyKey[]];

// 已勾的物资（含客户自己加的，catalogKey 为空）
export const draftSupplySchema = z.object({
  id,
  catalogKey: z.enum(SUPPLY_KEYS).optional(),
  name: z.string().trim().max(50, '物资名称最多 50 个字').default(''),
  unit: text(10, '单位'),
  quantity: count,
  location: text(50, '位置'),
});
export type DraftSupply = z.infer<typeof draftSupplySchema>;

// 急救药箱常规配置（M3 知识库上线后改为查库），「按常规配置」时可改数量
export const STANDARD_FIRST_AID_KIT = [
  ['纱布绷带', 2, '卷'],
  ['医用棉签', 2, '包'],
  ['脱脂棉球', 2, '包'],
  ['碘伏消毒液', 1, '瓶'],
  ['烫伤膏', 1, '盒'],
  ['红花油', 1, '瓶'],
  ['清凉油', 1, '瓶'],
] as const;

export const draftFirstAidItemSchema = z.object({
  id,
  name: z.string().trim().max(30, '药品名称最多 30 个字').default(''),
  quantity: count,
  unit: text(10, '单位'),
});
export type DraftFirstAidItem = z.infer<typeof draftFirstAidItemSchema>;

// standard = 按常规配置；manual = 自己逐项填。药品清单由客户填写，药箱照片只作补充（Martin 10-29）
export const FIRST_AID_MODES = ['standard', 'manual'] as const;
export type FirstAidMode = (typeof FIRST_AID_MODES)[number];

// 耐火等级默认「专家判断」，客户有消防验收资料、知道等级的可以直接选
export const FIRE_RATINGS = { expert: '专家判断', '1': '一级', '2': '二级', '3': '三级', '4': '四级' } as const;
export type FireRating = keyof typeof FIRE_RATINGS;

export const draftBuildingSchema = z.object({
  id,
  name: z.string().trim().max(50, '建筑名称最多 50 个字').default(''),
  fireRating: z.enum(Object.keys(FIRE_RATINGS) as [FireRating, ...FireRating[]]).default('expert'),
  floors: z.number().int().min(1).max(200).optional(),
  areaM2: amount,
});
export type DraftBuilding = z.infer<typeof draftBuildingSchema>;

export const DRAWINGS = {
  site_plan: { label: '总平面布置图', short: '总平面图', required: true, hint: 'CAD 导出、图纸拍照都可以' },
  evacuation_plan: { label: '紧急疏散示意图', short: '疏散图', required: true, hint: '车间墙上张贴的疏散图拍照即可，每层可各传一张' },
  fire_facility_plan: {
    label: '消防设施布置图',
    short: '消防设施图',
    required: false,
    hint: '在平面图打印件上手画后拍照：● 手提灭火器　▲ 推车灭火器　■ 消火栓　⊗ 消防沙',
  },
} as const;
export type DrawingKey = keyof typeof DRAWINGS;
export const DRAWING_KEYS = Object.keys(DRAWINGS) as DrawingKey[];

export const draftNeighborSchema = z.object({
  id,
  name: z.string().trim().max(50, '企业名称最多 50 个字').default(''),
  // 门卫、保安室等联系电话
  contact: text(50, '联系方式'),
});
export type DraftNeighbor = z.infer<typeof draftNeighborSchema>;

export const resourcesStepSchema = z.object({
  supplies: z.array(draftSupplySchema).max(100, '物资最多 100 项，更多请上传台账').default([]),
  // 统一保管人：引用第 2 步填过的人员 id，电话随人员带出
  custodianId: id.optional(),
  supplyLedgerFileIds: fileIds,
  firstAidKit: z
    .object({
      answer: z.enum(['yes', 'no']).optional(),
      mode: z.enum(FIRST_AID_MODES).default('standard'),
      // 常规配置改过数量、或自己逐项填的清单
      items: z.array(draftFirstAidItemSchema).max(50, '药品最多 50 项').default([]),
      photoFileIds: fileIds,
    })
    .prefault({}),
  firePool: z
    .object({
      answer: z.enum(['yes', 'no']).optional(),
      count: z.number().int().min(1).max(100).optional(),
      volumeM3: amount,
      // 容积点了「稍后补」
      volumeLater: z.boolean().default(false),
    })
    .prefault({}),
  buildings: z.array(draftBuildingSchema).max(50, '建筑最多 50 栋').default([]),
  fireAcceptanceFileIds: fileIds,
  // 第 3 步物料的 MSDS：按物料 id 记上传的文件、是否稍后补（物料本身在第 3 步）
  msds: z
    .record(id, z.object({ fileIds, later: z.boolean().default(false) }))
    .refine((r) => Object.keys(r).length <= 200, '物料最多 200 种')
    .default({}),
  drawings: z
    .object({ site_plan: fileIds, evacuation_plan: fileIds, fire_facility_plan: fileIds })
    .prefault({}),
  neighbors: z
    .object({
      // has = 填了相邻企业；none = 没有相邻企业；unknown = 不清楚，专家联系时再问
      answer: z.enum(['has', 'none', 'unknown']).optional(),
      items: z.array(draftNeighborSchema).max(20, '相邻企业最多 20 家').default([]),
    })
    .prefault({}),
});
export type ResourcesStep = z.infer<typeof resourcesStepSchema>;

export const resourcesStepSaveSchema = z.object({
  version: z.number().int().min(1),
  step: resourcesStepSchema,
});
export type ResourcesStepSave = z.infer<typeof resourcesStepSaveSchema>;

// 存在企业资料里的第 4 步内容
export interface ResourcesStepStored {
  step: ResourcesStep;
}

export function supplyFromCatalog(key: SupplyKey): DraftSupply {
  return { id: newId('r'), catalogKey: key, name: SUPPLY_CATALOG[key].name, unit: SUPPLY_CATALOG[key].unit };
}

// 物资排序：勾了相关场所的在前，其次常见的，其余按清单顺序
export function supplyKeysForSites(sites: readonly SiteType[]): SupplyKey[] {
  const score = (key: SupplyKey) => {
    const def: { name: string; common?: boolean; sites?: readonly SiteType[] } = SUPPLY_CATALOG[key];
    if (def.common) return 0;
    if (def.sites?.some((s) => sites.includes(s))) return 1;
    return def.sites ? 3 : 2;
  };
  return SUPPLY_KEYS.map((k, i) => [k, score(k), i] as const)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map(([k]) => k);
}

// 场所对应的建筑（宿舍也要填）；配电房、空压机房等一般在厂房里，不单列
const SITE_BUILDINGS: [SiteType, string][] = [
  ['workshop', '生产车间'],
  ['warehouse', '仓库'],
  ['hazmat_store', '危化品仓库'],
  ['boiler_room', '锅炉房'],
  ['canteen', '食堂'],
  ['dormitory', '员工宿舍'],
];

export function buildingsForSites(sites: readonly SiteType[]): DraftBuilding[] {
  return SITE_BUILDINGS.filter(([s]) => sites.includes(s)).map(([, name]) => ({
    id: newId('b'),
    name,
    fireRating: 'expert',
  }));
}

export function standardFirstAidItems(): DraftFirstAidItem[] {
  return STANDARD_FIRST_AID_KIT.map(([name, quantity, unit]) => ({ id: newId('k'), name, quantity, unit }));
}

// 第一次打开时的内容：常见物资勾上、按场所列出建筑、药箱按常规配置
export function defaultResourcesStep(sites: readonly SiteType[]): ResourcesStep {
  return resourcesStepSchema.parse({
    supplies: SUPPLY_KEYS.filter((k) => 'common' in SUPPLY_CATALOG[k]).map(supplyFromCatalog),
    buildings: buildingsForSites(sites),
    firstAidKit: { mode: 'standard', items: standardFirstAidItems() },
  });
}

// 步骤里引用的所有文件（保存时核对都是本组织上传的）
export function fileIdsOfResourcesStep(step: ResourcesStep): string[] {
  const ids = [
    ...step.supplyLedgerFileIds,
    ...step.firstAidKit.photoFileIds,
    ...step.fireAcceptanceFileIds,
    ...Object.values(step.msds).flatMap((m) => m.fileIds),
    ...DRAWING_KEYS.flatMap((k) => step.drawings[k]),
  ];
  return [...new Set(ids)];
}

const filled = (v: string | undefined) => Boolean(v && v.trim() !== '');

// 「应急物资及装备」开始编制只要求灭火器等消防器材数量：勾了的物资里有一项填了数量即可（上传台账另算，挂文件即已提供）
export function suppliesStartReady(step: ResourcesStep): boolean {
  return step.supplies.some((s) => filled(s.name) && (s.quantity ?? 0) > 0);
}

// 「急救药箱药品清单」：没有 → 没有；按常规配置或逐项填了 → 已提供；只传了药箱照片不算
export function firstAidKitStatus(kit: ResourcesStep['firstAidKit']): 'provided' | 'none' | null {
  if (kit.answer === 'no') return 'none';
  if (kit.answer !== 'yes') return null;
  return kit.items.some((i) => filled(i.name)) ? 'provided' : null;
}

// 「消防水池」：有并填了数量即已提供（容积可稍后补，交付前补齐）
export function firePoolStatus(pool: ResourcesStep['firePool']): 'provided' | 'none' | null {
  if (pool.answer === 'no') return 'none';
  return pool.answer === 'yes' && pool.count !== undefined ? 'provided' : null;
}

// 「建（构）筑物一览」：有一栋写了名称和面积即可，其余交付前补齐
export function buildingsReady(step: ResourcesStep): boolean {
  return step.buildings.some((b) => filled(b.name) && (b.areaM2 ?? 0) > 0);
}

// 合计面积（m²，两位小数），回填到第 1 步「总建筑面积」
export function totalBuildingArea(buildings: readonly DraftBuilding[]): number {
  const sum = buildings.reduce((acc, b) => acc + (b.areaM2 ?? 0), 0);
  return Math.round(sum * 100) / 100;
}

// 「外部应急队伍与资源」：消防、医院、应急管理局由耕云按地址带出，客户只答相邻企业：
// 填了至少一家，或明确没有，即已提供；不清楚的等专家联系时再问
export function neighborsReady(neighbors: ResourcesStep['neighbors']): boolean {
  if (neighbors.answer === 'none') return true;
  return neighbors.items.some((n) => filled(n.name));
}

// MSDS 一栏按第 3 步的物料名称给提示。是否危化品由专家判断，这里只分：常见纯气体由耕云资料库补全、
// 钢材等一般原料不需要（与第 3 步包装标签提示同一份名单）；油漆等混合物请向供应商要；其余等专家核实，先不用传。
// 混合物名单是第一版的保守写法，M3 化学品知识库上线后改为查库
const MIXTURES = ['油漆', '涂料', '稀释剂', '天那水', '油墨', '固化剂', '胶水', '清洗剂', '切削液', '脱模剂', '助焊剂'];

export type MsdsNeed = 'knowledge_base' | 'not_needed' | 'supplier' | 'expert';

export function msdsNeedOf(m: DraftMaterial): MsdsNeed | null {
  const hint = msdsHintOf(m);
  if (hint === null || hint === 'knowledge_base' || hint === 'not_needed') return hint;
  return MIXTURES.some((g) => m.name.includes(g)) ? 'supplier' : 'expert';
}
