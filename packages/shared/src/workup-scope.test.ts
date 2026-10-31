import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import { emptyProductionWorkup, type Judged } from './workup-production.ts';
import { riskView } from './workup-risk.ts';
import { scopeSaveSchema, scopeView, type ScopeWorkup } from './workup-scope.ts';

const stamp = { by: 'u-zhou', byName: '周工', at: '2026-10-29T08:00:00.000Z' };
const judged = <T>(value: T): Judged<T> => ({ ...stamp, value });
const withScope = (switches: ScopeWorkup['switches']) => ({ scope: { switches } });
const titles = (plans: { template: { title: string } }[]) => plans.map((p) => p.template.title);

describe('适用范围：哪些开关要专家确认', () => {
  const view = scopeView(feiyuSnapshot, {});
  const sw = (label: string) => view.switches.find((s) => s.label === label)!;

  it('飞宇：名称推断、拍照待看、物料没判定、粉尘量大小、消防水池的 6 个开关待确认，其余 15 个已确定', () => {
    expect(view.pending.map((s) => s.label)).toEqual(['压力管道', '粉尘', '粉尘专项', '熔融', '淹溺', '使用可燃液体']);
    expect(view.required).toBe(6);
    // 跌落不再默认打开
    expect(sw('跌落坠落')).toMatchObject({ status: 'confirmed', value: false, suggestion: { basis: 'none' } });
    expect(sw('粉尘专项').suggestion).toMatchObject({ value: false, basis: 'cue' });
    expect(sw('粉尘专项').suggestion.reason).toContain('没有除尘系统');
    expect(sw('粉尘').suggestion).toMatchObject({ value: true, basis: 'cue', reason: '资料里有「钻孔攻牙机」' });
    expect(sw('压力管道').suggestion.basis).toBe('photo');
    // 客户明确回答、工贸企业默认打开、没有依据的都算已确定
    expect(sw('出租厂房')).toMatchObject({ status: 'confirmed', value: false, suggestion: { basis: 'answer' } });
    expect(sw('厂内车辆')).toMatchObject({ status: 'confirmed', value: true, suggestion: { basis: 'default' } });
    expect(sw('电梯')).toMatchObject({ status: 'confirmed', value: false, suggestion: { basis: 'none' } });
  });

  it('酒精判定为危化品后，可燃液体开关不用再确认；判定不是则建议关闭', () => {
    const yes = scopeView(feiyuSnapshot, { production: { ...emptyProductionWorkup(), hazardous: { m5: judged(true) } } });
    expect(yes.switches.find((s) => s.key === 'flammableLiquid')).toMatchObject({ status: 'confirmed', value: true });
    const no = scopeView(feiyuSnapshot, { production: { ...emptyProductionWorkup(), hazardous: { m5: judged(false) } } });
    expect(no.switches.find((s) => s.key === 'flammableLiquid')).toMatchObject({ status: 'confirmed', value: false });
  });

  it('专家确认后不再待确认，必需项总数不变；撤回回到系统建议', () => {
    const v = scopeView(feiyuSnapshot, withScope({ dustProcess: judged(false), meltingProcess: judged(true) }));
    // 关掉产尘工序，粉尘专项跟着关、算已确定
    expect(v.pending.map((s) => s.key)).toEqual(['pressurePipeline', 'waterHazard', 'flammableLiquid']);
    expect(v.required).toBe(6);
    expect(v.switches.find((s) => s.key === 'dustSpecialty')).toMatchObject({ status: 'confirmed', value: false });
    expect(v.scope.dustSpecialty).toBe(false);
    expect(v.scope.dustProcess).toBe(false);
    expect(scopeView(feiyuSnapshot, withScope({})).scope.dustProcess).toBe(true);
  });

  it('已确定的开关专家也可以改：打开出租厂房多出承租企业专项预案', () => {
    const v = scopeView(feiyuSnapshot, withScope({ landlord: judged(true) }));
    expect(titles(v.preview.specialty)).toContain('承租企业生产安全事故专项应急预案');
    expect(v.preview.specialty.find((p) => p.template.title.startsWith('承租'))?.state).toBe('included');
  });
});

describe('生成结构预览', () => {
  it('待确认开关影响的章节标出来；按建议含的和不含的分开', () => {
    const view = scopeView(feiyuSnapshot, {});
    const dust = view.preview.specialty.find((p) => p.template.title === '粉尘爆炸事故专项应急预案');
    // 飞宇没有除尘系统，粉尘专项建议不含；现场处置方案跟着产尘工序，建议含
    expect(dust).toMatchObject({ state: 'pendingOut', pendingKey: 'dustSpecialty' });
    expect(view.preview.site.find((p) => p.template.title === '粉尘爆炸事故现场处置方案')).toMatchObject({ state: 'pendingIn', pendingKey: 'dustProcess' });
    const big = scopeView(feiyuSnapshot, withScope({ dustSpecialty: judged(true) }));
    expect(big.preview.specialty.find((p) => p.template.title === '粉尘爆炸事故专项应急预案')?.state).toBe('included');
    expect(view.preview.specialty.find((p) => p.template.title === '火灾爆炸事故专项应急预案')?.state).toBe('always');
    // 有消防水池建议不出淹溺方案，请专家确认
    expect(view.preview.site.find((p) => p.template.title === '淹溺事故现场处置方案')?.state).toBe('pendingOut');
    expect(view.preview.site.find((p) => p.template.title === '触电事故现场处置方案')?.state).toBe('always');
    // 已确定关闭的不出现
    expect(titles(view.preview.site)).not.toContain('起重致害事故现场处置方案');
  });

  it('专家关闭粉尘后预览即时去掉两份；建议关的待确认开关显示为「建议不含」', () => {
    const off = scopeView(feiyuSnapshot, withScope({ dustProcess: judged(false) }));
    expect(titles(off.preview.specialty)).not.toContain('粉尘爆炸事故专项应急预案');
    expect(titles(off.preview.site)).not.toContain('粉尘爆炸事故现场处置方案');

    // 酒精判定不是危化品但客户拍了压力管道照片：压力管道仍待确认，按建议含
    const pipe = scopeView(feiyuSnapshot, {}).preview.site.find((p) => p.template.title === '管道爆炸事故现场处置方案');
    expect(pipe?.state).toBe('pendingIn');
  });

  it('危险源候选跟着确认后的开关增减', () => {
    const before = riskView(feiyuSnapshot, {}).rows.map((r) => r.factor);
    expect(before).toContain('粉尘爆炸');
    const after = riskView(feiyuSnapshot, withScope({ dustProcess: judged(false), craneHoist: judged(true) }));
    expect(after.rows.map((r) => r.factor)).not.toContain('粉尘爆炸');
    const crane = after.rows.find((r) => r.factor === '起重致害');
    expect(crane?.basis).toBe('专家确认「有行车、电动葫芦等起重机械」');
  });
});

describe('保存', () => {
  it('只接受 20 个开关之一，值为开 / 关 / 撤回', () => {
    expect(scopeSaveSchema.safeParse({ version: 1, key: 'dustProcess', value: false }).success).toBe(true);
    expect(scopeSaveSchema.safeParse({ version: 1, key: 'dustProcess', value: null }).success).toBe(true);
    const bad = scopeSaveSchema.safeParse({ version: 1, key: 'P2', value: true });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('没有这个开关');
  });
});
