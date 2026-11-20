// 读表时对几类值的判断：电话、数字、是否、耐火等级。必填检查和放进企业资料共用，保证两边说法一致。
import type { YesNoUnknown } from '@genyun/shared';
import { normalizeLabel, toHalfWidth } from './cell-text.ts';

/** 去掉空格、短横线、括号和 +86 前缀，全角数字转半角 */
export function phoneDigits(text: string): string {
  return toHalfWidth(text)
    .replace(/[\s\-—–()（）]/g, '')
    .replace(/^\+?86(?=1\d{10}$)/, '');
}

export const isMobile = (text: string) => /^1[3-9]\d{9}$/.test(phoneDigits(text));

/** 座机：带区号（0 开头）、不带区号的 7–8 位、400 电话；可带「转」分机 */
export function isLandline(text: string): boolean {
  const d = phoneDigits(text).replace(/(转|ext\.?|#)\d{1,6}$/i, '');
  return /^(0\d{9,11}|\d{7,8}|400\d{7})$/.test(d);
}

export type PhoneKind = 'mobile' | 'landline' | 'invalid';
export function phoneKind(text: string): PhoneKind {
  if (isMobile(text)) return 'mobile';
  if (isLandline(text)) return 'landline';
  return 'invalid';
}

// 常见单位，数字后面带了也照样当数字读（如「3 层」「1200㎡」「45 人」）
const UNITS = [
  '层', '㎡', 'm²', 'm2', '平方米', '平米', '平方', '人', '名', '具', '个', '台', '套', '条', '辆', '把', '只', '部',
  '组', '件', '张', '卷', '瓶', '桶', '盒', '包', '支', '吨', 't', 'T', '千克', 'kg', 'KG', '公斤', '升', 'L', 'l',
  '立方米', 'm³', 'm3', '方', '万元', '元', '盏', '块', '副', '双',
];

/** 读成数字；不是数字（如「约 500」「三层」）返回 null */
export function parseNumber(text: string): number | null {
  let t = toHalfWidth(text).replace(/[\s,，]/g, '');
  for (const u of [...UNITS].sort((a, b) => b.length - a.length)) {
    if (t.endsWith(u) && t.length > u.length) {
      t = t.slice(0, -u.length);
      break;
    }
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function parseInteger(text: string): number | null {
  const n = parseNumber(text);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** 「是 / 有」→ yes；「否 / 没有 / 无」→ no；「不清楚」→ unknown；看不懂返回 null */
export function parseYesNo(text: string): YesNoUnknown | null {
  const t = normalizeLabel(text);
  if (t === '是' || t === '有') return 'yes';
  if (t === '否' || t === '没有' || t === '无') return 'no';
  if (t === '不清楚') return 'unknown';
  return null;
}

const RATINGS: Record<string, '1' | '2' | '3' | '4'> = {
  一级: '1', 二级: '2', 三级: '3', 四级: '4', 一: '1', 二: '2', 三: '3', 四: '4',
  '1': '1', '2': '2', '3': '3', '4': '4', '1级': '1', '2级': '2', '3级': '3', '4级': '4',
};
/** 耐火等级「一级–四级」「1–4」转成 '1'–'4'，看不懂返回 null */
export function parseFireRating(text: string): '1' | '2' | '3' | '4' | null {
  return RATINGS[normalizeLabel(text)] ?? null;
}

/** 按「；」「;」拆开，去掉空的 */
export function splitList(text: string): string[] {
  return text
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 生产场所地址写的是「同注册地址」 */
export const isSameAsRegistered = (text: string) => ['同注册地址', '同上', '与注册地址相同'].includes(normalizeLabel(text));
