// 读资料表格：按版本的位置说明（layout.ts）把格子读成「值 + 在哪一格」，不做业务判断。
// 必填检查（check.ts）和放进企业资料（profile.ts）都从这里读出来的东西开始。
import ExcelJS, { type Worksheet } from 'exceljs';
import { cellText, normalizeLabel } from './cell-text.ts';
import {
  DATA_SHEETS,
  GUIDE_SHEET,
  layoutFor,
  type DataSheet,
  type FieldKey,
  type FieldSpec,
  type OrgCol,
  type TableSpec,
  type TemplateLayout,
} from './layout.ts';

/** 一格的值：文字（模板自带的字已当空），和它在哪张表哪一格 */
export interface Val {
  text: string;
  sheet: DataSheet;
  row: number;
  col: string;
  cell: string;
}

export interface ReadRow<K extends string> {
  row: number;
  cells: Record<K, Val>;
  /** 除下拉、预置名称以外有没有填东西 */
  filled: boolean;
}

export interface ReadTable<K extends string> {
  sheet: DataSheet;
  /** 表头下一行，整张表都没填时缺项落在这里 */
  firstRow: number;
  rows: ReadRow<K>[];
}

export interface WorkbookRead {
  layout: TemplateLayout;
  /** 记到读表结果里的版本号：新版是 B2 写的版本，旧版是 'old' */
  templateVersion: string;
  fields: Partial<Record<FieldKey, Val>>;
  buildings: ReadTable<'name' | 'floors' | 'area' | 'structure' | 'fireRating' | 'use'>;
  sites: ReadTable<'name' | 'has' | 'note'>;
  equipment: ReadTable<'name' | 'spec' | 'qty' | 'unit' | 'location' | 'condition' | 'note'>;
  special: ReadTable<'category' | 'has' | 'ident' | 'medium' | 'qty' | 'unit' | 'params' | 'location' | 'note'>;
  materials: ReadTable<'kind' | 'name' | 'cas' | 'annual' | 'max' | 'unit' | 'location' | 'cylinder'>;
  orgTables: ReadTable<OrgCol>[];
  contacts: ReadTable<'type' | 'name' | 'phone' | 'note'>;
  supplies: ReadTable<'name' | 'qty' | 'location' | 'keeper' | 'keeperPhone' | 'status'>;
  firstAid: ReadTable<'name' | 'qty' | 'unit'> | null;
}

export type ReadOutcome = { kind: 'not_template' } | { kind: 'read'; read: WorkbookRead };

/** 打不开的文件（不是 xlsx、exceljs 读失败） */
export class UnreadableWorkbookError extends Error {}

// 分节标题：「一、…」「二、…」
const SECTION = /^[一二三四五六七八九十]+、/;

function colNumber(col: string): number {
  let n = 0;
  for (const c of col) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function valAt(ws: Worksheet, sheet: DataSheet, row: number, col: string): Val {
  const text = col ? cellText(ws.getCell(row, colNumber(col))) : '';
  return { text, sheet, row, col, cell: `${col}${row}` };
}

const aText = (ws: Worksheet, row: number) => cellText(ws.getCell(row, 1));

function readField(ws: Worksheet, spec: FieldSpec): Val {
  const target = normalizeLabel(spec.label);
  let row = spec.row;
  for (let r = 1; r <= ws.rowCount; r++) {
    if (normalizeLabel(aText(ws, r)) === target) {
      row = r;
      break;
    }
  }
  const v = valAt(ws, spec.sheet, row, 'B');
  if (spec.preset?.(v.text)) v.text = '';
  return v;
}

function readTable<K extends string>(ws: Worksheet, spec: TableSpec<K>): ReadTable<K> {
  const a = normalizeLabel(spec.headerA);
  const b = spec.headerB ? normalizeLabel(spec.headerB) : null;
  let header = spec.headerRow;
  let seen = 0;
  for (let r = 1; r <= ws.rowCount; r++) {
    if (normalizeLabel(aText(ws, r)) !== a) continue;
    if (b !== null && normalizeLabel(cellText(ws.getCell(r, 2))) !== b) continue;
    seen += 1;
    if (seen === (spec.occurrence ?? 1)) {
      header = r;
      break;
    }
  }
  const keys = Object.keys(spec.cols) as K[];
  const rows: ReadRow<K>[] = [];
  for (let r = header + 1; r <= ws.rowCount; r++) {
    if (SECTION.test(aText(ws, r))) break;
    const cells = {} as Record<K, Val>;
    let any = false;
    let filled = false;
    for (const k of keys) {
      const v = valAt(ws, spec.sheet, r, spec.cols[k]!);
      if (spec.placeholder?.[k]?.includes(v.text)) v.text = '';
      cells[k] = v;
      if (!v.text) continue;
      any = true;
      if (spec.ignore?.includes(k)) continue;
      if (spec.presetText?.[k]?.some((p) => normalizeLabel(p) === normalizeLabel(v.text))) continue;
      filled = true;
    }
    // 这一版没有的列也给个空值，后面读的时候不用判断
    if (any) rows.push({ row: r, cells: withMissingCols(cells, spec.sheet, r), filled });
  }
  return { sheet: spec.sheet, firstRow: header + 1, rows };
}

const ALL_COLS = [
  'name', 'floors', 'area', 'structure', 'fireRating', 'use', 'has', 'note', 'spec', 'qty', 'unit', 'location',
  'condition', 'category', 'ident', 'medium', 'params', 'kind', 'cas', 'annual', 'max', 'cylinder', 'group', 'role',
  'position', 'phone', 'type', 'keeper', 'keeperPhone', 'status',
];

function withMissingCols<K extends string>(cells: Record<K, Val>, sheet: DataSheet, row: number): Record<K, Val> {
  const out = { ...cells } as Record<string, Val>;
  for (const k of ALL_COLS) out[k] ??= { text: '', sheet, row, col: '', cell: '' };
  return out as Record<K, Val>;
}

export async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new UnreadableWorkbookError('xlsx 读取失败');
  }
  return wb;
}

/** 认版本、认是不是耕云模板，再按位置说明读出来 */
export function readWorkbook(wb: ExcelJS.Workbook): ReadOutcome {
  const sheets = {} as Record<DataSheet, Worksheet>;
  for (const name of DATA_SHEETS) {
    const ws = wb.getWorksheet(name);
    if (!ws) return { kind: 'not_template' };
    sheets[name] = ws;
  }
  const guide = wb.getWorksheet(GUIDE_SHEET);
  const versionCell = guide ? cellText(guide.getCell('B2')) : '';
  const layout = layoutFor(versionCell);
  const templateVersion = layout.old ? 'old' : (/^模板版本\s*(\S+)/.exec(versionCell)?.[1] ?? layout.version);

  const fields: Partial<Record<FieldKey, Val>> = {};
  for (const [key, spec] of Object.entries(layout.fields) as [FieldKey, FieldSpec][]) {
    fields[key] = readField(sheets[spec.sheet], spec);
  }
  const table = <K extends string>(spec: TableSpec<K>) => readTable(sheets[spec.sheet], spec);
  return {
    kind: 'read',
    read: {
      layout,
      templateVersion,
      fields,
      buildings: table(layout.buildings),
      sites: table(layout.sites),
      equipment: table(layout.equipment),
      special: table(layout.special),
      materials: table(layout.materials),
      orgTables: layout.orgTables.map(table),
      contacts: table(layout.contacts),
      supplies: table(layout.supplies),
      firstAid: layout.firstAid ? table(layout.firstAid) : null,
    },
  };
}
