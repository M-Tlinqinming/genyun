// 客户组织管理（M3 第 7 项，Paper 11 页「组织管理」）：机构管理员管理成员、邀请、企业分配、组织资料，查看年度服务。前后端共用。
// 成员只能访问分配给自己的企业；机构管理员访问全部企业。邀请沿用同一套邮件邀请（7 天有效）
import { z } from 'zod';
import type { InvitationState } from './invitation.ts';
import type { ContractState } from './task.ts';
import type { ServiceScopeKind } from './organization.ts';

export const CUSTOMER_ROLES = ['customer_admin', 'customer_member'] as const;
export type CustomerRole = (typeof CUSTOMER_ROLES)[number];
export const CUSTOMER_ROLE_LABELS: Record<CustomerRole, string> = { customer_admin: '机构管理员', customer_member: '成员' };

// 角色说明（成员与权限下方的两张卡片）
export const CUSTOMER_ROLE_DUTIES: Record<CustomerRole, string> = {
  customer_admin: '访问全部企业；邀请与移除成员、分配企业、查看年度服务。至少保留 1 名。',
  customer_member: '只访问分配给自己的企业；可建任务、上传资料、提交申请、回应补件、下载成果。',
};

export const memberInviteSchema = z.object({
  name: z.string().trim().min(1, '请填写姓名').max(50, '姓名最多 50 个字'),
  email: z.string().trim().toLowerCase().pipe(z.email('请填写正确的邮箱')),
  role: z.enum(CUSTOMER_ROLES, '请选择角色'),
});
export type MemberInviteInput = z.input<typeof memberInviteSchema>;

export const memberRoleSchema = z.object({ role: z.enum(CUSTOMER_ROLES, '请选择角色') });
export type MemberRoleInput = z.input<typeof memberRoleSchema>;

// 调整某位成员能访问的企业（整组替换）
export const memberEnterprisesSchema = z.object({ enterpriseIds: z.array(z.uuid()).max(500) });
// 调整某家企业的负责成员（整组替换）
export const enterpriseMembersSchema = z.object({ userIds: z.array(z.uuid()).max(200) });

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(100, '邮箱最多 100 个字')
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.email('请填写正确的邮箱').nullable());

// 组织资料：机构名称由耕云登记，客户只改联系人、电话、邮箱
export const orgProfileSchema = z.object({
  contactName: z.string().trim().min(1, '请填写服务联系人').max(50, '服务联系人最多 50 个字'),
  contactPhone: z
    .string()
    .trim()
    .min(1, '请填写联系电话')
    .max(30, '联系电话最多 30 位')
    .regex(/^[\d\s\-+()（）]+$/, '联系电话只能填数字、空格和短横线')
    .refine((v) => v.replace(/\D/g, '').length >= 7, '联系电话至少 7 位数字'),
  contactEmail: optionalEmail,
});
export type OrgProfileInput = z.input<typeof orgProfileSchema>;

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: CustomerRole;
  self: boolean;
  // 分配到的企业（机构管理员可以看全部企业，这里只表示「负责」）
  enterpriseIds: string[];
}

export interface OrgMemberInvitation {
  id: string;
  name: string;
  email: string;
  role: CustomerRole;
  createdAt: string;
  expiresAt: string;
  state: Extract<InvitationState, 'valid' | 'expired'>;
}

export interface OrgEnterpriseAssignment {
  id: string;
  name: string;
  memberIds: string[];
  // 最近一次调整负责成员的时间；没调整过为空
  membersChangedAt: string | null;
}

export interface OrgServiceView {
  startsAt: string | null;
  endsAt: string | null;
  state: ContractState;
  daysLeft: number | null;
  scopeKind: ServiceScopeKind | null;
  scopeEnterprises: number | null;
  // 本服务期内办理过的企业数、已交付、办理中
  enterprises: number;
  delivered: number;
  inProgress: number;
}

export interface OrgManagementView {
  org: { id: string; name: string; contactName: string | null; contactPhone: string | null; contactEmail: string | null };
  members: OrgMember[];
  invitations: OrgMemberInvitation[];
  enterprises: OrgEnterpriseAssignment[];
  service: OrgServiceView;
}

export interface MemberInviteResult {
  email: string;
  expiresAt: string;
  // 本机没有配置邮件服务时为 true（邮件写进模拟发件箱）
  simulated: boolean;
}
