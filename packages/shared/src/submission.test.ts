import { describe, expect, it } from 'vitest';
import { feiyuChecklist } from './fixtures/feiyu.ts';
import {
  describeDocumentChanges,
  pendingAfterSubmit,
  submissionFingerprint,
  supplementProgress,
} from './submission.ts';

const docs = [
  { documentId: 'd-plan', versionId: 'v1' },
  { documentId: 'd-list', versionId: 'v9' },
];

describe('提交 · 确认后资料有没有变', () => {
  it('同样的资料版本与处理情况，顺序不同也算一致', () => {
    expect(submissionFingerprint(docs, feiyuChecklist)).toBe(submissionFingerprint([...docs].reverse(), feiyuChecklist));
  });

  it('换了图纸版本、改了一项资料的处理，都算有变化', () => {
    const before = submissionFingerprint(docs, feiyuChecklist);
    expect(submissionFingerprint([{ documentId: 'd-plan', versionId: 'v2' }, docs[1]!], feiyuChecklist)).not.toBe(before);
    const changed = { ...feiyuChecklist, msds: { status: 'none' as const, fileIds: [], callRequested: false } };
    expect(submissionFingerprint(docs, changed)).not.toBe(before);
  });

  it('说清楚哪份资料变了', () => {
    const versions: Record<string, number> = { v1: 1, v2: 2, v9: 1 };
    const changes = describeDocumentChanges(
      docs,
      [
        { documentId: 'd-plan', versionId: 'v2', name: '总平面图', version: 2 },
        { documentId: 'd-new', versionId: 'v5', name: '花名册', version: 1 },
      ],
      (id) => versions[id],
    );
    expect(changes).toEqual(['总平面图由 V1 改为 V2', '新增了花名册', '移除了 1 份资料']);
  });
});

describe('提交 · 待补清单', () => {
  it('飞宇样例提交时待补 MSDS 与消防设施布置图，已处理的项不进清单', () => {
    expect(pendingAfterSubmit(feiyuChecklist)).toEqual(['msds', 'fire_facility_plan']);
  });

  it('必需项请了专家电话联系也进待补清单；拍照等专家判断的不进', () => {
    const items = {
      ...feiyuChecklist,
      duty_phone: { status: 'later' as const, fileIds: [], callRequested: true },
      special_equipment: { status: 'photo_for_expert' as const, fileIds: ['f-boiler'], callRequested: false },
    };
    const pending = pendingAfterSubmit(items);
    expect(pending).toContain('duty_phone');
    expect(pending).not.toContain('special_equipment');
  });

  it('补一项少一项', () => {
    const pending = pendingAfterSubmit(feiyuChecklist);
    const items = { ...feiyuChecklist, msds: { status: 'provided' as const, fileIds: ['f-msds'], callRequested: false } };
    expect(supplementProgress(pending, items)).toEqual({ done: 1, total: 2, doneKeys: ['msds'] });
  });
});
