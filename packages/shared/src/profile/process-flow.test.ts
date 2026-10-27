import { describe, expect, it } from 'vitest';
import { feiyuBasicInfo, feiyuProduction } from '../fixtures/feiyu.ts';
import {
  checkProcessEquipment,
  PROCESS_STEP_MAX,
  PROCESS_TEMPLATE_IDS,
  PROCESS_TEMPLATES,
  processDraftSchema,
  processStartReady,
  recommendedTemplate,
  snakeRows,
  stepsFromDescription,
  stepsFromTemplate,
} from './process-flow.ts';
import { productionStepSchema } from './production-step.ts';

let seq = 0;
const makeId = () => `s${++seq}`;

describe('企业自填第 3 步 · 工艺流程', () => {
  it('飞宇样例没有接近的模板，写一句话拆成 10 道工序，可以开始编制', () => {
    expect(recommendedTemplate(feiyuBasicInfo.businessScope)).toBeUndefined();
    const description = feiyuProduction.processFlow.description!;
    const steps = stepsFromDescription(description, makeId);
    expect(steps.map((s) => s.name)).toEqual(feiyuProduction.processFlow.steps.map((s) => s.name.replace('CNC加工', 'CNC 加工')));
    const process = processDraftSchema.parse({ source: 'text', description, steps });
    expect(processStartReady(process)).toBe(true);
  });

  it('一句话里的箭头、逗号、换行都能拆开，空的不算', () => {
    expect(stepsFromDescription('下料 → 冲压，折弯\n\n包装、', makeId).map((s) => s.name)).toEqual([
      '下料',
      '冲压',
      '折弯',
      '包装',
    ]);
    expect(stepsFromDescription('、，', makeId)).toEqual([]);
  });

  it('6 个内置模板都能通过规则；选中后工序和用到的设备一起带出', () => {
    expect(PROCESS_TEMPLATE_IDS).toHaveLength(6);
    for (const tid of PROCESS_TEMPLATE_IDS) {
      const steps = stepsFromTemplate(tid, makeId);
      expect(processDraftSchema.safeParse({ source: 'template', templateId: tid, steps }).success).toBe(true);
    }
    const lithium = stepsFromTemplate('lithium_battery', makeId);
    expect(lithium).toHaveLength(10);
    expect(lithium.find((s) => s.name === '电焊插头线')?.equipment).toEqual(['点焊机']);
  });

  it('按经营范围推荐模板，先出现的关键词优先', () => {
    expect(recommendedTemplate('锂离子电池组装、销售')).toBe('lithium_battery');
    expect(recommendedTemplate('塑料制品注塑加工；五金配件')).toBe('injection_molding');
    expect(recommendedTemplate('smt 贴片加工')).toBe('smt');
    expect(recommendedTemplate(undefined)).toBeUndefined();
  });

  it('没有工序、描述、照片时还不能开始编制；只传流程图照片也算', () => {
    expect(processStartReady(processDraftSchema.parse({}))).toBe(false);
    expect(processStartReady(processDraftSchema.parse({ steps: [{ id: 'a', name: ' ' }] }))).toBe(false);
    expect(
      processStartReady(processDraftSchema.parse({ sketchFileIds: ['0199b3c5-7e1a-7000-8000-000000000001'] })),
    ).toBe(true);
  });

  it('工序用到的设备和设备表核对：已有的关联上，没有的列出来', () => {
    const steps = stepsFromTemplate('lithium_battery', makeId);
    const check = checkProcessEquipment(steps, [
      { name: '气动点焊机', quantity: '2 台' },
      { name: '喷码机', quantity: '1 台' },
      { name: '' },
    ]);
    expect(check.linked).toContainEqual({ step: '电焊插头线', equipment: '气动点焊机', quantity: '2 台' });
    expect(check.linked.map((l) => l.step)).toContain('喷码');
    // 两道工序都用检测柜，只列一次
    expect(check.missing).toEqual(['裁切机', '打印机', '检测柜', '热风枪']);
  });

  it('流程图蛇形折行：第 2 行从右往左排', () => {
    expect(snakeRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 5)).toEqual([
      { items: [1, 2, 3, 4, 5], reversed: false },
      { items: [10, 9, 8, 7, 6], reversed: true },
      { items: [11], reversed: false },
    ]);
    expect(snakeRows([], 5)).toEqual([]);
  });

  it('工序名称、数量有上限；第 3 步没填过工艺流程时为空', () => {
    const tooMany = Array.from({ length: PROCESS_STEP_MAX + 1 }, (_, i) => ({ id: `x${i}`, name: `工序${i}` }));
    expect(processDraftSchema.safeParse({ steps: tooMany }).success).toBe(false);
    expect(processDraftSchema.safeParse({ steps: [{ id: 'a', name: '一'.repeat(21) }] }).success).toBe(false);
    expect(productionStepSchema.parse({}).process).toEqual({ sketchFileIds: [], steps: [] });
    expect(PROCESS_TEMPLATES.smt.label).toBe('SMT 电子装配');
  });
});
