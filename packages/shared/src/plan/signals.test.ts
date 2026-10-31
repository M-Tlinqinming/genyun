import { describe, expect, it } from 'vitest';
import { feiyuPlanInput } from '../fixtures/feiyu-plan.ts';
import type { PlanInput } from './input.ts';
import { planSignals } from './signals.ts';

const base = feiyuPlanInput.production.materials[0]!;
/** 飞宇样例换掉物料、设备、工序（虚构） */
function withProduction(names: string[], equipment: string[] = [], steps: string[] = [], products?: string): PlanInput {
  return {
    ...feiyuPlanInput,
    basic: { ...feiyuPlanInput.basic, mainProducts: products ?? feiyuPlanInput.basic.mainProducts },
    production: {
      ...feiyuPlanInput.production,
      materials: names.map((name) => ({ ...base, name, storageLocation: '原料仓库' })),
      equipment: equipment.map((name) => ({ ...feiyuPlanInput.production.equipment[0]!, name, location: '2 号车间' })),
      processFlow: {
        ...feiyuPlanInput.production.processFlow,
        steps: steps.map((name) => ({ name, equipment: [], inputs: [], next: 'next' as const })),
      },
    },
  };
}

describe('可燃气体', () => {
  it('只认真正的可燃气体，氧气、氩气、氮气、压缩空气不算', () => {
    const s = planSignals(withProduction(['氧气', '氩气', '氮气', '压缩空气']));
    expect(s.combustibleGases).toEqual([]);
  });

  it('液化石油气只记一次，并带出存放位置', () => {
    const s = planSignals(withProduction(['液化石油气', '乙炔', '氧气']));
    expect(s.combustibleGases).toEqual(['液化石油气', '乙炔']);
    expect(s.gasLocations).toEqual(['原料仓库']);
  });
});

describe('锂电池', () => {
  it('物料、设备或主要产品里有锂电池就算', () => {
    expect(planSignals(withProduction(['锂离子电池'])).lithium).toBe(true);
    expect(planSignals(withProduction([], [], [], '移动电源、锂电池组')).lithiumItems).toContain('锂电池组');
  });

  it('锂基润滑脂、碳酸锂这类不是电池', () => {
    const s = planSignals(withProduction(['锂基润滑脂', '碳酸锂'], [], [], '灯具'));
    expect(s.lithium).toBe(false);
  });
});

describe('粉尘种类', () => {
  it('没有木材依据不写木粉尘；喷粉写树脂粉尘', () => {
    const s = planSignals(withProduction(['粉末涂料'], ['喷粉柜'], ['喷粉']));
    expect(s.dustKinds).toContain('树脂粉尘（粉末涂料）');
    expect(s.dustKinds).not.toContain('木粉尘');
  });

  it('有木材开料才写木粉尘', () => {
    const s = planSignals(withProduction(['木材'], [], ['木材开料', '砂光']));
    expect(s.dustKinds).toContain('木粉尘');
  });
});
