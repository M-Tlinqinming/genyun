import { describe, expect, it } from 'vitest';
import { feiyuPlanInput } from '../fixtures/feiyu-plan.ts';
import { PLAN_TEMPLATES, accidentTypeOf, selectPlans } from './catalog.ts';
import { localAgenciesOf } from './agencies.ts';
import type { PlanInput } from './input.ts';
import { riskLevel, riskScore } from './input.ts';
import { hazardousMaterialsOf, resolveScope, suggestScope } from './scope.ts';
import { planSignals } from './signals.ts';

const ids = (input: PlanInput) => {
  const s = selectPlans(resolveScope(input));
  return { specialty: s.specialty.map((t) => t.id), site: s.site.map((t) => t.id) };
};

const withProduction = (patch: Partial<PlanInput['production']>, rest: Partial<PlanInput> = {}): PlanInput => ({
  ...feiyuPlanInput,
  ...rest,
  production: { ...feiyuPlanInput.production, ...patch },
});

describe('适用范围', () => {
  it('飞宇按新资料格式推出的预案组成与旧系统一致', () => {
    // 旧仓库 fixtures/feiyu-canonical.golden.md：专项 2 份、现场处置方案 14 份
    expect(ids(feiyuPlanInput)).toEqual({
      specialty: ['P1', 'P2'],
      site: ['SP01', 'SP02', 'SP03', 'SP04', 'SP05', 'SP06', 'SP07', 'SP10', 'SP11', 'SP12', 'SP17', 'SP20', 'SP21', 'SP22'],
    });
  });

  it('每个开关都给出业务语言的依据', () => {
    const s = suggestScope(feiyuPlanInput);
    expect(s.pressureVessel).toMatchObject({ value: true, reason: '客户回答有压力容器' });
    expect(s.waterHazard.reason).toBe('客户回答有消防水池');
    expect(s.chemicalsOver1t).toMatchObject({ value: false, reason: '危险化学品年用量合计 0.2 吨，不到 1 吨' });
    for (const v of Object.values(s)) expect(v.reason).not.toMatch(/[A-Z]{2,}\d|E\d|SP\d|true|false/);
  });

  it('专家改过的开关以专家为准', () => {
    const input = { ...feiyuPlanInput, expert: { ...feiyuPlanInput.expert, scope: { waterHazard: false, internalVehicle: false } } };
    expect(ids(input).site).not.toContain('SP17');
    expect(ids(input).site).not.toContain('SP07');
  });

  it('出租厂房、自备车辆、有限空间、锅炉按客户回答开启', () => {
    const input = withProduction(
      { specialEquipment: { ...feiyuPlanInput.production.specialEquipment, pressureVessels: { answer: 'no' }, boilers: { answer: 'yes', items: [], nameplateFileIds: [] } } },
      { business: { sites: ['workshop', 'confined_space'], leasesPremises: true, ownVehicles: true } },
    );
    const s = suggestScope(input);
    expect(s.pressureVessel).toMatchObject({ value: true, reason: '客户回答有锅炉' });
    expect(ids(input).specialty).toEqual(expect.arrayContaining(['P4', 'P6']));
    expect(ids(input).site).toContain('SP16');
  });

  it('危化品年用量超过 1 吨才生成泄漏专项预案；没判定前按名称建议', () => {
    const materials = [...feiyuPlanInput.production.materials, { name: '天那水', annualUsageTons: 2, labelPhotoFileIds: [], msdsFileIds: [] }];
    const input: PlanInput = { ...withProduction({ materials }), expert: { ...feiyuPlanInput.expert, hazardousMaterials: undefined } };
    expect(hazardousMaterialsOf(input)).toEqual(['酒精', '天那水']);
    expect(ids(input).specialty).toContain('P3');
    expect(ids(input).site).toEqual(expect.arrayContaining(['SP09']));
  });

  it('7 层以上建筑生成人员疏散专项预案', () => {
    const input = withProduction({ buildings: [{ name: '综合楼', floors: 8 }] });
    expect(suggestScope(input).highRise.reason).toBe('「综合楼」有 8 层');
    expect(ids(input).specialty).toContain('P5');
  });

  it('事故类别从标题取', () => {
    expect(accidentTypeOf('火灾爆炸事故专项应急预案')).toBe('火灾爆炸');
    expect(accidentTypeOf('有限空间专项应急预案')).toBe('有限空间');
    expect(accidentTypeOf('起重致害（电梯）事故现场处置方案')).toBe('起重致害（电梯）');
    expect(new Set(PLAN_TEMPLATES.map((t) => t.id)).size).toBe(28);
  });
});

describe('现场处置方案的具体内容', () => {
  it('飞宇：铝锌压铸、喷砂抛光 CNC 产尘、酒精、空压机', () => {
    const s = planSignals(feiyuPlanInput);
    expect(s.meltTypes).toEqual(['铝液', '锌液']);
    expect(s.furnaceEquip).toEqual(['熔炉', '锌压铸机', '铝压铸机']);
    expect(s.metalDustTypes).toEqual(['铝粉', '锌粉']);
    expect(s.dustWorkstations).toEqual(['喷砂', '抛光', 'CNC加工']);
    expect(s.flammableLiquids).toEqual(['酒精']);
    expect(s.liquidStorage).toBe('化学品柜（小量瓶装）');
    expect(s.pressureVessels).toEqual(['空压机（压缩空气压力容器）']);
    expect(s.dangerMachines).toHaveLength(3);
    expect(s.boiler).toBe(false);
  });

  it('不误判：钢砂不是钢水，铝梯不是铝粉，乙醇胺不是酒精，气瓶柜不是压力容器', () => {
    const input = withProduction({
      equipment: [{ name: '气瓶柜', unit: '台', department: '车间', location: '车间', condition: '正常' }],
      materials: [
        { name: '钢砂', labelPhotoFileIds: [], msdsFileIds: [] },
        { name: '铝梯', labelPhotoFileIds: [], msdsFileIds: [] },
        { name: '乙醇胺', labelPhotoFileIds: [], msdsFileIds: [] },
      ],
    });
    const s = planSignals({ ...input, expert: { ...input.expert, hazardousMaterials: ['乙醇胺'] } });
    expect(s.meltTypes).toEqual([]);
    expect(s.metalDustTypes).toEqual([]);
    expect(s.flammableLiquids).toEqual([]);
    expect(s.pressureVessels).toEqual([]);
  });
});

describe('属地机构与风险等级', () => {
  it('飞宇地址带出仲恺应急管理局与陈江街道；未收录的地区为空', () => {
    expect(feiyuPlanInput.agencies.streetOffice?.name).toBe('陈江街道应急办');
    expect(localAgenciesOf({ province: '广东省', city: '深圳市', district: '南山区', detail: '' })).toEqual({});
  });

  it('D = L × E × C 定等级', () => {
    expect(riskScore({ l: 1, e: 6, c: 7 })).toBe(42);
    expect(riskLevel(42)).toBe('一般危险');
    expect(riskLevel(riskScore({ l: 0.5, e: 3, c: 7 }))).toBe('稍有危险');
    expect(riskLevel(riskScore({ l: 3, e: 6, c: 15 }))).toBe('高度危险');
    expect(riskScore({ l: 1, e: 6 })).toBeUndefined();
  });
});
