// 再次交付时「这次更新了什么」系统先填好的那句（15 页 R14）：比较上一次交付和这一次用的资料，
// 再加上重新打开后改过的节标题，拼成一句不超过 40 个字的话。只列名字，不写改成了什么
import type { PlanInput } from './plan/input.ts';
import { UPDATE_NOTE_MAX } from './publish.ts';

type Names = readonly (readonly [key: string, name: string])[];

const BASIC: Names = [
  ['companyName', '企业名称'],
  ['socialCreditCode', '信用代码'],
  ['legalRepresentative', '法定代表人'],
  ['registeredAddress', '注册地址'],
  ['companyType', '企业类型'],
  ['mainProducts', '主要产品'],
  ['employeeCount', '员工人数'],
  ['technicalManagementCount', '技术人员数'],
  ['contactPerson', '联系人'],
  ['contactPhone', '联系电话'],
  ['responsiblePerson', '主管负责人'],
  ['safetyManagementCount', '安全管理人数'],
];
const LOCATION: Names = [
  ['siteAddress', '实际生产地址'],
  ['otherAddresses', '其他生产经营地址'],
  ['park', '园区管理方'],
  ['rescueAgreement', '救援协议'],
  ['mutualAid', '邻企互助协议'],
  ['neighbours', '相邻企业'],
];
const ORGANIZATION: Names = [
  ['commander', '总指挥'],
  ['deputies', '副总指挥'],
  ['dutyPhone', '值班电话'],
  ['hasEmergencyOffice', '应急办公室'],
  ['paSystem', '应急广播系统'],
  ['imGroup', '应急工作群'],
  ['compilationTeam', '编制小组'],
];
const PRODUCTION: Names = [
  ['buildings', '建构筑物'],
  ['equipment', '设备清单'],
  ['specialEquipment', '特种设备'],
  ['materials', '原辅材料'],
  ['processFlow', '工艺流程'],
  ['emergencySupplies', '应急物资'],
  ['firstAidKit', '急救药箱'],
  ['firePool', '消防水池'],
  ['hasEmergencyPool', '事故应急池'],
  ['assemblyPoint', '紧急集合点'],
];
const EXPERT: Names = [
  ['hazardousMaterials', '危险化学品'],
  ['hazards', '危险源辨识'],
  ['scope', '适用范围'],
  ['quarters', '厂区四邻'],
  ['externalContacts', '外部应急联系方式'],
  ['figures', '图件'],
];
const FACTS: Names = [
  ['shortName', '企业简称'],
  ['establishedDate', '成立日期'],
  ['superior', '上级主管单位'],
  ['surroundings', '周边环境'],
  ['hospital', '就近医院'],
  ['responseGrading', '响应分级'],
  ['training', '应急培训'],
  ['buildings', '建筑结构与耐火等级'],
];

/** 深度相等：没有这个键和值是 undefined 算一样，对象键的先后不算 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === undefined && b === undefined;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameValue(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!sameValue(ao[k], bo[k])) return false;
  return true;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

// 一块里列出来的键按名字写；没列出来的键（除了 skip）变了，写这一块的总称
function compareBlock(before: unknown, after: unknown, names: Names, skip: readonly string[] = []): { listed: string[]; other: boolean } {
  const b = obj(before);
  const a = obj(after);
  const listed = names.filter(([k]) => !sameValue(b[k], a[k])).map(([, n]) => n);
  const known = new Set([...names.map(([k]) => k), ...skip]);
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const other = [...keys].some((k) => !known.has(k) && !sameValue(b[k], a[k]));
  return { listed, other };
}

// 应急小组按小组名对上：组长、组员分开写，别的变了或者加了、删了写小组名
function groupChanges(before: unknown, after: unknown): string[] {
  const list = (v: unknown) => (Array.isArray(v) ? (v as Obj[]) : []);
  const b = list(before);
  const a = list(after);
  const names = [...new Set([...a.map((g) => String(g.name ?? '')), ...b.map((g) => String(g.name ?? ''))])];
  const out: string[] = [];
  for (const name of names) {
    const x = b.find((g) => g.name === name);
    const y = a.find((g) => g.name === name);
    if (!x || !y) {
      out.push(name);
      continue;
    }
    if (!sameValue(x.leader, y.leader)) out.push(`${name}组长`);
    if (!sameValue(x.members, y.members)) out.push(`${name}组员`);
    const rest = (g: Obj) => Object.fromEntries(Object.entries(g).filter(([k]) => k !== 'leader' && k !== 'members'));
    if (!sameValue(rest(x), rest(y))) out.push(name);
  }
  return out;
}

/** 两批资料里改过的项的名字，按资料核对的先后排，不重复 */
export function planChanges(before: PlanInput, after: PlanInput): string[] {
  const out: string[] = [];
  const add = (r: { listed: string[]; other: boolean }, whole: string) => {
    out.push(...r.listed);
    if (r.other) out.push(whole);
  };
  add(compareBlock(before.basic, after.basic, BASIC), '基本信息');
  add(compareBlock(before.location, after.location, LOCATION), '地址信息');
  const org = compareBlock(before.organization, after.organization, ORGANIZATION, ['groups']);
  out.push(...org.listed, ...groupChanges(obj(before.organization).groups, obj(after.organization).groups));
  if (org.other) out.push('应急组织');
  add(compareBlock(before.production, after.production, PRODUCTION), '生产信息');
  if (!sameValue(before.business, after.business)) out.push('场所与业务');
  const expert = compareBlock(before.expert, after.expert, EXPERT, ['facts', 'pending', 'specialPending']);
  const facts = compareBlock(before.expert?.facts, after.expert?.facts, FACTS);
  out.push(...expert.listed, ...facts.listed);
  if (expert.other || facts.other) out.push('专业项');
  if (!sameValue(before.agencies, after.agencies)) out.push('属地机构');
  if (!sameValue(before.drawings, after.drawings)) out.push('附图');
  return [...new Set(out)];
}

const HEADING_NUMBER = /^(?:[一二三四五六七八九十百]+、|附件\d+、|附\d+(?:\.\d+)*\.\s*|\d+(?:\.\d+)+\.?\s*|\d+\.\s*)/;

/** 节标题去掉开头的编号：「2.2 指挥机构及职责」→「指挥机构及职责」 */
export function stripHeadingNumber(title: string): string {
  return title.replace(HEADING_NUMBER, '').trim();
}

/**
 * 拼「这次更新了什么」：去重后用「、」连起来，不超过 40 个字。一项一项往上加，加不下的整项丢掉；
 * 第一项自己就超过 40 个字时返回空串
 */
export function composeUpdateNote(items: readonly string[], max: number = UPDATE_NOTE_MAX): string {
  const list = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
  if (!list.length || list[0]!.length > max) return '';
  let note = '';
  for (const item of list) {
    const next = note ? `${note}、${item}` : item;
    if (next.length <= max) note = next;
  }
  return note;
}
