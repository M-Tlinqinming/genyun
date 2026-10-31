import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import { emptyProductionWorkup, productionView, type Judged } from './workup-production.ts';
import { joinWorkplaces, planHazardsOf, riskSaveError, riskSaveSchema, riskView, workplacesOf, type RiskRowValue } from './workup-risk.ts';
import { scopeView } from './workup-scope.ts';

const stamp = { by: 'u-zhou', byName: '周工', at: '2026-10-29T08:00:00.000Z' };
const judged = <T>(value: T): Judged<T> => ({ ...stamp, value });
const withRows = (rows: Record<string, Judged<RiskRowValue>>) => ({ risks: { rows } });
const row = (view: ReturnType<typeof riskView>, factor: string) => view.rows.find((r) => r.factor === factor)!;

describe('危险源候选的系统推荐', () => {
  const view = riskView(feiyuSnapshot, {});

  it('每份要写的现场处置方案一类事故，默认取值照飞宇实际报告', () => {
    const fire = row(view, '火灾');
    // 火灾不再都写第一栋建筑：各设备使用地点加物料存放位置
    expect(fire).toMatchObject({ workplace: '压铸车间、加工车间、公用工程、原料仓库、成品仓库、辅料仓库、化学品柜', l: 1, e: 6, c: 7, d: 42, level: '一般危险', source: 'system' });
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
      basis: '危险化学品「酒精」属于易燃液体，最大储存量合计 50 kg',
    });
    expect(row(view, '机械致害').basis).toMatch(/^设备清单里有「.+」，系统默认列入$/);
    expect(row(view, '触电').workplace).toBe('配电房');
    expect(row(view, '容器爆炸').workplace).toBe('空压机房');
    // 同类设备分在几个车间就都列上
    expect(row(view, '机械致害').workplace).toBe('压铸车间、加工车间');
    expect(row(view, '灼烫').workplace).toBe('压铸车间');
    expect(row(view, '厂（场）内车辆致害').workplace).toBe('厂区道路');
    expect(view.rows.some((r) => r.workplace === '1 号生产厂房')).toBe(false);
  });

  it('改场所的可选项来自设备使用地点、存放位置、建筑和勾选的场所', () => {
    expect(view.placeOptions).toEqual(expect.arrayContaining(['压铸车间', '加工车间', '化学品柜', '1 号生产厂房', '配电房']));
    expect(new Set(view.placeOptions).size).toBe(view.placeOptions.length);
  });

  it('左栏按场所计数（一行写几个场所各算一次），底部按等级汇总', () => {
    const total = view.rows.length;
    expect(view.levels.reduce((s, l) => s + l.count, 0)).toBe(total);
    for (const p of view.places) expect(p.count).toBe(view.rows.filter((r) => workplacesOf(r.workplace).includes(p.name)).length);
    expect(view.places.reduce((s, p) => s + p.count, 0)).toBe(view.rows.reduce((s, r) => s + workplacesOf(r.workplace).length, 0));
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
    expect(planHazardsOf(view).find((h) => h.factor === '火灾')).toEqual({ workplace: '压铸车间、加工车间、公用工程、原料仓库、成品仓库、辅料仓库、化学品柜', factor: '火灾', l: 1, e: 6, c: 40, likelihood: 2, severity: 2 });
  });

  it('LSR 的可能性、严重性按事故类型给默认值，R 和等级自动算；改了也记下', () => {
    const view = riskView(feiyuSnapshot, {});
    expect(row(view, '火灾')).toMatchObject({ likelihood: 2, severity: 2, r: 4, lsrLevel: '可容忍' });
    expect(row(view, '机械致害')).toMatchObject({ likelihood: 2, severity: 4, r: 8, lsrLevel: '可容忍' });
    // 5 份专家报告里没出现过的类型按 1 × 3
    expect(row(view, '高温熔融物爆炸')).toMatchObject({ likelihood: 1, severity: 3, r: 3, lsrLevel: '轻微' });
    const edited = riskView(feiyuSnapshot, withRows({ SP01: judged({ ...base, likelihood: 3, severity: 4 }) }));
    expect(row(edited, '火灾')).toMatchObject({ r: 12, lsrLevel: '中等', changes: ['可能性 2 → 3', '严重性 2 → 4'] });
    expect(riskSaveSchema.safeParse({ version: 1, rowId: 'SP01', value: { ...base, severity: 6 } }).error?.issues[0]?.message).toBe('严重性请从取值表里选');
  });

  it('标为不适用：不进报告、不计数，可恢复', () => {
    const view = riskView(feiyuSnapshot, withRows({ SP01: judged({ ...base, excluded: true }) }));
    expect(row(view, '火灾').excluded).toBe(true);
    expect(planHazardsOf(view).some((h) => h.factor === '火灾')).toBe(false);
    const before = riskView(feiyuSnapshot, {}).places.find((p) => p.name === '辅料仓库')!.count;
    expect(before).toBe(1);
    expect(view.places.some((p) => p.name === '辅料仓库')).toBe(false);
  });

  it('手动新增的一行排在候选之后', () => {
    const view = riskView(feiyuSnapshot, withRows({ xa1: judged({ factor: '其他爆炸', workplace: '气瓶间', l: 1, e: 3, c: 40 }) }));
    expect(view.rows.at(-1)).toMatchObject({ id: 'xa1', added: true, basis: '专家手动新增', d: 120, level: '显著危险', changes: [] });
    // 早先保存、没有 LSR 取值的行按事故类型补默认值
    expect(planHazardsOf(view).at(-1)).toEqual({ workplace: '气瓶间', factor: '其他爆炸', l: 1, e: 3, c: 40, likelihood: 2, severity: 3 });
  });

  it('场所可以多选，用「、」存成一格；太长时只留前几个加「等」', () => {
    const view = riskView(feiyuSnapshot, withRows({ SP01: judged({ ...base, workplace: '压铸车间、仓库' }) }));
    expect(row(view, '火灾').changes).toEqual([`场所 ${base.workplace} → 压铸车间、仓库`]);
    expect(view.places.find((p) => p.name === '仓库')?.count).toBe(1);
    expect(workplacesOf('压铸车间、 加工车间，压铸车间')).toEqual(['压铸车间', '加工车间']);
    const long = joinWorkplaces(Array.from({ length: 30 }, (_, i) => `第${i + 1}号车间`));
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('等')).toBe(true);
    expect(riskSaveSchema.safeParse({ version: 1, rowId: 'SP01', value: { ...base, workplace: long } }).success).toBe(true);
  });

  it('专家新增中毒：适用范围建议打开对应开关，候选不重复列', () => {
    const data = withRows({ xa2: judged({ factor: '中毒', workplace: '化学品柜', l: 1, e: 3, c: 15 }) });
    const toxic = scopeView(feiyuSnapshot, data).switches.find((s) => s.key === 'toxicChemicals')!;
    expect(toxic).toMatchObject({ value: true, status: 'pending', suggestion: { basis: 'cue' } });
    expect(toxic.suggestion.reason).toBe('危险源辨识里列了「中毒」（化学品柜），对应的现场处置方案要出，请确认');
    const view = riskView(feiyuSnapshot, data);
    expect(view.rows.filter((r) => r.factor === '中毒').map((r) => r.id)).toEqual(['xa2']);
    // 标为不适用后不再带出
    const off = withRows({ xa2: judged({ factor: '中毒', workplace: '化学品柜', l: 1, e: 3, c: 15, excluded: true }) });
    expect(scopeView(feiyuSnapshot, off).switches.find((s) => s.key === 'toxicChemicals')?.value).toBe(false);
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
