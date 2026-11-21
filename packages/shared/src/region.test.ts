import { describe, expect, it } from 'vitest';
import {
  checkRegionParts,
  formatRegion,
  REGION_NOT_IN_AREA,
  regionCodesOf,
  regionFilterKey,
  regionPartsOf,
  regionPartsSchema,
  type AreaList,
  type RegionParts,
} from './region.ts';

// 从 @vant/area-data 2.2.0 摘出来的几条（代码和名称照原样）
const areaList: AreaList = {
  province_list: {
    '320000': '江苏省',
    '310000': '上海市',
    '420000': '湖北省',
    '500000': '重庆市',
    '440000': '广东省',
    '810000': '香港特别行政区',
  },
  city_list: {
    '320500': '苏州市',
    '310100': '上海市',
    '429000': '省直辖县',
    '500100': '重庆市',
    '500200': '县',
    '441900': '东莞市',
    '441300': '惠州市',
    '810100': '香港岛',
  },
  county_list: {
    '320506': '吴中区',
    '310112': '闵行区',
    '429004': '仙桃市',
    '500229': '城口县',
    '441903': '东城街道',
    '441302': '惠城区',
    '810101': '中西区',
  },
};

const p = (province: string, city: string, district: string | null): RegionParts => ({ province, city, district });

describe('拼地区文字', () => {
  const rows: [RegionParts, string, string][] = [
    [p('江苏省', '苏州市', '吴中区'), '江苏省苏州市吴中区', '江苏省苏州市'],
    [p('上海市', '上海市', '闵行区'), '上海市闵行区', '上海市闵行区'],
    [p('湖北省', '省直辖县', '仙桃市'), '湖北省仙桃市', '湖北省仙桃市'],
    [p('重庆市', '县', '城口县'), '重庆市城口县', '重庆市城口县'],
    [p('广东省', '东莞市', '东城街道'), '广东省东莞市东城街道', '广东省东莞市'],
    [p('广东省', '惠州市', null), '广东省惠州市', '广东省惠州市'],
  ];
  it.each(rows)('%o → 全称 %s，简称 %s', (parts, full, short) => {
    expect(formatRegion(parts, 'full')).toBe(full);
    expect(formatRegion(parts, 'short')).toBe(short);
  });

  it('香港：省 + 市 + 区', () => {
    expect(formatRegion(p('香港特别行政区', '香港岛', '中西区'), 'full')).toBe('香港特别行政区香港岛中西区');
  });
});

describe('筛选用的键', () => {
  it('省 + 市；直辖市、占位的市只写省', () => {
    expect(regionFilterKey(p('江苏省', '苏州市', '吴中区'))).toBe('江苏省苏州市');
    expect(regionFilterKey(p('上海市', '上海市', '闵行区'))).toBe('上海市');
    expect(regionFilterKey(p('重庆市', '县', '城口县'))).toBe('重庆市');
    expect(regionFilterKey(p('湖北省', '省直辖县', '仙桃市'))).toBe('湖北省');
  });
});

describe('三列 → 地区', () => {
  it('省市齐了才算；老数据为 null', () => {
    expect(regionPartsOf({ regionProvince: '广东省', regionCity: '惠州市', regionDistrict: null })).toEqual(p('广东省', '惠州市', null));
    expect(regionPartsOf({ regionProvince: null, regionCity: null, regionDistrict: null })).toBeNull();
  });
});

describe('格式检查', () => {
  it('省没选、市没选；区县可以为空', () => {
    expect(regionPartsSchema.safeParse({ province: '', city: '' }).error?.issues[0]?.message).toBe('请选择所在地区');
    expect(regionPartsSchema.safeParse(undefined).error?.issues[0]?.message).toBe('请选择所在地区');
    expect(regionPartsSchema.safeParse({ province: '广东省', city: '' }).error?.issues[0]?.message).toBe('请选到市');
    expect(regionPartsSchema.parse({ province: '广东省', city: '惠州市', district: '' })).toEqual(p('广东省', '惠州市', null));
  });
});

describe('核对区划', () => {
  it('苏州吴中、上海闵行、重庆的县、湖北仙桃、东莞的镇街、香港都对得上', () => {
    for (const parts of [
      p('江苏省', '苏州市', '吴中区'),
      p('上海市', '上海市', '闵行区'),
      p('重庆市', '县', '城口县'),
      p('湖北省', '省直辖县', '仙桃市'),
      p('广东省', '东莞市', '东城街道'),
      p('香港特别行政区', '香港岛', '中西区'),
    ]) {
      expect(checkRegionParts(parts, areaList)).toBeNull();
    }
  });

  it('上下级对不上、名称不在区划里', () => {
    expect(checkRegionParts(p('江苏省', '惠州市', '惠城区'), areaList)).toBe(REGION_NOT_IN_AREA);
    expect(checkRegionParts(p('广东省', '惠州市', '吴中区'), areaList)).toBe(REGION_NOT_IN_AREA);
    expect(checkRegionParts(p('重庆市', '县', '闵行区'), areaList)).toBe(REGION_NOT_IN_AREA);
    expect(checkRegionParts(p('火星省', '惠州市', null), areaList)).toBe(REGION_NOT_IN_AREA);
  });

  it('市下面有区县却没选', () => {
    expect(checkRegionParts(p('广东省', '惠州市', null), areaList)).toBe('请选到区县');
  });

  it('名称 → 代码（回填用）', () => {
    expect(regionCodesOf(p('广东省', '惠州市', '惠城区'), areaList)).toEqual({ province: '440000', city: '441300', district: '441302' });
    expect(regionCodesOf(p('火星省', '惠州市', null), areaList)).toBeNull();
  });
});
