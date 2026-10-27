import { describe, expect, it } from 'vitest';
import { feiyuOrganization } from '../fixtures/feiyu.ts';
import {
  compilationTeamOf,
  defaultOrganizationStep,
  dutyPhoneOfStep,
  emergencyGroupsStartReady,
  orgChartOf,
  organizationStepSchema,
  peopleOf,
  presetGroup,
  suggestedGroups,
  type OrganizationStep,
} from './organization-step.ts';

// 飞宇样例按第 2 步的填法
const feiyu: OrganizationStep = {
  mode: 'form',
  commander: feiyuOrganization.commander,
  deputies: feiyuOrganization.deputies,
  groups: feiyuOrganization.groups.map((g, i) => ({ ...g, id: `g${i}` })),
  compilationExtras: [],
};

describe('企业自填第 2 步 · 人员与应急组织', () => {
  it('飞宇样例通过规则，「各应急小组成员」可以开始编制', () => {
    expect(organizationStepSchema.safeParse(feiyu).error?.issues ?? []).toEqual([]);
    expect(emergencyGroupsStartReady(feiyu)).toBe(true);
  });

  it('边填边保存：姓名、电话可以暂时空着', () => {
    const draft = { ...defaultOrganizationStep(20), commander: { id: 'p1', name: '' } };
    expect(organizationStepSchema.safeParse(draft).success).toBe(true);
    expect(emergencyGroupsStartReady(draft)).toBe(false);
  });

  it('总指挥要有姓名和手机才算可以开始编制；上传花名册时由文件决定', () => {
    expect(emergencyGroupsStartReady({ ...feiyu, commander: { id: 'p1', name: '李文聪' } })).toBe(false);
    expect(emergencyGroupsStartReady({ ...feiyu, mode: 'roster' })).toBe(false);
  });

  it('电话只收数字和短横线', () => {
    const bad = { ...feiyu, dutyPhone: '找门卫' };
    expect(organizationStepSchema.safeParse(bad).error?.issues[0]?.message).toBe('电话只能填数字、空格和短横线');
  });

  it('小组 2–6 个，同一个预置小组不能加两次', () => {
    expect(organizationStepSchema.safeParse({ ...feiyu, groups: feiyu.groups.slice(0, 1) }).success).toBe(false);
    const custom = (id: string) => ({ id, kind: 'custom' as const, name: `自定义${id}`, members: [] });
    const six = [...feiyu.groups, custom('a'), custom('b'), custom('c')];
    expect(organizationStepSchema.safeParse({ ...feiyu, groups: six }).success).toBe(true);
    expect(organizationStepSchema.safeParse({ ...feiyu, groups: [...six, custom('d')] }).success).toBe(false);
    const twice = organizationStepSchema.safeParse({ ...feiyu, groups: [...feiyu.groups, presetGroup('rescue')] });
    expect(twice.error?.issues[0]?.message).toBe('同一个小组不能添加两次');
  });

  it('按员工人数预设小组：50 人以下 3 组，100 人以上 5 组', () => {
    expect(suggestedGroups(20)).toEqual({ min: 3, max: 3 });
    expect(suggestedGroups(86)).toEqual({ min: 3, max: 4 });
    expect(defaultOrganizationStep(86).groups.map((g) => g.name)).toEqual(['抢险救灾组', '综合保障组', '通讯联络组']);
    expect(defaultOrganizationStep(120).groups).toHaveLength(5);
  });

  it('值班电话默认取总指挥手机，填了就用填的', () => {
    expect(dutyPhoneOfStep(feiyu)).toBe('13800000001');
    expect(dutyPhoneOfStep({ ...feiyu, dutyPhone: '0752-3324567' })).toBe('0752-3324567');
    expect(dutyPhoneOfStep({ ...feiyu, commander: undefined })).toBeUndefined();
  });
});

describe('组织体系图', () => {
  it('总指挥 → 副总指挥 → 各组，按规定顺序排列', () => {
    const step = { ...feiyu, groups: [...feiyu.groups, presetGroup('medical'), presetGroup('evacuation')] };
    expect(orgChartOf(step)).toEqual({
      deputy: true,
      groups: ['抢险救灾组', '警戒疏散组', '医疗救护组', '综合保障组', '通讯联络组'],
    });
  });

  it('去掉副总指挥后各组直接挂在总指挥下；没起名的自定义组不画', () => {
    const custom = { id: 'c1', kind: 'custom' as const, name: '', members: [] };
    const chart = orgChartOf({ ...feiyu, deputies: [], groups: [...feiyu.groups, custom] });
    expect(chart).toEqual({ deputy: false, groups: ['抢险救灾组', '综合保障组', '通讯联络组'] });
  });
});

describe('应急预案编制小组', () => {
  it('总指挥任组长，副总指挥和各组组长任成员，分工已写好', () => {
    const team = compilationTeamOf(feiyu);
    expect(team.map((r) => [r.role, r.name])).toEqual([
      ['组长', '李文聪'],
      ['成员', '陈志刚'],
      ['成员', '王秀英'],
      ['成员', '刘海涛'],
      ['成员', '张丽华'],
      ['成员', '赵小龙'],
    ]);
    expect(team[0]!.duty).toBe('制定编制计划，组织编制、评审、修订，签署并颁布实施');
    expect(team[3]!.duty).toBe('重点编写风险评估与现场处置');
  });

  it('一人兼任多个组长只列一次；另加的成员排在后面', () => {
    const step: OrganizationStep = {
      ...feiyu,
      groups: feiyu.groups.map((g) => ({ ...g, leader: feiyu.commander })),
      compilationExtras: [{ id: 'x1', name: '钱多多', title: '财务', duty: '费用保障' }],
    };
    expect(compilationTeamOf(step).map((r) => r.name)).toEqual(['李文聪', '陈志刚', '王秀英', '钱多多']);
  });

  it('已填人员按人去重，供「从已填人员中选」', () => {
    expect(peopleOf(feiyu)).toHaveLength(3 + 7);
  });
});
