import { type ChecklistItemKey, CHECKLIST_ITEM_KEYS, CONTACT_WORKING_DAYS, addWorkingDays, getItemDef, reachedCustomer } from '@genyun/shared';

// 资料项按资料清单的固定顺序排（数据库查询不保证顺序；专家横幅、待核实列表、运营超时兜底都按这个顺序显示）
const ITEM_ORDER = new Map<string, number>(CHECKLIST_ITEM_KEYS.map((k, i) => [k, i]));
export function byChecklistOrder<T extends { itemKey: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (ITEM_ORDER.get(a.itemKey) ?? Infinity) - (ITEM_ORDER.get(b.itemKey) ?? Infinity));
}

// 客户请专家电话联系：从提交（或提交后才点的那一刻）起算 2 个工作日；改派后从新注安师接手时重新算
export interface ContactRequest {
  requestedAt: Date;
  requestedBy: string;
  labels: string[];
  deadline: Date;
}

export interface CallItem {
  itemKey: string;
  updatedAt: Date;
  updatedByName: string;
}

export interface ContactRow {
  method: 'request' | 'phone';
  result: 'clarified' | 'later' | 'unreachable' | null;
  createdAt: Date;
}

// 还没联系上的「客户请电话联系」；已联系上（已问清 / 客户稍后补）、没提交、已结束或没有请求的返回 null。
// 专家任务中心的倒计时横幅和运营的超时兜底用同一套规则
export function pendingContactRequest(
  t: { submittedAt: Date | null; closedAt: Date | null; assignedAt: Date | null },
  calls: readonly CallItem[],
  contacts: readonly ContactRow[],
): ContactRequest | null {
  if (t.submittedAt === null || t.closedAt !== null || calls.length === 0) return null;
  const first = calls.reduce((a, b) => (a.updatedAt <= b.updatedAt ? a : b));
  // 原注安师的联系记录不算：期限和「联系上」都从现在这位接手起算
  const requestedAt = new Date(
    Math.max(first.updatedAt.getTime(), t.submittedAt.getTime(), t.assignedAt?.getTime() ?? 0),
  );
  const records = contacts.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
  // 未接通不算联系上
  if (reachedCustomer(records, requestedAt)) return null;
  return {
    requestedAt,
    requestedBy: first.updatedByName,
    labels: byChecklistOrder(calls).map((p) => getItemDef(p.itemKey as ChecklistItemKey).label),
    deadline: addWorkingDays(requestedAt, CONTACT_WORKING_DAYS),
  };
}
