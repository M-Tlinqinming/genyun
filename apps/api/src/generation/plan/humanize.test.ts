import { describe, expect, it } from 'vitest';
import { dropMissingRefs, humanize } from './humanize.ts';

describe('方案之间的互相引用', () => {
  it('引用的方案出了：换成方案名称', () => {
    expect(humanize(dropMissingRefs('按 SP13 中毒事故处置方案联动；', new Set(['SP13'])))).toBe('按 中毒事故处置方案联动；');
  });

  it('引用的方案没出：改成相应现场处置方案', () => {
    expect(humanize(dropMissingRefs('按 SP13 中毒事故处置方案联动；', new Set(['SP01'])))).toBe('按 相应现场处置方案联动；');
    expect(humanize(dropMissingRefs('（按 SP06 灼烫事故处置方案联动）', new Set()))).toBe('（按 相应现场处置方案联动）');
  });

  it('专项预案没出：改成相应专项应急预案', () => {
    expect(dropMissingRefs('启动 P5 专项应急预案', new Set(['P1']))).toBe('启动 相应专项应急预案');
  });
});
