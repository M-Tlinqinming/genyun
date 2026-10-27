import { CHECKLIST_ITEMS, type ChecklistItemKey } from './items.ts';
import type { ChecklistState } from './status.ts';

// 稍后补 + 待专家电话联系累计超过这个数，提交页和任务页提示预约上门
export const ON_SITE_VISIT_THRESHOLD = 5;

export interface BlockingItem {
  key: ChecklistItemKey;
  label: string;
  reason: 'unanswered' | 'later';
}

export interface ChecklistCheck {
  // 开始编制必需的资料都已处理，可以提交
  canSubmit: boolean;
  blocking: BlockingItem[];
  // 交付前补齐、还没给的项：界面只说「还有 N 项可让预案更准确」，不算错误
  improvable: ChecklistItemKey[];
  // 已拍照、等注安师判断的项
  awaitingExpert: ChecklistItemKey[];
  laterOrCallCount: number;
  suggestOnSiteVisit: boolean;
}

export function checkChecklist(state: ChecklistState): ChecklistCheck {
  const blocking: BlockingItem[] = [];
  const improvable: ChecklistItemKey[] = [];
  const awaitingExpert: ChecklistItemKey[] = [];
  let laterOrCallCount = 0;

  for (const def of CHECKLIST_ITEMS) {
    if (def.requirement === 'system') continue;
    const s = state[def.key];

    if (s && (s.status === 'later' || s.callRequested)) laterOrCallCount++;
    if (s?.status === 'photo_for_expert' && (s.expertJudgement?.result ?? 'pending') === 'pending') {
      awaitingExpert.push(def.key);
    }

    // 必需项点了「请专家电话联系」也算已处理（Martin 10-28 确认），提交后由负责专家打电话问清
    const done = s !== undefined && (s.status !== 'later' || (def.requirement === 'start' && s.callRequested));
    if (done) continue;
    if (def.requirement === 'start') {
      blocking.push({ key: def.key, label: def.label, reason: s ? 'later' : 'unanswered' });
    } else {
      improvable.push(def.key);
    }
  }

  return {
    canSubmit: blocking.length === 0,
    blocking,
    improvable,
    awaitingExpert,
    laterOrCallCount,
    suggestOnSiteVisit: laterOrCallCount > ON_SITE_VISIT_THRESHOLD,
  };
}
