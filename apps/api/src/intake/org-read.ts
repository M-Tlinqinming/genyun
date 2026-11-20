// 应急组织：把小组表的行归到总指挥、副总指挥和五个预置组。必填检查和放进企业资料共用。
import { PRESET_GROUPS, type PresetGroupKey } from '@genyun/shared';
import { normalizeLabel } from './cell-text.ts';
import type { OrgCol } from './layout.ts';
import type { ReadRow, ReadTable, Val, WorkbookRead } from './read.ts';

export interface PersonVals {
  name: Val;
  phone: Val;
  position: Val;
}

export interface GroupRead {
  /** 组长那一行；表里没有这一组时是指向表第一行的空格子 */
  leader: PersonVals;
  members: PersonVals[];
  /** 这一组有没有填任何人 */
  filled: boolean;
}

export interface OrgRead {
  commander: PersonVals;
  deputy: PersonVals;
  groups: Record<PresetGroupKey, GroupRead>;
  /** 小组名称对不上五个预置组的行（客户改了组名） */
  unknownRows: ReadRow<OrgCol>[];
}

// 必填的三个组（模板里带 *），其余两组有内容才放
export const REQUIRED_GROUPS: PresetGroupKey[] = ['rescue', 'logistics', 'communication'];
export const OPTIONAL_GROUPS: PresetGroupKey[] = ['medical', 'evacuation'];
const GROUP_BY_NAME = new Map(
  (Object.entries(PRESET_GROUPS) as [PresetGroupKey, string][]).map(([k, name]) => [normalizeLabel(name), k]),
);
const COMMAND = normalizeLabel('总指挥部');

const person = (r: ReadRow<OrgCol>): PersonVals => ({ name: r.cells.name, phone: r.cells.phone, position: r.cells.position });
const personFilled = (p: PersonVals) => Boolean(p.name.text || p.phone.text || p.position.text);

/** 没有这一行时用的空格子，指向表的第一行数据行 */
function emptyPerson(table: ReadTable<OrgCol>, nameCol: string, phoneCol: string, offset = 0): PersonVals {
  const row = table.firstRow + offset;
  const v = (col: string): Val => ({ text: '', sheet: table.sheet, row, col, cell: col ? `${col}${row}` : '' });
  return { name: v(nameCol), phone: v(phoneCol), position: v('') };
}

interface TableGroup {
  leader: PersonVals | null;
  members: PersonVals[];
  filled: boolean;
}

interface TableGroups {
  commander: PersonVals | null;
  deputy: PersonVals | null;
  groups: Partial<Record<PresetGroupKey, TableGroup>>;
  unknownRows: ReadRow<OrgCol>[];
}

// 按 A 列分组：插进来的行 A 列空着的，算上一组。B 列含「组长」的是组长，其余是组员
function groupTable(table: ReadTable<OrgCol>): TableGroups {
  const out: TableGroups = { commander: null, deputy: null, groups: {}, unknownRows: [] };
  let current = '';
  for (const r of table.rows) {
    const a = normalizeLabel(r.cells.group.text);
    if (a) current = a;
    const role = normalizeLabel(r.cells.role.text);
    if (current === COMMAND) {
      if (role.includes('副总指挥')) out.deputy ??= person(r);
      else if (role.includes('总指挥')) out.commander ??= person(r);
      continue;
    }
    const kind = GROUP_BY_NAME.get(current);
    if (!kind) {
      if (r.filled) out.unknownRows.push(r);
      continue;
    }
    const g = (out.groups[kind] ??= { leader: null, members: [], filled: false });
    const p = person(r);
    if (role.includes('组长') && !g.leader) g.leader = p;
    else if (personFilled(p)) g.members.push(p);
    if (personFilled(p)) g.filled = true;
  }
  return out;
}

export function readOrg(read: WorkbookRead): OrgRead {
  const tables = read.orgTables;
  const first = tables[0]!;
  const nameCol = read.layout.orgTables[0]!.cols.name!;
  const phoneCol = read.layout.orgTables[0]!.cols.phone!;
  const grouped = tables.map(groupTable);

  let commander: PersonVals;
  let deputy: PersonVals;
  const f = read.fields;
  if (f.commanderName && f.commanderPhone) {
    // 旧版：总指挥、副总指挥是第 2–5 行的字段
    // 旧版没有「职务或岗位」
    const noPosition = (v: Val): Val => ({ ...v, text: '', col: '', cell: '' });
    commander = { name: f.commanderName, phone: f.commanderPhone, position: noPosition(f.commanderName) };
    deputy = { name: f.deputyName!, phone: f.deputyPhone!, position: noPosition(f.deputyName!) };
  } else {
    commander = grouped[0]?.commander ?? emptyPerson(first, nameCol, phoneCol, 0);
    deputy = grouped[0]?.deputy ?? emptyPerson(first, nameCol, phoneCol, 1);
  }

  const groups = {} as Record<PresetGroupKey, GroupRead>;
  for (const kind of Object.keys(PRESET_GROUPS) as PresetGroupKey[]) {
    // 两张表都有这一组：填了的以后一张为准；都没填，缺项指向第一张
    const found = grouped.map((g) => g.groups[kind]).filter((g): g is TableGroup => Boolean(g));
    const chosen = [...found].reverse().find((g) => g.filled) ?? found[0];
    groups[kind] = {
      leader: chosen?.leader ?? emptyPerson(first, nameCol, phoneCol, 0),
      members: chosen?.members ?? [],
      filled: chosen?.filled ?? false,
    };
  }
  return { commander, deputy, groups, unknownRows: grouped.flatMap((g) => g.unknownRows) };
}
