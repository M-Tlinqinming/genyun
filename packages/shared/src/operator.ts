// 运营概览（Paper 16 页 I01）与内部账号（16 页 I06）。前后端共用。
import { z } from 'zod';
import type { InvitationState } from './invitation.ts';
import { AUDIT_ACTION_LABELS, type AuditAction } from './audit.ts';
import type { OrgCreditsBrief } from './credits.ts';
import { CREDITS_LOW_THRESHOLD, daysBetween, orgNeedsAttention, type OrgServiceState } from './organization.ts';
import { chinaToday, contractState } from './task.ts';

// 耕云内部只有两种角色（CLAUDE.md）：运营管理员、专家。界面统一叫「专家」
export const INTERNAL_ROLES = ['expert', 'operator'] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];
export const INTERNAL_ROLE_LABELS: Record<InternalRole, string> = { expert: '专家', operator: '运营管理员' };

// 每种角色能看到的范围（I06 表格「可见范围」列、角色说明卡片）
export const INTERNAL_ROLE_SCOPES: Record<InternalRole, string> = { expert: '分配给本人的任务', operator: '全部客户组织' };
export const INTERNAL_ROLE_DUTIES: Record<InternalRole, string> = {
  operator: '开通客户组织、维护年度服务、分配任务、受理反馈、管理内部账号。不参与文档编制和审核。',
  expert: '只处理分配给自己的任务：核实资料、联系客户、整理编制、审核并交付三份成果。',
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
  // 负责的、还没结束的任务（只有专家有）
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

// 「今天先处理」的几类事（待分配的任务在任务中心看，不放这里；「专家待审核」以后加）
export const OVERVIEW_TODO_KINDS = {
  org_pending: '待开通',
  invitation: '邀请未接受',
  feedback: '待受理反馈',
  // 有成果已编制好、等次数到账才放开的客户组织
  credits_out: '次数用完',
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

/** 最近操作里操作人的身份：运营、专家（耕云内部），客户（客户组织的人），账号已删除 */
export type ActorIdentity = 'operator' | 'expert' | 'customer' | 'deleted';
export const ACTOR_IDENTITY_LABELS: Record<ActorIdentity, string> = {
  operator: '运营',
  expert: '专家',
  customer: '客户',
  deleted: '已删除的账号',
};

/** 「运营 · 林海」；账号删了只写「已删除的账号」 */
export function actorLine(identity: ActorIdentity, name: string | null): string {
  if (identity === 'deleted' || !name) return ACTOR_IDENTITY_LABELS.deleted;
  return `${ACTOR_IDENTITY_LABELS[identity]} · ${name}`;
}

export interface OverviewActivity {
  id: string;
  at: string;
  action: AuditAction;
  actorName: string | null;
  actorIdentity: ActorIdentity;
  target: string | null;
  /** 一句话（activitySentence 拼好的） */
  sentence: string;
}

export interface OperatorOverview {
  orgs: { total: number; active: number; pending: number; expired: number };
  // 在办 = 没删、不是已交付；待分配专家、等客户补资料两组和任务中心的统计格一致
  tasks: { open: number; toAssign: number; awaiting: number };
  deliveries: { thisMonth: number };
  // 反馈受理（M3 第 6 项）：待受理、处理中；「待跟进反馈」= 两者之和
  feedback: { new: number; processing: number };
  todos: OverviewTodo[];
  renewals: RenewalRow[];
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

// ---------- 概览「续约与次数」（16 页 I01） ----------

const dotted = (d: string) => d.replaceAll('-', '.');

/** 一个进度块：上面一行左标签、右值，下面一条进度条 */
export interface RenewalBar {
  label: string;
  value: string;
  /** 值和进度条用警示色（值加粗） */
  warn: boolean;
  /** 值用次要色（还没开始、开通后才有的那几种） */
  muted: boolean;
  /** 进度条，0–100 */
  percent: number;
}

export interface RenewalRow {
  orgId: string;
  name: string;
  /** 名称下面那一行 */
  sub: string;
  subWarn: boolean;
  contract: RenewalBar;
  credits: RenewalBar;
  action: { text: string; link: string };
  /** 标黄：30 天内到期、剩 ≤ 3 次、已到期 30 天以内 */
  flagged: boolean;
  /** 排序用：0 标黄、1 服务中、2 合同还没开始、3 待开通 */
  rank: number;
  sortKey: string;
}

export interface RenewalOrg {
  id: string;
  name: string;
  state: OrgServiceState;
  contractStartsAt: string | null;
  contractEndsAt: string | null;
  /** 登记时间（待开通的按它排） */
  createdAt: string | Date;
}

/** 已到期超过这么多天的不放进「续约与次数」（在客户组织列表里看） */
export const RENEWAL_EXPIRED_DAYS = 30;
export const RENEWAL_ROWS_MAX = 5;

const clampPercent = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const bar = (label: string, value: string, opts: Partial<Omit<RenewalBar, 'label' | 'value'>> = {}): RenewalBar => ({
  label,
  value,
  warn: false,
  muted: false,
  percent: 0,
  ...opts,
});

/** 续约与次数的一行；已到期超过 30 天、开通了却没登记合同的返回 null（不显示） */
export function renewalRow(
  org: RenewalOrg,
  credits: Pick<OrgCreditsBrief, 'remaining' | 'granted' | 'awaiting'> | null,
  today: string = chinaToday(),
): RenewalRow | null {
  const view = { text: '查看', link: `/operator/organizations/${org.id}` };
  if (org.state === 'pending') {
    return {
      orgId: org.id,
      name: org.name,
      sub: org.contractStartsAt ? `待开通 · 合同 ${dotted(org.contractStartsAt)} 起` : '待开通',
      subWarn: true,
      contract: bar('合同时间', '开通后开始', { muted: true }),
      credits: bar('编制次数', '开通后可用', { muted: true }),
      action: { text: '开通', link: `/operator/organizations?open=${org.id}` },
      flagged: false,
      rank: 3,
      sortKey: new Date(org.createdAt).toISOString(),
    };
  }
  const c = contractState(org, today);
  if (c.state === 'none' || !org.contractStartsAt || !org.contractEndsAt) return null;
  const startsAt = org.contractStartsAt;
  const endsAt = org.contractEndsAt;
  if (c.state === 'expired' || org.state === 'expired') {
    const ago = Math.max(0, daysBetween(endsAt, today));
    if (ago > RENEWAL_EXPIRED_DAYS) return null;
    const awaiting = credits?.awaiting ?? 0;
    return {
      orgId: org.id,
      name: org.name,
      sub: `合同到 ${dotted(endsAt)}`,
      subWarn: false,
      contract: bar('合同时间', `已到期 ${ago} 天`, { warn: true, percent: 100 }),
      credits:
        awaiting > 0
          ? bar('编制次数', `${awaiting} 份成果等续约`, { warn: true })
          : bar('编制次数', '随合同失效', { muted: true }),
      action: view,
      flagged: true,
      rank: 0,
      sortKey: endsAt,
    };
  }
  if (c.state === 'upcoming') {
    return {
      orgId: org.id,
      name: org.name,
      sub: `合同 ${dotted(startsAt)} 起生效`,
      subWarn: false,
      contract: bar('合同时间', '还没开始', { muted: true }),
      credits: bar('编制次数', '生效后可用', { muted: true }),
      action: view,
      flagged: false,
      rank: 2,
      sortKey: startsAt,
    };
  }
  const total = daysBetween(startsAt, endsAt);
  const elapsed = daysBetween(startsAt, today);
  const remaining = credits?.remaining.total ?? 0;
  const granted = credits?.granted ?? 0;
  const low = remaining <= CREDITS_LOW_THRESHOLD;
  const flagged = orgNeedsAttention(org, credits, today);
  return {
    orgId: org.id,
    name: org.name,
    sub: `合同到 ${dotted(endsAt)}`,
    subWarn: false,
    contract: bar('合同时间', `还有 ${daysBetween(today, endsAt)} 天`, {
      warn: c.state === 'expiring',
      percent: total > 0 ? clampPercent((elapsed / total) * 100) : 100,
    }),
    credits: bar(`编制次数 · 共 ${granted} 次`, `剩 ${remaining} 次`, {
      warn: low,
      percent: granted > 0 ? clampPercent(((granted - remaining) / granted) * 100) : remaining > 0 ? 0 : 100,
    }),
    action: low ? { text: '调整次数', link: `/operator/organizations/${org.id}?adjust=1` } : view,
    flagged,
    rank: flagged ? 0 : 1,
    sortKey: endsAt,
  };
}

/** 排序：标黄的（按到期日，已到期的自然在前）→ 服务中（按到期日）→ 合同还没开始（按开始日）→ 待开通（按登记时间）；最多 5 行 */
export function sortRenewalRows(rows: readonly (RenewalRow | null)[], max: number = RENEWAL_ROWS_MAX): RenewalRow[] {
  return rows
    .filter((r): r is RenewalRow => r !== null)
    .sort((a, b) => a.rank - b.rank || a.sortKey.localeCompare(b.sortKey))
    .slice(0, max);
}

// ---------- 概览「最近操作」的一句话 ----------

/** 拼句子时可补的信息：任务编号对应的企业名 */
export interface ActivityContext {
  enterpriseName?: string | null;
}

/** 任务类操作日志的对象以「{任务编号} · 」开头，取出编号（接口按它查企业名） */
export function activityTaskNumber(action: AuditAction, target: string | null): string | null {
  if (!target || (action !== 'task_assign' && action !== 'task_reassign' && action !== 'publish')) return null;
  return /^(\S+) · /.exec(target)?.[1] ?? null;
}

/**
 * 常见的几种写成一句话（画板「示例模具已分配给周工」）。对象是各接口写操作日志时拼的那个字符串：
 * 分配「编号 · 专家」、改派「编号 · 原专家 → 新专家」、交付「编号 · 第 N 次交付」、
 * 开通「组织 · 合同 编号」、续约「组织 · 合同 编号，到 YYYY.MM.DD」、调整次数「组织 · 类型 +N 次」、
 * 邀请组织成员「姓名（邮箱）· 角色[ · 重新发送]」。拼不出来的照旧「{标签}：{对象}」
 */
export function activitySentence(action: AuditAction, target: string | null, ctx: ActivityContext = {}): string {
  const label = AUDIT_ACTION_LABELS[action];
  if (!target) return label;
  const fallback = `${label}：${target}`;
  const task = /^(\S+) · (.+)$/.exec(target);
  const who = (number: string) => ctx.enterpriseName || number;
  switch (action) {
    case 'task_assign':
      return task ? `${who(task[1]!)}已分配给${task[2]}` : fallback;
    case 'task_reassign': {
      const r = task && /^(.+) → (.+)$/.exec(task[2]!);
      return task && r ? `${who(task[1]!)}已从${r[1]}改派给${r[2]}` : fallback;
    }
    case 'publish': {
      const v = task && /^第 (\d+) 次交付$/.exec(task[2]!);
      if (!task || !v) return fallback;
      return Number(v[1]) > 1 ? `${who(task[1]!)}的成果已更新` : `${who(task[1]!)}的成果已交付`;
    }
    case 'org_open': {
      const o = /^(.+) · 合同 .+$/.exec(target);
      return o ? `${o[1]}已开通` : fallback;
    }
    case 'contract_renew': {
      const o = /^(.+) · 合同 .+，到 (\d{4}\.\d{2}\.\d{2})$/.exec(target);
      return o ? `${o[1]}已续约，合同到 ${o[2]}` : fallback;
    }
    case 'credits_adjust': {
      const o = /^(.+) · (\S+) ([+-]?\d+) 次$/.exec(target);
      return o ? `${o[1]}${o[2]} ${o[3]} 次` : fallback;
    }
    case 'member_invite': {
      const o = /^(.+)（.+）· (.+?)( · 重新发送)?$/.exec(target);
      if (!o) return fallback;
      return `${o[3] ? '重新邀请' : '邀请'}${o[1]}加入，角色为${o[2]}`;
    }
    default:
      return fallback;
  }
}
