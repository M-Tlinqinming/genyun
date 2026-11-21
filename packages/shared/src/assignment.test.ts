import { describe, expect, it } from 'vitest';
import { assignExpertSchema, assignmentBlockedReason, needsAssignment } from './assignment.ts';

const ID = '7f1c2d1e-8b5a-4c3d-9e2f-1a2b3c4d5e6f';

describe('待分配', () => {
  it('客户已提交、没有负责专家、没结束：待分配', () => {
    expect(needsAssignment({ status: 'submitted', assignedExpertId: null, closedAt: null })).toBe(true);
  });

  it('资料准备中、已分配、已结束的都不算', () => {
    expect(needsAssignment({ status: 'preparing', assignedExpertId: null, closedAt: null })).toBe(false);
    expect(needsAssignment({ status: 'submitted', assignedExpertId: ID, closedAt: null })).toBe(false);
    expect(needsAssignment({ status: 'submitted', assignedExpertId: null, closedAt: new Date() })).toBe(false);
  });
});

describe('能不能分配', () => {
  it('已提交、没结束的可以分配或改派', () => {
    expect(assignmentBlockedReason({ status: 'submitted', closedAt: null })).toBeNull();
  });

  it('资料准备中、已结束的说明原因', () => {
    expect(assignmentBlockedReason({ status: 'preparing', closedAt: null })).toBe('客户还没提交资料，提交后才能分配专家');
    expect(assignmentBlockedReason({ status: 'submitted', closedAt: '2026-11-01T00:00:00Z' })).toBe('任务已结束，不能再分配');
  });

  it('目标专家暂停接单或审核状态不能派时说明原因', () => {
    const task = { status: 'submitted' as const, closedAt: null };
    expect(assignmentBlockedReason(task, { name: '王工', profile: null })).toBeNull();
    expect(assignmentBlockedReason(task, { name: '王工', profile: { reviewStatus: 'approved', acceptingOrders: true } })).toBeNull();
    expect(assignmentBlockedReason(task, { name: '王工', profile: { reviewStatus: null, acceptingOrders: true } })).toBeNull();
    expect(assignmentBlockedReason(task, { name: '王工', profile: { reviewStatus: 'approved', acceptingOrders: false } })).toBe(
      '王工已暂停接单，不能分配',
    );
    expect(assignmentBlockedReason(task, { name: '王工', profile: { reviewStatus: 'pending', acceptingOrders: true } })).toBe(
      '这位专家现在不能接任务',
    );
    expect(assignmentBlockedReason(task, { name: '王工', profile: { reviewStatus: 'delisted', acceptingOrders: true } })).toBe(
      '这位专家现在不能接任务',
    );
  });
});

describe('分配表单', () => {
  it('说明选填，空白当没填', () => {
    expect(assignExpertSchema.parse({ expertId: ID, currentExpertId: null, note: '  ' })).toEqual({ expertId: ID, currentExpertId: null });
    expect(assignExpertSchema.parse({ expertId: ID, currentExpertId: ID, note: ' 客户比较急 ' }).note).toBe('客户比较急');
  });

  it('改派理由选填，只认四种', () => {
    expect(assignExpertSchema.parse({ expertId: ID, currentExpertId: ID, reason: 'leave' }).reason).toBe('leave');
    expect(assignExpertSchema.parse({ expertId: ID, currentExpertId: ID }).reason).toBeUndefined();
    expect(assignExpertSchema.safeParse({ expertId: ID, currentExpertId: ID, reason: 'tired' }).success).toBe(false);
  });

  it('没选专家、说明超过 200 字都拒绝', () => {
    expect(assignExpertSchema.safeParse({ expertId: '', currentExpertId: null }).error?.issues[0]?.message).toBe('请选择专家');
    expect(assignExpertSchema.safeParse({ expertId: ID, currentExpertId: null, note: '字'.repeat(201) }).error?.issues[0]?.message).toBe(
      '说明最多 200 个字',
    );
  });
});
