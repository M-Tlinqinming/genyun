// 客户组织的登记与开通（Paper 16 页 I02「客户组织」与「开通与邀请弹窗」）。前后端共用。
// 商务全部线下：签合同、对公转账后，运营登记合同信息并开通，系统向首位管理员发邀请邮件。
import { z } from 'zod';
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
  region: z.string().trim().min(1, '请填写所在地区').max(50, '所在地区最多 50 个字'),
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

// 服务范围：编制 1 家企业，或年度服务 N 家企业（TECH-PLAN 1.2）。第一期不按范围拦截，超出由运营人工判断
export const SERVICE_SCOPES = { single: '编制 1 家企业', annual: '年度服务' } as const;
export type ServiceScopeKind = keyof typeof SERVICE_SCOPES;

export function serviceScopeLabel(kind: ServiceScopeKind, enterprises: number | null): string {
  return kind === 'single' ? SERVICE_SCOPES.single : `年度服务 · ${enterprises ?? '—'} 家企业`;
}

// 开通时登记的全部内容。表单上允许先空着，开通前用 openingGaps 列出还缺什么
export interface OrgOpenDraft {
  contractNumber?: string | null;
  scopeKind?: ServiceScopeKind | null;
  scopeEnterprises?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  contractFileId?: string | null;
  paymentReceived?: boolean;
  adminName?: string | null;
  adminPhone?: string | null;
  adminEmail?: string | null;
}

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0;

// 开通前还缺的项（按弹窗里的先后）。缺任一项都不能开通（TECH-PLAN 1.2：原件未上传或未确认到账不能开通）
export function openingGaps(d: OrgOpenDraft): string[] {
  const gaps: string[] = [];
  if (!filled(d.contractNumber)) gaps.push('合同编号');
  if (!d.scopeKind || (d.scopeKind === 'annual' && !(d.scopeEnterprises && d.scopeEnterprises > 0))) gaps.push('服务范围');
  if (!d.contractFileId) gaps.push('已签合同原件');
  if (d.paymentReceived !== true) gaps.push('合同款已到账');
  if (!filled(d.startsAt) || !filled(d.endsAt)) gaps.push('合同有效期');
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

// 后台收到的开通请求：先查 openingGaps，再按这里校验格式
export const orgOpenSchema = z
  .object({
    contractNumber: z.string().trim().min(1, '请填写合同编号').max(50, '合同编号最多 50 个字'),
    scopeKind: z.enum(['single', 'annual'], '请选择服务范围'),
    scopeEnterprises: z.number().int().min(1, '年度服务至少 1 家企业').max(9999).nullable().optional(),
    startsAt: dateSchema,
    endsAt: dateSchema,
    contractFileId: z.uuid('请上传已签合同原件'),
    paymentReceived: z.literal(true, '请确认合同款已到账'),
    adminName: z.string().trim().min(1, '请填写首位管理员姓名').max(50, '姓名最多 50 个字'),
    adminPhone: phoneSchema,
    adminEmail: z.string().trim().toLowerCase().pipe(z.email('请填写正确的邮箱')),
  })
  .refine((v) => v.startsAt <= v.endsAt, { message: '合同到期日不能早于开始日', path: ['endsAt'] })
  .refine((v) => v.endsAt >= chinaToday(), { message: '合同有效期已过，请核对', path: ['endsAt'] })
  .refine((v) => v.scopeKind === 'single' || (v.scopeEnterprises ?? 0) >= 1, {
    message: '请填写年度服务包含几家企业',
    path: ['scopeEnterprises'],
  })
  .transform((v) => ({ ...v, scopeEnterprises: v.scopeKind === 'single' ? null : (v.scopeEnterprises ?? null) }));
export type OrgOpenInput = z.input<typeof orgOpenSchema>;
export type OrgOpening = z.output<typeof orgOpenSchema>;

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

// 运营组织详情「企业与任务」里每家企业当前任务的进展（只读，处理在任务中心）
export type OperatorTaskStage = 'preparing' | 'unassigned' | 'drafting' | 'delivered';
export const OPERATOR_TASK_STAGES: Record<OperatorTaskStage, string> = {
  preparing: '资料准备',
  unassigned: '待分配',
  drafting: '耕云编制',
  delivered: '已交付',
};

export function operatorTaskStage(t: {
  status: 'preparing' | 'submitted';
  assignedExpertId: string | null;
  closedAt: string | Date | null;
}): OperatorTaskStage {
  if (t.closedAt) return 'delivered';
  if (t.status === 'preparing') return 'preparing';
  return t.assignedExpertId ? 'drafting' : 'unassigned';
}

// 重发邀请、更换首位管理员（Paper 16 页 I03「开通与邀请」）：旧链接作废，按这里的人重新发一封
export const adminInvitationSchema = z.object({
  name: z.string().trim().min(1, '请填写首位管理员姓名').max(50, '姓名最多 50 个字'),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().pipe(z.email('请填写正确的邮箱')),
});
export type AdminInvitationInput = z.input<typeof adminInvitationSchema>;
