import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import {
  emptyProductionWorkup,
  hazardSuggestionOf,
  listCounts,
  parseTons,
  planProductionOf,
  productionSaveError,
  productionSaveSchema,
  productionView,
  scopeImpact,
  type Judged,
  type ProductionWorkup,
} from './workup-production.ts';

const stamp = { by: 'u-zhou', byName: '周工', at: '2026-10-29T08:00:00.000Z' };
const judged = <T>(value: T, at = stamp.at): Judged<T> => ({ ...stamp, at, value });
const withWork = (patch: Partial<ProductionWorkup>) => ({ production: { ...emptyProductionWorkup(), ...patch } });
const none = {};

describe('危化品的系统建议', () => {
  it('按《危险化学品目录》给出建议和理由', () => {
    expect(hazardSuggestionOf('酒精')?.value).toBe(true);
    expect(hazardSuggestionOf('酒精')?.reason).toContain('第 2568 号');
    expect(hazardSuggestionOf('天那水（稀释剂）')?.value).toBe(true);
    expect(hazardSuggestionOf('乙炔')?.reason).toContain('易燃气体');
    expect(hazardSuggestionOf('氢氧化钠')?.reason).toContain('腐蚀品');
  });

  it('防误判：乙醇胺是腐蚀品不是酒精，聚苯板不算；钢材等一般原料直接判定不是', () => {
    expect(hazardSuggestionOf('乙醇胺')?.reason).toContain('第 33 号');
    expect(hazardSuggestionOf('乙醇胺')?.reason).not.toContain('易燃液体');
    expect(hazardSuggestionOf('气瓶柜')).toBeUndefined();
    expect(hazardSuggestionOf('聚苯板')).toBeUndefined();
    expect(hazardSuggestionOf('铝锭')).toEqual({ value: false, reason: '一般原料，不是危化品' });
  });

  it('名单里没有的不建议，留给专家判断', () => {
    expect(hazardSuggestionOf('陶瓷灯头')).toBeUndefined();
  });
});

describe('飞宇的整理结果', () => {
  const view = productionView(feiyuSnapshot, none);

  it('列出 8 台设备、5 种物料、1 栋建筑', () => {
    expect(view.equipment).toHaveLength(8);
    expect(view.materials.map((m) => m.name)).toEqual(['锌锭', '铝锭', '陶瓷灯头', '电线', '酒精']);
    expect(view.buildings).toHaveLength(1);
  });

  it('待确认：酒精、陶瓷灯头是否危化品，压力管道判定，厂房耐火等级', () => {
    expect(view.pending.map((p) => p.label)).toEqual([
      '陶瓷灯头是否危化品',
      '酒精是否危化品',
      '压力管道判定',
      '1 号生产厂房耐火等级',
    ]);
    expect(view.required).toBe(5);
    expect(listCounts(view).materials).toEqual({ count: 5, pending: 2 });
    expect(listCounts(view).special).toEqual({ count: 1, pending: 1 });
  });

  it('锌锭、铝锭、电线系统直接判定不是危化品', () => {
    const decided = view.materials.filter((m) => m.hazard.decidedBy === 'system').map((m) => m.name);
    expect(decided).toEqual(['锌锭', '铝锭', '电线']);
  });

  it('灭火器、消火栓归到消防设施；药箱清单客户已填', () => {
    expect(view.fire.supplies.map((s) => s.name)).toEqual(['干粉灭火器', '二氧化碳灭火器', '室内消火栓']);
    expect(view.fire.firePool).toMatchObject({ answer: 'yes', count: 1 });
    expect(view.firstAid.status).toBe('provided');
  });

  it('专家判定完，没有待确认项；判定为没有不需要理由', () => {
    const done = productionView(
      feiyuSnapshot,
      withWork({
        hazardous: { m3: judged(false), m5: judged(true) },
        special: { pressurePipelines: judged({ answer: 'no', items: [] }) },
        fireRatings: { b1: judged('2') },
      }),
    );
    expect(done.pending).toEqual([]);
    expect(done.special.find((s) => s.category === 'pressurePipelines')).toMatchObject({ customer: 'photo', answer: 'no' });
    expect(done.buildings[0]).toMatchObject({ fireRating: '2', ratingBy: 'expert' });
  });
});

describe('专家改行与新增行', () => {
  it('改过的行标专家整理，客户原值不丢；新增行按保存时间排在后面', () => {
    const view = productionView(
      feiyuSnapshot,
      withWork({
        equipment: {
          e8: judged({ name: '空压机', quantity: '1 台', location: '空压机房' }),
          x2: judged({ name: '电动叉车', quantity: '1 台' }, '2026-10-29T09:00:00.000Z'),
          x1: judged({ name: '手动液压车', quantity: '2 台' }, '2026-10-29T08:30:00.000Z'),
        },
      }),
    );
    expect(view.equipment.find((e) => e.id === 'e8')).toMatchObject({ location: '空压机房', source: 'expert', added: false });
    expect(view.equipment.slice(-2).map((e) => e.name)).toEqual(['手动液压车', '电动叉车']);
    expect(productionView(feiyuSnapshot, none).equipment.find((e) => e.id === 'e8')?.location).toBe('公用工程');
  });

  it('新增的物料同样要判断是否危化品', () => {
    const view = productionView(feiyuSnapshot, withWork({ materials: { x1: judged({ kind: 'material', name: '乙炔', maxStorage: '4 瓶' }) } }));
    expect(view.pending.map((p) => p.key)).toContain('material:x1');
  });
});

describe('保存一条判断前的校验', () => {
  const save = (body: unknown) => productionSaveSchema.parse(body);

  it('物料、建筑必须在这份整理里', () => {
    expect(productionSaveError(feiyuSnapshot, none, save({ version: 1, kind: 'hazardous', rowId: 'm5', value: true }))).toBeNull();
    expect(productionSaveError(feiyuSnapshot, none, save({ version: 1, kind: 'hazardous', rowId: 'm99', value: true }))).toBe('没有这一行物料');
    expect(productionSaveError(feiyuSnapshot, none, save({ version: 1, kind: 'fireRating', rowId: 'b9', value: '2' }))).toBe('没有这栋建筑');
  });

  it('特种设备参数按客户填写的格式校验', () => {
    const ok = save({ version: 1, kind: 'special', category: 'pressureVessels', value: { answer: 'yes', items: [{ medium: '压缩空气', maxWorkingPressureMPa: 0.84, volumeM3: 1.25 }] } });
    expect(productionSaveError(feiyuSnapshot, none, ok)).toBeNull();
    const bad = save({ version: 1, kind: 'special', category: 'pressureVessels', value: { answer: 'yes', items: [{ maxWorkingPressureMPa: '很高' }] } });
    expect(productionSaveError(feiyuSnapshot, none, bad)).not.toBeNull();
  });

  it('设备名称不能为空', () => {
    expect(productionSaveSchema.safeParse({ version: 1, kind: 'equipment', rowId: 'x1', value: { name: ' ' } }).success).toBe(false);
  });
});

describe('换算与适用范围预览', () => {
  it('年用量、储存量换成吨；瓶、桶不换', () => {
    expect(parseTons('0.6 t')).toBe(0.6);
    expect(parseTons('200 kg')).toBe(0.2);
    expect(parseTons('1.5吨')).toBe(1.5);
    expect(parseTons('8')).toBe(8);
    expect(parseTons('120 瓶')).toBeUndefined();
  });

  it('飞宇：酒精按建议算可燃液体；专家判定不是危化品后开关跟着关', () => {
    const before = scopeImpact(feiyuSnapshot, productionView(feiyuSnapshot, none), 'materials');
    expect(before.find((s) => s.key === 'flammableLiquid')?.suggestion).toMatchObject({ value: true, reason: '危险化学品「酒精」属于易燃液体，最大储存量合计 50 kg' });
    expect(before.find((s) => s.key === 'chemicalsOver1t')?.suggestion.value).toBe(false);

    const view = productionView(feiyuSnapshot, withWork({ hazardous: { m5: judged(false) } }));
    expect(scopeImpact(feiyuSnapshot, view, 'materials').find((s) => s.key === 'flammableLiquid')?.suggestion.value).toBe(false);
  });

  it('压力管道：拍照待判断时建议打开，专家判定没有后关闭', () => {
    const pipeline = (data: Parameters<typeof productionView>[1]) =>
      scopeImpact(feiyuSnapshot, productionView(feiyuSnapshot, data), 'special').find((s) => s.key === 'pressurePipeline')!.suggestion;
    expect(pipeline(none).value).toBe(true);
    expect(pipeline(withWork({ special: { pressurePipelines: judged({ answer: 'no', items: [] }) } }))).toMatchObject({
      value: false,
      reason: '客户回答没有压力管道',
    });
  });

  it('生成用的数据：数量读出数字，单位保留', () => {
    const { production } = planProductionOf(feiyuSnapshot, productionView(feiyuSnapshot, none));
    expect(production.equipment[0]).toMatchObject({ name: '熔炉', quantity: 4, unit: '台' });
    expect(production.materials.find((m) => m.name === '铝锭')).toMatchObject({ annualUsageTons: 55, maxStorageTons: 1 });
  });
});
