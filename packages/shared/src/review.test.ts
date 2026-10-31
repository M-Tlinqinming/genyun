import { describe, expect, it } from 'vitest';
import { checkedCount, checkStale, checkValid, nextToCheck, reviewRequestSchema, reviewValid, type DraftCheckView } from './review.ts';

const check = (version: number) => ({ byName: '周工', at: '2026-11-01T08:00:00Z', version });
const docs = (plan: DraftCheckView['check'], risk: DraftCheckView['check'], resource: DraftCheckView['check'], versions = [0, 0, 0]): DraftCheckView[] => [
  { kind: 'plan', version: versions[0]!, savedAt: null, check: plan },
  { kind: 'risk', version: versions[1]!, savedAt: null, check: risk },
  { kind: 'resource', version: versions[2]!, savedAt: null, check: resource },
];

describe('逐份核对', () => {
  it('核对时的修订次数与当前一致才算核对过；之后又保存修订就回到待核对', () => {
    const d = docs(check(2), check(0), null, [2, 1, 0]);
    expect(checkValid(d[0]!)).toBe(true);
    expect(checkValid(d[1]!)).toBe(false);
    expect(checkStale(d[1]!)).toBe(true);
    expect(checkStale(d[2]!)).toBe(false);
    expect(checkedCount(d)).toBe(1);
  });

  it('核对完一份接着打开下一份还没核对的，都核对过了返回空', () => {
    expect(nextToCheck(docs(check(0), null, null), 'plan')).toBe('risk');
    expect(nextToCheck(docs(check(0), check(0), null), 'risk')).toBe('resource');
    // 最后一份核对完，回头找前面失效的
    expect(nextToCheck(docs(check(0), check(0), check(0), [1, 0, 0]), 'resource')).toBe('plan');
    expect(nextToCheck(docs(check(0), check(0), check(0)), 'resource')).toBeNull();
  });
});

describe('审核结论', () => {
  it('结论记下的三份修订次数都与当前一致、且三份都核对过才有效', () => {
    const all = docs(check(1), check(0), check(0), [1, 0, 0]);
    const review = { note: '通过', byName: '周工', at: '', versions: { plan: 1, risk: 0, resource: 0 } };
    expect(reviewValid({ docs: all, review })).toBe(true);
    expect(reviewValid({ docs: docs(check(1), check(0), check(0), [2, 0, 0]), review })).toBe(false);
    expect(reviewValid({ docs: all, review: null })).toBe(false);
  });

  it('结论必填，三份修订次数都要带上', () => {
    expect(reviewRequestSchema.safeParse({ note: '  ', versions: { plan: 0, risk: 0, resource: 0 } }).success).toBe(false);
    expect(reviewRequestSchema.safeParse({ note: '通过', versions: { plan: 0, risk: 0 } }).success).toBe(false);
    expect(reviewRequestSchema.safeParse({ note: '通过', versions: { plan: 0, risk: 0, resource: 3 } }).success).toBe(true);
  });
});
