// 预案编号建议（资料核对第 5 步）：字号前两个汉字的拼音首字母大写 + 编制年份，如飞宇 → FY2026。
// 去括号、去地名、去组织形式在共享包 company-name.ts；剩不到两个汉字不给建议
import { chinaYear, planCodeSeed } from '@genyun/shared';
import { pinyin } from 'pinyin-pro';

export function suggestPlanCode(name: string | null | undefined, addresses: readonly (string | null | undefined)[], now: Date = new Date()): string {
  const seed = planCodeSeed(name, addresses);
  if (!seed) return '';
  const letters = pinyin(seed, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toUpperCase();
  if (!/^[A-Z]{2}$/.test(letters)) return '';
  return `${letters}${chinaYear(now)}`;
}
