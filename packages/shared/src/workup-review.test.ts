// 第 5 步「资料版本」里「您修改 N 处、补充 N 项」的计数
import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import { expertEditCounts } from './workup-review.ts';
import { workupFacts, type WorkupData } from './workup.ts';

const blank = (): WorkupData => ({ overrides: {} });
const production = () => structuredClone(feiyuSnapshot.profile.productionStep!);

describe('expertEditCounts', () => {
  it('什么都没改：都是 0', () => {
    expect(expertEditCounts(feiyuSnapshot, blank())).toEqual({ modified: 0, supplemented: 0 });
  });

  it('只改重大危险源结论：修改 1、补充 0', () => {
    const data: WorkupData = { ...blank(), review: { majorHazard: { value: '构成', reason: '现场核实', substances: [{ name: '乙炔', storage: '2 t' }] } } };
    expect(expertEditCounts(feiyuSnapshot, data)).toEqual({ modified: 1, supplemented: 0 });
  });

  it('删掉中间一行设备：修改 1（后面的行按 id 对齐，不算改动）', () => {
    const p = production();
    expect(p.step.equipment.length).toBeGreaterThanOrEqual(3);
    p.step.equipment.splice(1, 1);
    const data: WorkupData = { ...blank(), profile: { productionStep: p } };
    expect(expertEditCounts(feiyuSnapshot, data)).toEqual({ modified: 1, supplemented: 0 });
  });

  it('新增一行设备、填 3 个字段：补充 1', () => {
    const p = production();
    p.step.equipment.push({ id: 'ex1', name: '空压机', spec: '7.5 kW', quantity: '1 台', location: '', condition: '' } as (typeof p.step.equipment)[number]);
    const data: WorkupData = { ...blank(), profile: { productionStep: p } };
    expect(expertEditCounts(feiyuSnapshot, data)).toEqual({ modified: 0, supplemented: 1 });
  });

  it('专家单项补的事实：和字段里的值一样的不重复算；客户表格里没有的算补充 1', () => {
    const stamp = { source: 'expert' as const, by: 'u', byName: '周工', at: '2026-11-20T08:00:00.000Z' };
    const same = workupFacts(feiyuSnapshot, blank()).find((f) => f.key === 'employeeCount')!.value!;
    const data: WorkupData = { overrides: { employeeCount: { value: same, ...stamp }, establishedDate: { value: '2008-05-01', ...stamp } } };
    expect(expertEditCounts(feiyuSnapshot, data)).toEqual({ modified: 0, supplemented: 1 });
  });
});
