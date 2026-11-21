import { describe, expect, it } from 'vitest';
import {
  creditAdjustSchema,
  creditBalance,
  creditLockReason,
  creditSummary,
  formatAdminNames,
  giftCampaignTotals,
  giftUsage,
  pickAdjustContract,
  pickDeduction,
  type CreditContract,
  type GiftUsageRow,
  type CreditLedgerRow,
} from './credits.ts';
import { orgOpenSchema } from './organization.ts';

const today = '2026-11-20';
const a: CreditContract = { id: 'a', startsAt: '2026-01-01', endsAt: '2026-12-31' };
const b: CreditContract = { id: 'b', startsAt: '2026-11-01', endsAt: '2027-10-31' };
const past: CreditContract = { id: 'past', startsAt: '2025-01-01', endsAt: '2025-12-31' };
const future: CreditContract = { id: 'future', startsAt: '2027-01-01', endsAt: '2027-12-31' };

const row = (
  contractId: string,
  type: CreditLedgerRow['type'],
  pool: CreditLedgerRow['pool'],
  delta: number,
  campaign?: string,
): CreditLedgerRow => ({ contractId, type, pool, delta, campaign: campaign ?? null });

describe('余额', () => {
  it('先扣赠送，再扣购买', () => {
    const entries = [row('a', 'contract_purchase', 'purchase', 3), row('a', 'gift', 'gift', 1, '开通赠送')];
    expect(pickDeduction([a], entries, today)).toEqual({ ok: true, contractId: 'a', pool: 'gift' });
    entries.push(row('a', 'delivery_deduction', 'gift', -1));
    expect(pickDeduction([a], entries, today)).toEqual({ ok: true, contractId: 'a', pool: 'purchase' });
  });

  it('同一池里先扣到期早的；两份合同重叠时一起算', () => {
    const entries = [
      row('a', 'contract_purchase', 'purchase', 1),
      row('b', 'contract_purchase', 'purchase', 5),
      row('b', 'gift', 'gift', 2, '续约赠送'),
    ];
    // 赠送池只有 b 有，先扣 b 的赠送
    expect(pickDeduction([b, a], entries, today)).toEqual({ ok: true, contractId: 'b', pool: 'gift' });
    entries.push(row('b', 'delivery_deduction', 'gift', -1), row('b', 'delivery_deduction', 'gift', -1));
    // 购买池两份都有，先扣到期早的 a
    expect(pickDeduction([b, a], entries, today)).toEqual({ ok: true, contractId: 'a', pool: 'purchase' });
    expect(creditBalance([a, b], entries, today)).toEqual({ total: 6, gift: 0, purchase: 6 });
  });

  it('到期的、还没开始的合同不算', () => {
    const entries = [row('past', 'contract_purchase', 'purchase', 5), row('future', 'contract_purchase', 'purchase', 5)];
    expect(creditBalance([past, future], entries, today)).toEqual({ total: 0, gift: 0, purchase: 0 });
    expect(pickDeduction([past, future], entries, today)).toEqual({ ok: false, reason: 'expired' });
    expect(creditLockReason([past, future], today)).toBe('expired');
    expect(creditSummary([past, future], entries, today).validUntil).toBeNull();
  });

  it('余额 0 时扣不到，原因是次数用完；没有合同是到期', () => {
    const entries = [row('a', 'contract_purchase', 'purchase', 1), row('a', 'delivery_deduction', 'purchase', -1)];
    expect(pickDeduction([a], entries, today)).toEqual({ ok: false, reason: 'credits' });
    expect(creditLockReason([a], today)).toBe('credits');
    expect(pickDeduction([], [], today)).toEqual({ ok: false, reason: 'expired' });
  });

  it('首尾两天都算有效', () => {
    const e = [row('a', 'top_up', 'purchase', 1)];
    expect(pickDeduction([a], e, '2026-12-31').ok).toBe(true);
    expect(pickDeduction([a], e, '2026-01-01').ok).toBe(true);
    expect(pickDeduction([a], e, '2027-01-01').ok).toBe(false);
  });
});

describe('汇总', () => {
  it('granted − used = remaining.total，减的调整也算进 granted', () => {
    const entries = [
      row('a', 'contract_purchase', 'purchase', 20),
      row('a', 'gift', 'gift', 2, '开通赠送'),
      row('a', 'compensation', 'gift', 1),
      row('a', 'top_up', 'purchase', -1),
      row('a', 'delivery_deduction', 'gift', -1),
      row('a', 'delivery_deduction', 'purchase', -1),
      row('past', 'contract_purchase', 'purchase', 9),
    ];
    const s = creditSummary([a, past, b], entries, today);
    expect(s.granted).toBe(22);
    expect(s.used).toBe(2);
    expect(s.remaining).toEqual({ total: 20, gift: 2, purchase: 18 });
    expect(s.granted - s.used).toBe(s.remaining.total);
    expect(s.validUntil).toBe('2027-10-31');
    // 按池：赠送 2 + 补偿 1 = 3；购买 20 − 1 = 19
    expect(s.grantedByPool).toEqual({ gift: 3, purchase: 19 });
  });

  it('赠送按活动名称统计', () => {
    const entries = [
      row('a', 'gift', 'gift', 2, '开通赠送'),
      row('b', 'gift', 'gift', 3, '老客户回馈'),
      row('a', 'gift', 'gift', -1, '开通赠送'),
      row('a', 'compensation', 'gift', 5),
    ];
    expect(giftCampaignTotals(entries)).toEqual([
      { campaign: '开通赠送', total: 1 },
      { campaign: '老客户回馈', total: 3 },
    ]);
  });
});

describe('管理员名字', () => {
  it('用「、」连起来，没有时写组织管理员', () => {
    expect(formatAdminNames(['林管理员', ' 王经理 '])).toBe('林管理员、王经理');
    expect(formatAdminNames([])).toBe('组织管理员');
    expect(formatAdminNames(['  '])).toBe('组织管理员');
  });
});

describe('调整次数的请求体', () => {
  const ok = { type: 'top_up', delta: 3, reason: '客户加购 3 次' };
  it('正常通过，去掉首尾空白', () => {
    const r = creditAdjustSchema.parse({ ...ok, reason: '  客户加购 3 次 ' });
    expect(r).toEqual({ type: 'top_up', delta: 3, reason: '客户加购 3 次', campaign: null });
  });
  it('原因必填', () => {
    const r = creditAdjustSchema.safeParse({ ...ok, reason: '   ' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('请写调整原因');
  });
  it('赠送要写活动名称', () => {
    expect(creditAdjustSchema.safeParse({ ...ok, type: 'gift' }).success).toBe(false);
    expect(creditAdjustSchema.safeParse({ ...ok, type: 'gift', campaign: '老客户回馈' }).success).toBe(true);
  });
  it('不为 0、是整数、绝对值不超过 1000；交付扣减不能手调', () => {
    expect(creditAdjustSchema.safeParse({ ...ok, delta: 0 }).success).toBe(false);
    expect(creditAdjustSchema.safeParse({ ...ok, delta: 1.5 }).success).toBe(false);
    expect(creditAdjustSchema.safeParse({ ...ok, delta: 1001 }).success).toBe(false);
    expect(creditAdjustSchema.safeParse({ ...ok, delta: -1000 }).success).toBe(true);
    expect(creditAdjustSchema.safeParse({ ...ok, type: 'delivery_deduction' }).success).toBe(false);
  });
});

describe('开通时登记次数', () => {
  const base = {
    contractNumber: 'GY-1',
    startsAt: '2026-01-01',
    endsAt: '2099-12-31',
    contractFileId: '00000000-0000-4000-8000-000000000000',
    paymentReceived: true,
    adminName: '林',
    adminPhone: '0752 5200831',
    adminEmail: 'lin@example.cn',
  };
  it('购买次数必填，赠送按 0', () => {
    expect(orgOpenSchema.safeParse(base).error?.issues[0]?.message).toBe('请填合同购买次数');
    const r = orgOpenSchema.parse({ ...base, purchasedCredits: 0 });
    expect(r.purchasedCredits).toBe(0);
    expect(r.giftCredits).toBe(0);
    expect(r.giftCampaign).toBeNull();
  });
  it('有赠送时要填活动名称', () => {
    const r = orgOpenSchema.safeParse({ ...base, purchasedCredits: 20, giftCredits: 2 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('有赠送时请填活动名称');
    const ok = orgOpenSchema.parse({ ...base, purchasedCredits: 20, giftCredits: 2, giftCampaign: ' 开通赠送 ' });
    expect(ok.giftCampaign).toBe('开通赠送');
  });
  it('次数不能是负数', () => {
    expect(orgOpenSchema.safeParse({ ...base, purchasedCredits: -1 }).success).toBe(false);
  });
});

describe('调整次数挑哪份合同', () => {
  it('生效的里到期最晚的；没有就挑还没开始的里最早开始的；都没有为 null', () => {
    expect(pickAdjustContract([a, b, past], today)?.id).toBe('b');
    const later: CreditContract = { id: 'later', startsAt: '2028-01-01', endsAt: '2028-12-31' };
    expect(pickAdjustContract([past, later, future], today)?.id).toBe('future');
    expect(pickAdjustContract([past], today)).toBeNull();
  });
});

describe('赠送用掉多少', () => {
  let n = 0;
  const g = (
    contractId: string,
    type: GiftUsageRow['type'],
    delta: number,
    campaign: string | null = null,
    pool: GiftUsageRow['pool'] = 'gift',
  ): GiftUsageRow => {
    n += 1;
    return { id: `r${String(n).padStart(3, '0')}`, contractId, type, pool, delta, campaign, createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z` };
  };

  it('先送先用', () => {
    const rows = [
      g('a', 'gift', 2, '开通赠送'),
      g('a', 'gift', 3, '老客户回馈'),
      g('a', 'delivery_deduction', -1),
      g('a', 'delivery_deduction', -1),
      g('a', 'delivery_deduction', -1),
      g('a', 'delivery_deduction', -1, null, 'purchase'),
    ];
    const r = giftUsage(rows);
    expect(r.map((x) => [x.campaign, x.granted, x.used, x.unused])).toEqual([
      ['开通赠送', 2, 2, 0],
      ['老客户回馈', 3, 1, 2],
    ]);
  });

  it('两份合同各算各的', () => {
    const rows = [g('a', 'gift', 2, '开通赠送'), g('b', 'gift', 2, '开通赠送'), g('b', 'delivery_deduction', -1)];
    const r = giftUsage(rows);
    expect(r.find((x) => x.contractId === 'a')).toMatchObject({ granted: 2, used: 0, unused: 2 });
    expect(r.find((x) => x.contractId === 'b')).toMatchObject({ granted: 2, used: 1, unused: 1 });
  });

  it('负数先冲同类型同活动最晚那笔，不够再往前、再同类型、再任意一笔；冲掉的算没送出', () => {
    const rows = [
      g('a', 'gift', 2, '开通赠送'),
      g('a', 'compensation', 1),
      g('a', 'gift', 2, '开通赠送'),
      g('a', 'gift', 1, '老客户回馈'),
      g('a', 'gift', -5, '开通赠送'),
      g('a', 'compensation', -2),
    ];
    const r = giftUsage(rows);
    // 「开通赠送」两笔 4 次被冲 4；剩下 1 次再冲同类型的「老客户回馈」；补偿 −2 冲掉补偿 1，再冲任意一笔（已经都是 0）
    expect(r.map((x) => [x.type, x.campaign, x.granted])).toEqual([
      ['gift', '开通赠送', 0],
      ['compensation', null, 0],
      ['gift', '开通赠送', 0],
      ['gift', '老客户回馈', 0],
    ]);
  });

  it('冲掉以后交付扣减跳过已经冲空的那笔', () => {
    const rows = [g('a', 'gift', 2, '甲'), g('a', 'gift', 2, '乙'), g('a', 'gift', -2, '甲'), g('a', 'delivery_deduction', -1)];
    const r = giftUsage(rows);
    expect(r.map((x) => [x.campaign, x.granted, x.used])).toEqual([
      ['甲', 0, 0],
      ['乙', 2, 1],
    ]);
  });

  it('购买池的行不算', () => {
    expect(giftUsage([g('a', 'contract_purchase', 10, null, 'purchase'), g('a', 'top_up', 2, null, 'purchase')])).toEqual([]);
  });
});
