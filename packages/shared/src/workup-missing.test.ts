import { describe, expect, it } from 'vitest';
import { companyShortName, planCodeSeed, stripBrackets, stripOrgSuffix, stripPlaces } from './company-name.ts';
import { majorHazardOf } from './plan/major-hazard.ts';
import { missingListText, monthDay, recomputeMissingList, type MissingList } from './workup-missing.ts';

describe('企业简称与预案编号的字号', () => {
  it('去括号、去开头地名、去组织形式', () => {
    expect(stripOrgSuffix('示例电子有限公司')).toBe('示例电子');
    expect(stripOrgSuffix('公司')).toBe('公司');
    expect(stripOrgSuffix('示例集团')).toBe('示例');
    expect(stripOrgSuffix('示例集团有限公司')).toBe('示例');
    expect(stripOrgSuffix('示例集团公司')).toBe('示例');
    expect(stripBrackets('飞宇（惠州）电器')).toBe('飞宇电器');
    expect(stripPlaces('惠州市惠阳飞宇电器', ['广东省惠州市惠阳区秋长街道'])).toBe('飞宇电器');
    expect(companyShortName('惠阳飞宇电器有限公司', ['广东省惠州市惠阳区秋长街道'])).toBe('飞宇电器');
  });

  it('字号前两个汉字；不足两个汉字不给', () => {
    expect(planCodeSeed('惠州市飞宇电器有限公司', ['广东省惠州市'])).toBe('飞宇');
    expect(planCodeSeed('ABC 有限公司')).toBe('');
    expect(planCodeSeed('')).toBe('');
    expect(planCodeSeed(null)).toBe('');
  });
});

describe('重大危险源 ∑q/Q', () => {
  it('能算的相加，≥ 1 构成；换算不了和临界量不详的单列', () => {
    const r = majorHazardOf([
      { name: '甲醇', maxStorageTons: 300 },
      { name: '液化石油气', maxStorageTons: 30 },
      { name: '乙醇', maxStorageText: '6 桶' },
      { name: '某种稀释剂', maxStorageTons: 1 },
    ]);
    expect(r.sum).toBeCloseTo(1.2);
    expect(r.conclusion).toBe('构成');
    expect(r.complete).toBe(false);
    expect(r.unconvertible).toEqual([{ name: '乙醇', qty: '6', unit: '桶' }]);
    expect(r.noCritical).toEqual(['某种稀释剂']);
    expect(r.rows[0]).toMatchObject({ q: 300, Q: 500, ratio: 0.6 });
  });

  it('都很少时不构成', () => {
    const r = majorHazardOf([{ name: '乙醇', maxStorageTons: 0.02 }]);
    expect(r.conclusion).toBe('不构成');
    expect(r.complete).toBe(true);
    expect(r.sumText).toBe('4.0e-5');
  });
});

describe('缺项清单', () => {
  const list: MissingList = {
    at: '2026-11-18T08:05:00.000Z',
    by: 'u1',
    byName: '周工',
    items: [
      { key: 'drawing:evacuation_plan', label: '紧急疏散示意图', customerLabel: '紧急疏散示意图', step: 4, required: true },
      { key: 'basic.postalCode', label: '邮政编码', customerLabel: '邮政编码', step: 1, required: false },
    ],
  };

  it('补上的记时间，又缺了去掉时间；都补上了 allFilled', () => {
    const a = recomputeMissingList(list, [{ key: 'basic.postalCode' }], 'T1');
    expect(a.changed).toBe(true);
    expect(a.allFilled).toBe(false);
    expect(a.list.items[0]!.filledAt).toBe('T1');
    expect(a.list.items[1]!.filledAt).toBeUndefined();

    const same = recomputeMissingList(a.list, [{ key: 'basic.postalCode' }], 'T2');
    expect(same.changed).toBe(false);
    expect(same.list).toBe(a.list);

    const back = recomputeMissingList(a.list, [{ key: 'drawing:evacuation_plan' }, { key: 'basic.postalCode' }], 'T3');
    expect(back.list.items[0]!.filledAt).toBeUndefined();

    const all = recomputeMissingList(list, [], 'T4');
    expect(all.allFilled).toBe(true);
  });

  it('清单文字：简称抬头、必须补在前、联系人落款', () => {
    expect(monthDay('2026-11-18T08:05:00.000Z')).toBe('11 月 18 日');
    const text = missingListText({
      companyName: '示例电子科技有限公司',
      expertName: '周工',
      at: list.at,
      contact: { name: '王经理', phone: '13912345678' },
      items: list.items,
    });
    expect(text.split('\n')).toEqual([
      '【示例电子科技 · 编制应急预案还缺的资料】',
      '11 月 18 日 · 专家 周工',
      '',
      '必须补（没有不能生成）：',
      '1. 紧急疏散示意图',
      '',
      '最好补齐（不补会在预案里标「待补充」）：',
      '2. 邮政编码',
      '',
      '联系人：王经理 · 13912345678',
      '请发到客服企业微信，专家收到后代为上传。',
    ]);
  });
});
