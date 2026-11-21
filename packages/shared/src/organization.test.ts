import { describe, expect, it } from 'vitest';
import {
  addDays,
  openingGaps,
  operatorTaskStage,
  orgCreditCell,
  orgNeedsAttention,
  orgOpenSchema,
  orgRegisterSchema,
  orgRenewalSchema,
  orgServiceState,
  renewalDefaultDates,
  serviceScopeLabel,
} from './organization.ts';
import { chinaToday } from './task.ts';

const FILE = '11111111-1111-4111-8111-111111111111';
const complete = {
  contractNumber: 'GY-HT-2026-018',
  purchasedCredits: 20,
  startsAt: '2026-11-01',
  endsAt: '2027-10-31',
  contractFileId: FILE,
  paymentReceived: true as const,
  adminName: '孙经理',
  adminPhone: '136 2254 1234',
  adminEmail: 'Sun@Huadong-Anping.cn',
};

const reg = {
  name: ' 华东安评 ',
  region: { province: '上海市', city: '上海市', district: '闵行区' },
  socialCreditCode: '91310112ma1xxxxxx3',
  contactName: '孙经理',
  contactPhone: '136 2254 1234',
  contactEmail: 'Sun@Huadong-Anping.CN',
};

describe('登记客户组织', () => {
  it('名称、地区、统一社会信用代码、主联系人、手机号、邮箱都必填；备注空着存为空', () => {
    const r = orgRegisterSchema.parse({ ...reg, note: '' });
    expect(r).toMatchObject({ name: '华东安评', note: null });
    for (const field of ['name', 'region', 'socialCreditCode', 'contactName', 'contactPhone', 'contactEmail'] as const) {
      expect(orgRegisterSchema.safeParse({ ...reg, [field]: '' }).success, field).toBe(false);
    }
    expect(orgRegisterSchema.safeParse({ ...reg, region: undefined }).error?.issues[0]?.message).toBe('请选择所在地区');
    expect(orgRegisterSchema.safeParse({ ...reg, region: { province: '广东省', city: '' } }).error?.issues[0]?.message).toBe('请选到市');
    expect(orgRegisterSchema.safeParse({ ...reg, socialCreditCode: undefined }).error?.issues[0]?.message).toBe('请填写统一社会信用代码');
    expect(orgRegisterSchema.safeParse({ ...reg, contactEmail: undefined }).error?.issues[0]?.message).toBe('请填写邮箱');
  });

  it('信用代码转大写并校验 18 位，邮箱转小写', () => {
    const r = orgRegisterSchema.parse(reg);
    expect(r.socialCreditCode).toBe('91310112MA1XXXXXX3');
    expect(r.contactEmail).toBe('sun@huadong-anping.cn');
    expect(orgRegisterSchema.safeParse({ ...reg, socialCreditCode: '123' }).success).toBe(false);
  });

  it('手机号至少 7 位数字', () => {
    expect(orgRegisterSchema.safeParse({ ...reg, contactPhone: '123 456' }).error?.issues[0]?.message).toBe('手机号至少 7 位数字');
    expect(orgRegisterSchema.safeParse({ ...reg, contactPhone: '0752-520083' }).success).toBe(true);
  });
});

describe('合同有效期', () => {
  it('不存在的日期（如 2 月 30 日）说明怎么改', () => {
    const r = orgOpenSchema.safeParse({ ...complete, startsAt: '2026-02-30' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('日期不存在，请按 年-月-日 重新选择');
  });

  it('到期日早于今天时拦下', () => {
    const r = orgOpenSchema.safeParse({ ...complete, startsAt: '2020-01-01', endsAt: '2020-12-31' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('合同有效期已过，请核对');
  });
});

describe('开通前检查', () => {
  it('填齐后没有缺项', () => {
    expect(openingGaps(complete)).toEqual([]);
  });

  it('合同原件选填；没确认到账、没填购买次数不能开通', () => {
    expect(openingGaps({ ...complete, contractFileId: null })).toEqual([]);
    expect(openingGaps({ ...complete, paymentReceived: false })).toEqual(['合同款已到账']);
    expect(openingGaps({ ...complete, purchasedCredits: null })).toEqual(['合同购买次数']);
    expect(openingGaps({ ...complete, purchasedCredits: 0 })).toEqual([]);
  });

  it('有赠送时要写活动名称', () => {
    expect(openingGaps({ ...complete, giftCredits: 2 })).toEqual(['活动名称']);
    expect(openingGaps({ ...complete, giftCredits: 2, giftCampaign: '开通赠送' })).toEqual([]);
  });

  it('什么都没填时按弹窗先后列出全部缺项', () => {
    expect(openingGaps({})).toEqual([
      '合同编号',
      '合同购买次数',
      '合同款已到账',
      '合同有效期',
      '首位管理员姓名',
      '首位管理员手机号',
      '首位管理员邮箱',
    ]);
    expect(openingGaps({ giftCredits: 1 })).toContain('活动名称');
  });
});

describe('开通请求校验', () => {
  it('邮箱转小写；合同原件可以不传；赠送默认 0', () => {
    const r = orgOpenSchema.parse({ ...complete, contractFileId: undefined });
    expect(r.adminEmail).toBe('sun@huadong-anping.cn');
    expect(r.contractFileId).toBeNull();
    expect(r.giftCredits).toBe(0);
  });

  it('购买次数必填，0–100000 的整数', () => {
    expect(orgOpenSchema.safeParse({ ...complete, purchasedCredits: undefined }).error?.issues[0]?.message).toBe('请填合同购买次数');
    expect(orgOpenSchema.safeParse({ ...complete, purchasedCredits: -1 }).success).toBe(false);
    expect(orgOpenSchema.safeParse({ ...complete, purchasedCredits: 1.5 }).success).toBe(false);
    expect(orgOpenSchema.safeParse({ ...complete, purchasedCredits: 100001 }).success).toBe(false);
    expect(orgOpenSchema.safeParse({ ...complete, purchasedCredits: 0 }).success).toBe(true);
    expect(orgOpenSchema.safeParse({ ...complete, giftCredits: 1 }).error?.issues[0]?.message).toBe('有赠送时请填活动名称');
  });

  it('到期日早于开始日、未确认到账都不通过', () => {
    expect(orgOpenSchema.safeParse({ ...complete, endsAt: '2026-10-01' }).success).toBe(false);
    expect(orgOpenSchema.safeParse({ ...complete, paymentReceived: false }).success).toBe(false);
  });
});

describe('组织状态', () => {
  const contract = { contractStartsAt: '2026-11-01', contractEndsAt: '2027-10-31' };
  it('没开通是待开通，开通后按合同有效期算服务中 / 已到期', () => {
    expect(orgServiceState({ ...contract, activatedAt: null }, '2026-11-02')).toBe('pending');
    expect(orgServiceState({ ...contract, activatedAt: '2026-10-30T02:00:00Z' }, '2026-10-31')).toBe('active');
    expect(orgServiceState({ ...contract, activatedAt: '2026-10-30T02:00:00Z' }, '2027-10-31')).toBe('active');
    expect(orgServiceState({ ...contract, activatedAt: '2026-10-30T02:00:00Z' }, '2027-11-01')).toBe('expired');
  });

  it('服务范围文字', () => {
    expect(serviceScopeLabel('single', null)).toBe('编制 1 家企业');
    expect(serviceScopeLabel('annual', 5)).toBe('年度服务 · 5 家企业');
  });
});

describe('运营看到的任务进展', () => {
  it('资料准备、待分配、耕云编制、已交付', () => {
    expect(operatorTaskStage({ status: 'preparing', assignedExpertId: null, closedAt: null })).toBe('preparing');
    expect(operatorTaskStage({ status: 'submitted', assignedExpertId: null, closedAt: null })).toBe('unassigned');
    expect(operatorTaskStage({ status: 'submitted', assignedExpertId: 'u', closedAt: null })).toBe('drafting');
    expect(operatorTaskStage({ status: 'submitted', assignedExpertId: 'u', closedAt: '2026-10-01' })).toBe('delivered');
  });
});

describe('登记续约请求校验', () => {
  const today = chinaToday();
  const renewal = {
    contractNumber: 'GY-HT-2027-001',
    purchasedCredits: 10,
    paymentReceived: true as const,
    contractStartsAt: today,
    contractEndsAt: addDays(today, 364),
  };
  it('填齐能过；原件选填；赠送默认 0', () => {
    const r = orgRenewalSchema.parse(renewal);
    expect(r.contractFileId).toBeNull();
    expect(r.giftCredits).toBe(0);
  });
  it('各项报错', () => {
    const msg = (v: object) => orgRenewalSchema.safeParse({ ...renewal, ...v }).error?.issues[0]?.message;
    expect(msg({ paymentReceived: false })).toBe('合同款到账后才能登记续约');
    expect(msg({ purchasedCredits: undefined })).toBe('请填合同购买次数');
    expect(msg({ contractNumber: '' })).toBe('请填写合同编号');
    expect(msg({ giftCredits: 2 })).toBe('有赠送时请填活动名称');
    expect(msg({ contractEndsAt: addDays(today, -1), contractStartsAt: addDays(today, -10) })).toBe('合同有效期已过，请核对');
    expect(msg({ contractStartsAt: addDays(today, 10), contractEndsAt: addDays(today, 5) })).toBe('合同到期日不能早于开始日');
  });
  it('默认日期：没到期的接着现在的，已到期的从今天开始，到期日加一年减一天', () => {
    expect(renewalDefaultDates({ contractStartsAt: '2026-01-01', contractEndsAt: '2026-12-31' }, '2026-11-21')).toEqual({
      startsAt: '2027-01-01',
      endsAt: '2027-12-31',
    });
    expect(renewalDefaultDates({ contractStartsAt: '2025-01-01', contractEndsAt: '2025-12-31' }, '2026-11-21')).toEqual({
      startsAt: '2026-11-21',
      endsAt: '2027-11-20',
    });
    expect(renewalDefaultDates({ contractStartsAt: '2024-01-01', contractEndsAt: '2024-02-28' }, '2024-01-10').startsAt).toBe('2024-02-29');
  });
});

describe('快到期或快用完、剩余次数格', () => {
  const today = '2026-11-21';
  const active = { state: 'active' as const, contractStartsAt: '2026-01-01', contractEndsAt: '2026-12-31' };
  const credits = (total: number, granted = 22, awaiting = 0) => ({ remaining: { total, gift: 0, purchase: total }, granted, awaiting });

  it('服务中、已开始，30 天内到期或剩 ≤ 3 次', () => {
    expect(orgNeedsAttention(active, credits(21), today)).toBe(false);
    expect(orgNeedsAttention(active, credits(3), today)).toBe(true);
    expect(orgNeedsAttention(active, credits(0), today)).toBe(true);
    expect(orgNeedsAttention({ ...active, contractEndsAt: '2026-12-21' }, credits(21), today)).toBe(true);
    expect(orgNeedsAttention({ ...active, contractEndsAt: '2026-12-22' }, credits(21), today)).toBe(false);
  });

  it('还没开始、待开通、已到期都不算', () => {
    expect(orgNeedsAttention({ ...active, contractStartsAt: '2026-12-01' }, credits(0), today)).toBe(false);
    expect(orgNeedsAttention({ state: 'pending', contractStartsAt: null, contractEndsAt: null }, null, today)).toBe(false);
    expect(orgNeedsAttention({ ...active, state: 'expired', contractEndsAt: '2026-11-01' }, credits(0), today)).toBe(false);
  });

  it('剩余次数格的几种情况', () => {
    expect(orgCreditCell(active, credits(21), today)).toEqual({ kind: 'normal', remaining: 21, granted: 22 });
    expect(orgCreditCell(active, credits(2, 5), today)).toEqual({ kind: 'low', remaining: 2, granted: 5 });
    expect(orgCreditCell(active, credits(0, 5, 1), today)).toEqual({ kind: 'out', granted: 5, awaiting: 1 });
    expect(orgCreditCell({ state: 'pending', contractStartsAt: null, contractEndsAt: null }, null, today)).toEqual({ kind: 'pending' });
    expect(orgCreditCell({ ...active, contractStartsAt: '2026-12-01' }, credits(0), today)).toEqual({ kind: 'upcoming', startsAt: '2026-12-01' });
    expect(orgCreditCell({ ...active, state: 'expired' }, credits(0, 5, 2), today)).toEqual({ kind: 'expired', awaiting: 2 });
  });
});
