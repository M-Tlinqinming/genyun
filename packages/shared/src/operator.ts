// 运营概览（Paper 16 页 I01）与内部账号（16 页 I06）。前后端共用。
import { z } from 'zod';
import type { InvitationState } from './invitation.ts';
import type { AuditAction } from './audit.ts';
import { chinaToday } from './task.ts';

// 耕云内部只有两种角色（CLAUDE.md）：运营管理员、注安师。界面统一叫「注安师」
export const INTERNAL_ROLES = ['expert', 'operator'] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];
export const INTERNAL_ROLE_LABELS: Record<InternalRole, string> = { expert: '注安师', operator: '运营管理员' };

// 每种角色能看到的范围（I06 表格「可见范围」列、角色说明卡片）
export const INTERNAL_ROLE_SCOPES: Record<InternalRole, string> = { expert: '分配给本人的任务', operator: '全部客户组织' };
export const INTERNAL_ROLE_DUTIES: Record<InternalRole, string> = {
  operator: '开通客户组织、维护年度服务、分配任务、处理上门工单和超时兜底、管理内部账号。不参与文档编制和审核。',
  expert: '只处理分配给自己的任务：核实资料、联系客户、整理编制、审核并发布三份成果。',
};

// 邀请内部成员（邮件邀请，7 天有效，和客户组织的邀请同一套）
export const internalInviteSchema = z.object({
  name: z.string().trim().min(1, '请填写姓名').max(50, '姓名最多 50 个字'),
  email: z.string().trim().toLowerCase().pipe(z.email('请填写正确的邮箱')),
  role: z.enum(INTERNAL_ROLES, '请选择角色'),
});
export type InternalInviteInput = z.input<typeof internalInviteSchema>;

export const internalRoleSchema = z.object({ role: z.enum(INTERNAL_ROLES, '请选择角色') });
export type InternalRoleInput = z.input<typeof internalRoleSchema>;

export interface InternalAccount {
  id: string;
  name: string;
  email: string;
  role: InternalRole;
  // 停用时间；为空 = 正常
  disabledAt: string | null;
  // 最近一次登录成功（来自操作日志）；从没登录过为空
  lastLoginAt: string | null;
  // 负责的、还没结束的任务（只有注安师有）
  openTasks: number;
  self: boolean;
}

export interface InternalInvitation {
  id: string;
  name: string;
  email: string;
  role: InternalRole;
  createdAt: string;
  expiresAt: string;
  invitedByName: string;
  state: Extract<InvitationState, 'valid' | 'expired'>;
}

export interface InternalAccountsView {
  accounts: InternalAccount[];
  // 还没接受、没作废的邀请（同一邮箱只留最新一封）
  invitations: InternalInvitation[];
}

// ---------- 运营概览 ----------

// 「今天先处理」的几类事（设计稿里的「反馈」「知识库待核实」等功能上线后再加）
export const OVERVIEW_TODO_KINDS = {
  org_pending: '待开通',
  invitation: '邀请未接受',
  unassigned: '待分派',
  overdue: '超时兜底',
  on_site: '上门工单',
} as const;
export type OverviewTodoKind = keyof typeof OVERVIEW_TODO_KINDS;

export interface OverviewTodo {
  kind: OverviewTodoKind;
  id: string;
  title: string;
  subtitle: string;
  note: string;
  // 从什么时候开始等（按这个排序，等得最久的在前）
  since: string;
  action: string;
  link: string;
}

export interface OverviewService {
  orgId: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  enterprises: number;
  state: 'pending' | 'active';
  // 服务中：还剩几天；待开通为空
  daysLeft: number | null;
}

export interface OverviewActivity {
  id: string;
  at: string;
  action: AuditAction;
  actorName: string | null;
  target: string | null;
}

export interface OperatorOverview {
  orgs: { total: number; active: number; pending: number; expired: number };
  tasks: { open: number; preparing: number; unassigned: number; drafting: number };
  deliveries: { thisMonth: number };
  followUps: { overdue: number; onSiteNew: number };
  todos: OverviewTodo[];
  services: OverviewService[];
  recent: OverviewActivity[];
}

// 已等待：按北京时间的日期算，同一天写「今天」
export function waitedLabel(since: string | Date, now: Date = new Date()): string {
  const days = Math.round((Date.parse(chinaToday(now)) - Date.parse(chinaToday(new Date(since)))) / 86_400_000);
  return days <= 0 ? '今天' : `${days} 天`;
}

// 统计卡第二行：去掉为 0 的项，全是 0 时给一句兜底
export function breakdownLine(parts: [string, number][], empty: string): string {
  const shown = parts.filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`);
  return shown.length > 0 ? shown.join(' · ') : empty;
}
