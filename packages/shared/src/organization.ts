// 客户组织的登记与开通（Paper 16 页 I02「客户组织」与「开通与邀请弹窗」）。前后端共用。
// 商务全部线下：签合同、对公转账后，运营登记合同信息并开通，系统向首位管理员发邀请邮件。
import { z } from 'zod';
import type { OrgCreditsBrief } from './credits.ts';
import { regionPartsSchema } from './region.ts';
import { chinaToday, contractState, type ContractPeriod } from './task.ts';

const phoneSchema = z
  .string()
  .trim()
  .min(1, '请填写手机号')
  .max(30, '手机号最多 30 位')
  .regex(/^[\d\s\-+()（）]+$/, '手机号只能填数字、空格和短横线')
  .refine((v) => v.replace(/\D/g, '').length >= 7, '手机号至少 7 位数字');

const optional = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}最多 ${max} 个字`)
    .optional()
    .transform((v) => (v ? v : null));

// 登记客户组织：合作已确认、还没开通时先登记，列表里显示「待开通」
export const orgRegisterSchema = z.object({
  name: z.string().trim().min(1, '请填写组织名称').max(100, '组织名称最多 100 个字'),
  // 省 / 市 / 区县三级（K16）；接口再按全国区划核对一次，存三列，region 文字列存全称
  region: regionPartsSchema,
  socialCreditCode: z
    .string('请填写统一社会信用代码')
    .trim()
    .toUpperCase()
    .min(1, '请填写统一社会信用代码')
    .regex(/^[0-9A-Z]{18}$/, '统一社会信用代码是 18 位数字或大写字母'),
  contactName: z.string().trim().min(1, '请填写主联系人').max(50, '主联系人最多 50 个字'),
  contactPhone: phoneSchema,
  // 开通时默认把主联系人作为首位管理员，邀请发到这个邮箱
  contactEmail: z
    .string('请填写邮箱')
    .trim()
    .toLowerCase()
    .min(1, '请填写邮箱')
    .pipe(z.email('请填写正确的邮箱')),
  note: optional(200, '备注'),
});
export type OrgRegisterInput = z.input<typeof orgRegisterSchema>;
export type OrgRegistration = z.output<typeof orgRegisterSchema>;

// 服务范围：编制 1 家企业，或年度服务 N 家企业（TECH-PLAN 1.2）。开通、续约不再登记，只给旧合同显示用
export const SERVICE_SCOPES = { single: '编制 1 家企业', annual: '年度服务' } as const;
export type ServiceScopeKind = keyof typeof SERVICE_SCOPES;

export function serviceScopeLabel(kind: ServiceScopeKind, enterprises: number | null): string {
  return kind === 'single' ? SERVICE_SCOPES.single : `年度服务 · ${enterprises ?? '—'} 家企业`;
}

// 开通时登记的全部内容。表单上允许先空着，开通前用 openingGaps 列出还缺什么
export interface OrgOpenDraft {
  contractNumber?: string | null;
  purchasedCredits?: number | null;
  giftCredits?: number | null;
  giftCampaign?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  contractFileId?: string | null;
  paymentReceived?: boolean;
  adminName?: string | null;
  adminPhone?: string | null;
  adminEmail?: string | null;
}

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0;

// 合同部分还缺的项（开通、登记续约共用；按弹窗里的先后）。合同原件选填，不算缺项
export function contractGaps(d: OrgOpenDraft): string[] {
  const gaps: string[] = [];
  if (!filled(d.contractNumber)) gaps.push('合同编号');
  if (typeof d.purchasedCredits !== 'number' || Number.isNaN(d.purchasedCredits)) gaps.push('合同购买次数');
  if ((d.giftCredits ?? 0) > 0 && !filled(d.giftCampaign)) gaps.push('活动名称');
  if (d.paymentReceived !== true) gaps.push('合同款已到账');
  if (!filled(d.startsAt) || !filled(d.endsAt)) gaps.push('合同有效期');
  return gaps;
}

// 开通前还缺的项（按弹窗里的先后）。缺任一项都不能开通；没确认到账不能开通
export function openingGaps(d: OrgOpenDraft): string[] {
  const gaps = contractGaps(d);
  if (!filled(d.adminName)) gaps.push('首位管理员姓名');
  if (!filled(d.adminPhone)) gaps.push('首位管理员手机号');
  if (!filled(d.adminEmail)) gaps.push('首位管理员邮箱');
  return gaps;
}

// 日期按 年-月-日；2 月 30 日这类不存在的日期也拦下
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '请选择日期')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, '日期不存在，请按 年-月-日 重新选择');

// 开通和登记续约共用的合同字段（16 页开通弹窗；续约弹窗没画，照开通弹窗）
const creditCount = (required: string) =>
  z.number(required).int('次数要是整数').min(0, '次数不能小于 0').max(100000, '次数最多 100000');
const contractFields = {
  contractNumber: z.string('请填写合同编号').trim().min(1, '请填写合同编号').max(50, '合同编号最多 50 个字'),
  // 合同原件选填，可以以后再传
  contractFileId: z
    .uuid('合同原件找不到了，请重新上传')
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  purchasedCredits: creditCount('请填合同购买次数'),
  giftCredits: creditCount('请填赠送次数').default(0),
  giftCampaign: z
    .string()
    .trim()
    .max(50, '活动名称最多 50 个字')
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
};

// 后台收到的开通请求：先查 openingGaps，再按这里校验格式
export const orgOpenSchema = z
  .object({
    ...contractFields,
    startsAt: dateSchema,
    endsAt: dateSchema,
    paymentReceived: z.literal(true, '请确认合同款已到账'),
    adminName: z.string().trim().min(1, '请填写首位管理员姓名').max(50, '姓名最多 50 个字'),
    adminPhone: phoneSchema,
    adminEmail: z.string().trim().toLowerCase().pipe(z.email('请填写正确的邮箱')),
  })
  .refine((v) => v.giftCredits === 0 || v.giftCampaign !== null, { message: '有赠送时请填活动名称', path: ['giftCampaign'] })
  .refine((v) => v.startsAt <= v.endsAt, { message: '合同到期日不能早于开始日', path: ['endsAt'] })
  .refine((v) => v.endsAt >= chinaToday(), { message: '合同有效期已过，请核对', path: ['endsAt'] });
export type OrgOpenInput = z.input<typeof orgOpenSchema>;
export type OrgOpening = z.output<typeof orgOpenSchema>;

// 登记续约（画板没画，照开通弹窗）：格式在这里查，和现在合同的衔接、同编号在接口里查
export const orgRenewalSchema = z
  .object({
    ...contractFields,
    paymentReceived: z.literal(true, '合同款到账后才能登记续约'),
    contractStartsAt: dateSchema,
    contractEndsAt: dateSchema,
  })
  .refine((v) => v.giftCredits === 0 || v.giftCampaign !== null, { message: '有赠送时请填活动名称', path: ['giftCampaign'] })
  .refine((v) => v.contractStartsAt <= v.contractEndsAt, { message: '合同到期日不能早于开始日', path: ['contractEndsAt'] })
  .refine((v) => v.contractEndsAt >= chinaToday(), { message: '合同有效期已过，请核对', path: ['contractEndsAt'] });
export type OrgRenewalInput = z.input<typeof orgRenewalSchema>;
export type OrgRenewal = z.output<typeof orgRenewalSchema>;

/** 登记续约接口返回：放开了几份成果 */
export interface OrgRenewalResult {
  released: number;
}

/** 日期 YYYY-MM-DD 加几天（按日历算） */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 两个日期相差几天（b − a） */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** 续约弹窗的默认日期：没到期的从现在到期日的后一天开始，已到期的从今天开始；到期日 = 开始日加一年减一天 */
export function renewalDefaultDates(org: ContractPeriod, today: string = chinaToday()): { startsAt: string; endsAt: string } {
  const startsAt = org.contractEndsAt && org.contractEndsAt >= today ? addDays(org.contractEndsAt, 1) : today;
  const d = new Date(`${startsAt}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return { startsAt, endsAt: addDays(d.toISOString().slice(0, 10), -1) };
}

// ---------- 列表、概览用的次数和到期状态（K16；K17 概览「续约与次数」复用） ----------

/** 剩这么多次及以下算「快用完」 */
export const CREDITS_LOW_THRESHOLD = 3;

interface OrgCreditState extends ContractPeriod {
  state: OrgServiceState;
}

/** 快到期或快用完：服务中、合同已经开始，并且 30 天内到期或剩余 ≤ 3 次（含 0 次） */
export function orgNeedsAttention(
  org: OrgCreditState,
  credits: Pick<OrgCreditsBrief, 'remaining'> | null,
  today: string = chinaToday(),
): boolean {
  if (org.state !== 'active') return false;
  const c = contractState(org, today);
  if (c.state === 'upcoming' || c.state === 'none' || c.state === 'expired') return false;
  return c.state === 'expiring' || (credits !== null && credits.remaining.total <= CREDITS_LOW_THRESHOLD);
}

/**
 * 列表「剩余次数」格的几种情况：
 * pending 待开通；upcoming 合同还没开始；expired 已到期；out 剩 0 次；low 剩 1–3 次；normal 正常
 */
export type OrgCreditCell =
  | { kind: 'pending' }
  | { kind: 'upcoming'; startsAt: string }
  | { kind: 'expired'; awaiting: number }
  | { kind: 'out'; granted: number; awaiting: number }
  | { kind: 'low'; remaining: number; granted: number }
  | { kind: 'normal'; remaining: number; granted: number };

export function orgCreditCell(
  org: OrgCreditState,
  credits: Pick<OrgCreditsBrief, 'remaining' | 'granted' | 'awaiting'> | null,
  today: string = chinaToday(),
): OrgCreditCell {
  if (org.state === 'pending') return { kind: 'pending' };
  if (org.state === 'expired') return { kind: 'expired', awaiting: credits?.awaiting ?? 0 };
  if (org.contractStartsAt && today < org.contractStartsAt) return { kind: 'upcoming', startsAt: org.contractStartsAt };
  const remaining = credits?.remaining.total ?? 0;
  const granted = credits?.granted ?? 0;
  if (remaining <= 0) return { kind: 'out', granted, awaiting: credits?.awaiting ?? 0 };
  if (remaining <= CREDITS_LOW_THRESHOLD) return { kind: 'low', remaining, granted };
  return { kind: 'normal', remaining, granted };
}

// 列表里的状态：待开通（登记了还没开通）、服务中、已到期。开通了但还没到合同开始日也算服务中（显示「未开始」）
export type OrgServiceState = 'pending' | 'active' | 'expired';
export const ORG_SERVICE_STATES: Record<OrgServiceState, string> = {
  pending: '待开通',
  active: '服务中',
  expired: '已到期',
};

export function orgServiceState(org: ContractPeriod & { activatedAt: string | null }, today?: string): OrgServiceState {
  if (!org.activatedAt) return 'pending';
  return contractState(org, today).state === 'expired' ? 'expired' : 'active';
}

// 邀请链接的有效期（Paper 16 页开通弹窗：7 天内有效）
export const INVITATION_TTL_DAYS = 7;

// 重发邀请、更换首位管理员（Paper 16 页 I03「开通与邀请」）：旧链接作废，按这里的人重新发一封
export const adminInvitationSchema = z.object({
  name: z.string().trim().min(1, '请填写首位管理员姓名').max(50, '姓名最多 50 个字'),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().pipe(z.email('请填写正确的邮箱')),
});
export type AdminInvitationInput = z.input<typeof adminInvitationSchema>;
