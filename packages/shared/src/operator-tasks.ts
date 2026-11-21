// 运营任务中心（Paper 16 页 I04、I04b、分配专家弹窗）的分组、排序和几句文字。前后端共用。
// 任务状态本身用 task-status.ts 的 taskView（运营那一侧），这里只把它分成五组、排好顺序。
import { breakdownLine } from './operator.ts';
import { INDUSTRY_NAMES } from './profile/industries.ts';
import { chinaToday } from './task.ts';
import { TASK_VIEW_STAGES } from './task-status.ts';

/** 五组，列表里按这个顺序排：要运营动手的两组在前，已交付在最后 */
export const OPERATOR_TASK_GROUPS = ['to_assign', 'awaiting', 'working', 'preparing', 'delivered'] as const;
export type OperatorTaskGroup = (typeof OPERATOR_TASK_GROUPS)[number];
export const OPERATOR_TASK_GROUP_LABELS: Record<OperatorTaskGroup, string> = {
  to_assign: '待分配专家',
  awaiting: '等客户补资料',
  working: '专家处理中',
  preparing: '资料准备',
  delivered: '已交付',
};

const GROUP_OF_KEY: Record<string, OperatorTaskGroup> = {
  to_assign: 'to_assign',
  awaiting_customer: 'awaiting',
  reopened: 'working',
  to_check: 'working',
  checking: 'working',
  draft_ready: 'working',
  preparing: 'preparing',
  delivered: 'delivered',
  delivered_locked: 'delivered',
};

// 运营那一侧 taskView 的阶段序号 → 分组（旧流程只读的任务 key 统一是 legacy_readonly，靠阶段分组）
const GROUP_OF_STAGE: Record<string, OperatorTaskGroup> = {
  资料准备: 'preparing',
  待分配专家: 'to_assign',
  等客户补资料: 'awaiting',
  专家处理中: 'working',
  已交付: 'delivered',
};

/** taskView（运营那一侧）的 key → 分组；认不出的 key 按阶段序号分，再不行算「专家处理中」 */
export function operatorTaskGroup(key: string, stage?: number): OperatorTaskGroup {
  const byKey = GROUP_OF_KEY[key];
  if (byKey) return byKey;
  const label = stage === undefined ? undefined : TASK_VIEW_STAGES.operator[stage];
  return (label && GROUP_OF_STAGE[label]) || 'working';
}

/**
 * 专家「在办 N 个」算哪些任务：分给他、没删除，分组不是「已交付」也不是「资料准备」。
 * 客户撤回、回到资料准备的不算；重新打开、等再次交付的（专家处理中）算。
 * 分配弹窗和内部账号列表都用这一条
 */
export function countsAsExpertOpenTask(group: OperatorTaskGroup): boolean {
  return group !== 'delivered' && group !== 'preparing';
}

type When = string | Date | null | undefined;
const time = (d: When): number | null => (d ? new Date(d).getTime() : null);

export interface OperatorTaskSortable {
  group: OperatorTaskGroup;
  /** 待分配 = 提交时间，等客户补资料 = 列出缺项的时间，其余为空 */
  waitingSince: When;
  /** 最近更新 */
  activityAt: When;
  /** 最近一次交付 */
  deliveredAt: When;
}

/**
 * 列表默认顺序：先按五组排，组内——
 * 待分配、等客户补资料：等得最久的在前；专家处理中、资料准备：最近更新在前；已交付：最近一次交付在前
 */
export function sortOperatorTasks<T extends OperatorTaskSortable>(rows: readonly T[]): T[] {
  const asc = (a: When, b: When) => (time(a) ?? Infinity) - (time(b) ?? Infinity);
  const desc = (a: When, b: When) => (time(b) ?? -Infinity) - (time(a) ?? -Infinity);
  return [...rows].sort((a, b) => {
    const g = OPERATOR_TASK_GROUPS.indexOf(a.group) - OPERATOR_TASK_GROUPS.indexOf(b.group);
    if (g !== 0) return g;
    switch (a.group) {
      case 'to_assign':
      case 'awaiting':
        return asc(a.waitingSince, b.waitingSince);
      case 'delivered':
        return desc(a.deliveredAt, b.deliveredAt);
      default:
        return desc(a.activityAt, b.activityAt);
    }
  });
}

/** 「已等 2 天」：按北京时间的日历天算；当天写「已等不到 1 天」 */
export function waitingLine(since: string | Date, now: Date = new Date()): string {
  const days = Math.round((Date.parse(chinaToday(now)) - Date.parse(chinaToday(new Date(since)))) / 86_400_000);
  return days <= 0 ? '已等不到 1 天' : `已等 ${days} 天`;
}

/** 「专家处理中」里各状态的个数（核对中包括初稿生成中、生成失败；旧流程只读的也算核对中） */
export interface OperatorWorkingCounts {
  toCheck: number;
  checking: number;
  draftReady: number;
  reopened: number;
}

export interface OperatorTaskCounts {
  groups: Record<OperatorTaskGroup, number>;
  working: OperatorWorkingCounts;
  /** 在办 = 不是已交付的 */
  open: number;
}

/** 统计格和概览共用：按分组数，专家处理中再按状态细分 */
export function operatorTaskCounts(rows: readonly { group: OperatorTaskGroup; key: string }[]): OperatorTaskCounts {
  const groups = Object.fromEntries(OPERATOR_TASK_GROUPS.map((g) => [g, 0])) as Record<OperatorTaskGroup, number>;
  const working: OperatorWorkingCounts = { toCheck: 0, checking: 0, draftReady: 0, reopened: 0 };
  for (const r of rows) {
    groups[r.group] += 1;
    if (r.group !== 'working') continue;
    if (r.key === 'to_check') working.toCheck += 1;
    else if (r.key === 'draft_ready') working.draftReady += 1;
    else if (r.key === 'reopened') working.reopened += 1;
    else working.checking += 1;
  }
  return { groups, working, open: rows.length - groups.delivered };
}

/** 统计格「专家处理中」第二行：「待核对资料 1 · 核对中 1 · 初稿已生成 1」，为 0 的不写 */
export function operatorWorkingLine(w: OperatorWorkingCounts): string {
  return breakdownLine(
    [
      ['待核对资料', w.toCheck],
      ['核对中', w.checking],
      ['初稿已生成', w.draftReady],
      ['重新打开', w.reopened],
    ],
    '没有专家在处理的任务',
  );
}

/** 分配弹窗里每位专家的第二行：「在办 3 个 · 擅长化工、危化品储存」，超过两个行业接「等 N 个」 */
export function expertPickLine(openTasks: number, industryCodes: readonly string[] | null | undefined): string {
  const names = (industryCodes ?? []).map((c) => INDUSTRY_NAMES[c]).filter((n): n is string => !!n);
  const head = `在办 ${openTasks} 个`;
  if (names.length === 0) return head;
  const shown = names.slice(0, 2).join('、');
  return names.length > 2 ? `${head} · 擅长 ${shown} 等 ${names.length} 个` : `${head} · 擅长 ${shown}`;
}
