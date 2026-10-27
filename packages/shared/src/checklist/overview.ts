// 资料检查页（Paper 12 页 P05、P06）：按 6 类汇总 19 项的处理情况。两种开始方式共用。
import { checkChecklist } from './check.ts';
import { CATEGORIES, CHECKLIST_ITEMS, type Category, type ChecklistItemKey, type Requirement } from './items.ts';
import type { ChecklistState, ItemState } from './status.ts';

// done = 已处理（已提供 / 没有 / 耕云生成）；missing = 开始编制必需、还要客户处理；
// later = 交付前补齐、现在可以不给；expert = 拍了照等专家判断；call = 等专家电话联系
export type ItemCheckState = 'done' | 'missing' | 'later' | 'expert' | 'call';

export const ITEM_CHECK_LABELS: Record<ItemCheckState, string> = {
  done: '已满足',
  missing: '待补充',
  later: '可稍后补',
  expert: '耕云判断中',
  call: '待专家联系',
};

export function itemCheckState(requirement: Requirement, s: ItemState | undefined): ItemCheckState {
  if (requirement === 'system') return 'done';
  if (s?.callRequested) return 'call';
  if (s?.status === 'photo_for_expert') return (s.expertJudgement?.result ?? 'pending') === 'pending' ? 'expert' : 'done';
  if (s && s.status !== 'later') return 'done';
  return requirement === 'start' ? 'missing' : 'later';
}

// 类别状态：有必需项没处理 → 待补充；否则有等专家的 → 核实中；否则已满足
export type CategoryStatus = 'missing' | 'verifying' | 'done';
export const CATEGORY_STATUS_LABELS: Record<CategoryStatus, string> = {
  missing: '待补充',
  verifying: '核实中',
  done: '已满足',
};

export interface CategoryCheckItem {
  key: ChecklistItemKey;
  label: string;
  requirement: Requirement;
  startPart?: string;
  allowNone: boolean;
  allowPhoto: boolean;
  state: ItemCheckState;
  item?: ItemState;
}

export interface CategoryCheck {
  category: Category;
  label: string;
  status: CategoryStatus;
  items: CategoryCheckItem[];
}

export interface ChecklistOverview {
  categories: CategoryCheck[];
  counts: Record<CategoryStatus, number>;
  // 客户要处理的必需项
  missing: CategoryCheckItem[];
  // 等耕云专家的项（判断照片、电话联系）
  withExpert: CategoryCheckItem[];
  canSubmit: boolean;
  suggestOnSiteVisit: boolean;
}

export function checkOverview(state: ChecklistState): ChecklistOverview {
  const categories = (Object.keys(CATEGORIES) as Category[]).map((category): CategoryCheck => {
    const items = CHECKLIST_ITEMS.filter((d) => d.category === category).map(
      (d): CategoryCheckItem => ({
        key: d.key,
        label: d.label,
        requirement: d.requirement,
        startPart: 'startPart' in d ? d.startPart : undefined,
        allowNone: d.allowNone,
        allowPhoto: d.allowPhoto,
        state: itemCheckState(d.requirement, state[d.key]),
        item: state[d.key],
      }),
    );
    const status: CategoryStatus = items.some((i) => i.state === 'missing')
      ? 'missing'
      : items.some((i) => i.state === 'expert' || i.state === 'call')
        ? 'verifying'
        : 'done';
    return { category, label: CATEGORIES[category], status, items };
  });

  const all = categories.flatMap((c) => c.items);
  const check = checkChecklist(state);
  const counts = { missing: 0, verifying: 0, done: 0 };
  for (const c of categories) counts[c.status]++;
  return {
    categories,
    counts,
    missing: all.filter((i) => i.state === 'missing'),
    withExpert: all.filter((i) => i.state === 'expert' || i.state === 'call'),
    canSubmit: check.canSubmit,
    suggestOnSiteVisit: check.suggestOnSiteVisit,
  };
}
