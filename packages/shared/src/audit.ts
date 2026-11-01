import { z } from 'zod';

// 操作日志（M4 第 5 项，等保要求）：谁在什么时候、从哪个 IP、对什么做了哪类关键操作。
// 只增不改；运营只读查看。界面上只显示中文名称。
export const AUDIT_ACTIONS = [
  'login_success',
  'login_failure',
  'logout',
  'password_change',
  'password_reset',
  'task_assign',
  'task_reassign',
  'publish',
  'account_invite',
  'account_disable',
  'account_enable',
  'account_role_change',
  'member_invite',
  'member_invite_revoke',
  'member_remove',
  'member_role_change',
  'enterprise_assign',
  'org_profile_update',
  'knowledge_agency_change',
  'knowledge_holiday_change',
  'knowledge_template_change',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  login_success: '登录成功',
  login_failure: '登录失败',
  logout: '退出登录',
  password_change: '修改密码',
  password_reset: '找回密码并重设',
  task_assign: '分派注安师',
  task_reassign: '改派注安师',
  publish: '发布',
  account_invite: '邀请内部成员',
  account_disable: '停用账号',
  account_enable: '恢复账号',
  account_role_change: '变更角色',
  member_invite: '邀请机构成员',
  member_invite_revoke: '撤销成员邀请',
  member_remove: '移除机构成员',
  member_role_change: '变更成员角色',
  enterprise_assign: '调整可访问企业',
  org_profile_update: '修改组织资料',
  knowledge_agency_change: '维护属地应急机构',
  knowledge_holiday_change: '维护节假日',
  knowledge_template_change: '维护工艺模板',
};

export const AUDIT_PAGE_SIZE = 50;

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  action: z.enum(AUDIT_ACTIONS).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditLogEntry {
  id: string;
  at: string;
  // 操作人：登录失败时可能不是任何账号（输错邮箱），这时为 null
  actorName: string | null;
  actorEmail: string | null;
  ip: string | null;
  action: AuditAction;
  // 对象：一句话说明对什么操作，例如登录用的邮箱、任务编号
  target: string | null;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}
