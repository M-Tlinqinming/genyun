import { describe, expect, it } from 'vitest';
import { actorLine, activitySentence, activityTaskNumber, renewalRow, sortRenewalRows, type RenewalOrg } from './operator.ts';

const TODAY = '2026-11-12';
const org = (o: Partial<RenewalOrg> = {}): RenewalOrg => ({
  id: 'o1',
  name: '示例组织',
  state: 'active',
  contractStartsAt: '2026-05-01',
  contractEndsAt: '2027-04-30',
  createdAt: '2026-04-20T00:00:00Z',
  ...o,
});
const credits = (remaining: number, granted: number, awaiting = 0) => ({
  remaining: { total: remaining, gift: 0, purchase: remaining },
  granted,
  awaiting,
});

describe('续约与次数的每一行', () => {
  it('服务中', () => {
    const r = renewalRow(org(), credits(8, 10), TODAY)!;
    expect(r.sub).toBe('合同到 2027.04.30');
    expect(r.contract).toMatchObject({ label: '合同时间', value: '还有 169 天', warn: false });
    expect(r.contract.percent).toBe(54);
    expect(r.credits).toMatchObject({ label: '编制次数 · 共 10 次', value: '剩 8 次', warn: false, percent: 20 });
    expect(r.action).toEqual({ text: '查看', link: '/operator/organizations/o1' });
    expect(r.flagged).toBe(false);
  });

  it('剩 ≤ 3 次（含 0 次）：次数标黄、操作调整次数', () => {
    for (const left of [3, 0]) {
      const r = renewalRow(org(), credits(left, 10), TODAY)!;
      expect(r.credits).toMatchObject({ value: `剩 ${left} 次`, warn: true });
      expect(r.action).toEqual({ text: '调整次数', link: '/operator/organizations/o1?adjust=1' });
      expect(r.flagged).toBe(true);
    }
  });

  it('次数没取到：不标黄、不给调整次数，和整行是否标黄一致', () => {
    const r = renewalRow(org(), null, TODAY)!;
    expect(r.credits).toMatchObject({ label: '编制次数', value: '暂时没取到', warn: false, muted: true });
    expect(r.action.text).toBe('查看');
    expect(r.flagged).toBe(false);
    // 快到期时照样因为合同标黄，次数那格仍不标
    const soon = renewalRow(org({ contractStartsAt: '2025-12-01', contractEndsAt: '2026-11-30' }), null, TODAY)!;
    expect(soon.flagged).toBe(true);
    expect(soon.credits.warn).toBe(false);
  });

  it('30 天内到期：合同时间标黄', () => {
    const r = renewalRow(org({ contractStartsAt: '2025-12-01', contractEndsAt: '2026-11-30' }), credits(8, 10), TODAY)!;
    expect(r.contract).toMatchObject({ value: '还有 18 天', warn: true });
    expect(r.credits.warn).toBe(false);
    expect(r.action.text).toBe('查看');
    expect(r.flagged).toBe(true);
  });

  it('合同还没开始', () => {
    const r = renewalRow(org({ contractStartsAt: '2026-12-01', contractEndsAt: '2027-11-30' }), credits(5, 5), TODAY)!;
    expect(r.sub).toBe('合同 2026.12.01 起生效');
    expect(r.contract).toMatchObject({ value: '还没开始', muted: true, percent: 0 });
    expect(r.credits).toMatchObject({ label: '编制次数', value: '生效后可用', muted: true, percent: 0 });
    expect(r.flagged).toBe(false);
  });

  it('已到期 30 天以内', () => {
    const expired = org({ state: 'expired', contractStartsAt: '2025-11-01', contractEndsAt: '2026-10-31' });
    const r = renewalRow(expired, credits(0, 0), TODAY)!;
    expect(r.contract).toMatchObject({ value: '已到期 12 天', warn: true, percent: 100 });
    expect(r.credits).toMatchObject({ label: '编制次数', value: '随合同失效', muted: true, percent: 0 });
    expect(r.flagged).toBe(true);
    expect(renewalRow(expired, credits(0, 0, 2), TODAY)!.credits).toMatchObject({ value: '2 份成果等续约', warn: true });
  });

  it('已到期超过 30 天不显示', () => {
    expect(renewalRow(org({ state: 'expired', contractStartsAt: '2025-09-01', contractEndsAt: '2026-08-31' }), null, TODAY)).toBeNull();
  });

  it('待开通', () => {
    const r = renewalRow(org({ state: 'pending' }), null, TODAY)!;
    expect(r.sub).toBe('待开通 · 合同 2026.05.01 起');
    expect(r.subWarn).toBe(true);
    expect(r.contract).toMatchObject({ value: '开通后开始', muted: true });
    expect(r.credits).toMatchObject({ label: '编制次数', value: '开通后可用', muted: true });
    expect(r.action).toEqual({ text: '开通', link: '/operator/organizations?open=o1' });
    expect(renewalRow(org({ state: 'pending', contractStartsAt: null }), null, TODAY)!.sub).toBe('待开通');
  });

  it('排序：标黄（按到期日）→ 服务中 → 还没开始 → 待开通；最多 5 行', () => {
    const rows = [
      renewalRow(org({ id: 'pending', state: 'pending' }), null, TODAY),
      renewalRow(org({ id: 'upcoming', contractStartsAt: '2026-12-01', contractEndsAt: '2027-11-30' }), credits(5, 5), TODAY),
      renewalRow(org({ id: 'active-late', contractEndsAt: '2027-04-30' }), credits(8, 10), TODAY),
      renewalRow(org({ id: 'active-early', contractEndsAt: '2027-02-28' }), credits(8, 10), TODAY),
      renewalRow(org({ id: 'low', contractEndsAt: '2027-03-31' }), credits(1, 10), TODAY),
      renewalRow(org({ id: 'expired', state: 'expired', contractStartsAt: '2025-11-01', contractEndsAt: '2026-10-31' }), null, TODAY),
      renewalRow(org({ id: 'old', state: 'expired', contractStartsAt: '2025-01-01', contractEndsAt: '2025-12-31' }), null, '2026-11-12'),
    ];
    expect(sortRenewalRows(rows, 10).map((r) => r.orgId)).toEqual(['expired', 'low', 'active-early', 'active-late', 'upcoming', 'pending']);
    expect(sortRenewalRows(rows)).toHaveLength(5);
  });
});

describe('最近操作的一句话', () => {
  it('分配、改派、交付：有企业名用企业名，没有用任务编号', () => {
    expect(activitySentence('task_assign', 'GY-2026-0001 · 周工', { enterpriseName: '示例模具' })).toBe('示例模具已分配给周工');
    expect(activitySentence('task_assign', 'GY-2026-0001 · 周工')).toBe('GY-2026-0001已分配给周工');
    expect(activitySentence('task_reassign', 'GY-2026-0001 · 周工 → 吴工', { enterpriseName: '示例模具' })).toBe(
      '示例模具已从周工改派给吴工',
    );
    expect(activitySentence('publish', 'GY-2026-0001 · 第 1 次交付', { enterpriseName: '示例模具' })).toBe('示例模具的成果已交付');
    expect(activitySentence('publish', 'GY-2026-0001 · 第 2 次交付', { enterpriseName: '示例模具' })).toBe('示例模具的成果已更新');
    expect(activitySentence('reopen', 'GY-2026-0001 · 重新打开', { enterpriseName: '示例模具' })).toBe('示例模具的任务已重新打开');
    expect(activitySentence('reopen', 'GY-2026-0001 · 重新打开')).toBe('GY-2026-0001的任务已重新打开');
  });

  it('开通、续约、调整次数、邀请组织成员', () => {
    expect(activitySentence('org_open', '示例组织 · 合同 HT-001')).toBe('示例组织已开通');
    expect(activitySentence('contract_renew', '示例组织 · 合同 HT-002，到 2027.10.31')).toBe('示例组织已续约，合同到 2027.10.31');
    expect(activitySentence('credits_adjust', '示例组织 · 加购次数 +5 次')).toBe('示例组织加购次数 +5 次');
    expect(activitySentence('credits_adjust', '示例组织 · 补偿 -1 次')).toBe('示例组织补偿 -1 次');
    expect(activitySentence('member_invite', '王五（w@example.com）· 组织成员')).toBe('邀请王五加入，角色为组织成员');
    expect(activitySentence('member_invite', '王五（w@example.com）· 组织成员 · 重新发送')).toBe('重新邀请王五加入，角色为组织成员');
  });

  it('拼不出来的照旧「标签：对象」', () => {
    expect(activitySentence('task_assign', '对不上的格式')).toBe('分配专家：对不上的格式');
    expect(activitySentence('org_open', '没有合同')).toBe('开通客户组织：没有合同');
    expect(activitySentence('feedback_close', '示例反馈')).toBe('回复并关闭反馈：示例反馈');
    expect(activitySentence('account_disable', null)).toBe('停用账号');
  });

  it('任务类的取出任务编号', () => {
    expect(activityTaskNumber('publish', 'GY-2026-0001 · 第 1 次交付')).toBe('GY-2026-0001');
    expect(activityTaskNumber('reopen', 'GY-2026-0001 · 重新打开')).toBe('GY-2026-0001');
    expect(activityTaskNumber('org_open', '示例组织 · 合同 1')).toBeNull();
  });

  it('身份行', () => {
    expect(actorLine('operator', '林海')).toBe('运营 · 林海');
    expect(actorLine('customer', '王五')).toBe('客户 · 王五');
    expect(actorLine('expert', '周工')).toBe('专家 · 周工');
    expect(actorLine('deleted', null)).toBe('已删除的账号');
  });
});
