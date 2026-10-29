import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import { emptyProductionWorkup, productionView, type Judged } from './workup-production.ts';
import { planHazardsOf, riskSaveError, riskSaveSchema, riskView, type RiskRowValue } from './workup-risk.ts';

const stamp = { by: 'u-zhou', byName: '周工', at: '2026-10-29T08:00:00.000Z' };
const judged = <T>(value: T): Judged<T> => ({ ...stamp, value });
const withRows = (rows: Record<string, Judged<RiskRowValue>>) => ({ risks: { rows } });
const row = (view: ReturnType<typeof riskView>, factor: string) => view.rows.find((r) => r.factor === factor)!;

describe('危险源候选的系统推荐', () => {
  const view = riskView(feiyuSnapshot, {});

  it('每份要写的现场处置方案一类事故，默认取值照飞宇实际报告', () => {
    const fire = row(view, '火灾');
    expect(fire).toMatchObject({ workplace: '1 号生产厂房', l: 1, e: 6, c: 7, d: 42, level: '一般危险', source: 'system' });
    expect(fire.planTitle).toBe('火灾事故现场处置方案');
    expect(row(view, '高温熔融物爆炸')).toMatchObject({ l: 0.5, e: 3, c: 7, level: '稍有危险' });
    // 飞宇没有行车、电梯
    expect(view.rows.some((r) => r.factor === '起重致害')).toBe(false);
  });

  it('场所取触发它的设备或物料所在位置，依据点名设备物料', () => {
    expect(row(view, '可燃液体蒸气爆炸')).toMatchObject({
      workplace: '化学品柜',
      item: '酒精',
      ref: { list: 'materials', name: '酒精' },
      basis: '资料里有「酒精」',
    });
    expect(row(view, '机械致害').basis).toMatch(/^设备清单里有「.+」，系统默认列入$/);
    expect(row(view, '触电').workplace).toBe('配电房');
    expect(row(view, '容器爆炸').workplace).toBe('空压机房');
  });

  it('左栏按场所计数，底部按等级汇总', () => {
    const total = view.rows.length;
    expect(view.places.reduce((s, p) => s + p.count, 0)).toBe(total);
    expect(view.levels.reduce((s, l) => s + l.count, 0)).toBe(total);
  });

  it('专家判定酒精不是危化品后，可燃液体蒸气爆炸不再推荐', () => {
    const alcohol = productionView(feiyuSnapshot, {}).materials.find((m) => m.name === '酒精')!;
    const production = { ...emptyProductionWorkup(), hazardous: { [alcohol.id]: judged(false) } };
    expect(riskView(feiyuSnapshot, { production }).rows.some((r) => r.factor === '可燃液体蒸气爆炸')).toBe(false);
  });
});

describe('专家取值与修改', () => {
  const fire = row(riskView(feiyuSnapshot, {}), '火灾');
  const base = { factor: fire.factor, workplace: fire.workplace, l: fire.l, e: fire.e, c: fire.c };

  it('改取值后 D 和等级跟着变，记下改了什么', () => {
    const view = riskView(feiyuSnapshot, withRows({ SP01: judged({ ...base, c: 40, note: '仓库紧邻车间' }) }));
    expect(row(view, '火灾')).toMatchObject({ c: 40, d: 240, level: '高度危险', source: 'expert', note: '仓库紧邻车间', changes: ['C 7 → 40'] });
    expect(planHazardsOf(view).find((h) => h.factor === '火灾')).toEqual({ workplace: '1 号生产厂房', factor: '火灾', l: 1, e: 6, c: 40 });
  });

  it('标为不适用：不进报告、不计数，可恢复', () => {
    const view = riskView(feiyuSnapshot, withRows({ SP01: judged({ ...base, excluded: true }) }));
    expect(row(view, '火灾').excluded).toBe(true);
    expect(planHazardsOf(view).some((h) => h.factor === '火灾')).toBe(false);
    const before = riskView(feiyuSnapshot, {}).places.find((p) => p.name === '1 号生产厂房')!.count;
    expect(view.places.find((p) => p.name === '1 号生产厂房')!.count).toBe(before - 1);
  });

  it('手动新增的一行排在候选之后', () => {
    const view = riskView(feiyuSnapshot, withRows({ xa1: judged({ factor: '其他爆炸', workplace: '气瓶间', l: 1, e: 3, c: 40 }) }));
    expect(view.rows.at(-1)).toMatchObject({ id: 'xa1', added: true, basis: '专家手动新增', d: 120, level: '显著危险', changes: [] });
    expect(planHazardsOf(view).at(-1)).toEqual({ workplace: '气瓶间', factor: '其他爆炸', l: 1, e: 3, c: 40 });
  });

  it('取值只能从取值表里选，名称和场所必填', () => {
    const ok = { version: 1, rowId: 'SP01', value: base };
    expect(riskSaveSchema.safeParse(ok).success).toBe(true);
    expect(riskSaveSchema.safeParse({ ...ok, value: { ...base, c: 20 } }).error?.issues[0]?.message).toBe('C 请从取值表里选');
    expect(riskSaveSchema.safeParse({ ...ok, value: { ...base, workplace: ' ' } }).error?.issues[0]?.message).toBe('请填写作业场所');
    expect(riskSaveSchema.safeParse({ ...ok, value: null }).success).toBe(true);
  });

  it('只能改现有候选或新增行', () => {
    expect(riskSaveError(feiyuSnapshot, {}, { version: 1, rowId: 'SP01', value: base })).toBeNull();
    expect(riskSaveError(feiyuSnapshot, {}, { version: 1, rowId: 'xnew', value: base })).toBeNull();
    expect(riskSaveError(feiyuSnapshot, {}, { version: 1, rowId: 'SP08', value: base })).toBe('没有这一项危险源');
  });
});
