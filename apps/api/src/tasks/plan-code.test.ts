import { describe, expect, it } from 'vitest';
import { suggestPlanCode } from './plan-code.ts';

describe('预案编号建议', () => {
  const now = new Date('2026-11-20T02:00:00Z');
  it('字号前两个汉字的拼音首字母 + 年份', () => {
    expect(suggestPlanCode('惠阳飞宇电器有限公司', ['广东省惠州市惠阳区秋长街道'], now)).toBe('FY2026');
    expect(suggestPlanCode('示例电子科技有限公司', [], now)).toBe('SL2026');
  });
  it('名称里的区县名不在地址里也去掉（知识库内置的区县）', () => {
    expect(suggestPlanCode('惠阳飞宇电器有限公司', ['惠州市仲恺高新区陈江街道正大路 17 号'], now)).toBe('FY2026');
    expect(suggestPlanCode('惠阳区飞宇电器有限公司', [], now)).toBe('FY2026');
  });
  it('年份按中国时间算', () => {
    expect(suggestPlanCode('示例电子科技有限公司', [], new Date('2026-12-31T17:00:00Z'))).toBe('SL2027');
  });
  it('拿不到两个汉字不给建议', () => {
    expect(suggestPlanCode('ABC Ltd', [], now)).toBe('');
    expect(suggestPlanCode(null, [], now)).toBe('');
  });
});
