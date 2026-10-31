import { describe, expect, it } from 'vitest';
import { hazardSuggestionOf } from '../workup-production.ts';
import { MAIN_ADDRESS_ID, addressLabelOf, addressOptions, groupDisplayNames, shortAddress } from './addresses.ts';

describe('一照多址的厂址', () => {
  it('短写去掉省、市、区县', () => {
    expect(shortAddress('广东省惠州市惠城区示例路1号A栋')).toBe('示例路1号A栋');
    expect(shortAddress('惠州仲恺高新区示例大道8号厂房3楼')).toBe('示例大道8号厂房3楼');
    expect(shortAddress('示例路2号')).toBe('示例路2号');
    expect(shortAddress('惠州市示例区5号小区（厂房）示例路3号2楼')).toBe('5号小区示例路3号2楼');
  });

  it('只有一处地址（或其他地址都没填）不用标厂址', () => {
    expect(addressOptions('广东省惠州市惠城区示例路1号', undefined)).toEqual([]);
    expect(addressOptions('广东省惠州市惠城区示例路1号', [{ id: 'a2', address: '  ' }])).toEqual([]);
  });

  it('两处及以上：实际生产地址在前，id 为 main', () => {
    const list = addressOptions('广东省惠州市惠城区示例路1号', [{ id: 'a2', address: '广东省惠州市惠阳区示例大道9号' }]);
    expect(list.map((a) => [a.id, a.label])).toEqual([
      [MAIN_ADDRESS_ID, '示例路1号'],
      ['a2', '示例大道9号'],
    ]);
    expect(addressLabelOf(list, 'a2')).toBe('示例大道9号');
    expect(addressLabelOf(list, undefined)).toBe('');
  });

  it('短写撞了用全称', () => {
    const list = addressOptions('广东省惠州市惠城区示例路1号', [{ id: 'a2', address: '广东省惠州市惠阳区示例路1号' }]);
    expect(list.map((a) => a.label)).toEqual(['广东省惠州市惠城区示例路1号', '广东省惠州市惠阳区示例路1号']);
  });

  it('同名小组带厂址，不同名的照原名', () => {
    const list = addressOptions('广东省惠州市惠城区示例路1号', [{ id: 'a2', address: '广东省惠州市惠阳区示例大道9号' }]);
    const names = groupDisplayNames(
      [
        { name: '抢险救灾组', addressId: 'main' },
        { name: '抢险救灾组', addressId: 'a2' },
        { name: '通讯联络组', addressId: 'a2' },
      ],
      list,
    );
    expect(names).toEqual(['抢险救灾组（示例路1号）', '抢险救灾组（示例大道9号）', '通讯联络组']);
    expect(groupDisplayNames([{ name: '抢险救灾组', addressId: 'a2' }, { name: '抢险救灾组' }], [])).toEqual(['抢险救灾组', '抢险救灾组']);
  });
});

describe('物料 CAS 号参与危化品判断', () => {
  it('名称认不出、CAS 号在目录里时按 CAS 号建议', () => {
    expect(hazardSuggestionOf('清洗剂A')).toBeUndefined();
    const s = hazardSuggestionOf('清洗剂A', '64-17-5');
    expect(s?.value).toBe(true);
    expect(s?.reason).toContain('CAS 号 64-17-5');
  });
});
