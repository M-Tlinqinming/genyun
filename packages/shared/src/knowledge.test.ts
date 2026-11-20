import { describe, expect, it } from 'vitest';
import { regionHasDistrictAgencies, regionHasLocalAgencies, type KnowledgeAgency, type KnowledgeRegion } from './knowledge.ts';

const agency = (disabled = false) => ({ id: 'a', disabled }) as KnowledgeAgency;
const region = (province: string, city: string, agencies: KnowledgeAgency[], name = '某区', aliases: string[] = []) =>
  ({ id: city, province, city, name, aliases, plan: null, agencies }) as unknown as KnowledgeRegion;

describe('客户组织所在地区有没有属地机构', () => {
  const regions = [region('广东省', '惠州市', [agency()]), region('广东省', '珠海市', [agency(true)])];

  it('区县所属的省市出现在地区里，且至少有一条没停用的机构', () => {
    expect(regionHasLocalAgencies('广东省惠州市惠阳区', regions)).toBe(true);
    expect(regionHasLocalAgencies('广东省惠州市', regions)).toBe(true);
    expect(regionHasLocalAgencies('惠州', regions)).toBe(true);
  });

  it('外地、机构全部停用、写错省、没写地区：没有', () => {
    expect(regionHasLocalAgencies('上海市闵行区', regions)).toBe(false);
    expect(regionHasLocalAgencies('广东省珠海市香洲区', regions)).toBe(false);
    expect(regionHasLocalAgencies('福建省惠州市', regions)).toBe(false);
    expect(regionHasLocalAgencies(null, regions)).toBe(false);
    expect(regionHasLocalAgencies('广东省惠州市', [])).toBe(false);
  });
});

describe('按省、市、区县三级判断有没有属地机构', () => {
  const regions = [
    region('广东省', '惠州市', [agency()], '惠阳区', ['淡水']),
    region('广东省', '惠州市', [agency()], '仲恺高新区', ['仲恺']),
    region('广东省', '珠海市', [agency(true)], '香洲区'),
  ];

  it('区县为空时只比省市', () => {
    expect(regionHasDistrictAgencies({ province: '广东省', city: '惠州市', district: null }, regions)).toBe(true);
    expect(regionHasDistrictAgencies({ province: '广东', city: '惠州', district: null }, regions)).toBe(true);
  });

  it('区县按名称或别的叫法比，去掉末尾的区县市旗', () => {
    expect(regionHasDistrictAgencies({ province: '广东省', city: '惠州市', district: '惠阳区' }, regions)).toBe(true);
    expect(regionHasDistrictAgencies({ province: '广东省', city: '惠州市', district: '淡水区' }, regions)).toBe(true);
    expect(regionHasDistrictAgencies({ province: '广东省', city: '惠州市', district: '博罗县' }, regions)).toBe(false);
  });

  it('机构全部停用、省不对：没有', () => {
    expect(regionHasDistrictAgencies({ province: '广东省', city: '珠海市', district: '香洲区' }, regions)).toBe(false);
    expect(regionHasDistrictAgencies({ province: '福建省', city: '惠州市', district: null }, regions)).toBe(false);
  });
});
