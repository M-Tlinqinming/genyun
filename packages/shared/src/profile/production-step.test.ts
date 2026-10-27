import { describe, expect, it } from 'vitest';
import { feiyuBasicInfo, feiyuProduction } from '../fixtures/feiyu.ts';
import {
  defaultProductionStep,
  equipmentStartReady,
  fileIdsOfProductionStep,
  hasAirCompressor,
  materialsStartReady,
  msdsHintOf,
  pressureVolumeOf,
  productionStepSchema,
  sitesFromBusinessScope,
  specialEquipmentStatus,
  type DraftMaterial,
  type ProductionStep,
} from './production-step.ts';

// 飞宇样例按第 3 步的填法：数量、用量带单位直接写
const feiyu: ProductionStep = productionStepSchema.parse({
  sites: ['workshop', 'warehouse', 'power_room', 'compressor_room'],
  specialEquipment: {
    pressureVessels: { answer: 'yes' },
    boilers: { answer: 'no' },
    pressurePipelines: { answer: 'no' },
    storageTanks: { answer: 'no' },
  },
  equipment: feiyuProduction.equipment.map((e, i) => ({
    id: `e${i}`,
    name: e.name,
    spec: e.spec,
    quantity: `${e.quantity} ${e.unit}`,
    location: e.location,
    condition: e.condition,
  })),
  materials: feiyuProduction.materials.map((m, i) => ({
    id: `m${i}`,
    name: m.name,
    annualUsage: `${m.annualUsageTons} t`,
    maxStorage: `${m.maxStorageTons} t`,
    storageLocation: m.storageLocation,
  })),
  leasesPremises: false,
  ownVehicles: false,
});

const material = (patch: Partial<DraftMaterial>): DraftMaterial => ({
  id: 'm',
  kind: 'material',
  name: '',
  labelPhotoFileIds: [],
  ...patch,
});

describe('企业自填第 3 步 · 场所、设备与物料', () => {
  it('飞宇样例通过规则，设备、原辅材料、特种设备都可以开始编制', () => {
    expect(productionStepSchema.safeParse(feiyu).error?.issues ?? []).toEqual([]);
    expect(equipmentStartReady(feiyu)).toBe(true);
    expect(materialsStartReady(feiyu)).toBe(true);
    expect(specialEquipmentStatus(feiyu.specialEquipment)).toBe('provided');
  });

  it('第一次打开预选常见场所，并按经营范围加上喷涂、焊接', () => {
    expect(defaultProductionStep(feiyuBasicInfo.businessScope).sites).toEqual(['workshop', 'warehouse', 'power_room']);
    expect(sitesFromBusinessScope('金属制品的焊接、喷涂加工')).toEqual(['spraying', 'welding']);
    expect(defaultProductionStep('五金件喷漆、钣金').sites).toEqual([
      'workshop',
      'spraying',
      'welding',
      'warehouse',
      'power_room',
    ]);
  });

  it('空白的一步也能保存，特种设备四类都还没回答', () => {
    const step = productionStepSchema.parse({});
    expect(step.specialEquipment.boilers).toEqual({ items: [], photoFileIds: [] });
    expect(specialEquipmentStatus(step.specialEquipment)).toBeNull();
    expect(equipmentStartReady(step)).toBe(false);
  });

  it('设备要有名称和数量，物料要有名称和最大存放量', () => {
    const step = productionStepSchema.parse({
      equipment: [{ id: 'a', name: '冲床' }],
      materials: [{ id: 'b', name: '油漆', annualUsage: '2 t' }],
    });
    expect(equipmentStartReady(step)).toBe(false);
    expect(materialsStartReady(step)).toBe(false);
    step.equipment[0]!.quantity = '3 台';
    step.materials[0]!.maxStorage = '200 kg';
    expect(equipmentStartReady(step)).toBe(true);
    expect(materialsStartReady(step)).toBe(true);
  });

  it('特种设备：都没有为「没有」，没有「有」但要拍照的交给专家看', () => {
    const answers = (a: ('yes' | 'no' | 'photo')[]) =>
      productionStepSchema.parse({
        specialEquipment: {
          pressureVessels: { answer: a[0] },
          boilers: { answer: a[1] },
          pressurePipelines: { answer: a[2] },
          storageTanks: { answer: a[3] },
        },
      }).specialEquipment;
    expect(specialEquipmentStatus(answers(['no', 'no', 'no', 'no']))).toBe('none');
    expect(specialEquipmentStatus(answers(['photo', 'no', 'no', 'no']))).toBe('photo_for_expert');
    expect(specialEquipmentStatus(answers(['photo', 'yes', 'no', 'no']))).toBe('provided');
  });

  it('切换回答时已填的参数留着', () => {
    const step = productionStepSchema.parse({
      specialEquipment: { pressureVessels: { answer: 'no', items: [{ id: 'v', medium: '压缩空气' }] } },
    });
    expect(step.specialEquipment.pressureVessels.items).toHaveLength(1);
  });

  it('设备里有空压机时提示压力容器', () => {
    expect(hasAirCompressor(feiyu.equipment)).toBe(true);
    expect(hasAirCompressor([{ id: 'x', name: '冲床' }])).toBe(false);
  });

  it('PV 值由系统计算', () => {
    expect(pressureVolumeOf({ maxWorkingPressureMPa: 0.84, volumeM3: 1.25 })).toBe(1.05);
    expect(pressureVolumeOf({ maxWorkingPressureMPa: 0.84 })).toBeUndefined();
  });

  it('包装标签提示：纯气体耕云补全，一般原料不需要，其余拍标签', () => {
    expect(msdsHintOf(material({ name: '氧气瓶', kind: 'cylinder' }))).toBe('knowledge_base');
    expect(msdsHintOf(material({ name: '钢板、型材' }))).toBe('not_needed');
    expect(msdsHintOf(material({ name: '稀释剂' }))).toBe('label_needed');
    expect(msdsHintOf(material({ name: '油漆', labelPhotoFileIds: ['f'] }))).toBe('label_done');
    expect(msdsHintOf(material({ name: '  ' }))).toBeNull();
  });

  it('列出步骤里引用的文件，供保存时核对', () => {
    const a = '0b1e7c4e-8a33-4b8e-9f43-3a3c6e2a0001';
    const b = '0b1e7c4e-8a33-4b8e-9f43-3a3c6e2a0002';
    const step = productionStepSchema.parse({
      specialEquipment: { pressureVessels: { answer: 'photo', photoFileIds: [a] } },
      materials: [{ id: 'm', name: '油漆', labelPhotoFileIds: [b, a] }],
      ledgers: { equipment: [b] },
    });
    expect(fileIdsOfProductionStep(step).sort()).toEqual([a, b]);
  });

  it('文件 ID 格式不对、行数超限时不保存', () => {
    expect(productionStepSchema.safeParse({ ledgers: { equipment: ['not-a-file'] } }).success).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => ({ id: `e${i}`, name: '冲床' }));
    expect(productionStepSchema.safeParse({ equipment: many }).success).toBe(false);
  });
});
