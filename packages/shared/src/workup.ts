// 专业整理（Paper 14 页 E18-00A、E18-00A2）：负责专家对照原件整理企业事实。前后端共用。
// 每个任务单独存一份（Martin 10-29 确认）：专家第一次打开任务时复制企业资料（快照），
// 之后客户再改企业资料不影响这里，变化走第 13 项事实补件；专家的修改只记在任务里，标为「专家整理」。
import { z } from 'zod';
import type { ChecklistItemKey } from './checklist/items.ts';
import type { BasicStepAnyField, EnterpriseProfile } from './profile/basic-step.ts';
import { addressLabelOf, addressOptions } from './profile/addresses.ts';
import { YES_NO_UNKNOWN_LABELS, type YesNoUnknown } from './profile/basic.ts';
import { INDUSTRY_NAMES } from './profile/industries.ts';
import { PRESET_GROUPS } from './profile/organization.ts';
import {
  defaultOrganizationStep,
  type DraftGroup,
  type DraftPerson,
  type OrganizationStep,
} from './profile/organization-step.ts';
import { totalBuildingArea } from './profile/resources-step.ts';
import { type AgencyDistrict, localAgenciesOf } from './plan/agencies.ts';
import type { ProductionWorkup } from './workup-production.ts';
import type { RiskWorkup } from './workup-risk.ts';
import type { FiguresWorkup } from './workup-figures.ts';
import type { ScopeWorkup } from './workup-scope.ts';

// 快照：企业身份四项（企业档案的列）+ 企业自填资料
export interface WorkupSnapshot {
  identity: {
    name: string;
    socialCreditCode: string | null;
    legalRepresentative: string | null;
    registeredAddress: string | null;
  };
  profile: EnterpriseProfile;
}

// 来源标签的四类（设计系统 gy-source）
export const FACT_SOURCES = {
  original: '客户原件',
  customer: '客户确认',
  system: '系统推导',
  expert: '专家整理',
} as const;
export type FactSource = keyof typeof FACT_SOURCES;

export const FACT_SECTIONS = {
  basic: '基本信息',
  contact: '联系与规模',
  agencies: '属地机构',
  organization: '应急组织',
  compilation: '编制小组',
  judgement: '专家判断',
} as const;
export type FactSection = keyof typeof FACT_SECTIONS;

// text = 文字；count = 人数等整数；person = 姓名、职位、电话
export type FactKind = 'text' | 'count' | 'person';

export const factPersonSchema = z.object({
  name: z.string().trim().min(1, '请填写姓名').max(50, '姓名最多 50 个字'),
  position: z.string().trim().max(50, '职位最多 50 个字').optional(),
  phone: z
    .string()
    .trim()
    .max(30, '电话最多 30 位')
    .regex(/^[\d\s\-+()（）]*$/, '电话只能填数字、空格和短横线')
    .optional(),
});
export type FactPerson = z.infer<typeof factPersonSchema>;
export type FactValue = string | number | FactPerson;

// 专家保存一项：直接填写（对照原件整理）或标为客户确认（电话问过客户）
export const factSaveSchema = z.object({
  version: z.number().int().min(1),
  key: z.string().min(1).max(80),
  // null = 撤回专家的修改，回到客户资料里的值
  value: z.union([z.string().trim().min(1, '请填写内容').max(500, '最多 500 个字'), z.number(), factPersonSchema]).nullable(),
  source: z.enum(['expert', 'customer']).default('expert'),
  // 整理时对照的原件
  fileId: z.uuid().optional(),
  // 采用客户在任务里的回答（联系记录）
  contactId: z.uuid().optional(),
});
export type FactSave = z.infer<typeof factSaveSchema>;

export interface FactOverride {
  value: FactValue;
  source: 'expert' | 'customer';
  fileId?: string;
  // 来自联系客户：phone = 电话问清后回填，request = 采用客户在任务里的回答；supplement = 事实补件里专家明确采用（第 13 项）
  via?: 'phone' | 'request' | 'supplement';
  contactId?: string;
  supplementId?: string;
  by: string;
  byName: string;
  at: string;
}

export interface WorkupData {
  overrides: Record<string, FactOverride>;
  // 生产设备与物料的整理与判断（workup-production.ts），专家第一次保存时才有
  production?: ProductionWorkup;
  // 危险源辨识的修改与新增（workup-risk.ts），专家第一次保存时才有
  risks?: RiskWorkup;
  // 适用范围开关的专家确认（workup-scope.ts），专家第一次确认时才有
  scope?: ScopeWorkup;
  // 图件的画法与采用（workup-figures.ts），专家第一次调整或采用时才有
  figures?: FiguresWorkup;
}

export interface FactDef {
  key: string;
  section: FactSection;
  label: string;
  kind: FactKind;
  required: boolean;
  // 系统按规则得出、专家不在这里改的项（如编制小组）
  readonly?: boolean;
  // 缺失时告诉专家这一项用在哪里
  use?: string;
  // 对照原件时打开哪一项资料的文件
  itemKey?: ChecklistItemKey;
}

export interface FactBase {
  value?: FactValue;
  source?: FactSource;
  // 来源标签后半段，如「营业执照」「知识库」「同法定代表人」
  sourceNote?: string;
  fileId?: string;
  // 客户点了「稍后补」
  later?: boolean;
  hint?: string;
}

export type FactStatus = 'done' | 'missing' | 'later' | 'empty';

export interface Fact extends FactDef, FactBase {
  status: FactStatus;
  override?: FactOverride;
}

const filled = (v: unknown) =>
  typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') || (typeof v === 'object' && v !== null);

export function formatFact(value: FactValue | undefined, kind: FactKind): string {
  if (value === undefined) return '';
  if (typeof value === 'object') return [value.name, value.position, value.phone].filter(Boolean).join(' · ');
  if (kind === 'count') return `${value} 人`;
  return String(value);
}

const asPerson = (p: DraftPerson | undefined): FactPerson | undefined =>
  p && p.name.trim() ? { name: p.name.trim(), position: p.position || undefined, phone: p.phone || undefined } : undefined;

// 选填的有 / 没有 / 不清楚：有的带上名称或位置；没回答的为空
const answerText = (answer: YesNoUnknown | undefined, detail?: string) =>
  answer === undefined ? undefined : answer === 'yes' ? [YES_NO_UNKNOWN_LABELS.yes, detail?.trim()].filter(Boolean).join(' · ') : YES_NO_UNKNOWN_LABELS[answer];

// 同类小组有多个（分厂址各设一套）时，第二个起按 id 记
const groupKey = (g: DraftGroup, groups: readonly DraftGroup[]) =>
  `group.${g.kind === 'custom' || groups.find((x) => x.kind === g.kind) !== g ? g.id : g.kind}`;

export function organizationOf(snapshot: WorkupSnapshot): OrganizationStep {
  return snapshot.profile.organizationStep?.step ?? defaultOrganizationStep(snapshot.profile.basicStep?.basic.employeeCount);
}

type Entry = [FactDef, FactBase];

function basicEntries(snapshot: WorkupSnapshot): Entry[] {
  const stored = snapshot.profile.basicStep;
  const basic = stored?.basic ?? {};
  const later = new Set<string>(stored?.later ?? []);
  const licenseFileId = stored?.licenseFileId;

  // 客户自填的字段：执照识别带出的标「客户原件 · 营业执照」，按规则带出的标系统推导，其余为客户确认
  const fromCustomer = (field: BasicStepAnyField, value: FactValue | undefined | null): FactBase => {
    if (value === undefined || value === null || !filled(value)) return { later: later.has(field) };
    const src = stored?.sources[field];
    if (src === 'license') return { value, source: 'original', sourceNote: '营业执照', fileId: licenseFileId };
    if (src === 'account') return { value, source: 'system', sourceNote: '当前账号' };
    if (src === 'legal_rep') return { value, source: 'system', sourceNote: '同法定代表人' };
    if (src === 'registered_address') return { value, source: 'system', sourceNote: '同注册地址' };
    return { value, source: 'customer', sourceNote: '自填' };
  };
  const def = (
    key: string,
    section: FactSection,
    label: string,
    opts: Partial<FactDef> = {},
  ): FactDef => ({ key, section, label, kind: 'text', required: false, itemKey: 'basic_info', ...opts });
  const id = snapshot.identity;
  const license = { itemKey: 'business_license' as const };
  const industry = basic.industry ? INDUSTRY_NAMES[basic.industry] : undefined;
  const buildings = snapshot.profile.resourcesStep?.step.buildings ?? [];
  const floorArea = totalBuildingArea(buildings);

  return [
    [def('companyName', 'basic', '企业名称', { required: true, ...license }), fromCustomer('name', id.name)],
    [def('socialCreditCode', 'basic', '信用代码', { required: true, ...license, use: '封面与企业概况' }), fromCustomer('socialCreditCode', id.socialCreditCode)],
    [def('legalRepresentative', 'basic', '法定代表人', { required: true, ...license, use: '企业概况与批准发布令' }), fromCustomer('legalRepresentative', id.legalRepresentative)],
    [def('registeredAddress', 'basic', '注册地址', { required: true, ...license, use: '企业概况；属地机构按地址调取' }), fromCustomer('registeredAddress', id.registeredAddress)],
    [def('siteAddress', 'basic', '实际生产地址'), fromCustomer('siteAddress', basic.siteAddress)],
    [
      def('otherAddresses', 'basic', '其他生产经营地址', { use: '一照多址：适用范围与各清单的厂址' }),
      fromCustomer('otherAddresses', (basic.otherAddresses ?? []).map((a) => a.address.trim()).filter(Boolean).join('；') || undefined),
    ],
    [def('industry', 'basic', '所属行业'), fromCustomer('industry', industry)],
    [def('companyType', 'basic', '企业类型', license), fromCustomer('companyType', basic.companyType)],
    [def('mainProducts', 'basic', '主要产品', { required: true, use: '企业概况与风险评估' }), fromCustomer('mainProducts', basic.mainProducts)],
    [def('employeeCount', 'basic', '员工人数', { kind: 'count', required: true, use: '企业概况；应急小组规模建议' }), fromCustomer('employeeCount', basic.employeeCount)],
    [def('technicalManagementCount', 'basic', '技术人员数', { kind: 'count', required: true, use: '用于企业概况章节' }), fromCustomer('technicalManagementCount', basic.technicalManagementCount)],

    [def('contactPerson', 'contact', '联系人', { required: true, use: '封面联系人' }), fromCustomer('contactPerson', basic.contactPerson)],
    [def('contactPhone', 'contact', '联系电话', { required: true, use: '封面联系人' }), fromCustomer('contactPhone', basic.contactPhone)],
    [def('responsiblePerson', 'contact', '主管负责人'), fromCustomer('responsiblePerson', basic.responsiblePerson)],
    [def('safetyManagementCount', 'contact', '安全管理人数', { kind: 'count' }), fromCustomer('safetyManagementCount', basic.safetyManagementCount)],
    [
      def('totalFloorArea', 'contact', '总建筑面积', { itemKey: 'buildings', readonly: true }),
      floorArea > 0
        ? { value: `${floorArea} m²（${buildings.length} 栋合计）`, source: 'system', sourceNote: '建筑表' }
        : { hint: '由建（构）筑物一览合计；建筑表还没有面积' },
    ],
    [def('landArea', 'contact', '占地面积'), fromCustomer('landAreaM2', basic.landAreaM2 === undefined ? undefined : `${basic.landAreaM2} m²`)],
  ];
}

function agencyEntries(snapshot: WorkupSnapshot, districts?: readonly AgencyDistrict[]): Entry[] {
  const address = snapshot.profile.basicStep?.basic.siteAddress || snapshot.identity.registeredAddress || '';
  const agencies = localAgenciesOf({ province: '', city: '', district: '', detail: address }, districts);
  const known = (a: { name: string; phone?: string } | undefined): FactBase =>
    a
      ? { value: [a.name, a.phone].filter(Boolean).join(' · '), source: 'system', sourceNote: '知识库' }
      : { hint: address ? '知识库还没有收录这个地区，请对照当地资料填写' : '还没有地址，无法调取' };
  const def = (key: string, label: string): FactDef => ({ key, section: 'agencies', label, kind: 'text', required: false });
  const basic = snapshot.profile.basicStep?.basic;
  const res = snapshot.profile.resourcesStep?.step;
  const customer = (v: string | undefined): FactBase => (v ? { value: v, source: 'customer', sourceNote: '自填' } : {});
  const park = basic?.inPark === 'yes' ? [basic.parkManager, basic.parkDutyPhone].map((x) => x?.trim()).filter(Boolean).join(' · ') : '';
  return [
    [def('agency.emergencyBureau', '应急管理局'), known(agencies.emergencyBureau)],
    [def('agency.streetOffice', '街道'), known(agencies.streetOffice)],
    [def('agency.fireDept', '消防'), known(agencies.fireDept)],
    [def('agency.park', '园区管理方'), customer(answerText(basic?.inPark, park))],
    [def('agency.rescueAgreement', '救援协议'), customer(answerText(res?.rescueAgreement?.answer, res?.rescueAgreement?.parties))],
    [def('agency.mutualAid', '邻企互助协议'), customer(answerText(res?.mutualAid?.answer, res?.mutualAid?.parties))],
  ];
}

function organizationEntries(snapshot: WorkupSnapshot): Entry[] {
  const org = organizationOf(snapshot);
  const roster = org.mode === 'roster';
  const rosterHint = roster ? '客户上传了花名册，请对照整理' : undefined;
  const person = (p: DraftPerson | undefined): FactBase => {
    const v = asPerson(p);
    return v ? { value: v, source: 'customer', sourceNote: '自填' } : { hint: rosterHint };
  };
  const entries: Entry[] = [
    [
      { key: 'commander', section: 'organization', label: '总指挥', kind: 'person', required: true, itemKey: 'emergency_groups', use: '组织体系图与职责' },
      person(org.commander),
    ],
  ];
  org.deputies.forEach((d, i) => {
    entries.push([
      { key: `deputy.${i + 1}`, section: 'organization', label: org.deputies.length > 1 ? `副总指挥 ${i + 1}` : '副总指挥', kind: 'person', required: false, itemKey: 'emergency_groups' },
      person(d),
    ]);
  });
  const basic = snapshot.profile.basicStep?.basic;
  const addresses = addressOptions(basic?.siteAddress, basic?.otherAddresses);
  for (const g of org.groups) {
    const members = g.members.filter((m) => m.name.trim()).length;
    const preset = g.kind === 'custom' ? g.name || '自定义小组' : PRESET_GROUPS[g.kind];
    const site = org.groups.filter((x) => x.kind === g.kind).length > 1 ? addressLabelOf(addresses, g.addressId) : '';
    const name = site ? `${preset}（${site}）` : preset;
    const base = person(g.leader);
    entries.push([
      { key: groupKey(g, org.groups), section: 'organization', label: `${name}组长`, kind: 'person', required: false, itemKey: 'emergency_groups' },
      { ...base, hint: base.hint ?? (members ? `组员 ${members} 人` : rosterHint ?? '客户还没有填组长') },
    ]);
  }
  const duty = org.dutyPhone?.trim();
  entries.push([
    { key: 'dutyPhone', section: 'organization', label: '值班电话', kind: 'text', required: true, itemKey: 'duty_phone', use: '应急响应与信息报告' },
    duty ? { value: duty, source: 'customer', sourceNote: '自填' } : {},
  ]);
  const optional = (key: string, label: string, v: string | undefined): Entry => [
    { key, section: 'organization', label, kind: 'text', required: false },
    v ? { value: v, source: 'customer', sourceNote: '自填' } : {},
  ];
  const point = snapshot.profile.resourcesStep?.step.assemblyPoint;
  entries.push(
    optional('paSystem', '应急广播系统', answerText(org.paSystem)),
    optional('imGroup', '应急工作群', answerText(org.imGroup)),
    optional('assemblyPoint', '紧急集合点', answerText(point?.answer, point?.location)),
  );
  return entries;
}

function compilationEntries(snapshot: WorkupSnapshot, commander: FactValue | undefined): Entry[] {
  const org = organizationOf(snapshot);
  const members = [
    ...org.deputies.map((d) => d.name.trim()),
    ...org.groups.map((g) => g.leader?.name.trim() ?? ''),
    ...org.compilationExtras.map((e) => e.name.trim()),
  ].filter(Boolean);
  const unique = [...new Set(members)];
  const leaderName = typeof commander === 'object' ? commander.name : undefined;
  const def = (key: string, label: string): FactDef => ({ key, section: 'compilation', label, kind: 'text', required: false, readonly: true });
  return [
    [def('compilation.leader', '组长'), leaderName ? { value: `${leaderName} · 计划、评审、签署颁布`, source: 'system', sourceNote: '分工模板' } : { hint: '由总指挥担任' }],
    [
      def('compilation.members', unique.length ? `成员 ${unique.length} 人` : '成员'),
      unique.length ? { value: unique.join('、'), source: 'system', sourceNote: '分工模板' } : { hint: '由副总指挥与各组组长组成' },
    ],
  ];
}

// 只由专家补充的企业事实（plan/input.ts 的 ExpertFacts），都可以不填
function judgementEntries(): Entry[] {
  const def = (key: string, label: string, use: string): FactDef => ({ key, section: 'judgement', label, kind: 'text', required: false, use });
  return [
    [def('shortName', '企业简称', '预案编号（如 FY2026）'), {}],
    [def('establishedDate', '成立日期', '企业概况'), {}],
    [def('superior', '上级主管单位', '企业概况'), {}],
    [def('surroundings', '周边环境', '周边环境与重大危险源情况'), {}],
    [def('hospital', '就近医院', '医疗救护与外部资源'), {}],
    [def('trainingDepartment', '培训主管部门', '应急培训'), {}],
  ];
}

function statusOf(def: FactDef, value: FactValue | undefined, later: boolean | undefined): FactStatus {
  if (value !== undefined && filled(value)) return 'done';
  if (later) return 'later';
  return def.required ? 'missing' : 'empty';
}

// 按快照与专家的修改算出每一项现在的值、来源和状态。
// districts 是知识库里的属地机构（接口从数据库取来传进来）；不传时用内置数据
export function workupFacts(snapshot: WorkupSnapshot, data: WorkupData, districts?: readonly AgencyDistrict[]): Fact[] {
  const apply = ([def, base]: Entry): Fact => {
    const override = def.readonly ? undefined : data.overrides[def.key];
    const merged: FactBase = override
      ? {
          value: override.value,
          source: override.source,
          sourceNote:
            override.source === 'customer'
              ? override.via === 'request'
                ? '任务内补充'
                : override.via === 'supplement'
                  ? '事实补件'
                  : '电话确认'
              : undefined,
          fileId: override.fileId,
        }
      : base;
    return { ...def, ...base, ...merged, override, status: statusOf(def, merged.value, base.later && !override) };
  };
  const head = [...basicEntries(snapshot), ...agencyEntries(snapshot, districts), ...organizationEntries(snapshot)].map(apply);
  const commander = head.find((f) => f.key === 'commander')?.value;
  return [...head, ...compilationEntries(snapshot, commander).map(apply), ...judgementEntries().map(apply)];
}

export function factDefOf(snapshot: WorkupSnapshot, key: string): FactDef | undefined {
  return workupFacts(snapshot, { overrides: {} }).find((f) => f.key === key);
}

// 保存前校验：这一项存在、能改，值的类型对得上
export function factSaveError(def: FactDef | undefined, value: FactSave['value']): string | null {
  if (!def) return '没有这一项';
  if (def.readonly) return `${def.label}由系统按规则生成，不在这里修改`;
  if (value === null) return null;
  if (def.kind === 'person' && typeof value !== 'object') return '请填写姓名、职位和电话';
  if (def.kind === 'count' && !(typeof value === 'number' && Number.isInteger(value) && value >= 0)) return '请填写人数';
  if (def.kind === 'text' && typeof value !== 'string') return '请填写文字';
  return null;
}

export interface SectionSummary {
  section: FactSection;
  label: string;
  missing: number;
}

export interface WorkupProgress {
  required: number;
  done: number;
  missing: Fact[];
  sections: SectionSummary[];
}

// 必需项的进度、还差哪几项（底栏「还差 N 项」），以及每个小节缺几项
export function workupProgress(facts: readonly Fact[]): WorkupProgress {
  const required = facts.filter((f) => f.required);
  const missing = required.filter((f) => f.status !== 'done');
  const sections = (Object.keys(FACT_SECTIONS) as FactSection[]).map((section) => ({
    section,
    label: FACT_SECTIONS[section],
    missing: missing.filter((f) => f.section === section).length,
  }));
  return { required: required.length, done: required.length - missing.length, missing, sections };
}

// 「下一个缺失项」：从当前项往后找下一个没完成的必需项，到底了从头找
export function nextMissing(facts: readonly Fact[], currentKey?: string): Fact | undefined {
  const missing = facts.filter((f) => f.required && f.status !== 'done');
  if (missing.length === 0) return undefined;
  const at = currentKey ? facts.findIndex((f) => f.key === currentKey) : -1;
  return missing.find((f) => facts.indexOf(f) > at) ?? missing[0];
}
