import { describe, expect, it } from 'vitest';
import { feiyuChecklist } from '../fixtures/feiyu.ts';
import { checkChecklist } from './check.ts';
import { checkOverview } from './overview.ts';
import { statusNotAllowedReason } from './status.ts';

const later = { status: 'later' as const, fileIds: [], callRequested: false };

describe('资料检查页 · 六类汇总', () => {
  it('飞宇样例六类都已满足；稍后补的交付前项不影响', () => {
    const o = checkOverview(feiyuChecklist);
    expect(o.categories.map((c) => [c.label, c.status])).toEqual([
      ['企业基本资料', 'done'],
      ['生产工艺与设备', 'done'],
      ['原辅料与安全资料', 'done'],
      ['应急组织与联系人', 'done'],
      ['应急资源与设施', 'done'],
      ['厂区实际图纸', 'done'],
    ]);
    expect(o.categories[5]!.items.find((i) => i.key === 'fire_facility_plan')!.state).toBe('later');
    expect(o.canSubmit).toBe(true);
  });

  it('什么都没给：有必需项的类别待补充，耕云生成的项算已满足', () => {
    const o = checkOverview({});
    expect(o.counts).toEqual({ missing: 6, verifying: 0, done: 0 });
    const org = o.categories.find((c) => c.category === 'organization')!;
    expect(org.items.find((i) => i.key === 'org_chart')!.state).toBe('done');
    expect(o.missing.map((i) => i.key)).toContain('site_plan');
    expect(o.canSubmit).toBe(false);
  });

  it('拍照给耕云看、请专家电话联系的类别显示核实中，并且可以提交', () => {
    const o = checkOverview({
      ...feiyuChecklist,
      special_equipment: { status: 'photo_for_expert', fileIds: ['f'], callRequested: false },
      evacuation_plan: { ...later, callRequested: true },
    });
    expect(o.categories.find((c) => c.category === 'production')!.status).toBe('verifying');
    expect(o.categories.find((c) => c.category === 'drawings')!.status).toBe('verifying');
    expect(o.withExpert.map((i) => [i.key, i.state])).toEqual([
      ['special_equipment', 'expert'],
      ['evacuation_plan', 'call'],
    ]);
    expect(o.canSubmit).toBe(true);
  });

  it('必需项不能单纯稍后补，但可以请专家电话联系', () => {
    expect(statusNotAllowedReason('site_plan', 'later')).toContain('不能稍后补');
    expect(statusNotAllowedReason('site_plan', 'later', true)).toBeNull();
    expect(checkChecklist({ ...feiyuChecklist, site_plan: later }).canSubmit).toBe(false);
    expect(checkChecklist({ ...feiyuChecklist, site_plan: { ...later, callRequested: true } }).canSubmit).toBe(true);
  });
});
