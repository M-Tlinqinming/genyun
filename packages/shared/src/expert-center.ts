// 专家任务中心（13 页 E1 / E1b）：列表排序、四格计数、按钮文字、时间列。前后端共用的纯函数，
// 当前时间由调用方传入；阶段文字一律取 taskView 的结果，这里不另写叫法。
import { z } from 'zod';
import { formatTaskDay, formatTaskDayTime, type TaskDraftState, type TaskView } from './task-status.ts';

// ---------- 暂停接单 ----------

export const expertAcceptingSchema = z.object({ acceptingOrders: z.boolean() });
export type ExpertAcceptingInput = z.infer<typeof expertAcceptingSchema>;

// ---------- 分组与排序 ----------

/** 列表分组，按这个顺序排：待核对资料、编制中（含重新打开）、等客户补资料、旧流程只读、已交付 */
export const EXPERT_CENTER_GROUPS = ['to_check', 'working', 'awaiting', 'legacy', 'delivered'] as const;
export type ExpertCenterGroup = (typeof EXPERT_CENTER_GROUPS)[number];

/** 排序、按钮、时间列要用到的任务事实（taskView 的结果加几个时间） */
export interface ExpertCenterFacts {
  view: TaskView;
  draft: TaskDraftState;
  assignedAt: Date | null;
  /** 最近更新：任务、核对、生成、改稿、资料上传里最晚的时间 */
  activityAt: Date;
  awaitingCustomerSince: Date | null;
  lastDelivery: { at: Date } | null;
}

export function expertCenterGroup(view: Pick<TaskView, 'key'>): ExpertCenterGroup {
  switch (view.key) {
    case 'to_check':
      return 'to_check';
    case 'working':
    case 'reopened':
      return 'working';
    case 'awaiting_customer':
      return 'awaiting';
    case 'delivered':
      return 'delivered';
    default:
      return 'legacy';
  }
}

const time = (d: Date | null | undefined) => (d ? d.getTime() : 0);

/** 组内排序用的时间和方向：待核对先分配的在前、等客户等得久的在前，其余最近的在前 */
function sortKey(f: ExpertCenterFacts): number {
  switch (expertCenterGroup(f.view)) {
    case 'to_check':
      return time(f.assignedAt ?? f.activityAt);
    case 'awaiting':
      return time(f.awaitingCustomerSince ?? f.activityAt);
    case 'delivered':
      return -time(f.lastDelivery?.at ?? f.activityAt);
    default:
      return -time(f.activityAt);
  }
}

/** 先按组，组内再按时间；返回新数组 */
export function sortExpertCenter<T extends ExpertCenterFacts>(rows: readonly T[]): T[] {
  const order = (r: T) => EXPERT_CENTER_GROUPS.indexOf(expertCenterGroup(r.view));
  return [...rows].sort((a, b) => order(a) - order(b) || sortKey(a) - sortKey(b));
}

// ---------- 按钮和时间列 ----------

/** 右边操作按钮的文字（一律进任务页） */
export function expertCenterButton(f: Pick<ExpertCenterFacts, 'view' | 'draft'>): string {
  switch (f.view.key) {
    case 'to_check':
      return '开始核对';
    case 'working':
      if (f.draft === 'ready') return '核对文稿';
      if (f.draft === 'generating') return '查看进度';
      if (f.draft === 'failed') return '重新生成';
      return '继续核对';
    case 'awaiting_customer':
      return '查看缺项';
    case 'reopened':
      return '继续编制';
    default:
      return '查看';
  }
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const beijingDay = (d: Date) => Math.floor((d.getTime() + BEIJING_OFFSET_MS) / 86_400_000);
function beijingMonth(d: Date): number {
  const b = new Date(d.getTime() + BEIJING_OFFSET_MS);
  return b.getUTCFullYear() * 12 + b.getUTCMonth();
}

/** action = 要动手（琥珀色），muted = 灰字 */
export interface ExpertCenterTime {
  text: string;
  tone: 'action' | 'muted';
}

/** 「等了多久 / 最近更新」列 */
export function expertCenterTime(f: ExpertCenterFacts, now: Date): ExpertCenterTime {
  switch (expertCenterGroup(f.view)) {
    case 'to_check':
      return { text: `${formatTaskDay(f.assignedAt ?? f.activityAt, now)}分配`, tone: 'action' };
    case 'awaiting': {
      const days = beijingDay(now) - beijingDay(f.awaitingCustomerSince ?? f.activityAt);
      return { text: days < 1 ? '不到 1 天' : `已等 ${days} 天`, tone: 'muted' };
    }
    case 'delivered':
      return { text: formatTaskDayTime(f.lastDelivery?.at ?? f.activityAt, now), tone: 'muted' };
    default:
      return { text: formatTaskDayTime(f.activityAt, now), tone: 'muted' };
  }
}

/** 在办 = 没交付的（含旧流程只读、重新打开待交付）；「我的任务」页签只列这些 */
export function isExpertCenterOpen(view: Pick<TaskView, 'key'>): boolean {
  return expertCenterGroup(view) !== 'delivered';
}

/** 已交付、最近一次交付在北京时间本月 */
export function isDeliveredThisMonth(f: Pick<ExpertCenterFacts, 'view' | 'lastDelivery'>, now: Date): boolean {
  return f.view.key === 'delivered' && !!f.lastDelivery && beijingMonth(f.lastDelivery.at) === beijingMonth(now);
}

// ---------- 四格统计 ----------

export const EXPERT_CENTER_STATS = ['to_check', 'working', 'awaiting', 'delivered_month'] as const;
export type ExpertCenterStat = (typeof EXPERT_CENTER_STATS)[number];
export type ExpertCenterStats = Record<ExpertCenterStat, number>;

/** 这一行算进哪一格；旧流程只读、上月以前交付的不算任何一格 */
export function expertCenterStatOf(
  row: { view: Pick<TaskView, 'key'>; deliveredThisMonth: boolean },
): ExpertCenterStat | null {
  const g = expertCenterGroup(row.view);
  if (g === 'to_check' || g === 'working' || g === 'awaiting') return g;
  if (g === 'delivered' && row.deliveredThisMonth) return 'delivered_month';
  return null;
}

export function expertCenterStats(rows: readonly { view: Pick<TaskView, 'key'>; deliveredThisMonth: boolean }[]): ExpertCenterStats {
  const stats: ExpertCenterStats = { to_check: 0, working: 0, awaiting: 0, delivered_month: 0 };
  for (const r of rows) {
    const s = expertCenterStatOf(r);
    if (s) stats[s] += 1;
  }
  return stats;
}

// ---------- 接口返回 ----------

export interface ExpertCenterRow {
  id: string;
  number: string;
  name: string;
  enterpriseName: string;
  orgName: string;
  view: TaskView;
  button: string;
  time: ExpertCenterTime;
  /** 在办（「我的任务」页签） */
  isOpen: boolean;
  deliveredThisMonth: boolean;
}

export interface ExpertCenterData {
  acceptingOrders: boolean;
  rows: ExpertCenterRow[];
  stats: ExpertCenterStats;
}
