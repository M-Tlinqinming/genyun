// 生成门槛与缺项清单（Paper 13 页 E2-5b、E2-5c、S02、S04）。
// 门槛：第 1、2 步的必需项（专家勾了「先留空」的不算）+ 总平面布置图 + 紧急疏散示意图。别的空着照样能生成，文稿写「（待补充）」。
// 缺项清单 = 门槛缺的（必须补）+ 客户未填（最好补齐），key 和 customerGaps 同一套，复制时存进 WorkupData.missingList，
// 之后每次保存、上传都按现在的缺项重算：补上的记 filledAt，又空了的去掉 filledAt；都补上了自动取消「等客户补资料」。
import type { AgencyDistrict } from './plan/agencies.ts';
import { companyShortName } from './company-name.ts';
import { isDrawingContentType, type DrawingFileKey } from './workup-drawings.ts';
import { customerGaps } from './workup-gaps.ts';
import { effectiveSnapshot } from './workup-steps.ts';
import { workupFacts, workupProgress, type FactSection, type WorkupData, type WorkupSnapshot } from './workup.ts';

export type WorkupStepNo = 1 | 2 | 3 | 4;

export interface WorkupGap {
  // 和 customerGaps 同一套 key（field:identity.name、drawing:site_plan……）
  key: string;
  label: string;
  // 写给客户看的说法（缺项清单里用）
  customerLabel: string;
  step: WorkupStepNo;
  // 第 1、2 步的必需项对应的事实键（代填、定位用）；图纸没有
  factKey?: string;
}

// 第 1、2 步必需项的事实键 → 缺项 key（与 customerGaps 一致，同一项不重复列）
const FACT_GAP_KEYS: Record<string, string> = {
  companyName: 'field:identity.name',
  socialCreditCode: 'field:identity.socialCreditCode',
  legalRepresentative: 'field:identity.legalRepresentative',
  registeredAddress: 'field:identity.registeredAddress',
  mainProducts: 'field:basic.mainProducts',
  employeeCount: 'field:basic.employeeCount',
  technicalManagementCount: 'field:basic.technicalManagementCount',
  contactPerson: 'field:basic.contactPerson',
  contactPhone: 'field:basic.contactPhone',
  commander: 'field:organization.commander',
  dutyPhone: 'field:organization.dutyPhone',
};
const STEP_OF_SECTION: Partial<Record<FactSection, WorkupStepNo>> = { basic: 1, contact: 1, organization: 2 };

// 生成必备的两张图
export const REQUIRED_DRAWINGS: { key: DrawingFileKey; label: string; customerLabel: string }[] = [
  { key: 'site_plan', label: '总平面布置图', customerLabel: '厂区总平面布置图（有 CAD 或 PDF 最好，拍照也行）' },
  { key: 'evacuation_plan', label: '紧急疏散示意图', customerLabel: '紧急疏散示意图（墙上贴的那张，拍照即可）' },
];

export type WorkupDrawingRef = { key: DrawingFileKey | string; contentType?: string };

const validDrawing = (drawings: readonly WorkupDrawingRef[], key: string) =>
  drawings.some((d) => d.key === key && (d.contentType === undefined || isDrawingContentType(d.contentType)));

/**
 * 生成门槛还差的项：第 1、2 步必需项 + 两张必备图纸。
 * drawings：任务里现有的图纸（接口按 drawingCandidates 算出）
 */
export function workupGaps(
  snapshot: WorkupSnapshot,
  data: WorkupData,
  districts?: readonly AgencyDistrict[],
  drawings: readonly WorkupDrawingRef[] = [],
): { required: number; gaps: WorkupGap[] } {
  const progress = workupProgress(workupFacts(snapshot, data, districts));
  const customer = new Map(customerGaps(snapshot, data, drawings).map((g) => [g.key, g]));
  const gaps: WorkupGap[] = progress.missing.map((f) => {
    const key = FACT_GAP_KEYS[f.key] ?? `fact:${f.key}`;
    return { key, label: f.label, customerLabel: customer.get(key)?.customerLabel ?? f.label, step: STEP_OF_SECTION[f.section] ?? 1, factKey: f.key };
  });
  for (const d of REQUIRED_DRAWINGS) {
    if (!validDrawing(drawings, d.key)) gaps.push({ key: `drawing:${d.key}`, label: d.label, customerLabel: d.customerLabel, step: 4 });
  }
  return { required: progress.required + REQUIRED_DRAWINGS.length, gaps };
}

// ---------- 缺项清单 ----------

export interface MissingItem {
  key: string;
  label: string;
  // 写给客户看的说法
  customerLabel?: string;
  step: WorkupStepNo;
  // 必须补（没有不能生成）
  required: boolean;
  // 补上的时间；又空了就去掉
  filledAt?: string;
}

export interface MissingList {
  at: string;
  by: string;
  byName: string;
  items: MissingItem[];
}

export interface CurrentGap {
  key: string;
  label: string;
  customerLabel: string;
  step: WorkupStepNo;
  required: boolean;
}

/** 现在的缺项：门槛缺的在前（必须补），客户未填在后（最好补齐），同一 key 只列一次 */
export function currentGaps(
  snapshot: WorkupSnapshot,
  data: WorkupData,
  districts?: readonly AgencyDistrict[],
  drawings: readonly WorkupDrawingRef[] = [],
): CurrentGap[] {
  const required = workupGaps(snapshot, data, districts, drawings).gaps;
  const seen = new Set(required.map((g) => g.key));
  const rest = customerGaps(snapshot, data, drawings).filter((g) => !seen.has(g.key));
  return [
    ...required.map((g) => ({ key: g.key, label: g.label, customerLabel: g.customerLabel, step: g.step, required: true })),
    ...rest.map((g) => ({ key: g.key, label: g.label, customerLabel: g.customerLabel, step: g.step, required: false })),
  ];
}

/** 复制清单时存下的项 */
export function missingItemsOf(gaps: readonly CurrentGap[]): MissingItem[] {
  return gaps.map((g) => ({ key: g.key, label: g.label, customerLabel: g.customerLabel, step: g.step, required: g.required }));
}

/**
 * 按现在的缺项重算清单：key 不在了记 filledAt（补上的时间），又出现了去掉 filledAt。
 * 返回新清单、是否有变化、是否都补上了
 */
export function recomputeMissingList(
  list: MissingList,
  current: readonly { key: string }[],
  now: string,
): { list: MissingList; changed: boolean; allFilled: boolean } {
  const open = new Set(current.map((g) => g.key));
  let changed = false;
  const items = list.items.map((i): MissingItem => {
    if (open.has(i.key)) {
      if (!i.filledAt) return i;
      changed = true;
      const { filledAt: _, ...rest } = i;
      return rest;
    }
    if (i.filledAt) return i;
    changed = true;
    return { ...i, filledAt: now };
  });
  return { list: changed ? { ...list, items } : list, changed, allFilled: items.every((i) => i.filledAt) };
}

// 「11 月 18 日」
export const monthDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
};

export interface MissingTextInput {
  companyName: string;
  addresses?: readonly (string | null | undefined)[];
  expertName: string;
  at: string;
  contact?: { name?: string; phone?: string };
  items: readonly Pick<MissingItem, 'label' | 'customerLabel' | 'required'>[];
}

/** 发给客服的缺项清单文字（S04 的格式） */
export function missingListText(input: MissingTextInput): string {
  const short = companyShortName(input.companyName, input.addresses ?? []);
  const lines = [`【${short} · 编制应急预案还缺的资料】`, `${monthDay(input.at)} · 专家 ${input.expertName}`];
  const must = input.items.filter((i) => i.required);
  const better = input.items.filter((i) => !i.required);
  let n = 0;
  if (must.length) {
    lines.push('', '必须补（没有不能生成）：');
    for (const i of must) lines.push(`${++n}. ${i.customerLabel || i.label}`);
  }
  if (better.length) {
    lines.push('', '最好补齐（不补会在预案里标「待补充」）：');
    for (const i of better) lines.push(`${++n}. ${i.customerLabel || i.label}`);
  }
  const contact = [input.contact?.name?.trim(), input.contact?.phone?.trim()].filter(Boolean).join(' · ');
  lines.push('');
  if (contact) lines.push(`联系人：${contact}`);
  lines.push('请发到客服企业微信，专家收到后代为上传。');
  return lines.join('\n');
}

/** 联系人（缺项清单落款）：第 1 步的联系人和电话 */
export function missingContactOf(snapshot: WorkupSnapshot, data: WorkupData): { name?: string; phone?: string } {
  const b = effectiveSnapshot(snapshot, data).profile.basicStep?.basic;
  const o = (k: string) => {
    const v = data.overrides[k]?.value;
    return typeof v === 'string' ? v : undefined;
  };
  return { name: o('contactPerson') ?? b?.contactPerson, phone: o('contactPhone') ?? b?.contactPhone };
}
