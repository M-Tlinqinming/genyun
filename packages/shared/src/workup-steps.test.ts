import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import { workupGaps } from './workup-plan.ts';
import {
  basicStepView,
  effectiveSnapshot,
  organizationStepSaveError,
  organizationStepView,
  replaceStepBlank,
  stripStepOverrides,
  wizardStepOfKey,
} from './workup-steps.ts';
import { workupFacts, workupProgress, type FactOverride, type WorkupData } from './workup.ts';

const stamp = { by: 'u-zhou', byName: '周工', at: '2026-11-20T08:00:00.000Z' };
const byExpert = (value: FactOverride['value']): FactOverride => ({ value, source: 'expert', ...stamp });
const fact = (data: WorkupData, key: string) => workupFacts(feiyuSnapshot, data).find((f) => f.key === key)!;

// 专家那份：在快照的第 1 步上改了联系人和员工人数
const expertBasic = (): WorkupData => ({
  overrides: {},
  identity: { ...feiyuSnapshot.identity, legalRepresentative: '王五' },
  profile: {
    basicStep: {
      ...feiyuSnapshot.profile.basicStep!,
      basic: { ...feiyuSnapshot.profile.basicStep!.basic, contactPerson: '林工', employeeCount: 120 },
    },
  },
});

describe('专家那份盖在快照上', () => {
  it('没有专家那份时就是快照本身', () => {
    expect(effectiveSnapshot(feiyuSnapshot, { overrides: {} } as WorkupData)).toBe(feiyuSnapshot);
  });

  it('身份整份替换、企业资料按步替换，重复调用结果不变', () => {
    const data = expertBasic();
    const once = effectiveSnapshot(feiyuSnapshot, data);
    expect(once.identity.legalRepresentative).toBe('王五');
    expect(once.profile.basicStep?.basic.employeeCount).toBe(120);
    expect(once.profile.organizationStep).toBe(feiyuSnapshot.profile.organizationStep);
    expect(effectiveSnapshot(once, data)).toEqual(once);
    // 快照本身没被改
    expect(feiyuSnapshot.identity.legalRepresentative).not.toBe('王五');
  });

  it('和客户原来的值不一样的标为专家修改，一样的保持原来的来源', () => {
    const data = expertBasic();
    expect(fact(data, 'employeeCount')).toMatchObject({ value: 120, source: 'expert', status: 'done' });
    expect(fact(data, 'legalRepresentative')).toMatchObject({ value: '王五', source: 'expert' });
    expect(fact(data, 'mainProducts').source).toBe('customer');
  });
});

describe('老整理页的单项修改并进向导', () => {
  it('第 1 步：只有快照', () => {
    const v = basicStepView(feiyuSnapshot, { overrides: {} });
    expect(v.identity).toEqual(feiyuSnapshot.identity);
    expect(v.basic.employeeCount).toBe(feiyuSnapshot.profile.basicStep!.basic.employeeCount);
  });

  it('第 1 步：快照 + 单项修改', () => {
    const v = basicStepView(feiyuSnapshot, {
      overrides: { employeeCount: byExpert(90), companyName: byExpert('飞宇电器'), landArea: byExpert('13942 m²'), industry: byExpert('电气机械和器材制造业') },
    });
    expect(v.basic.employeeCount).toBe(90);
    expect(v.basic.landAreaM2).toBe(13942);
    expect(v.basic.industry).toBe(feiyuSnapshot.profile.basicStep!.basic.industry);
    expect(v.identity.name).toBe('飞宇电器');
  });

  it('第 1 步：专家那份 + 单项修改（单项修改在上）', () => {
    const data = { ...expertBasic(), overrides: { contactPerson: byExpert('周工') } };
    const v = basicStepView(feiyuSnapshot, data);
    expect(v.basic.contactPerson).toBe('周工');
    expect(v.basic.employeeCount).toBe(120);
    expect(v.identity.legalRepresentative).toBe('王五');
  });

  it('保存一步后删掉这一步用过的单项修改，别的步和属地机构的留着', () => {
    const overrides = {
      employeeCount: byExpert(90),
      commander: byExpert({ name: '陈总' }),
      'group.rescue': byExpert({ name: '黄工' }),
      'agency.fireDept': byExpert('惠阳消防 · 119'),
      shortName: byExpert('FY'),
    };
    expect(Object.keys(stripStepOverrides(overrides, 'basic'))).toEqual(['commander', 'group.rescue', 'agency.fireDept', 'shortName']);
    expect(Object.keys(stripStepOverrides(overrides, 'organization'))).toEqual(['employeeCount', 'agency.fireDept', 'shortName']);
  });

  it('第 2 步：总指挥、组长、值班电话的单项修改并进组织', () => {
    const v = organizationStepView(feiyuSnapshot, {
      overrides: { commander: byExpert({ name: '陈总', phone: '〔手机号〕' }), 'group.rescue': byExpert({ name: '黄工' }), dutyPhone: byExpert('0752-1234567') },
    });
    expect(v.commander?.name).toBe('陈总');
    expect(v.groups.find((g) => g.kind === 'rescue')?.leader?.name).toBe('黄工');
    expect(v.dutyPhone).toBe('0752-1234567');
  });

  it('事实键属于哪一步', () => {
    expect(wizardStepOfKey('contactPhone')).toBe('basic');
    expect(wizardStepOfKey('deputy.2')).toBe('organization');
    expect(wizardStepOfKey('group.g-1')).toBe('organization');
    expect(wizardStepOfKey('agency.streetOffice')).toBeUndefined();
    expect(wizardStepOfKey('totalFloorArea')).toBeUndefined();
  });
});

describe('先留空，文稿标「待补充」', () => {
  const profile = structuredClone(feiyuSnapshot.profile);
  delete profile.basicStep!.basic.technicalManagementCount;
  const snapshot = { ...feiyuSnapshot, profile };

  it('勾上的必需项算处理过了，不算缺项', () => {
    const before = workupFacts(snapshot, { overrides: {} }).find((f) => f.key === 'technicalManagementCount')!;
    expect(before.status).toBe('missing');
    const data: WorkupData = { overrides: {}, blank: ['technicalManagementCount'] };
    const after = workupFacts(snapshot, data).find((f) => f.key === 'technicalManagementCount')!;
    expect(after.status).toBe('blank');
    expect(workupProgress(workupFacts(snapshot, data)).missing.map((f) => f.key)).not.toContain('technicalManagementCount');
    expect(workupGaps(snapshot, data).gaps.map((g) => g.key)).not.toContain('technicalManagementCount');
  });

  it('填了值就不再是留空', () => {
    const data: WorkupData = { overrides: { technicalManagementCount: byExpert(3) }, blank: ['technicalManagementCount'] };
    expect(workupFacts(snapshot, data).find((f) => f.key === 'technicalManagementCount')!.status).toBe('done');
  });

  it('保存一步时只换这一步的留空项', () => {
    expect(replaceStepBlank(['dutyPhone', 'technicalManagementCount'], 'basic', ['contactPhone', 'dutyPhone'])).toEqual(['dutyPhone', 'contactPhone']);
  });
});

describe('第 2 步保存检查', () => {
  const before = feiyuSnapshot.profile.organizationStep!.step;
  it('不能新加自定义小组，原来的可以留着', () => {
    const custom = { id: 'g-new', kind: 'custom' as const, name: '设备组', members: [] };
    expect(organizationStepSaveError({ ...before, groups: [...before.groups, custom] }, before)).toBe('小组只能从预设的五个里选');
    expect(organizationStepSaveError(before, before)).toBeNull();
  });
  it('同一个预设小组不能添加两次（分厂址的除外）', () => {
    const rescue = before.groups.find((g) => g.kind === 'rescue')!;
    expect(organizationStepSaveError({ ...before, groups: [...before.groups, { ...rescue, id: 'g-2' }] }, before)).toContain('不能添加两次');
    expect(organizationStepSaveError({ ...before, groups: [...before.groups, { ...rescue, id: 'g-2', addressId: 'addr2' }] }, before)).toBeNull();
  });
});
