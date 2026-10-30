import { describe, expect, it } from 'vitest';
import { processFlowSvg, orgChartSvg } from './document/figures.ts';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import {
  figureSignature,
  figuresSaveError,
  figuresSaveSchema,
  figuresView,
  flowOptionsOf,
  orderGroups,
  planFiguresOf,
  type FiguresWorkup,
} from './workup-figures.ts';
import type { WorkupSnapshot } from './workup.ts';

const stamp = { by: 'u-zhou', byName: '周工', at: '2026-10-30T08:00:00.000Z' };
const view = (figures?: FiguresWorkup, overrides = {}) => figuresView(feiyuSnapshot, { overrides, figures });
const adoptAll = (figures: FiguresWorkup = {}): FiguresWorkup => {
  const v = view(figures);
  return {
    ...figures,
    adopted: { org: { ...stamp, signature: figureSignature(v, 'org') }, process: { ...stamp, signature: figureSignature(v, 'process') } },
  };
};

describe('图件：自动排版', () => {
  const v = view();

  it('飞宇：小组按规则排序，有副总指挥就显示，应急办公室默认不显示', () => {
    expect(v.org.groups).toEqual(['抢险救灾组', '综合保障组', '通讯联络组']);
    expect(v.org).toMatchObject({ deputy: true, office: false, customized: false, status: 'pending' });
  });

  it('飞宇：10 道工序、每行 5 道、没有支路；两张图都要采用', () => {
    expect(v.process).toMatchObject({ available: true, perRow: 5, customized: false, source: '由客户的一句话描述拆出' });
    expect(v.process.steps).toHaveLength(10);
    expect(v.required).toBe(2);
    expect(v.pending.map((p) => p.label)).toEqual(['应急救援组织体系图', '生产工艺流程图']);
  });

  it('没有工序时工艺流程图画不出，不计入必需项，也不能采用', () => {
    const profile = structuredClone(feiyuSnapshot.profile);
    profile.productionStep!.step.process.steps = [];
    const empty = figuresView({ ...feiyuSnapshot, profile } as WorkupSnapshot, { overrides: {} });
    expect(empty.process.available).toBe(false);
    expect(empty.required).toBe(1);
    expect(figuresSaveError(empty, { version: 1, adopt: ['process'] })).toBe('没有工序，画不出工艺流程图');
  });
});

describe('图件：专家微调', () => {
  it('隐藏副总指挥、显示应急办公室、调换小组顺序', () => {
    const v = view({ org: { deputy: false, office: true, order: ['通讯联络组', '抢险救灾组'] } });
    // 没列进顺序的小组按规则排在后面
    expect(v.org.groups).toEqual(['通讯联络组', '抢险救灾组', '综合保障组']);
    expect(v.org).toMatchObject({ deputy: false, office: true, customOrder: true, customized: true });
  });

  it('顺序里已删掉的小组忽略', () => {
    expect(orderGroups(['甲', '乙'], ['丙', '乙', '甲'])).toEqual(['乙', '甲']);
  });

  it('每行工序数与返工支路；工序名称对不上的支路不画', () => {
    const v = view({
      process: {
        perRow: 4,
        branches: [
          { id: 'b1', from: '品质检测', to: '抛光', kind: 'rework' },
          { id: 'b2', from: '包装出货', to: '不存在', kind: 'reuse' },
        ],
      },
    });
    expect(v.process.perRow).toBe(4);
    expect(v.process.branches.map((b) => b.valid)).toEqual([true, false]);
    expect(v.process.flowBranches).toEqual([{ from: 8, to: 5, label: '返工' }]);
  });

  it('支路起点终点相同不能保存', () => {
    const save = figuresSaveSchema.parse({ version: 1, process: { branches: [{ id: 'b1', from: '压铸', to: '压铸', kind: 'rework' }] } });
    expect(figuresSaveError(view(), save)).toBe('支路的起点和终点不能是同一道工序');
  });
});

describe('图件：采用', () => {
  it('采用后两张图都不再待处理', () => {
    const v = view(adoptAll());
    expect(v.org.status).toBe('adopted');
    expect(v.process.status).toBe('adopted');
    expect(v.pending).toEqual([]);
  });

  it('采用后改了画法回到待采用（有变化）', () => {
    const adopted = adoptAll();
    const v = view({ ...adopted, process: { perRow: 3 } });
    expect(v.process.status).toBe('changed');
    expect(v.org.status).toBe('adopted');
    expect(v.pending.map((p) => p.key)).toEqual(['process']);
  });

  it('采用后专家在企业事实里补了副总指挥：自动排版的图跟着变，回到待采用', () => {
    const profile = structuredClone(feiyuSnapshot.profile);
    profile.organizationStep!.step.deputies = [];
    const snapshot = { ...feiyuSnapshot, profile } as WorkupSnapshot;
    const before = figuresView(snapshot, { overrides: {} });
    expect(before.org.deputy).toBe(false);
    const figures: FiguresWorkup = { adopted: { org: { ...stamp, signature: figureSignature(before, 'org') } } };
    const after = figuresView(snapshot, { overrides: { 'deputy.1': { value: { name: '李四' }, source: 'expert', ...stamp } }, figures });
    expect(after.org).toMatchObject({ deputy: true, status: 'changed' });
  });
});

describe('图件进生成数据', () => {
  it('planFiguresOf 按名称给出画法，生成时对回工序下标', () => {
    const v = view({ org: { office: true }, process: { perRow: 0, branches: [{ id: 'b1', from: '品质检测', to: '抛光', kind: 'rework' }] } });
    const plan = planFiguresOf(v);
    expect(plan.org).toEqual({ deputy: true, office: true, order: ['抢险救灾组', '综合保障组', '通讯联络组'] });
    expect(flowOptionsOf(v.process.steps, plan.process)).toEqual({ perRow: 0, branches: [{ from: 8, to: 5, label: '返工' }] });
  });

  it('画出来的图：单行更宽，支路与应急办公室出现在图里', () => {
    const steps = view().process.steps;
    const auto = processFlowSvg(steps);
    const single = processFlowSvg(steps, { perRow: 0 });
    expect(single.width).toBeGreaterThan(auto.width);
    expect(single.height).toBeLessThan(auto.height);
    const branched = processFlowSvg(steps, { branches: [{ from: 8, to: 5, label: '返工' }] });
    expect(branched.svg).toContain('返工');
    expect(branched.svg).toContain('stroke-dasharray');
    // 同一行的支路只在框下方加高；跨行的从左边绕，图变宽
    expect(branched.width).toBe(auto.width);
    expect(branched.height).toBeGreaterThan(auto.height);
    expect(processFlowSvg(steps, { branches: [{ from: 8, to: 1, label: '回用' }] }).width).toBeGreaterThan(auto.width);
    const office = orgChartSvg({ deputy: true, office: true, groups: ['抢险救灾组'] });
    expect(office.svg).toContain('应急办公室');
    expect(orgChartSvg({ deputy: true, groups: ['抢险救灾组'] }).svg).not.toContain('应急办公室');
  });
});
