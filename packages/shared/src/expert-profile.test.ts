import { describe, expect, it } from 'vitest';
import { EXPERT_REVIEW_STATUSES, isCustomerSelectableExpert, isOperatorAssignableExpert } from './expert-profile.ts';

describe('专家能不能选、能不能派', () => {
  it('客户能选：有资料行、已上架、接单中', () => {
    expect(isCustomerSelectableExpert({ reviewStatus: 'approved', acceptingOrders: true })).toBe(true);
    expect(isCustomerSelectableExpert({ reviewStatus: 'approved', acceptingOrders: false })).toBe(false);
    expect(isCustomerSelectableExpert(null)).toBe(false);
    for (const s of EXPERT_REVIEW_STATUSES.filter((s) => s !== 'approved')) {
      expect(isCustomerSelectableExpert({ reviewStatus: s, acceptingOrders: true })).toBe(false);
    }
  });
  it('审核状态为空（内部账号）：接单中能派、客户选不到；暂停接单都不行', () => {
    expect(isOperatorAssignableExpert({ reviewStatus: null, acceptingOrders: true })).toBe(true);
    expect(isCustomerSelectableExpert({ reviewStatus: null, acceptingOrders: true })).toBe(false);
    expect(isOperatorAssignableExpert({ reviewStatus: null, acceptingOrders: false })).toBe(false);
    expect(isCustomerSelectableExpert({ reviewStatus: null, acceptingOrders: false })).toBe(false);
  });
  it('运营能派：没有资料行算接单中；有资料行要已上架且接单中', () => {
    expect(isOperatorAssignableExpert(null)).toBe(true);
    expect(isOperatorAssignableExpert({ reviewStatus: 'approved', acceptingOrders: true })).toBe(true);
    expect(isOperatorAssignableExpert({ reviewStatus: 'approved', acceptingOrders: false })).toBe(false);
    for (const s of EXPERT_REVIEW_STATUSES.filter((s) => s !== 'approved')) {
      expect(isOperatorAssignableExpert({ reviewStatus: s, acceptingOrders: true })).toBe(false);
    }
  });
});
