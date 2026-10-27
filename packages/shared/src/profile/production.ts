// 生产现场（旧仓库 E4）。字段按 TECH-PLAN 3.5 扩展。
// 专业判断（是否危化品、是否属于压力容器 / 压力管道、耐火等级）不在这里，只存在专家侧。
import { z } from 'zod';

const text = z.string().trim().optional();
const amount = z.coerce.number().min(0).optional();
const fileIds = z.array(z.string()).default([]);

export const buildingSchema = z.object({
  name: z.string().trim().min(1, '请填写建筑名称'),
  floors: z.coerce.number().int().min(1).optional(),
  floorAreaM2: amount,
  remarks: text,
});

export const EQUIPMENT_CONDITIONS = ['正常', '异常', '停用', '其它'] as const;

export const equipmentSchema = z.object({
  name: z.string().trim().min(1, '请填写设备名称'),
  spec: text,
  quantity: z.coerce.number().int().min(0).optional(),
  unit: z.string().default('台'),
  department: z.string().default('车间'),
  location: z.string().default('车间'),
  condition: z.enum(EQUIPMENT_CONDITIONS).default('正常'),
});

// 特种设备：每类先回答有 / 没有 / 拍照给耕云看，选「有」才填参数；铭牌照片作为原件
const specialCategory = <T extends z.ZodType>(row: T) =>
  z.discriminatedUnion('answer', [
    z.object({ answer: z.literal('yes'), items: z.array(row).default([]), nameplateFileIds: fileIds }),
    z.object({ answer: z.literal('no') }),
    z.object({ answer: z.literal('photo'), nameplateFileIds: fileIds }),
  ]);

export const pressureVesselSchema = z.object({
  medium: text,
  maxWorkingPressureMPa: amount,
  volumeM3: amount,
});

export const boilerSchema = z.object({
  type: z.enum(['steam', 'hot_water']).optional(),
  // 蒸汽锅炉
  ratedPressureMPa: amount,
  evaporationTph: amount,
  // 热水锅炉
  outletTempC: amount,
  powerMW: amount,
});

export const pressurePipelineSchema = z.object({ nominalDiameterMm: amount });

export const storageTankSchema = z.object({ substance: text, capacityTons: amount });

export const specialEquipmentSchema = z.object({
  pressureVessels: specialCategory(pressureVesselSchema).optional(),
  boilers: specialCategory(boilerSchema).optional(),
  pressurePipelines: specialCategory(pressurePipelineSchema).optional(),
  storageTanks: specialCategory(storageTankSchema).optional(),
});
export type SpecialEquipment = z.infer<typeof specialEquipmentSchema>;

// PV 值（MPa·m³）由系统计算，不让客户填
export function pressureVolume(v: z.infer<typeof pressureVesselSchema>): number | undefined {
  if (v.maxWorkingPressureMPa === undefined || v.volumeM3 === undefined) return undefined;
  return Math.round(v.maxWorkingPressureMPa * v.volumeM3 * 1000) / 1000;
}

// not_needed = 不需要（非危化品）；pending_upload = 待上传；knowledge_base = 耕云资料库补全
export const MSDS_STATES = ['not_needed', 'pending_upload', 'knowledge_base'] as const;

export const materialSchema = z.object({
  name: z.string().trim().min(1, '请填写物料名称'),
  casNumber: text,
  annualUsageTons: amount,
  maxStorageTons: amount,
  storageLocation: text,
  // 如「氧气 40L × 6 瓶」
  cylinderSpec: text,
  labelPhotoFileIds: fileIds,
  msds: z.enum(MSDS_STATES).optional(),
  msdsFileIds: fileIds,
});

export const processStepSchema = z.object({
  name: z.string().trim().min(1, '请填写工序名称'),
  equipment: z.array(z.string()).default([]),
  inputs: z.array(z.string()).default([]),
  // 去向：下一道 / 返工 / 回用
  next: z.enum(['next', 'rework', 'reuse']).default('next'),
});

export const processFlowSchema = z.object({
  // 三选一：一句话 / 草图照片 / 行业模板
  source: z.enum(['text', 'sketch', 'template']).optional(),
  description: text,
  sketchFileIds: fileIds,
  templateId: text,
  steps: z.array(processStepSchema).default([]),
});

export const supplySchema = z.object({
  name: z.string().trim().min(1, '请填写物资名称'),
  model: text,
  quantity: z.coerce.number().int().min(0).optional(),
  unit: text,
  location: text,
  // 引用应急组织里的人员 id，电话随人员带出
  custodianId: text,
});

export const firstAidItemSchema = z.object({
  name: z.string().trim().min(1, '请填写药品名称'),
  quantity: z.coerce.number().int().min(0).optional(),
  unit: text,
});

export const productionSchema = z.object({
  buildings: z.array(buildingSchema).default([]),
  equipment: z.array(equipmentSchema).default([]),
  specialEquipment: specialEquipmentSchema.default({}),
  materials: z.array(materialSchema).default([]),
  processFlow: processFlowSchema.prefault({}),
  emergencySupplies: z.array(supplySchema).default([]),
  firstAidKit: z
    .discriminatedUnion('answer', [
      z.object({ answer: z.literal('yes'), items: z.array(firstAidItemSchema).default([]) }),
      z.object({ answer: z.literal('no') }),
      z.object({ answer: z.literal('photo'), photoFileIds: fileIds }),
    ])
    .optional(),
  firePool: z
    .discriminatedUnion('answer', [
      z.object({
        answer: z.literal('yes'),
        count: z.coerce.number().int().min(1).optional(),
        volumeM3: amount,
      }),
      z.object({ answer: z.literal('no') }),
    ])
    .optional(),
  hasEmergencyPool: z.boolean().optional(),
});
export type Production = z.infer<typeof productionSchema>;

export function totalFloorArea(p: Pick<Production, 'buildings'>): number {
  return p.buildings.reduce((sum, b) => sum + (b.floorAreaM2 ?? 0), 0);
}
