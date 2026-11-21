// 危险化学品重大危险源辨识（GB 18218-2018）：按最大储存量 q 与临界量 Q 算 ∑q/Q。
// 资料核对第 5 步「是否构成重大危险源」和风险评估报告表 1.3-2 共用这一份算法。

// GB 18218-2018 表 1 的临界量（t），只收常见、核对过的几种；其余由专家核定
export const CRITICAL_TONS: [names: string[], tons: number][] = [
  [['乙醇', '酒精'], 500],
  [['甲醇'], 500],
  [['汽油'], 200],
  [['丙酮'], 500],
  [['甲苯'], 500],
  [['乙酸乙酯'], 500],
  [['天然气'], 50],
  [['液化石油气', '液化气'], 50],
  [['氢气'], 5],
  [['乙炔'], 1],
  [['氧气', '液氧'], 200],
  [['氨气', '液氨'], 10],
  [['氯气', '液氯'], 5],
  [['环氧乙烷'], 10],
];
export const criticalTonsOf = (name: string) => CRITICAL_TONS.find(([names]) => names.some((n) => name.includes(n)))?.[1];

export interface MajorHazardMaterial {
  name: string;
  /** 换算成吨的最大储存量；读不出来为 undefined */
  maxStorageTons?: number;
  /** 客户写的最大储存量原文（如「200 kg」「6 瓶」），显示用；换算不了时给专家看 */
  maxStorageText?: string;
}

export interface MajorHazardRow {
  name: string;
  /** 最大存放量，按客户写的显示 */
  storage?: string;
  q?: number;
  Q?: number;
  ratio?: number;
}

export interface MajorHazardResult {
  /** 按能算的物料得出的结论（∑q/Q ≥ 1 构成）；换算不了、临界量不详的没算进去 */
  conclusion: '构成' | '不构成';
  /** 每种物料都算进去了 */
  complete: boolean;
  sum: number;
  /** ∑q/Q 显示用的写法 */
  sumText: string;
  /** 参与计算的危险化学品 */
  rows: MajorHazardRow[];
  /** 储存量换算不了吨的（单位是桶、瓶等） */
  unconvertible: { name: string; qty: string; unit: string }[];
  /** 临界量表里没有的 */
  noCritical: string[];
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** materials 只传判定为危险化学品的物料 */
export function majorHazardOf(materials: readonly MajorHazardMaterial[]): MajorHazardResult {
  const rows: MajorHazardRow[] = materials.map((m) => {
    const Q = criticalTonsOf(m.name);
    const q = m.maxStorageTons;
    const storage = m.maxStorageText?.trim() || (q !== undefined ? `${q} t` : undefined);
    return { name: m.name, storage, q, Q, ratio: q !== undefined && Q !== undefined ? round4(q / Q) : undefined };
  });
  const unconvertible = materials
    .filter((m) => m.maxStorageTons === undefined && m.maxStorageText?.trim())
    .map((m) => {
      const t = m.maxStorageText!.trim();
      const hit = t.match(/^([\d.]+)\s*(.*)$/);
      return { name: m.name, qty: hit ? hit[1]! : t, unit: hit ? hit[2]!.trim() : '' };
    });
  const noCritical = rows.filter((r) => r.Q === undefined).map((r) => r.name);
  const sum = rows.reduce((s, r) => s + (r.q !== undefined && r.Q !== undefined ? r.q / r.Q : 0), 0);
  const sumText = sum > 0 && sum < 0.0001 ? sum.toExponential(1) : String(round4(sum));
  const complete = rows.every((r) => r.ratio !== undefined);
  return { conclusion: sum >= 1 ? '构成' : '不构成', complete, sum, sumText, rows, unconvertible, noCritical };
}
