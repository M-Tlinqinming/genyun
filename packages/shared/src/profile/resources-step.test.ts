import { describe, expect, it } from 'vitest';
import { feiyuProduction } from '../fixtures/feiyu.ts';
import {
  buildingsForSites,
  buildingsReady,
  defaultResourcesStep,
  fileIdsOfResourcesStep,
  firePoolStatus,
  firstAidKitStatus,
  msdsNeedOf,
  neighborsReady,
  resourcesStepSchema,
  SUPPLY_CATALOG,
  suppliesStartReady,
  supplyFromCatalog,
  supplyKeysForSites,
  totalBuildingArea,
  type ResourcesStep,
} from './resources-step.ts';

const FILE = '7d3f0c1e-2b4a-4c6d-8e9f-0a1b2c3d4e5f';
const material = (name: string) => ({ id: name, kind: 'material' as const, name, labelPhotoFileIds: [] });

// 飞宇样例按第 4 步的填法
const feiyu: ResourcesStep = resourcesStepSchema.parse({
  supplies: feiyuProduction.emergencySupplies.map((s, i) => ({
    id: `r${i}`,
    name: s.name,
    unit: s.unit,
    quantity: s.quantity,
    location: s.location,
  })),
  custodianId: 'p20',
  firstAidKit: { answer: 'yes', mode: 'manual', items: [{ id: 'k1', name: '急救箱(综合配置)', quantity: 2, unit: '箱' }] },
  firePool: { answer: 'yes', count: 1, volumeM3: 200 },
  buildings: feiyuProduction.buildings.map((b, i) => ({
    id: `b${i}`,
    name: b.name,
    floors: b.floors,
    areaM2: b.floorAreaM2,
  })),
  neighbors: { answer: 'none' },
});

describe('第 4 步 应急资源与图纸', () => {
  it('飞宇样例：物资、药箱、水池、建筑、相邻企业都能得出结论', () => {
    expect(suppliesStartReady(feiyu)).toBe(true);
    expect(firstAidKitStatus(feiyu.firstAidKit)).toBe('provided');
    expect(firePoolStatus(feiyu.firePool)).toBe('provided');
    expect(buildingsReady(feiyu)).toBe(true);
    expect(totalBuildingArea(feiyu.buildings)).toBe(2400);
    expect(neighborsReady(feiyu.neighbors)).toBe(true);
    // 耐火等级没填就是「专家判断」
    expect(feiyu.buildings[0]!.fireRating).toBe('expert');
  });

  it('第一次打开：常见的 4 项物资勾上但没有数量，不算已提供；建筑按场所列出', () => {
    const step = defaultResourcesStep(['workshop', 'warehouse', 'power_room', 'dormitory']);
    expect(step.supplies.map((s) => s.name)).toEqual([
      '手提式干粉灭火器',
      '室内消火栓',
      '应急照明灯',
      '疏散指示 / 安全出口标志',
    ]);
    expect(suppliesStartReady(step)).toBe(false);
    expect(step.buildings.map((b) => b.name)).toEqual(['生产车间', '仓库', '员工宿舍']);
    expect(buildingsReady(step)).toBe(false);
    expect(step.firstAidKit.items).toHaveLength(7);
    expect(firstAidKitStatus(step.firstAidKit)).toBeNull();
  });

  it('物资清单共 20 项，勾了配电房的把绝缘手套等排在不相关的前面', () => {
    expect(Object.keys(SUPPLY_CATALOG)).toHaveLength(20);
    const order = supplyKeysForSites(['power_room']);
    expect(order).toHaveLength(20);
    expect(order.indexOf('insulated_gloves')).toBeLessThan(order.indexOf('safety_rope'));
    expect(order.indexOf('co2_ext')).toBeLessThan(order.indexOf('eyewash'));
    // 常见的永远在最前
    expect(order.slice(0, 4)).toEqual(['fire_ext_portable', 'hydrant_indoor', 'emergency_light', 'exit_sign']);
  });

  it('物资填了数量才算已提供，数量为 0 不算', () => {
    const s = supplyFromCatalog('fire_ext_portable');
    expect(suppliesStartReady({ ...feiyu, supplies: [{ ...s, quantity: 0 }] })).toBe(false);
    expect(suppliesStartReady({ ...feiyu, supplies: [{ ...s, quantity: 50 }] })).toBe(true);
  });

  it('急救药箱：没有 / 常规配置 / 拍照交给专家 / 逐项填', () => {
    const kit = (k: Partial<ResourcesStep['firstAidKit']>) => ({ ...feiyu.firstAidKit, ...k });
    expect(firstAidKitStatus(kit({ answer: 'no' }))).toBe('none');
    expect(firstAidKitStatus(kit({ answer: undefined }))).toBeNull();
    expect(firstAidKitStatus(kit({ mode: 'photo', photoFileIds: [] }))).toBeNull();
    expect(firstAidKitStatus(kit({ mode: 'photo', photoFileIds: [FILE] }))).toBe('photo_for_expert');
    expect(firstAidKitStatus(kit({ mode: 'manual', items: [{ id: 'k', name: ' ' }] }))).toBeNull();
    expect(firstAidKitStatus(defaultResourcesStep([]).firstAidKit)).toBeNull();
    expect(firstAidKitStatus({ ...defaultResourcesStep([]).firstAidKit, answer: 'yes' })).toBe('provided');
  });

  it('消防水池：有并填数量即已提供，容积可稍后补；没有就是没有', () => {
    expect(firePoolStatus({ answer: 'yes', count: 1, volumeLater: true })).toBe('provided');
    expect(firePoolStatus({ answer: 'yes', volumeLater: false })).toBeNull();
    expect(firePoolStatus({ answer: 'no', volumeLater: false })).toBe('none');
  });

  it('建筑面积合计到两位小数（设计稿示例 23104.30）', () => {
    const rows = [20079.92, 1864.05, 1160.33].map((areaM2, i) => ({ id: `b${i}`, name: 'x', fireRating: 'expert' as const, areaM2 }));
    expect(totalBuildingArea(rows)).toBe(23104.3);
    expect(totalBuildingArea([])).toBe(0);
    expect(buildingsForSites(['canteen', 'compressor_room']).map((b) => b.name)).toEqual(['食堂']);
  });

  it('相邻企业：填了一家或明确没有即可，不清楚的等专家问', () => {
    expect(neighborsReady({ answer: 'unknown', items: [] })).toBe(false);
    expect(neighborsReady({ answer: 'has', items: [{ id: 'n', name: '' }] })).toBe(false);
    expect(neighborsReady({ answer: 'has', items: [{ id: 'n', name: '惠州某电子有限公司', contact: '0752-1234567' }] })).toBe(true);
  });

  it('MSDS 提示：纯气体耕云补全，一般原料不需要，混合物找供应商，其余等专家核实', () => {
    expect(msdsNeedOf(material('氧气'))).toBe('knowledge_base');
    expect(msdsNeedOf(material('钢板、型材'))).toBe('not_needed');
    expect(msdsNeedOf(material('油漆'))).toBe('supplier');
    expect(msdsNeedOf(material('稀释剂'))).toBe('supplier');
    expect(msdsNeedOf(material('酒精'))).toBe('expert');
    expect(msdsNeedOf(material(''))).toBeNull();
  });

  it('引用的文件去重后列出，便于后台核对归属', () => {
    const step = resourcesStepSchema.parse({
      supplyLedgerFileIds: [FILE],
      drawings: { site_plan: [FILE], evacuation_plan: [], fire_facility_plan: [] },
      msds: { m1: { fileIds: [FILE] } },
    });
    expect(fileIdsOfResourcesStep(step)).toEqual([FILE]);
  });

  it('格式不对的拒绝保存：数量不能为负，文件必须是 ID', () => {
    expect(resourcesStepSchema.safeParse({ supplies: [{ id: 'r', name: '灭火器', quantity: -1 }] }).success).toBe(false);
    expect(resourcesStepSchema.safeParse({ drawings: { site_plan: ['abc'] } }).success).toBe(false);
  });
});
