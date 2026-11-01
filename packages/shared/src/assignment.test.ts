import { describe, expect, it } from 'vitest';
import { assignExpertSchema, assignmentBlockedReason, expertLoadLine, needsAssignment } from './assignment.ts';

const ID = '7f1c2d1e-8b5a-4c3d-9e2f-1a2b3c4d5e6f';

describe('待分派', () => {
  it('客户已提交、没有负责专家、没结束：待分派', () => {
    expect(needsAssignment({ status: 'submitted', assignedExpertId: null, closedAt: null })).toBe(true);
  });

  it('资料准备中、已分派、已结束的都不算', () => {
    expect(needsAssignment({ status: 'preparing', assignedExpertId: null, closedAt: null })).toBe(false);
    expect(needsAssignment({ status: 'submitted', assignedExpertId: ID, closedAt: null })).toBe(false);
    expect(needsAssignment({ status: 'submitted', assignedExpertId: null, closedAt: new Date() })).toBe(false);
  });
});

describe('能不能分派', () => {
  it('已提交、没结束的可以分派或改派', () => {
    expect(assignmentBlockedReason({ status: 'submitted', closedAt: null })).toBeNull();
  });

  it('资料准备中、已结束的说明原因', () => {
    expect(assignmentBlockedReason({ status: 'preparing', closedAt: null })).toBe('客户还没提交资料，提交后才能分派注安师');
    expect(assignmentBlockedReason({ status: 'submitted', closedAt: '2026-11-01T00:00:00Z' })).toBe('任务已结束，不能再分派');
  });
});

describe('分派表单', () => {
  it('说明选填，空白当没填', () => {
    expect(assignExpertSchema.parse({ expertId: ID, currentExpertId: null, note: '  ' })).toEqual({ expertId: ID, currentExpertId: null });
    expect(assignExpertSchema.parse({ expertId: ID, currentExpertId: ID, note: ' 客户比较急 ' }).note).toBe('客户比较急');
  });

  it('改派理由选填，只认四种', () => {
    expect(assignExpertSchema.parse({ expertId: ID, currentExpertId: ID, reason: 'leave' }).reason).toBe('leave');
    expect(assignExpertSchema.parse({ expertId: ID, currentExpertId: ID }).reason).toBeUndefined();
    expect(assignExpertSchema.safeParse({ expertId: ID, currentExpertId: ID, reason: 'tired' }).success).toBe(false);
  });

  it('没选注安师、说明超过 200 字都拒绝', () => {
    expect(assignExpertSchema.safeParse({ expertId: '', currentExpertId: null }).error?.issues[0]?.message).toBe('请选择注安师');
    expect(assignExpertSchema.safeParse({ expertId: ID, currentExpertId: null, note: '字'.repeat(201) }).error?.issues[0]?.message).toBe(
      '说明最多 200 个字',
    );
  });
});

describe('专业人员的工作量', () => {
  it('只在有同客户的其他企业时才写第二句', () => {
    expect(expertLoadLine({ openTasks: 0, sameOrgEnterprises: 0 })).toBe('在办 0 个');
    expect(expertLoadLine({ openTasks: 3, sameOrgEnterprises: 3 })).toBe('在办 3 个 · 正在处理该客户的另外 3 家企业');
  });
});
