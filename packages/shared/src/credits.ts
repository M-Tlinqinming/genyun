// 编制次数（11 页 C01·S02、16 页 I03「调整次数」「次数记录」「次数用完」）：按组织记一份次数台账。
// 专家首次交付才扣 1 次；重新打开后再次交付、撤回都不算；先扣赠送的，再扣购买的。
// 专家和普通成员看不到次数；组织管理员和运营看得到。

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
  delivery_deduction: '交付扣减',
};

/** 次数分两池：赠送（不算收入）和购买；扣的时候先扣赠送 */
export const CREDIT_POOLS = ['gift', 'purchase'] as const;
export type CreditPool = (typeof CREDIT_POOLS)[number];

/** 各类型记进哪一池；补偿不算收入，记进赠送池（待业务确认） */
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
