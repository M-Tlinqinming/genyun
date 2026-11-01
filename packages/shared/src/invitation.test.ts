import { describe, expect, it } from 'vitest';
import { acceptInvitationSchema, invitationState, passwordChecks, passwordProblem } from './invitation.ts';

const NOW = new Date('2026-11-01T10:00:00+08:00');
const future = '2026-11-08T10:00:00+08:00';
const past = '2026-10-31T10:00:00+08:00';

describe('邀请状态', () => {
  it('没用过、没撤销、没过期：可以接受', () => {
    expect(invitationState({ acceptedAt: null, revokedAt: null, expiresAt: future }, NOW)).toBe('valid');
  });

  it('已使用优先于已撤销、已过期', () => {
    expect(invitationState({ acceptedAt: past, revokedAt: past, expiresAt: past }, NOW)).toBe('accepted');
  });

  it('已撤销优先于已过期', () => {
    expect(invitationState({ acceptedAt: null, revokedAt: past, expiresAt: past }, NOW)).toBe('revoked');
  });

  it('到期那一刻起算过期', () => {
    expect(invitationState({ acceptedAt: null, revokedAt: null, expiresAt: NOW.toISOString() }, NOW)).toBe('expired');
  });
});

describe('设置密码', () => {
  it('三条规则逐条给出是否满足', () => {
    expect(passwordChecks('abc', 'wang@example.cn')).toEqual([
      { label: '至少 8 位', ok: false },
      { label: '含字母和数字', ok: false },
      { label: '不与邮箱相同', ok: true },
    ]);
    expect(passwordChecks('genyun2026', 'wang@example.cn').every((c) => c.ok)).toBe(true);
  });

  it('与邮箱相同（不分大小写）不行', () => {
    expect(passwordProblem('Wang1@example.cn', 'wang1@example.cn')).toBe('密码不能与邮箱相同');
  });

  it('不满足时说明怎么改', () => {
    expect(passwordProblem('12345678', 'a@b.cn')).toBe('密码要同时含字母和数字');
    expect(passwordProblem('abc123', 'a@b.cn')).toBe('密码至少 8 位');
    expect(passwordProblem('abcd1234', 'a@b.cn')).toBeNull();
  });
});

describe('接受邀请表单', () => {
  it('姓名必填，要勾选同意服务协议', () => {
    expect(acceptInvitationSchema.safeParse({ name: ' ', password: 'abcd1234', agreed: true }).success).toBe(false);
    const r = acceptInvitationSchema.safeParse({ name: '王编制', password: 'abcd1234', agreed: false });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('请先阅读并同意服务协议和隐私政策');
    expect(acceptInvitationSchema.parse({ name: ' 王编制 ', password: 'abcd1234', agreed: true }).name).toBe('王编制');
  });

  it('密码最长 128 位', () => {
    expect(acceptInvitationSchema.safeParse({ name: '王', password: `a1${'x'.repeat(127)}`, agreed: true }).success).toBe(false);
  });
});
