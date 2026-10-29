import { describe, expect, it } from 'vitest';
import { feiyuBasicInfo, feiyuChecklist, feiyuOrganization, feiyuProduction } from '../fixtures/feiyu.ts';
import type { BasicStepStored } from './basic-step.ts';
import { organizationStepSchema, type OrganizationStep } from './organization-step.ts';
import { productionStepSchema, type ProductionStep } from './production-step.ts';
import { resourcesStepSchema, type ResourcesStep } from './resources-step.ts';
import { reviewOf, type ReviewInput } from './review-step.ts';

const FILE = '7d3f0c1e-2b4a-4c6d-8e9f-0a1b2c3d4e5f';
const none = { items: [], photoFileIds: [] };

const { companyName, socialCreditCode, legalRepresentative, registeredAddress, ...basic } = feiyuBasicInfo;
const basicStep: BasicStepStored = { basic: { ...basic, industry: '38', email: 'safety@feiyu.example', landAreaM2: 5000 }, later: [], sources: {} };

const organization: OrganizationStep = organizationStepSchema.parse({
  commander: feiyuOrganization.commander,
  deputies: feiyuOrganization.deputies,
  groups: feiyuOrganization.groups.map((g, i) => ({ ...g, id: `g${i}` })),
  dutyPhone: '0752-3324567',
});

const production: ProductionStep = productionStepSchema.parse({
  sites: ['workshop', 'warehouse', 'power_room', 'compressor_room'],
  specialEquipment: {
    pressureVessels: { answer: 'yes' },
    boilers: { answer: 'no' },
    pressurePipelines: { answer: 'no' },
    storageTanks: { answer: 'no' },
  },
  equipment: feiyuProduction.equipment.map((e, i) => ({ id: `e${i}`, name: e.name, quantity: `${e.quantity} ${e.unit}` })),
  materials: [
    { id: 'm1', name: '锌锭', annualUsage: '8 t', maxStorage: '0.3 t' },
    { id: 'm2', name: '铝锭', annualUsage: '55 t', maxStorage: '1 t' },
  ],
  process: { steps: ['熔融', '压铸', '攻牙'].map((name, i) => ({ id: `s${i}`, name })) },
  leasesPremises: false,
});

const resources: ResourcesStep = resourcesStepSchema.parse({
  supplies: [{ id: 'r1', name: '干粉灭火器', quantity: 30, unit: '具' }],
  custodianId: 'p20',
  firstAidKit: { answer: 'yes', mode: 'standard', items: [{ id: 'k1', name: '纱布绷带', quantity: 2 }] },
  firePool: { answer: 'yes', count: 1, volumeM3: 200 },
  buildings: [{ id: 'b1', name: '1 号生产厂房', floors: 1, areaM2: 2400, fireRating: '2' }],
  drawings: { site_plan: [FILE], evacuation_plan: [FILE], fire_facility_plan: [FILE] },
  neighbors: { answer: 'none' },
});

const feiyu: ReviewInput = {
  enterpriseName: companyName,
  basicStep,
  organization,
  production,
  resources,
  checklist: feiyuChecklist,
};

describe('企业自填第 5 步 · 核对', () => {
  it('飞宇样例：四步都有概括，可以提交，没有稍后补', () => {
    const review = reviewOf(feiyu);
    expect(review.canSubmit).toBe(true);
    expect(review.steps.map((s) => s.missing)).toEqual([[], [], [], []]);
    expect(review.steps[0]!.facts).toEqual(['惠阳飞宇电器有限公司', '电气机械和器材制造业', '86 人', '联系人 李文聪']);
    expect(review.steps[1]!.facts).toEqual(['总指挥', '副总指挥', '应急小组 3 个', '值班电话', '编制小组已生成']);
    expect(review.steps[2]!.facts).toEqual(['4 个场所', '压力容器', '8 种设备', '2 种物料', '3 道工序']);
    expect(review.steps[3]!.facts).toEqual(['1 项应急物资', '常规药箱', '1 栋建筑', '总平面图、疏散图、消防设施图已上传']);
    expect(review.laterCount).toBe(0);
    expect(review.suggestOnSiteVisit).toBe(false);
    expect(review.expert).toEqual(['压力容器的类别与检验要求（按铭牌）']);
  });

  it('必需资料没给时按步骤列出，不能提交', () => {
    const review = reviewOf({ ...feiyu, checklist: {} });
    expect(review.canSubmit).toBe(false);
    expect(review.steps[0]!.missing).toEqual(['营业执照', '企业基本情况']);
    expect(review.steps[3]!.missing).toEqual(['应急物资及装备', '总平面布置图', '紧急疏散示意图']);
  });

  it('稍后补的内容按步骤列出，超过 5 项建议预约上门', () => {
    const review = reviewOf({
      ...feiyu,
      basicStep: { ...basicStep, basic: { ...basicStep.basic, safetyManagementCount: undefined, landAreaM2: undefined } },
      organization: { ...organization, groups: organization.groups.map((g, i) => (i === 2 ? { ...g, leader: undefined } : g)) },
      production: {
        ...production,
        materials: [...production.materials, { id: 'm3', kind: 'material', name: '稀释剂', labelPhotoFileIds: [] }],
      },
      resources: { ...resources, firePool: { answer: 'yes', count: 1, volumeLater: true } },
    });
    expect(review.steps[0]!.later).toEqual(['安全管理人员数', '厂区占地面积']);
    expect(review.steps[1]!.later).toEqual([`${organization.groups[2]!.name}组长`]);
    expect(review.steps[2]!.later).toEqual(['稀释剂年用量', '稀释剂包装标签']);
    expect(review.steps[3]!.later).toEqual(['消防水池容积', '稀释剂的安全技术说明书']);
    expect(review.laterCount).toBe(7);
    expect(review.suggestOnSiteVisit).toBe(true);
    expect(review.expert[0]).toBe('稀释剂是否属于危化品（按包装标签）');
    // 稍后补不影响提交
    expect(review.canSubmit).toBe(true);
  });

  it('拍了标签、传了说明书就不再算稍后补；物料多时只列前几种', () => {
    const paints = ['油漆', '稀释剂', '固化剂', '胶水'].map((name, i) => ({
      id: `p${i}`,
      kind: 'material' as const,
      name,
      annualUsage: '1 t',
      labelPhotoFileIds: [FILE],
    }));
    const msds = Object.fromEntries(paints.map((p) => [p.id, { fileIds: [FILE], later: false }]));
    const review = reviewOf({
      ...feiyu,
      production: { ...production, materials: paints },
      resources: { ...resources, msds },
    });
    expect(review.laterCount).toBe(0);
    expect(review.expert[0]).toBe('油漆、稀释剂、固化剂等 4 种是否属于危化品（按包装标签）');
  });

  it('上传花名册的不追问组长；拍照的特种设备交给专家，只传药箱照片的待补清单', () => {
    const review = reviewOf({
      ...feiyu,
      organization: { ...organization, mode: 'roster', groups: organization.groups.map((g) => ({ ...g, leader: undefined })) },
      production: {
        ...production,
        specialEquipment: { ...production.specialEquipment, pressureVessels: { ...none, answer: 'no' }, boilers: { ...none, answer: 'photo' } },
      },
      resources: { ...resources, firstAidKit: { ...resources.firstAidKit, mode: 'manual', items: [], photoFileIds: [FILE] } },
    });
    expect(review.steps[1]!.facts).toEqual(['已上传花名册，由耕云整理']);
    expect(review.steps[1]!.later).toEqual([]);
    expect(review.expert).toEqual(['锅炉是否属于特种设备（按照片）']);
    expect(review.steps[3]!.later).toContain('急救药箱药品清单');
  });

  it('还没填过的步骤只列必需资料，不报错', () => {
    const review = reviewOf({ enterpriseName: '新企业', checklist: {} });
    expect(review.steps[0]!.facts).toEqual(['新企业']);
    expect(review.steps[1]!.facts).toEqual([]);
    expect(review.canSubmit).toBe(false);
  });
});
