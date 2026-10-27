// 企业自填第 3 步「生产情况」第 1 页：场所、特种设备、设备与原辅材料、两个业务问题（Paper 12 页 S03a）。
// 第 2 页工艺流程（S03b）在第 7b 项加到同一块里。
// 边填边保存，数量、用量按客户习惯写（如「6 台」「200 kg」），交付前由注册安全工程师按 productionSchema 整理。
// 是否危化品、是否属于压力容器等专业判断不在这里，由专家完成。
import { z } from 'zod';

const id = z.string().min(1).max(40);
const text = (max: number, label: string) => z.string().trim().max(max, `${label}最多 ${max} 个字`).optional();
const fileIds = z.array(z.uuid()).max(20, '每处最多 20 个文件').default([]);
const amount = z.number().min(0).max(1_000_000).optional();

// 场所按设计稿顺序排列
export const SITE_TYPES = {
  workshop: '生产车间',
  spraying: '喷涂',
  welding: '焊接 / 切割',
  warehouse: '仓库',
  power_room: '配电房',
  hazmat_store: '危化品仓库',
  compressor_room: '空压机房',
  boiler_room: '锅炉房',
  confined_space: '有限空间（污水池、罐体等）',
  canteen: '食堂',
  dormitory: '员工宿舍',
} as const;
export type SiteType = keyof typeof SITE_TYPES;
const SITE_KEYS = Object.keys(SITE_TYPES) as [SiteType, ...SiteType[]];

// 几乎每家工厂都有，第一次打开时直接勾上
const COMMON_SITES: SiteType[] = ['workshop', 'warehouse', 'power_room'];

// 经营范围里出现这些词就预选对应场所（客户确认，专家审核时再核对）
const SCOPE_KEYWORDS: [SiteType, string[]][] = [
  ['spraying', ['喷涂', '喷漆', '涂装', '喷塑', '喷粉']],
  ['welding', ['焊接', '切割', '钣金', '激光切']],
  ['boiler_room', ['锅炉']],
  ['canteen', ['餐饮', '食堂']],
];

export function sitesFromBusinessScope(scope: string | undefined): SiteType[] {
  if (!scope) return [];
  return SCOPE_KEYWORDS.filter(([, words]) => words.some((w) => scope.includes(w))).map(([site]) => site);
}

// 特种设备每类先答有 / 没有 / 拍照给耕云看；切换回答时已填的参数和照片都留着，不丢
export const SPECIAL_ANSWERS = ['yes', 'no', 'photo'] as const;
export type SpecialAnswer = (typeof SPECIAL_ANSWERS)[number];

export const draftPressureVesselSchema = z.object({
  id,
  medium: text(30, '介质'),
  maxWorkingPressureMPa: amount,
  volumeM3: amount,
});
export const BOILER_TYPES = { steam: '蒸汽锅炉', hot_water: '热水锅炉', thermal_oil: '有机热载体锅炉' } as const;
export const draftBoilerSchema = z.object({
  id,
  type: z.enum(Object.keys(BOILER_TYPES) as [keyof typeof BOILER_TYPES]).optional(),
  // 如「2 t/h，1.25 MPa」
  ratedParams: text(50, '额定参数'),
});
export const draftPipelineSchema = z.object({
  id,
  medium: text(30, '介质'),
  nominalDiameter: text(20, '公称直径'),
});
export const draftTankSchema = z.object({
  id,
  substance: text(30, '储存物'),
  capacity: text(20, '储存量'),
});

const category = <T extends z.ZodType>(row: T) =>
  z.object({
    answer: z.enum(SPECIAL_ANSWERS).optional(),
    items: z.array(row).max(20, '每类最多 20 台').default([]),
    // 铭牌照片（选「有」时代替参数）或给耕云看的照片
    photoFileIds: fileIds,
  });

export const SPECIAL_CATEGORIES = {
  pressureVessels: { label: '压力容器', schema: category(draftPressureVesselSchema) },
  boilers: { label: '锅炉（蒸汽 / 热水 / 有机热载体）', schema: category(draftBoilerSchema) },
  pressurePipelines: { label: '压力管道（蒸汽、燃气、压缩空气主管）', schema: category(draftPipelineSchema) },
  storageTanks: { label: '储罐 / 油库', schema: category(draftTankSchema) },
} as const;
export type SpecialCategory = keyof typeof SPECIAL_CATEGORIES;
export const SPECIAL_CATEGORY_KEYS = Object.keys(SPECIAL_CATEGORIES) as SpecialCategory[];

export const EQUIPMENT_CONDITION_OPTIONS = ['正常', '停用', '维修中'] as const;

export const draftEquipmentSchema = z.object({
  id,
  name: z.string().trim().max(50, '设备名称最多 50 个字').default(''),
  spec: text(50, '规格型号'),
  // 如「6 台」「1 间」
  quantity: text(20, '数量'),
  location: text(50, '使用部门 / 地点'),
  // 可选常用值，也可直接写（如「运行 4 台」）
  condition: text(20, '使用状况'),
});
export type DraftEquipment = z.infer<typeof draftEquipmentSchema>;

export const draftMaterialSchema = z.object({
  id,
  // cylinder = 气瓶，名称旁显示规格
  kind: z.enum(['material', 'cylinder']).default('material'),
  name: z.string().trim().max(50, '物料名称最多 50 个字').default(''),
  // 如「40L」
  cylinderSpec: text(20, '气瓶规格'),
  annualUsage: text(20, '年用量'),
  maxStorage: text(20, '最大存放量'),
  storageLocation: text(50, '存放位置'),
  labelPhotoFileIds: fileIds,
});
export type DraftMaterial = z.infer<typeof draftMaterialSchema>;

export const productionStepSchema = z.object({
  sites: z.array(z.enum(SITE_KEYS)).default([]),
  customSites: z.array(z.string().trim().min(1).max(20, '场所名称最多 20 个字')).max(10, '其他场所最多 10 个').default([]),
  specialEquipment: z.object({
    pressureVessels: SPECIAL_CATEGORIES.pressureVessels.schema.prefault({}),
    boilers: SPECIAL_CATEGORIES.boilers.schema.prefault({}),
    pressurePipelines: SPECIAL_CATEGORIES.pressurePipelines.schema.prefault({}),
    storageTanks: SPECIAL_CATEGORIES.storageTanks.schema.prefault({}),
  }).prefault({}),
  equipment: z.array(draftEquipmentSchema).max(200, '设备最多 200 行，更多请上传台账').default([]),
  materials: z.array(draftMaterialSchema).max(200, '物料最多 200 行，更多请上传台账').default([]),
  // 上传的设备台账、原辅材料台账（同时挂在任务对应的资料项上）
  ledgers: z.object({ equipment: fileIds, materials: fileIds }).prefault({}),
  leasesPremises: z.boolean().optional(),
  ownVehicles: z.boolean().optional(),
});
export type ProductionStep = z.infer<typeof productionStepSchema>;
export type SpecialEquipmentDraft = ProductionStep['specialEquipment'];

export const productionStepSaveSchema = z.object({
  version: z.number().int().min(1),
  step: productionStepSchema,
});
export type ProductionStepSave = z.infer<typeof productionStepSaveSchema>;

// 第一次打开时的内容：常见场所 + 按经营范围预选的场所
export function defaultProductionStep(businessScope: string | undefined): ProductionStep {
  const fromScope = sitesFromBusinessScope(businessScope);
  return productionStepSchema.parse({
    sites: SITE_KEYS.filter((s) => COMMON_SITES.includes(s) || fromScope.includes(s)),
  });
}

// 步骤里引用的所有文件（保存时核对都是本组织上传的）
export function fileIdsOfProductionStep(step: ProductionStep): string[] {
  const ids = [
    ...SPECIAL_CATEGORY_KEYS.flatMap((k) => step.specialEquipment[k].photoFileIds),
    ...step.materials.flatMap((m) => m.labelPhotoFileIds),
    ...step.ledgers.equipment,
    ...step.ledgers.materials,
  ];
  return [...new Set(ids)];
}

const filled = (v: string | undefined) => Boolean(v && v.trim() !== '');

// 设备里有空压机，一般带储气罐（压力容器），页面据此预选「有」
export function hasAirCompressor(equipment: DraftEquipment[]): boolean {
  return equipment.some((e) => e.name.includes('空压机') || e.name.includes('空气压缩机'));
}

// PV 值（MPa·m³）由系统计算
export function pressureVolumeOf(v: { maxWorkingPressureMPa?: number; volumeM3?: number }): number | undefined {
  if (v.maxWorkingPressureMPa === undefined || v.volumeM3 === undefined) return undefined;
  return Math.round(v.maxWorkingPressureMPa * v.volumeM3 * 1000) / 1000;
}

// 「生产设备设施」开始编制只要求主要设备名称与数量
export function equipmentStartReady(step: ProductionStep): boolean {
  return step.equipment.some((e) => filled(e.name) && filled(e.quantity));
}

// 「原辅材料贮存量」开始编制只要求名称与最大储存量
export function materialsStartReady(step: ProductionStep): boolean {
  return step.materials.some((m) => filled(m.name) && filled(m.maxStorage));
}

// 「特种设备与储存设施」四类都回答了才有结论：有一类「有」即已提供；
// 没有「有」但有要拍照的，交给专家看；四类都「没有」就是没有
export function specialEquipmentStatus(s: SpecialEquipmentDraft): 'provided' | 'photo_for_expert' | 'none' | null {
  const answers = SPECIAL_CATEGORY_KEYS.map((k) => s[k].answer);
  if (answers.some((a) => a === undefined)) return null;
  if (answers.includes('yes')) return 'provided';
  if (answers.includes('photo')) return 'photo_for_expert';
  return 'none';
}

// 包装标签 / MSDS 一栏给客户的提示。是否危化品由专家判断，这里只说要不要拍标签：
// 常见纯气体由耕云资料库补全；钢材等一般原料不需要；其余请拍包装标签。
// 名单是第一版的保守写法，M3 化学品知识库上线后改为查库
const PURE_GASES = ['氧气', '氮气', '氩气', '氦气', '氢气', '二氧化碳', '乙炔', '丙烷'];
const GENERAL_MATERIALS = [
  '钢板', '钢材', '型材', '钢管', '铝材', '铝板', '铝锭', '锌锭', '铜材', '铜线', '铁皮',
  '木材', '板材', '纸箱', '纸板', '包装材料', '塑料粒子', '胶粒', '电线', '螺丝', '五金配件',
];

export type MsdsHint = 'knowledge_base' | 'not_needed' | 'label_done' | 'label_needed';

export function msdsHintOf(m: DraftMaterial): MsdsHint | null {
  const name = m.name.trim();
  if (!name) return null;
  if (PURE_GASES.some((g) => name.includes(g))) return 'knowledge_base';
  if (GENERAL_MATERIALS.some((g) => name.includes(g))) return 'not_needed';
  return m.labelPhotoFileIds.length > 0 ? 'label_done' : 'label_needed';
}

// 存在企业资料里的第 3 步内容
export interface ProductionStepStored {
  step: ProductionStep;
}
