import { describe, expect, it } from 'vitest';
import { feiyuBasicInfo, feiyuLocation, feiyuOrganization, feiyuProduction } from '../fixtures/feiyu.ts';
import { basicInfoSchema } from './basic.ts';
import { locationSchema } from './location.ts';
import { defaultGroups, dutyPhoneOf, organizationSchema } from './organization.ts';
import { pressureVolume, productionSchema, totalFloorArea } from './production.ts';

describe('飞宇样例通过字段规则', () => {
  it.each([
    ['企业信息', basicInfoSchema, feiyuBasicInfo],
    ['地址与相邻企业', locationSchema, feiyuLocation],
    ['应急组织', organizationSchema, feiyuOrganization],
    ['生产现场', productionSchema, feiyuProduction],
  ] as const)('%s', (_name, schema, data) => {
    const result = schema.safeParse(data);
    expect(result.error?.issues ?? []).toEqual([]);
  });
});

describe('企业信息', () => {
  it('自动保存时只要求企业名称', () => {
    expect(basicInfoSchema.safeParse({ companyName: '某某五金厂' }).success).toBe(true);
    expect(basicInfoSchema.safeParse({ companyName: '  ' }).success).toBe(false);
  });

  it('统一社会信用代码不区分大小写，但位数和字符要对', () => {
    const parsed = basicInfoSchema.parse({ companyName: 'x', socialCreditCode: '91441300726483224b' });
    expect(parsed.socialCreditCode).toBe('91441300726483224B');
    expect(basicInfoSchema.safeParse({ companyName: 'x', socialCreditCode: '9144130072648322' }).success).toBe(false);
  });

  it('不收是否危化品、耐火等级等专业判断字段', () => {
    const material = productionSchema.parse({ materials: [{ name: '酒精', isHazardous: true }] }).materials[0];
    expect(material).not.toHaveProperty('isHazardous');
    const building = productionSchema.parse({ buildings: [{ name: '厂房', fireResistanceLevel: '二级' }] }).buildings[0];
    expect(building).not.toHaveProperty('fireResistanceLevel');
  });
});

describe('应急组织', () => {
  it('默认三个小组', () => {
    expect(defaultGroups().map((g) => g.name)).toEqual(['抢险救灾组', '综合保障组', '通讯联络组']);
  });

  it('小组 2–6 个，副总指挥最多 2 人', () => {
    const base = { groups: defaultGroups() };
    expect(organizationSchema.safeParse({ groups: defaultGroups().slice(0, 1) }).success).toBe(false);
    expect(organizationSchema.safeParse({ groups: [...defaultGroups(), ...defaultGroups(), ...defaultGroups()] }).success).toBe(false);
    const deputy = (id: string) => ({ id, name: `副总${id}` });
    expect(organizationSchema.safeParse({ ...base, deputies: [deputy('a'), deputy('b'), deputy('c')] }).success).toBe(false);
  });

  it('值班电话默认取总指挥手机', () => {
    expect(dutyPhoneOf(feiyuOrganization)).toBe('13800000001');
    expect(dutyPhoneOf({ ...feiyuOrganization, dutyPhone: '0752-1234567' })).toBe('0752-1234567');
  });
});

describe('生产现场', () => {
  it('设备单位、部门、使用状况有默认值', () => {
    const [row] = productionSchema.parse({ equipment: [{ name: '冲床', quantity: 3 }] }).equipment;
    expect(row).toMatchObject({ unit: '台', department: '车间', location: '车间', condition: '正常' });
  });

  it('特种设备选「没有」时不收参数', () => {
    const parsed = productionSchema.parse({ specialEquipment: { boilers: { answer: 'no', items: [{ type: 'steam' }] } } });
    expect(parsed.specialEquipment.boilers).toEqual({ answer: 'no' });
  });

  it('PV 值由系统计算', () => {
    expect(pressureVolume({ maxWorkingPressureMPa: 0.8, volumeM3: 1.5 })).toBe(1.2);
    expect(pressureVolume({ volumeM3: 1.5 })).toBeUndefined();
  });

  it('总建筑面积由各栋合计', () => {
    expect(totalFloorArea({ buildings: [{ name: 'A', floorAreaM2: 2400 }, { name: 'B', floorAreaM2: 600.5 }, { name: 'C' }] })).toBe(3000.5);
  });
});
