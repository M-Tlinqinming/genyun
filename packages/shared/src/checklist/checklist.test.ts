import { describe, expect, it } from 'vitest';
import { feiyuChecklist } from '../fixtures/feiyu.ts';
import { checkChecklist } from './check.ts';
import { CATEGORIES, CHECKLIST_ITEMS, type ChecklistItemKey } from './items.ts';
import { checklistStateSchema, itemStateSchema, statusNotAllowedReason, type ChecklistState } from './status.ts';

const later = { status: 'later' as const, fileIds: [], callRequested: false };

function without(state: ChecklistState, key: ChecklistItemKey): ChecklistState {
  const { [key]: _removed, ...rest } = state;
  return rest;
}

describe('资料清单', () => {
  it('共 6 类 19 项，每类都有资料项', () => {
    expect(CHECKLIST_ITEMS).toHaveLength(19);
    for (const category of Object.keys(CATEGORIES)) {
      expect(CHECKLIST_ITEMS.some((i) => i.category === category)).toBe(true);
    }
  });

  it('总平面图、疏散图开始编制必需，消防设施布置图交付前补齐', () => {
    const req = (key: string) => CHECKLIST_ITEMS.find((i) => i.key === key)?.requirement;
    expect(req('site_plan')).toBe('start');
    expect(req('evacuation_plan')).toBe('start');
    expect(req('fire_facility_plan')).toBe('before_delivery');
  });
});

describe('资料项状态', () => {
  it('开始编制必需的项不能稍后补', () => {
    expect(statusNotAllowedReason('site_plan', 'later')).toContain('不能稍后补');
    expect(statusNotAllowedReason('fire_facility_plan', 'later')).toBeNull();
  });

  it('只有「有则提供」的项可以回答没有', () => {
    expect(statusNotAllowedReason('special_equipment', 'none')).toBeNull();
    expect(statusNotAllowedReason('business_license', 'none')).not.toBeNull();
  });

  it('拍照给耕云看只出现在需要辨认实物的项', () => {
    expect(statusNotAllowedReason('special_equipment', 'photo_for_expert')).toBeNull();
    expect(statusNotAllowedReason('equipment', 'photo_for_expert')).not.toBeNull();
  });

  it('耕云代办的项客户只能确认', () => {
    expect(statusNotAllowedReason('org_chart', 'provided')).toBeNull();
    expect(statusNotAllowedReason('org_chart', 'later')).not.toBeNull();
  });

  it('直接填写或选择没有时必须记录确认人和时间，上传文件不需要', () => {
    expect(itemStateSchema.safeParse({ status: 'none' }).success).toBe(false);
    expect(itemStateSchema.safeParse({ status: 'provided' }).success).toBe(false);
    expect(itemStateSchema.safeParse({ status: 'provided', fileIds: ['f1'] }).success).toBe(true);
    expect(
      itemStateSchema.safeParse({ status: 'none', confirmedBy: 'u1', confirmedAt: '2026-10-27T09:00:00.000Z' }).success,
    ).toBe(true);
  });

  it('专家判定为无不需要理由，但要记录判定人', () => {
    const photo = { status: 'photo_for_expert', fileIds: ['f1'] };
    const judged = { result: 'no', judgedBy: 'expert-1', judgedAt: '2026-10-27T10:00:00.000Z' };
    expect(itemStateSchema.safeParse({ ...photo, expertJudgement: judged }).success).toBe(true);
    expect(itemStateSchema.safeParse({ ...photo, expertJudgement: { result: 'no' } }).success).toBe(false);
  });

  it('不接受清单外的资料项', () => {
    expect(checklistStateSchema.safeParse({ land_certificate: later }).success).toBe(false);
  });
});

describe('提交检查（飞宇样例）', () => {
  it('开始编制必需的资料齐了就可以提交，其余只提示还能补几项', () => {
    const result = checkChecklist(feiyuChecklist);
    expect(result.canSubmit).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.improvable).toEqual(['msds', 'fire_facility_plan']);
    expect(result.suggestOnSiteVisit).toBe(false);
  });

  it('缺疏散图时不能提交，并指出缺哪一项', () => {
    const result = checkChecklist(without(feiyuChecklist, 'evacuation_plan'));
    expect(result.canSubmit).toBe(false);
    expect(result.blocking).toEqual([{ key: 'evacuation_plan', label: '紧急疏散示意图', reason: 'unanswered' }]);
  });

  it('耕云代办的项不影响提交', () => {
    const result = checkChecklist(feiyuChecklist);
    expect(feiyuChecklist.org_chart).toBeUndefined();
    expect(result.blocking.map((b) => b.key)).not.toContain('org_chart');
    expect(result.improvable).not.toContain('org_chart');
  });

  it('拍照给耕云看算已处理，但列入等专家判断', () => {
    const result = checkChecklist({
      ...feiyuChecklist,
      special_equipment: { status: 'photo_for_expert', fileIds: ['f-nameplate'], callRequested: false },
    });
    expect(result.canSubmit).toBe(true);
    expect(result.awaitingExpert).toEqual(['special_equipment']);
  });
});

describe('预约上门提示', () => {
  const sixLater: ChecklistState = {
    ...feiyuChecklist,
    buildings: later,
    msds: later,
    external_resources: later,
    first_aid_kit: later,
    fire_pool: later,
    fire_facility_plan: later,
  };

  it('稍后补累计超过 5 项时提示', () => {
    expect(checkChecklist(sixLater).laterOrCallCount).toBe(6);
    expect(checkChecklist(sixLater).suggestOnSiteVisit).toBe(true);
  });

  it('正好 5 项不提示', () => {
    const fiveLater = { ...sixLater, buildings: feiyuChecklist.buildings };
    expect(checkChecklist(fiveLater).suggestOnSiteVisit).toBe(false);
  });

  it('待专家电话联系也计入，同一项不重复计算', () => {
    const state: ChecklistState = {
      ...sixLater,
      buildings: feiyuChecklist.buildings,
      msds: { ...later, callRequested: true },
      basic_info: { ...feiyuChecklist.basic_info!, callRequested: true },
    };
    expect(checkChecklist(state).laterOrCallCount).toBe(6);
    expect(checkChecklist(state).suggestOnSiteVisit).toBe(true);
  });
});
