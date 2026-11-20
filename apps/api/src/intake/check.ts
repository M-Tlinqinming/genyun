// 必填检查：资料表格里缺了哪几项（missing）、选填没填的有哪些（optional），再加上两张必填图。
// 一个必填格算一项；整块一行都没填只出一项；同一个人姓名、手机都空只出一项。
import type { IntakeMissingItem, IntakeOptionalItem, IntakeRequiredCheck } from '@genyun/shared';
import { PRESET_GROUPS } from '@genyun/shared';
import { normalizeLabel } from './cell-text.ts';
import { DATA_SHEETS, type FieldKey } from './layout.ts';
import { readOrg, OPTIONAL_GROUPS, REQUIRED_GROUPS, type PersonVals } from './org-read.ts';
import type { ReadRow, Val, WorkbookRead } from './read.ts';
import { isSameAsRegistered, parseInteger, parseNumber, parseYesNo, phoneKind } from './values.ts';

// 企业名称最长 100 个字（同企业资料的校验）；超长的按没填处理，进必填缺项
export const ENTERPRISE_NAME_MAX = 100;
export const isNameTooLong = (name: string) => name.trim().length > ENTERPRISE_NAME_MAX;

export interface SheetCheck {
  missing: IntakeMissingItem[];
  optional: IntakeOptionalItem[];
}

// 空着没填的提示（k5 说明给的原话，最后几条是我拟的）
export const NOTES = {
  name: '没填。按营业执照上的全称填。',
  nameTooLong: '超过 100 个字。按营业执照上的全称填。',
  siteAddress: '没填。写实际生产的地址，到门牌号。',
  inPark: '没填。选「是」或「否」。',
  leases: '没填。选「是」或「否」：厂区里有别的企业租您的厂房生产经营，选「是」。',
  mainProducts: '没填。如：五金冲压件、塑胶外壳。',
  employees: '没填。只填数字，含管理和后勤人员。',
  responsible: '没填。填分管安全生产的负责人姓名。',
  contact: '没填。填对接这次编制的人。',
  buildingArea: '没填。大概数就行，可以看租赁合同。',
  dutyPhone: '没填。座机或手机都可以。',
  process: '没填。用一句话写，如：购入钢材→冲压成型→焊接→喷涂→装配入库。',
  // 以下是我拟的
  contactPhone: '没填。填联系人的手机号。',
  extinguisher: '没填。写全厂灭火器的总数，只填数字。',
  buildingName: '没填。如：1 号厂房、宿舍楼。',
  buildingFloors: '没填。只填数字，如：3。',
  equipmentName: '没填。写设备名称，如：冲床。',
  equipmentQty: '没填。只填数字，单位在旁边一格选。',
  materialName: '没填。如：天那水、液压油。',
  materialMax: '没填。只填数字，单位在旁边一格选。',
  materialUnit: '没填。从下拉里选一个单位。',
  materialLocation: '没填。如：危化品仓库。',
  personBoth: '没填。姓名和手机都要填。',
  bigOrgLeader: '员工 100 人以上，5 个组都要有组长。不清楚的可以留空，专家核对时补。',
  personName: '没填。手机填了，姓名也要填。',
  personPhone: '没填。要 24 小时能打通的手机。',
  // 格式不对
  landlineForPerson: '填的是座机。这里要 24 小时能打通的手机。',
  landlineForContact: '填的是座机。这里要手机号。',
  notMobile: '不是 11 位手机号。请检查有没有多填或少填。',
  notPhone: '不像电话号码。座机或手机都可以，只填号码。',
  notYesNo: '只能选「是」或「否」。',
  notInteger: (eg: string) => `要填整数，如：${eg}。`,
  notNumber: (eg: string) => `要填数字，如：${eg}。`,
  blockBuildings: '一栋都没填。至少填 1 栋：名称、层数、建筑面积。',
  blockEquipment: '一台都没填。至少填 1 台：设备名称、数量。',
  blockMaterials: '一种都没填。至少填 1 种：名称、最大存放量、单位、存放位置。',
  // 旧版模板
  oldLeasesUnknown:
    '旧版这一格问的是「是否出租厂房」，您填的是「不清楚」。请改成「有」或「没有」：厂区里有别的企业租您的厂房生产经营，填「有」。',
  oldLeasesEmpty: '没填。选「有」或「没有」：厂区里有别的企业租您的厂房生产经营，填「有」。',
  oldInPark: '没填。选「有」「没有」或「不清楚」。',
  oldLegalRep: '没填。旧版模板没有「安全生产主管负责人」这一格，我们按法定代表人填，请把法定代表人填上。',
  oldEquipmentQty: '没填。只填数字，如：3。',
  oldMaterialMax: '没填。只填数字，单位是吨，如：0.5。',
  siteSameButEmpty: (row: number) => `填的是「同注册地址」，但注册地址（第 ${row} 行）没填。请把实际生产的地址写完整，到门牌号。`,
  // 两张图
  sitePlan: '还没传。',
  evacuationPlan: '还没传。确实没有这张图的，点「这张图我们没有」。',
} as const;

const SHEET_ORDER = new Map<string, number>(DATA_SHEETS.map((s, i) => [s, i]));
const colNumber = (col: string | null | undefined) =>
  col ? [...col.replace(/\d+$/, '')].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) : 0;

/** 按工作表、行、列排；两张图（没有工作表）排在最后 */
export function sortItems<T extends { sheet: string | null; row?: number | null; cell?: string | null }>(items: T[]): T[] {
  const key = (i: T) => [
    i.sheet === null ? Infinity : (SHEET_ORDER.get(i.sheet) ?? 99),
    i.row ?? Infinity,
    colNumber(i.cell),
  ];
  return items
    .map((item, idx) => ({ item, idx, k: key(item) }))
    .sort((a, b) => a.k[0]! - b.k[0]! || a.k[1]! - b.k[1]! || a.k[2]! - b.k[2]! || a.idx - b.idx)
    .map((x) => x.item);
}

export function checkSheet(read: WorkbookRead): SheetCheck {
  const old = read.layout.old;
  const f = read.fields;
  const missing: IntakeMissingItem[] = [];
  const optional: IntakeOptionalItem[] = [];
  const miss = (field: string, label: string, v: Val, note: string, mismatch = false) =>
    missing.push({ field, label, sheet: v.sheet, row: v.row, cell: v.cell || null, note, ...(mismatch ? { mismatch } : {}) });
  const opt = (field: string, label: string, v: Val | undefined) => {
    if (v && !v.text) optional.push({ field, label, sheet: v.sheet, row: v.row, cell: v.cell });
  };
  const field = (k: FieldKey) => f[k]!;

  // —— 企业信息 ——
  const text = (k: FieldKey, label: string, note: string) => {
    if (!field(k).text) miss(`enterprise.${k}`, label, field(k), note);
  };
  text('name', '企业名称', NOTES.name);
  if (isNameTooLong(field('name').text)) miss('enterprise.name', '企业名称', field('name'), NOTES.nameTooLong);

  const site = field('siteAddress');
  if (!site.text) miss('enterprise.siteAddress', '生产场所地址', site, NOTES.siteAddress);
  else if (isSameAsRegistered(site.text) && !field('regAddress').text) {
    miss('enterprise.siteAddress', '生产场所地址', site, NOTES.siteSameButEmpty(field('regAddress').row));
  }

  const inPark = field('inPark');
  const park = parseYesNo(inPark.text);
  if (old) {
    if (!inPark.text) miss('enterprise.inPark', '是否位于园区', inPark, NOTES.oldInPark);
    else if (park === null) miss('enterprise.inPark', '是否位于园区', inPark, `只能选「有」「没有」或「不清楚」。`);
  } else if (!inPark.text) miss('enterprise.inPark', '是否位于园区', inPark, NOTES.inPark);
  else if (park === null || park === 'unknown') miss('enterprise.inPark', '是否位于园区', inPark, NOTES.notYesNo);

  const leases = field('leases');
  const lease = parseYesNo(leases.text);
  const leaseLabel = '是否把厂房分租给其他企业（厂中厂）';
  if (old) {
    if (!leases.text) miss('enterprise.leases', leaseLabel, leases, NOTES.oldLeasesEmpty);
    else if (lease === 'unknown') miss('enterprise.leases', leaseLabel, leases, NOTES.oldLeasesUnknown, true);
    else if (lease === null) miss('enterprise.leases', leaseLabel, leases, '只能选「有」或「没有」。');
  } else if (!leases.text) miss('enterprise.leases', leaseLabel, leases, NOTES.leases);
  else if (lease === null || lease === 'unknown') miss('enterprise.leases', leaseLabel, leases, NOTES.notYesNo);

  text('mainProducts', '主要产品', NOTES.mainProducts);

  const employees = field('employees');
  if (!employees.text) miss('enterprise.employees', '员工人数', employees, NOTES.employees);
  else if (parseInteger(employees.text) === null) miss('enterprise.employees', '员工人数', employees, NOTES.notInteger('45'));

  if (old) {
    // 旧版没有「安全生产主管负责人」，按法定代表人填
    const legal = field('legalRep');
    if (!legal.text) miss('enterprise.responsible', '法定代表人', legal, NOTES.oldLegalRep);
  } else text('responsible', '安全生产主管负责人', NOTES.responsible);

  text('contact', '联系人', NOTES.contact);
  const contactPhone = field('contactPhone');
  const contactPhoneLabel = old ? '联系人电话' : '联系人手机';
  if (!contactPhone.text) miss('enterprise.contactPhone', contactPhoneLabel, contactPhone, NOTES.contactPhone);
  else {
    const kind = phoneKind(contactPhone.text);
    if (kind === 'landline') miss('enterprise.contactPhone', contactPhoneLabel, contactPhone, NOTES.landlineForContact);
    if (kind === 'invalid') miss('enterprise.contactPhone', contactPhoneLabel, contactPhone, NOTES.notMobile);
  }

  // 企业信息选填
  opt('creditCode', '统一社会信用代码', f.creditCode);
  if (!old) opt('legalRep', '法定代表人', f.legalRep);
  opt('companyType', '企业类型', f.companyType);
  opt('industry', '所属行业', f.industry);
  opt('capital', '注册资本', f.capital);
  opt('scope', '经营范围', f.scope);
  opt('regAddress', '注册地址', f.regAddress);
  if (park === 'yes') {
    opt('parkManager', '园区管理方名称', f.parkManager);
    opt('parkPhone', '园区值班电话', f.parkPhone);
  }
  opt('landArea', '厂区占地面积', f.landArea);
  opt('totalArea', '总建筑面积', f.totalArea);
  if (lease === 'yes') opt('tenants', '承租企业名称', f.tenants);
  opt('techCount', '技术管理人员', f.techCount);
  opt('safetyCount', '安全管理人员', f.safetyCount);

  // —— 建筑与场所 ——
  const buildings = read.buildings.rows.filter((r) => r.filled);
  if (buildings.length === 0) {
    miss('building', '建筑', blockVal(read.buildings.sheet, read.buildings.firstRow), NOTES.blockBuildings);
  }
  buildings.forEach((r, i) => {
    const n = `第 ${i + 1} 栋建筑的`;
    const c = r.cells;
    if (!c.name.text) miss('building.name', `${n}名称`, c.name, NOTES.buildingName);
    if (!c.floors.text) miss('building.floors', `${n}层数`, c.floors, NOTES.buildingFloors);
    else if (!((parseInteger(c.floors.text) ?? 0) >= 1)) miss('building.floors', `${n}层数`, c.floors, NOTES.notInteger('3'));
    if (!c.area.text) miss('building.area', `${n}建筑面积`, c.area, NOTES.buildingArea);
    else if (!((parseNumber(c.area.text) ?? 0) > 0)) miss('building.area', `${n}建筑面积`, c.area, NOTES.notNumber('1200'));
  });
  countOptional(optional, buildings, 'structure', 'building.structure', '结构类型', '栋', read.buildings.sheet);
  countOptional(optional, buildings, 'fireRating', 'building.fireRating', '耐火等级', '栋', read.buildings.sheet);

  // —— 生产与设备 ——
  const process = field('process');
  if (!process.text) miss('production.process', '生产工艺', process, NOTES.process);

  const equipment = read.equipment.rows.filter((r) => r.filled);
  if (equipment.length === 0) {
    miss('equipment', '设备', blockVal(read.equipment.sheet, read.equipment.firstRow), NOTES.blockEquipment);
  }
  equipment.forEach((r, i) => {
    const n = `第 ${i + 1} 台设备的`;
    const c = r.cells;
    if (!c.name.text) miss('equipment.name', `${n}名称`, c.name, NOTES.equipmentName);
    if (!c.qty.text) miss('equipment.qty', `${n}数量`, c.qty, old ? NOTES.oldEquipmentQty : NOTES.equipmentQty);
    else if (parseNumber(c.qty.text) === null) miss('equipment.qty', `${n}数量`, c.qty, NOTES.notNumber('3'));
  });
  countOptional(optional, equipment, 'spec', 'equipment.spec', '规格型号', '台设备', read.equipment.sheet);

  // —— 原辅料与危化品 ——
  const materials = read.materials.rows.filter((r) => r.filled);
  if (materials.length === 0) {
    const first = read.materials.firstRow;
    const v: Val = { text: '', sheet: read.materials.sheet, row: first, col: 'B', cell: `B${first}` };
    miss('material', '原辅料', v, NOTES.blockMaterials);
  }
  materials.forEach((r, i) => {
    const n = `第 ${i + 1} 种物料的`;
    const c = r.cells;
    if (!c.name.text) miss('material.name', `${n}名称`, c.name, NOTES.materialName);
    if (!c.max.text) miss('material.max', `${n}最大存放量`, c.max, old ? NOTES.oldMaterialMax : NOTES.materialMax);
    else if (parseNumber(c.max.text) === null) miss('material.max', `${n}最大存放量`, c.max, NOTES.notNumber('0.5'));
    // 旧版没有单位列，一律按吨，不查
    if (!read.layout.fixedMaterialUnit && !c.unit.text) miss('material.unit', `${n}单位`, c.unit, NOTES.materialUnit);
    if (!c.location.text) miss('material.location', `${n}存放位置`, c.location, NOTES.materialLocation);
  });
  countOptional(optional, materials, 'cas', 'material.cas', 'CAS 号', '种物料', read.materials.sheet);
  countOptional(optional, materials, 'annual', 'material.annual', '年用量', '种物料', read.materials.sheet);

  // —— 应急组织 ——
  const duty = field('dutyPhone');
  if (!duty.text) miss('organization.dutyPhone', '24 小时值班电话', duty, NOTES.dutyPhone);
  else if (phoneKind(duty.text) === 'invalid') miss('organization.dutyPhone', '24 小时值班电话', duty, NOTES.notPhone);

  const org = readOrg(read);
  const person = (key: string, label: string, p: PersonVals, required: boolean) => {
    const name = p.name.text;
    const phone = p.phone.text;
    if (!name && !phone) {
      if (required) miss(key, label, p.name, NOTES.personBoth);
      return;
    }
    if (!name && required) miss(`${key}.name`, `${label}姓名`, p.name, NOTES.personName);
    if (!phone) {
      if (required) miss(`${key}.phone`, `${label}手机`, p.phone, NOTES.personPhone);
      return;
    }
    const kind = phoneKind(phone);
    if (kind === 'landline') miss(`${key}.phone`, `${label}手机`, p.phone, NOTES.landlineForPerson);
    if (kind === 'invalid') miss(`${key}.phone`, `${label}手机`, p.phone, NOTES.notMobile);
  };
  person('organization.commander', '总指挥', org.commander, true);
  person('organization.deputy', '副总指挥', org.deputy, true);
  for (const kind of REQUIRED_GROUPS) person(`organization.${kind}`, `${PRESET_GROUPS[kind]}组长`, org.groups[kind].leader, true);
  for (const kind of OPTIONAL_GROUPS) person(`organization.${kind}`, `${PRESET_GROUPS[kind]}组长`, org.groups[kind].leader, false);
  // 员工 100 人以上：业务方要求 5 个组都有组长。模板只给前 3 个组长打了 *，所以不拦提交，只在选填里提醒
  const headcount = parseInteger(employees.text);
  if (headcount !== null && headcount >= 100) {
    for (const kind of OPTIONAL_GROUPS) {
      const leader = org.groups[kind].leader;
      if (leader.name.text || leader.phone.text) continue;
      const v = leader.name;
      optional.push({
        field: `organization.${kind}`,
        label: `${PRESET_GROUPS[kind]}组长`,
        sheet: v.sheet,
        row: v.row,
        cell: v.cell,
        note: NOTES.bigOrgLeader,
      });
    }
  }

  const hospital = read.contacts.rows.find((r) => normalizeLabel(r.cells.type.text) === '就近医院');
  if (hospital && !hospital.cells.name.text && !hospital.cells.phone.text) opt('hospital', '就近医院', hospital.cells.name);

  // —— 应急资源 ——
  const extinguisher = read.supplies.rows.find((r) => normalizeLabel(r.cells.name.text) === '灭火器');
  const extVal = extinguisher?.cells.qty ?? blockVal(read.supplies.sheet, read.supplies.firstRow, 'B');
  if (!extVal.text) miss('resources.extinguisher', '灭火器数量', extVal, NOTES.extinguisher);
  else if (parseInteger(extVal.text) === null) miss('resources.extinguisher', '灭火器数量', extVal, NOTES.notInteger('20'));

  if (parseYesNo(f.pool?.text ?? '') === 'yes') {
    opt('poolVolume', '消防水池容量', f.poolVolume);
    opt('poolLocation', '消防水池位置', f.poolLocation);
  }

  return { missing: sortItems(missing), optional: sortItems(optional) };
}

function blockVal(sheet: Val['sheet'], row: number, col = 'A'): Val {
  return { text: '', sheet, row, col, cell: `${col}${row}` };
}

// 按列算的选填：已填的行里这一列空着的有几行
function countOptional<K extends string>(
  out: IntakeOptionalItem[],
  rows: ReadRow<K>[],
  col: K,
  field: string,
  label: string,
  unitWord: string,
  sheet: string,
) {
  const count = rows.filter((r) => !r.cells[col].text).length;
  if (count > 0) out.push({ field, label, sheet, count, unitWord });
}

// —— 两张必填图 ——
export interface DrawingState {
  sitePlan: boolean;
  evacuationPlan: boolean;
  noEvacuationMap: boolean;
}

export function drawingMissing(d: DrawingState): IntakeMissingItem[] {
  const out: IntakeMissingItem[] = [];
  const item = (field: string, label: string, note: string) =>
    out.push({ field, label, sheet: null, row: null, cell: null, note });
  if (!d.sitePlan) item('drawing.site_plan', '总平面布置图', NOTES.sitePlan);
  // 说明了没有疏散图，不算缺
  if (!d.evacuationPlan && !d.noEvacuationMap) item('drawing.evacuation_plan', '紧急疏散示意图', NOTES.evacuationPlan);
  return out;
}

/** 合成要存的必填检查；没有读得了的表格时为 null */
export function composeCheck(sheet: SheetCheck | null, drawings: DrawingState, now = new Date()): IntakeRequiredCheck | null {
  if (!sheet) return null;
  return { missing: [...sheet.missing, ...drawingMissing(drawings)], optional: sheet.optional, checkedAt: now.toISOString() };
}

/** 图纸变了时重算：表格那部分不动，换掉图的那两项 */
export function recheckDrawings(prev: IntakeRequiredCheck | null, drawings: DrawingState, now = new Date()): IntakeRequiredCheck | null {
  if (!prev) return null;
  const sheetPart = { missing: prev.missing.filter((m) => m.sheet !== null), optional: prev.optional ?? [] };
  return composeCheck(sheetPart, drawings, now);
}
