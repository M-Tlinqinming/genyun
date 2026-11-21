import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import { customerGapCount, customerGaps } from './workup-gaps.ts';
import { contactPhoneError, emptyResourcesExtra, hoursSuffix, quartersSentence } from './workup-resources.ts';
import { resourcesStepView } from './workup-steps.ts';
import { parseUploadTarget, uploadTargetLabel, withUploadedFile } from './workup-uploads.ts';
import type { WorkupData } from './workup.ts';

const none = (): WorkupData => ({ overrides: {} });
const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';

describe('外部应急联系方式', () => {
  it('座机、手机、特服号都算对，空着不报错', () => {
    for (const ok of ['0512-66881234', '051266881234', '13912345678', '110', '12350', '', undefined, '（0512）66881234']) {
      expect(contactPhoneError(ok)).toBeNull();
    }
    for (const bad of ['1391234567', '66881234', '0512-123', 'abc']) expect(contactPhoneError(bad)).toBe('号码位数不对');
  });

  it('值守时间 24 小时不写，其余写在括号里', () => {
    expect(hoursSuffix(undefined)).toBe('');
    expect(hoursSuffix('24 小时')).toBe('');
    expect(hoursSuffix('8:00–17:00')).toBe('（8:00–17:00）');
  });

  it('只有专家填的部分默认是空的', () => {
    const e = emptyResourcesExtra();
    expect(e.hours).toEqual({});
    expect(e.quarters).toEqual({});
    expect(e.drawings).toEqual({ surroundings_map: [], hospital_route: [], traffic_map: [] });
  });
});

describe('厂区四邻', () => {
  it('按东南西北写成一句，没填的方向不写', () => {
    expect(quartersSentence({ east: '空地', west: ' 河道 ', north: '' })).toBe('公司东临空地，西临河道。');
    expect(quartersSentence({})).toBe('');
    expect(quartersSentence(undefined)).toBe('');
  });
});

describe('客户未填（第 4 步）', () => {
  it('飞宇：物资、药箱、水池、建筑都有，只缺消防设施布置图', () => {
    const gaps = customerGaps(feiyuSnapshot, none());
    expect(gaps.filter((g) => g.step === 4).map((g) => g.key)).toEqual(['drawing:fire_facility_plan']);
    expect(customerGapCount(gaps, 4)).toBe(1);
    expect(customerGapCount(customerGaps(feiyuSnapshot, none(), [{ key: 'fire_facility_plan' }]), 4)).toBe(0);
  });

  it('专家那份清空物资、水池没填容积时算客户未填，key 稳定', () => {
    const step = resourcesStepView(feiyuSnapshot, none());
    step.supplies = [];
    step.firePool = { ...step.firePool, volumeM3: undefined, volumeLater: true };
    step.firstAidKit = { ...step.firstAidKit, answer: undefined };
    const data: WorkupData = { overrides: {}, profile: { resourcesStep: { step } } };
    const keys = customerGaps(feiyuSnapshot, data, [{ key: 'fire_facility_plan' }])
      .filter((g) => g.step === 4)
      .map((g) => g.key);
    // 标了「先留空」的容积照样算没填
    expect(keys).toEqual(['field:supplies', 'field:firstAid', 'field:firePool.volume']);
  });
});

describe('专家代客户上传', () => {
  it('上传位置只认几种写法', () => {
    expect(parseUploadTarget('drawing:evacuation_plan')).toEqual({ kind: 'drawing', key: 'evacuation_plan' });
    expect(parseUploadTarget('drawing:traffic_map')).toEqual({ kind: 'drawing', key: 'traffic_map' });
    expect(parseUploadTarget('firstAid')).toEqual({ kind: 'firstAid' });
    expect(parseUploadTarget('msds:m1')).toEqual({ kind: 'msds', rowId: 'm1' });
    for (const bad of ['drawing:other', 'firstAid:1', 'msds:', 'label:../x', '', undefined]) expect(parseUploadTarget(bad)).toBeNull();
  });

  it('客户的图纸写进第 4 步专家那份，替换时去掉旧文件', () => {
    const once = withUploadedFile(feiyuSnapshot, none(), { kind: 'drawing', key: 'evacuation_plan' }, F1)!;
    expect(resourcesStepView(feiyuSnapshot, once).drawings.evacuation_plan).toEqual([F1]);
    const twice = withUploadedFile(feiyuSnapshot, once, { kind: 'drawing', key: 'evacuation_plan' }, F2, F1)!;
    expect(resourcesStepView(feiyuSnapshot, twice).drawings.evacuation_plan).toEqual([F2]);
    // 快照没动
    expect(feiyuSnapshot.profile.resourcesStep!.step.drawings.evacuation_plan).toEqual([]);
  });

  it('专家的三张图写进 resourcesExtra，药箱照片写进药箱', () => {
    const map = withUploadedFile(feiyuSnapshot, none(), { kind: 'drawing', key: 'hospital_route' }, F1)!;
    expect(map.resourcesExtra?.drawings.hospital_route).toEqual([F1]);
    expect(map.profile?.resourcesStep).toBeUndefined();
    const kit = withUploadedFile(feiyuSnapshot, none(), { kind: 'firstAid' }, F2)!;
    expect(resourcesStepView(feiyuSnapshot, kit).firstAidKit.photoFileIds).toEqual([F2]);
  });

  it('物料行不在了不写', () => {
    expect(withUploadedFile(feiyuSnapshot, none(), { kind: 'msds', rowId: 'nope' }, F1)).toBeNull();
    expect(withUploadedFile(feiyuSnapshot, none(), { kind: 'label', rowId: 'nope' }, F1)).toBeNull();
    const ok = withUploadedFile(feiyuSnapshot, none(), { kind: 'msds', rowId: 'm1' }, F1)!;
    expect(resourcesStepView(feiyuSnapshot, ok).msds.m1).toEqual({ fileIds: [F1], later: false });
  });

  it('处理记录里的说法', () => {
    expect(uploadTargetLabel('drawing:evacuation_plan')).toEqual({ text: '紧急疏散示意图', byExpert: false });
    expect(uploadTargetLabel('drawing:traffic_map').byExpert).toBe(true);
    expect(uploadTargetLabel('firstAid').text).toBe('急救药箱照片');
  });
});
