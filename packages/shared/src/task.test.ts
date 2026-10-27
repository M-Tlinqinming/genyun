import { describe, expect, it } from 'vitest';
import { enterpriseInputSchema } from './enterprise.ts';
import { chinaToday, formatTaskNumber, isContractActive } from './task.ts';

describe('企业档案输入', () => {
  it('只填企业名称即可保存，空的选填项存为空', () => {
    const r = enterpriseInputSchema.parse({ name: ' 飞宇制造有限公司 ', socialCreditCode: '', legalRepresentative: '' });
    expect(r).toEqual({ name: '飞宇制造有限公司', socialCreditCode: null, registeredAddress: null, legalRepresentative: null });
  });

  it('统一社会信用代码转大写并校验格式', () => {
    expect(enterpriseInputSchema.parse({ name: 'x', socialCreditCode: '91441300726483224b' }).socialCreditCode).toBe(
      '91441300726483224B',
    );
    expect(enterpriseInputSchema.safeParse({ name: 'x', socialCreditCode: '123' }).success).toBe(false);
  });

  it('企业名称必填', () => {
    expect(enterpriseInputSchema.safeParse({ name: '  ' }).success).toBe(false);
  });
});

describe('任务编号', () => {
  it('按年三位流水，超过 999 自然变长', () => {
    expect(formatTaskNumber(2026, 1)).toBe('GY-2026-001');
    expect(formatTaskNumber(2026, 1234)).toBe('GY-2026-1234');
  });
});

describe('合同有效期', () => {
  const contract = { contractStartsAt: '2026-01-01', contractEndsAt: '2026-12-31' };

  it('起止日当天都算有效', () => {
    expect(isContractActive(contract, '2026-01-01')).toBe(true);
    expect(isContractActive(contract, '2026-12-31')).toBe(true);
  });

  it('到期后和开始前都不能新建任务', () => {
    expect(isContractActive(contract, '2027-01-01')).toBe(false);
    expect(isContractActive(contract, '2025-12-31')).toBe(false);
  });

  it('没登记合同视为无效', () => {
    expect(isContractActive({ contractStartsAt: null, contractEndsAt: null }, '2026-06-01')).toBe(false);
  });

  it('按北京时间算日期', () => {
    // UTC 12-31 16:00 已是北京时间次年 1 月 1 日
    expect(chinaToday(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });
});
