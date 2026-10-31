// 风险评估报告第 3 章「事故风险评价」用的 LSR 法：风险值 R = 可能性 L × 严重性 S，各分 1–5 级。
// 与第 2 章的 LEC 法并用（专家写的 5 份风险评估报告都是这样：2.2 节 LEC，3.1 节 LSR，Martin 10-31 说明）。
// 判定准则照这 5 份报告的表 3.1-1 ~ 3.1-3；默认取值照这 5 份报告 228 行 LSR 里各类事故最常见的取值，待注安师复核。

export type LsrKey = 'likelihood' | 'severity';
export const LSR_KEYS: LsrKey[] = ['likelihood', 'severity'];
export const LSR_DIMENSIONS: Record<LsrKey, string> = {
  likelihood: '事件发生的可能性',
  severity: '事件后果严重性',
};
/** 页面上和 LEC 的 L 区分开的叫法 */
export const LSR_SHORT: Record<LsrKey, string> = { likelihood: '可能性', severity: '严重性' };

export const LSR_OPTIONS: Record<LsrKey, { value: number; label: string }[]> = {
  likelihood: [
    { value: 5, label: '经常发生，没有防范、监测措施' },
    { value: 4, label: '不易发现，措施未有效执行' },
    { value: 3, label: '没有保护措施或未严格按规程执行' },
    { value: 2, label: '能及时发现，有防范控制措施' },
    { value: 1, label: '措施充分有效，极不可能发生' },
  ],
  severity: [
    { value: 5, label: '发生死亡，损失 50 万元以上' },
    { value: 4, label: '丧失劳动能力，损失 25 万元以上' },
    { value: 3, label: '截肢、骨折、听力丧失、慢性病' },
    { value: 2, label: '轻微受伤、间歇不舒适' },
    { value: 1, label: '无伤亡、无损失' },
  ],
};

export const LSR_LEVELS = ['轻微', '可容忍', '中等', '重大风险', '巨大风险'] as const;
export type LsrLevel = (typeof LSR_LEVELS)[number];
export const LSR_THRESHOLDS = 'R < 4 轻微 · 4–8 可容忍 · 9–12 中等 · 15–16 重大风险 · 20–25 巨大风险';

export function lsrScore(h: { likelihood?: number; severity?: number }): number | undefined {
  if (h.likelihood === undefined || h.severity === undefined) return undefined;
  return h.likelihood * h.severity;
}

export function lsrLevel(r: number | undefined): LsrLevel | undefined {
  if (r === undefined) return undefined;
  if (r >= 20) return '巨大风险';
  if (r >= 15) return '重大风险';
  if (r >= 9) return '中等';
  if (r >= 4) return '可容忍';
  return '轻微';
}

// 按事故类型的默认取值，从上往下取第一个对得上的；括号里是 5 份报告里这一类的行数
const DEFAULT_LSR: [RegExp, number, number][] = [
  [/容器爆炸/, 2, 2], // 12
  [/粉尘爆炸/, 1, 4], // 1
  [/火灾/, 2, 2], // 36
  [/触电/, 2, 2], // 36
  [/机械/, 2, 4], // 19
  [/物体打击/, 2, 3], // 21
  [/灼烫/, 2, 2], // 12
  [/车辆/, 1, 4], // 7
  [/起重/, 2, 3], // 11
  [/高处坠落/, 1, 3], // 16
  [/中毒|窒息/, 1, 3], // 7
  [/泄漏/, 1, 3], // 3
  [/坍塌/, 2, 3], // 5
  [/淹溺/, 2, 4], // 2
  [/^其他/, 2, 3], // 40
];
/** 5 份报告里没出现过的事故类型 */
const FALLBACK_LSR = { likelihood: 1, severity: 3 };

export function defaultLsr(factor: string): { likelihood: number; severity: number } {
  const hit = DEFAULT_LSR.find(([re]) => re.test(factor.trim()));
  return hit ? { likelihood: hit[1], severity: hit[2] } : FALLBACK_LSR;
}
