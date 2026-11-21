import type { IntakeCellRef } from '@genyun/shared';

// 对照客户原表的格子计算（纯函数，组件在 OriginalCompare.tsx）

export type CompareMode = 'items' | 'sheet';

// 字段在表头上的叫法
const HEADERS: Record<string, string> = {
  name: '名称',
  spec: '规格型号',
  quantity: '数量',
  location: '位置',
  condition: '使用状况',
  note: '备注',
  casNumber: 'CAS 号',
  annualUsage: '年用量',
  maxStorage: '最大存放量',
  storageLocation: '存放位置',
  cylinderSpec: '气瓶规格',
  description: '生产工艺',
  count: '数量',
  contact: '联系人',
  contactPhone: '联系电话',
  position: '公司职位',
  phone: '手机',
  keeper: '保管人',
  keeperPhone: '保管人电话',
  status: '状态',
  unit: '单位',
  answer: '有没有',
  volumeM3: '容积',
  floors: '层数',
  areaM2: '建筑面积',
  fireRating: '耐火等级',
  structure: '结构类型',
  use: '用途',
  medium: '介质',
  maxWorkingPressureMPa: '最高工作压力',
  ratedParams: '额定参数',
  nominalDiameter: '公称直径',
  substance: '储存物',
  capacity: '储存量',
  dutyPhone: '值班电话',
};

export interface CompareCell {
  col: string;
  header: string;
  original: string;
  // 现在的值；这一行被删掉了为 undefined
  current: string | undefined;
}

export interface CompareRow {
  row: number;
  cells: CompareCell[];
  removed: boolean;
}

export interface CompareSheet {
  sheet: string;
  rows: CompareRow[];
  changed: number;
  empty: number;
}

type Obj = Record<string, unknown>;

const show = (v: unknown): string => {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '是' : '否';
  return '';
};
const answerText = (v: unknown) => (v === 'yes' ? '有' : v === 'no' ? '没有' : v === 'unknown' ? '不清楚' : show(v));

function at(root: unknown, keys: string[]): unknown {
  let node = root;
  for (const k of keys) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Obj)[k];
  }
  return node;
}

// 路径里的数组下标换成行 id：客户那份按下标找到这一行，现在那份按同一个 id 找（专家删了、挪了都对得上）
function currentAt(original: unknown, current: unknown, keys: string[]): { value: unknown; removed: boolean } {
  let o = original;
  let c = current;
  for (const k of keys) {
    if (Array.isArray(o) && /^\d+$/.test(k)) {
      const row = o[Number(k)] as Obj | undefined;
      o = row;
      const id = row && typeof row === 'object' ? row.id : undefined;
      c = Array.isArray(c) && id !== undefined ? c.find((x) => (x as Obj | undefined)?.id === id) : undefined;
      if (c === undefined) return { value: undefined, removed: true };
      continue;
    }
    o = o && typeof o === 'object' ? (o as Obj)[k] : undefined;
    c = c && typeof c === 'object' ? (c as Obj)[k] : undefined;
  }
  return { value: c, removed: false };
}

const colOf = (cell: string) => cell.replace(/\d+/g, '');
export const colOrder = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

/**
 * 按来源算出这一步用到的格子。roots：路径第一段（production / resources / organization）→ 客户那份和现在那份。
 * 同一张表里别的行有、这一行客户没填的列补成空格子（显示「（空）」）
 */
export function compareSheets(sources: Record<string, IntakeCellRef>, roots: Record<string, { original: unknown; current: unknown }>): CompareSheet[] {
  const sheets = new Map<string, Map<number, Map<string, CompareCell & { table: string; field: string }>>>();
  // 表（去掉下标和字段的路径）→ 字段 → 列
  const tableCols = new Map<string, Map<string, { col: string; sheet: string }>>();
  const tableRows = new Map<string, Map<number, { sheet: string; removed: boolean; listKeys: string[] }>>();

  for (const [path, ref] of Object.entries(sources)) {
    const [root, ...keys] = path.split('.');
    const r = roots[root!];
    if (!r || !ref.cell) continue;
    const field = keys[keys.length - 1]!;
    const original = at(r.original, keys);
    const { value, removed } = currentAt(r.original, r.current, keys);
    const fmt = field === 'answer' ? answerText : show;
    const cell = {
      col: colOf(ref.cell),
      header: HEADERS[field] ?? field,
      original: fmt(original),
      current: removed ? undefined : fmt(value),
      table: [root, ...keys.slice(0, -1).map((k) => (/^\d+$/.test(k) ? '#' : k))].join('.'),
      field,
    };
    const rows = sheets.get(ref.sheet) ?? new Map();
    sheets.set(ref.sheet, rows);
    const cells = rows.get(ref.row) ?? new Map();
    rows.set(ref.row, cells);
    cells.set(cell.col, cell);
    const cols = tableCols.get(cell.table) ?? new Map();
    tableCols.set(cell.table, cols);
    cols.set(field, { col: cell.col, sheet: ref.sheet });
    if (cell.table.includes('#')) {
      const tr = tableRows.get(cell.table) ?? new Map();
      tableRows.set(cell.table, tr);
      tr.set(ref.row, { sheet: ref.sheet, removed, listKeys: [root!, ...keys.slice(0, -1)] });
    }
  }

  // 表格类（设备、物料……）客户没填的格子
  for (const [table, rows] of tableRows) {
    const cols = tableCols.get(table)!;
    for (const [rowNo, info] of rows) {
      const cells = sheets.get(info.sheet)!.get(rowNo)!;
      for (const [field, { col, sheet }] of cols) {
        if (sheet !== info.sheet || cells.has(col)) continue;
        const [root, ...keys] = [...info.listKeys, field];
        const r = roots[root!]!;
        const { value, removed } = currentAt(r.original, r.current, keys);
        cells.set(col, { col, header: HEADERS[field] ?? field, original: '', current: removed ? undefined : show(value), table, field });
      }
    }
  }

  return [...sheets].map(([sheet, rows]) => {
    const list: CompareRow[] = [...rows]
      .sort((a, b) => a[0] - b[0])
      .map(([row, cells]) => {
        const sorted = [...cells.values()].sort((a, b) => colOrder(a.col, b.col)).map(({ col, header, original, current }) => ({ col, header, original, current }));
        return { row, cells: sorted, removed: sorted.length > 0 && sorted.every((c) => c.current === undefined) };
      });
    const all = list.flatMap((r) => (r.removed ? [] : r.cells));
    return {
      sheet,
      rows: list,
      changed: all.filter((c) => c.current !== c.original).length + list.filter((r) => r.removed).length,
      empty: all.filter((c) => !c.original).length,
    };
  });
}
