// 编制次数（11 页 C01·S02、16 页 I03「调整次数」「次数记录」「次数用完」）：按组织记一份次数台账。
// 专家首次交付才扣 1 次；重新打开后再次交付、撤回都不算；先扣赠送的，再扣购买的。
// 专家和普通成员看不到次数；组织管理员和运营看得到。
import { z } from 'zod';
import { chinaToday } from './task.ts';

/**
 * 台账类型：
 * contract_purchase = 合同购买（开通、续约时登记）；top_up = 加购次数（合同外加买，线下已收款）；
 * gift = 耕云赠送（活动送的，要写活动名称）；compensation = 补偿（因耕云的原因补给客户）；
 * delivery_deduction = 交付扣减（专家首次交付时自动记一次 -1）。
 * 「调整次数」可以加也可以减（16 页弹窗「加还是减」），减的时候在所选类型下记负数，不另设类型。
 */
export const CREDIT_ENTRY_TYPES = ['contract_purchase', 'top_up', 'gift', 'compensation', 'delivery_deduction'] as const;
export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number];
export const CREDIT_ENTRY_TYPE_LABELS: Record<CreditEntryType, string> = {
  contract_purchase: '合同购买',
  top_up: '加购次数',
  gift: '耕云赠送',
  compensation: '补偿',
  delivery_deduction: '交付成果',
};

/** 次数分两池：赠送（不算收入）和购买；扣的时候先扣赠送 */
export const CREDIT_POOLS = ['gift', 'purchase'] as const;
export type CreditPool = (typeof CREDIT_POOLS)[number];

/**
 * 各类型记进哪一池（K14、K16 写台账时用；数据库只要求每行都有池，不按类型约束）：
 * 赠送、补偿 → 赠送池；合同购买、加购 → 购买池；交付扣减按实际扣的那一池记（先赠送后购买）。
 * 每一行都挂在合同上：赠送、加购、补偿跟着那份合同一起到期；扣减记交付当天有效的合同。
 */
export const CREDIT_ENTRY_POOL: Record<Exclude<CreditEntryType, 'delivery_deduction'>, CreditPool> = {
  contract_purchase: 'purchase',
  top_up: 'purchase',
  gift: 'gift',
  compensation: 'gift',
};

/** 任务的扣次状态：未扣、已扣、等次数（交付时次数不够，成果先锁住，续约或加购后按任务先后放开） */
export const CHARGE_STATUSES = ['not_charged', 'charged', 'awaiting_credits'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  not_charged: '未扣',
  charged: '已扣',
  awaiting_credits: '等次数',
};

// ---------- 余额、扣次、汇总（纯函数；接口读出台账和合同后调用） ----------

/** 算余额要用到的合同字段（日期是 YYYY-MM-DD） */
export interface CreditContract {
  id: string;
  startsAt: string;
  endsAt: string;
}

/** 算余额要用到的台账字段 */
export interface CreditLedgerRow {
  contractId: string;
  type: CreditEntryType;
  pool: CreditPool;
  delta: number;
  campaign?: string | null;
}

/** 北京时间当天在合同有效期内（含首尾两天）才算有效；和 isContractActive 一致 */
export function isCreditContractActive(c: CreditContract, today: string = chinaToday()): boolean {
  return c.startsAt <= today && today <= c.endsAt;
}

export interface CreditBalance {
  total: number;
  gift: number;
  purchase: number;
}

/** 每份合同每一池的余额 */
export function contractPoolBalance(entries: CreditLedgerRow[], contractId: string, pool: CreditPool): number {
  let sum = 0;
  for (const e of entries) if (e.contractId === contractId && e.pool === pool) sum += e.delta;
  return sum;
}

/** 剩余 = 当天有效的合同上所有台账行之和，分两池 */
export function creditBalance(contracts: CreditContract[], entries: CreditLedgerRow[], today: string = chinaToday()): CreditBalance {
  const active = new Set(contracts.filter((c) => isCreditContractActive(c, today)).map((c) => c.id));
  let gift = 0;
  let purchase = 0;
  for (const e of entries) {
    if (!active.has(e.contractId)) continue;
    if (e.pool === 'gift') gift += e.delta;
    else purchase += e.delta;
  }
  return { total: gift + purchase, gift, purchase };
}

/** 扣不到的原因：expired = 当天没有有效合同；credits = 有合同，次数用完了 */
export type CreditLockReason = 'credits' | 'expired';

export type CreditDeduction = { ok: true; contractId: string; pool: CreditPool } | { ok: false; reason: CreditLockReason };

/**
 * 扣一次从哪儿扣：有效合同里先找赠送池有余额的、到期早的先扣；都没有再找购买池，同样到期早的先扣。
 * 有效期重叠的几份合同一起算。
 */
export function pickDeduction(contracts: CreditContract[], entries: CreditLedgerRow[], today: string = chinaToday()): CreditDeduction {
  const active = contracts
    .filter((c) => isCreditContractActive(c, today))
    .sort((a, b) => (a.endsAt === b.endsAt ? a.startsAt.localeCompare(b.startsAt) : a.endsAt.localeCompare(b.endsAt)));
  if (active.length === 0) return { ok: false, reason: 'expired' };
  for (const pool of CREDIT_POOLS) {
    for (const c of active) {
      if (contractPoolBalance(entries, c.id, pool) > 0) return { ok: true, contractId: c.id, pool };
    }
  }
  return { ok: false, reason: 'credits' };
}

/** 当天有没有有效合同（锁住时的原因按查看时算） */
export function creditLockReason(contracts: CreditContract[], today: string = chinaToday()): CreditLockReason {
  return contracts.some((c) => isCreditContractActive(c, today)) ? 'credits' : 'expired';
}

/** 给页面用的汇总：granted − used = remaining.total */
export interface CreditSummary {
  remaining: CreditBalance;
  /** 共：有效合同上所有不是交付扣减的行之和（正负都算） */
  granted: number;
  /** 已用：有效合同上交付扣减的条数 */
  used: number;
  /** 有效期至：有效合同里最晚的到期日；没有为 null */
  validUntil: string | null;
}

export function creditSummary(contracts: CreditContract[], entries: CreditLedgerRow[], today: string = chinaToday()): CreditSummary {
  const activeList = contracts.filter((c) => isCreditContractActive(c, today));
  const active = new Set(activeList.map((c) => c.id));
  let granted = 0;
  let used = 0;
  for (const e of entries) {
    if (!active.has(e.contractId)) continue;
    if (e.type === 'delivery_deduction') used += -e.delta;
    else granted += e.delta;
  }
  const validUntil = activeList.reduce<string | null>((m, c) => (m === null || c.endsAt > m ? c.endsAt : m), null);
  return { remaining: creditBalance(contracts, entries, today), granted, used, validUntil };
}

/** 赠送按活动名称统计（所有合同上的赠送行，正负相加；按活动第一次出现的先后） */
export function giftCampaignTotals(entries: CreditLedgerRow[]): { campaign: string; total: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== 'gift') continue;
    const key = e.campaign?.trim() || '未写活动名称';
    map.set(key, (map.get(key) ?? 0) + e.delta);
  }
  return [...map].map(([campaign, total]) => ({ campaign, total }));
}

/** 管理员名字用「、」连起来；一个都没有时写「组织管理员」 */
export function formatAdminNames(names: string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  return list.length > 0 ? list.join('、') : '组织管理员';
}

/** 运营「调整次数」能选的类型（交付扣减只由系统记） */
export const CREDIT_ADJUST_TYPES = ['top_up', 'gift', 'compensation', 'contract_purchase'] as const;
export type CreditAdjustType = (typeof CREDIT_ADJUST_TYPES)[number];

export const creditAdjustSchema = z
  .object({
    type: z.enum(CREDIT_ADJUST_TYPES, '请选择调整类型'),
    delta: z
      .number('请填写调整几次')
      .int('次数要是整数')
      .refine((v) => v !== 0, '调整次数不能为 0')
      .refine((v) => Math.abs(v) <= 1000, '一次最多调整 1000 次'),
    reason: z.string('请写调整原因').trim().min(1, '请写调整原因').max(200, '调整原因最多 200 个字'),
    campaign: z
      .string()
      .trim()
      .max(50, '活动名称最多 50 个字')
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.type !== 'gift' || v.campaign !== null, { message: '赠送请填活动名称', path: ['campaign'] });
export type CreditAdjustInput = z.input<typeof creditAdjustSchema>;
export type CreditAdjust = z.output<typeof creditAdjustSchema>;

/** 汇总加上「等次数」的成果份数（运营列表、概览、组织详情用） */
export interface OrgCreditsBrief extends CreditSummary {
  awaiting: number;
}

/** 运营看一个组织的次数（16 页「次数记录」） */
export interface OperatorCreditEntry {
  id: string;
  type: CreditEntryType;
  typeLabel: string;
  delta: number;
  pool: CreditPool;
  campaign: string | null;
  reason: string | null;
  taskNumber: string | null;
  enterpriseName: string | null;
  contractNumber: string;
  createdByName: string | null;
  createdAt: string;
}

export interface OperatorOrgCredits extends OrgCreditsBrief {
  entries: OperatorCreditEntry[];
  typeCounts: Record<CreditEntryType, number>;
  giftCampaigns: { campaign: string; total: number }[];
}

/** 组织管理员看自己组织的次数（K7 工作台用） */
export interface OrgCredits extends CreditSummary {
  awaitingTasks: { taskId: string; taskNumber: string; enterpriseName: string }[];
}

/** 调整次数接口返回 */
export interface CreditAdjustResult {
  summary: OrgCreditsBrief;
  released: number;
}
