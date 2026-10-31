import { describe, expect, it } from 'vitest';
import { HAZCHEM_ROWS } from './hazchem-data.ts';
import { hazchemCount, hazchemEntry, hazchemSuggestionOf } from './hazchem.ts';

const of = (name: string, casNumber?: string) => hazchemSuggestionOf({ name, casNumber });

describe('《危险化学品目录（2015 版）》', () => {
  it('2828 条，序号连续；剧毒化学品 148 种', () => {
    expect(hazchemCount()).toBe(2828);
    expect(HAZCHEM_ROWS.map((r) => r[0])).toEqual(Array.from({ length: 2828 }, (_, i) => i + 1));
    expect(HAZCHEM_ROWS.filter((r) => r[5] === 1)).toHaveLength(148);
  });

  it('逐条与原文一致（抽查）', () => {
    expect(hazchemEntry(2548)).toMatchObject({ name: '液化石油气', cas: ['68476-85-7'] });
    expect(hazchemEntry(981)?.cas).toEqual(['75-21-8']);
    expect(hazchemEntry(2568)?.cas).toEqual(['64-17-5']);
    expect(hazchemEntry(33)?.name).toBe('2-氨基乙醇');
  });
});

describe('按目录判定危化品', () => {
  it('名称、别名、常用叫法都认，理由写目录序号', () => {
    expect(of('酒精')).toMatchObject({ value: true, kinds: ['flammableLiquid'] });
    expect(of('无水乙醇')?.reason).toContain('第 2568 号');
    expect(of('液化石油气')).toMatchObject({ value: true, kinds: expect.arrayContaining(['flammableGas']) });
    expect(of('环氧乙烷')?.kinds).toEqual(expect.arrayContaining(['flammableGas', 'toxic']));
    expect(of('液氮')?.kinds).toEqual(['inertGas']);
    expect(of('氧气')?.kinds).toContain('oxidizer');
  });

  it('CAS 号相同即同一种：商品名查不到时按 CAS 号认', () => {
    expect(of('清洗剂 A', '110-54-3')?.reason).toContain('第 2789 号');
    // 铝、锌目录只收粉状，锭料不是
    expect(of('铝锭', '7429-90-5')?.value).toBe(false);
  });

  it('名称里写了成分的按成分认；常见含溶剂的混合物按闪点规定请专家确认', () => {
    const wash = of('洗板水（含正己烷、三氯乙烯）');
    expect(wash?.value).toBe(true);
    expect(wash?.reason).toContain('成分含');
    expect(of('洗网水')?.reason).toContain('第 2828 号');
    expect(of('水性油墨')?.value).not.toBe(true);
  });

  it('不误判：乙醇胺不是酒精，气瓶柜不是气体，聚苯乙烯、硫酸铜不算', () => {
    expect(of('乙醇胺')?.kinds).not.toContain('flammableLiquid');
    expect(of('气瓶柜')).toBeUndefined();
    expect(of('聚苯乙烯')?.value).not.toBe(true);
    expect(of('硫酸铜')?.value).not.toBe(true);
    expect(of('陶瓷灯头')).toBeUndefined();
  });
});
