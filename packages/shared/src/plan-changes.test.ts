import { describe, expect, it } from 'vitest';
import { feiyuPlanInput } from './fixtures/feiyu-plan.ts';
import { composeUpdateNote, planChanges, sameValue, stripHeadingNumber } from './plan-changes.ts';
import type { PlanInput } from './plan/input.ts';

const clone = (p: PlanInput): PlanInput => structuredClone(p);

describe('planChanges：两批资料改过的项', () => {
  it('一样的资料没有改动', () => {
    expect(planChanges(feiyuPlanInput, clone(feiyuPlanInput))).toEqual([]);
  });

  it('列出来的项按名字写，按资料核对的先后排', () => {
    const after = clone(feiyuPlanInput);
    after.organization = { ...after.organization, dutyPhone: '0752-0000000' };
    after.basic = { ...after.basic, contactPhone: '0752-1111111' };
    expect(planChanges(feiyuPlanInput, after)).toEqual(['联系电话', '值班电话']);
  });

  it('应急小组按小组名对上，组长、组员分开写', () => {
    const after = clone(feiyuPlanInput);
    const groups = after.organization.groups.map((g) => (g.name === '通讯联络组' ? { ...g, members: [] } : g));
    after.organization = { ...after.organization, groups };
    expect(planChanges(feiyuPlanInput, after)).toEqual(['通讯联络组组员']);
  });

  it('没列出名字的项写这一块的总称', () => {
    const after = clone(feiyuPlanInput);
    after.business = { ...after.business, ownVehicles: true };
    expect(planChanges(feiyuPlanInput, after)).toEqual(['场所与业务']);
  });

  it('深度相等：缺这个键和值为 undefined 一样，键的先后不算', () => {
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
  });
});

describe('节标题去编号', () => {
  it('去掉各种开头编号', () => {
    expect(stripHeadingNumber('2.2 指挥机构及职责')).toBe('指挥机构及职责');
    expect(stripHeadingNumber('一、总则')).toBe('总则');
    expect(stripHeadingNumber('3. 风险描述')).toBe('风险描述');
    expect(stripHeadingNumber('附件1、通讯录')).toBe('通讯录');
    expect(stripHeadingNumber('信息报告')).toBe('信息报告');
  });
});

describe('composeUpdateNote：拼「这次更新了什么」', () => {
  it('去重、用顿号连', () => {
    expect(composeUpdateNote(['值班电话', '通讯联络组组员', '值班电话'])).toBe('值班电话、通讯联络组组员');
  });

  it('不超过 40 个字，加不下的整项丢掉', () => {
    const items = ['一二三四五六七八九十一二三四五六七八九十', '一二三四五六七八九十一二三四五六七八', '短的'];
    const note = composeUpdateNote(items);
    expect(note.length).toBeLessThanOrEqual(40);
    expect(note).toBe('一二三四五六七八九十一二三四五六七八九十、一二三四五六七八九十一二三四五六七八');
    expect(composeUpdateNote(['甲'.repeat(20), '乙'.repeat(20), '丙'])).toBe(`${'甲'.repeat(20)}、丙`);
  });

  it('第一项自己就超过 40 个字时为空；没有项为空', () => {
    expect(composeUpdateNote(['字'.repeat(41), '短'])).toBe('');
    expect(composeUpdateNote([])).toBe('');
  });
});
