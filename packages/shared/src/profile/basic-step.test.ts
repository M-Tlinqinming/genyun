import { describe, expect, it } from 'vitest';
import { basicInfoStartReady, basicStepSaveSchema } from './basic-step.ts';
import { INDUSTRY_NAMES } from './industries.ts';

const identity = { name: '惠阳飞宇电器有限公司' };

describe('企业自填第 1 步', () => {
  it('联系人、电话、职工人数、主要产品都有了，企业基本情况才算可以开始编制', () => {
    const ready = { contactPerson: '李文聪', contactPhone: '13800000000', employeeCount: 86, mainProducts: '电热水壶' };
    expect(basicInfoStartReady(ready)).toBe(true);
    expect(basicInfoStartReady({ ...ready, mainProducts: ' ' })).toBe(false);
    expect(basicInfoStartReady({ ...ready, employeeCount: undefined })).toBe(false);
    // 0 人也是填了
    expect(basicInfoStartReady({ ...ready, employeeCount: 0 })).toBe(true);
  });

  it('自动保存只要求企业名称，其余可以空着', () => {
    const r = basicStepSaveSchema.safeParse({ version: 1, identity, basic: {} });
    expect(r.success).toBe(true);
    expect(r.data?.later).toEqual([]);
  });

  it('格式不对的字段不保存', () => {
    const bad = (basic: object) => basicStepSaveSchema.safeParse({ version: 1, identity, basic }).success;
    expect(bad({ postalCode: '5160' })).toBe(false);
    expect(bad({ email: 'abc' })).toBe(false);
    expect(bad({ industry: '99' })).toBe(false);
    expect(bad({ industry: '33' })).toBe(true);
  });

  it('稍后补和来源标签只能用于本步字段', () => {
    const save = (extra: object) =>
      basicStepSaveSchema.safeParse({ version: 1, identity, basic: {}, ...extra }).success;
    expect(save({ later: ['safetyManagementCount'] })).toBe(true);
    expect(save({ later: ['nonsense'] })).toBe(false);
    expect(save({ sources: { name: 'license', contactPerson: 'account' } })).toBe(true);
    expect(save({ sources: { name: 'magic' } })).toBe(false);
  });

  it('行业表按国标大类，金属制品业为 33', () => {
    expect(INDUSTRY_NAMES['33']).toBe('金属制品业');
    expect(Object.keys(INDUSTRY_NAMES)).toHaveLength(90);
  });
});
