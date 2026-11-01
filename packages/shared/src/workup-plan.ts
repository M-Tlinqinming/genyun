// 第 10 项「生成三份草稿」的输入：按锁定的快照与专家整理结果拼出 PlanInput。
// 客户资料取快照；专家改过的事实（data.overrides）盖在上面；设备物料、危险源、适用范围、图件用各模块给生成的转换。
import { type AgencyDistrict, localAgenciesOf, type LocalAgencies } from './plan/agencies.ts';
import type { ExpertFacts, PlanInput } from './plan/input.ts';
import type { Address, BasicInfo, YesNoUnknown } from './profile/basic.ts';
import { YES_NO_UNKNOWN_LABELS } from './profile/basic.ts';
import type { Location } from './profile/location.ts';
import type { Organization, Person } from './profile/organization.ts';
import { compilationTeamOf, type DraftPerson, type OrganizationStep } from './profile/organization-step.ts';
import { FIRE_RATINGS } from './profile/resources-step.ts';
import { figuresView, planFiguresOf } from './workup-figures.ts';
import { planProductionOf, productionView, type ProductionList } from './workup-production.ts';
import { planHazardsOf, riskView } from './workup-risk.ts';
import { planScopeOf, scopeView } from './workup-scope.ts';
import { organizationOf, workupFacts, workupProgress, type FactPerson, type FactSection, type FactValue, type WorkupData, type WorkupSnapshot } from './workup.ts';

const address = (detail: string): Address => ({ province: '', city: '', district: '', detail });
const text = (v: FactValue | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const count = (v: FactValue | undefined) => (typeof v === 'number' ? v : undefined);

// 「N m²」
const squareMeters = (v: FactValue | undefined) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// workup.ts answerText 的反向：「有 · 明细」「没有」「不清楚」
function answerOf(v: FactValue | undefined): { answer: YesNoUnknown; detail?: string } | undefined {
  const s = text(v);
  if (!s) return undefined;
  const [head, ...rest] = s.split(' · ');
  const answer = (Object.keys(YES_NO_UNKNOWN_LABELS) as YesNoUnknown[]).find((k) => YES_NO_UNKNOWN_LABELS[k] === head);
  // 专家直接写了名称的，按「有」处理
  if (!answer) return { answer: 'yes', detail: s };
  return { answer, detail: rest.join(' · ') || undefined };
}

// 「名称 · 电话」
function agencyOf(v: FactValue | undefined): { name: string; phone?: string } | undefined {
  const s = text(v);
  if (!s) return undefined;
  const [name, ...rest] = s.split(' · ');
  return { name: name!.trim(), phone: rest.join(' · ').trim() || undefined };
}

const personOf = (p: FactPerson, id: string): Person => ({ id, name: p.name, position: p.position || undefined, phone: p.phone || undefined });
const draftPerson = (p: DraftPerson | undefined): Person | undefined =>
  p && p.name.trim() ? { id: p.id, name: p.name.trim(), position: p.position || undefined, phone: p.phone || undefined } : undefined;

function basicOf(snapshot: WorkupSnapshot, data: WorkupData): BasicInfo {
  const o = (key: string) => data.overrides[key]?.value;
  const id = snapshot.identity;
  const stored = snapshot.profile.basicStep?.basic ?? {};
  const { industry: _i, siteAddress: _s, otherAddresses: _a, inPark: _p, parkManager: _m, parkDutyPhone: _d, ...rest } = stored;
  const registered = text(o('registeredAddress')) ?? id.registeredAddress ?? undefined;
  return {
    ...rest,
    companyName: text(o('companyName')) ?? id.name,
    socialCreditCode: text(o('socialCreditCode')) ?? id.socialCreditCode ?? undefined,
    legalRepresentative: text(o('legalRepresentative')) ?? id.legalRepresentative ?? undefined,
    registeredAddress: registered ? address(registered) : undefined,
    companyType: text(o('companyType')) ?? rest.companyType,
    mainProducts: text(o('mainProducts')) ?? rest.mainProducts,
    employeeCount: count(o('employeeCount')) ?? rest.employeeCount,
    technicalManagementCount: count(o('technicalManagementCount')) ?? rest.technicalManagementCount,
    contactPerson: text(o('contactPerson')) ?? rest.contactPerson,
    contactPhone: text(o('contactPhone')) ?? rest.contactPhone,
    responsiblePerson: text(o('responsiblePerson')) ?? rest.responsiblePerson,
    safetyManagementCount: count(o('safetyManagementCount')) ?? rest.safetyManagementCount,
    landAreaM2: o('landArea') === undefined ? rest.landAreaM2 : squareMeters(o('landArea')),
  };
}

function locationOf(snapshot: WorkupSnapshot, data: WorkupData): Location {
  const o = (key: string) => data.overrides[key]?.value;
  const basic = snapshot.profile.basicStep?.basic;
  const res = snapshot.profile.resourcesStep?.step;
  const site = text(o('siteAddress')) ?? basic?.siteAddress ?? snapshot.identity.registeredAddress ?? '';

  // 其他地址：专家改的是一行文字（「；」分隔），按顺序沿用原来的 id，人员、设备的厂址标注才对得上
  const stored = basic?.otherAddresses ?? [];
  const others = o('otherAddresses') === undefined
    ? stored.filter((a) => a.address.trim())
    : (text(o('otherAddresses')) ?? '').split('；').map((s) => s.trim()).filter(Boolean).map((a, i) => ({ id: stored[i]?.id ?? `addr${i + 2}`, address: a }));

  const parkOverride = answerOf(o('agency.park'));
  const park = parkOverride
    ? (() => {
        const [manager, dutyPhone] = (parkOverride.detail ?? '').split(' · ');
        return { answer: parkOverride.answer, manager: manager || undefined, dutyPhone: dutyPhone || undefined };
      })()
    : basic?.inPark
      ? { answer: basic.inPark, manager: basic.parkManager, dutyPhone: basic.parkDutyPhone }
      : undefined;

  const agreement = (key: string, stored?: { answer?: YesNoUnknown; parties?: string }) => {
    const v = answerOf(o(key));
    if (v) return { answer: v.answer, parties: v.detail };
    return stored?.answer ? { answer: stored.answer, parties: stored.parties } : undefined;
  };

  const n = res?.neighbors;
  const items = (n?.items ?? []).filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), contact: x.contact || undefined }));
  const neighbours: Location['neighbours'] =
    n?.answer === 'has' && items.length ? { answer: 'listed', items } : n?.answer === 'none' ? { answer: 'none' } : n?.answer === 'unknown' ? { answer: 'unknown' } : undefined;

  return {
    siteAddress: address(site),
    otherAddresses: others.length ? others : undefined,
    park,
    rescueAgreement: agreement('agency.rescueAgreement', res?.rescueAgreement),
    mutualAid: agreement('agency.mutualAid', res?.mutualAid),
    neighbours,
  };
}

// 专家改了总指挥、副总指挥、组长的，替换到组织里；同一个人兼任几处时只改这一处
function organizationStepOf(snapshot: WorkupSnapshot, data: WorkupData): OrganizationStep {
  const step = organizationOf(snapshot);
  const o = (key: string) => {
    const v = data.overrides[key]?.value;
    return typeof v === 'object' ? v : undefined;
  };
  const replace = (p: DraftPerson | undefined, v: FactPerson | undefined, id: string): DraftPerson | undefined =>
    v ? { id: p?.id ?? id, name: v.name, position: v.position, phone: v.phone } : p;
  const groupKey = (g: OrganizationStep['groups'][number]) =>
    `group.${g.kind === 'custom' || step.groups.find((x) => x.kind === g.kind) !== g ? g.id : g.kind}`;
  const duty = text(data.overrides.dutyPhone?.value);
  const yn = (key: string, stored: YesNoUnknown | undefined) => answerOf(data.overrides[key]?.value)?.answer ?? stored;
  return {
    ...step,
    commander: replace(step.commander, o('commander'), 'commander'),
    deputies: step.deputies.map((d, i) => replace(d, o(`deputy.${i + 1}`), `deputy${i + 1}`)!),
    groups: step.groups.map((g) => ({ ...g, leader: replace(g.leader, o(groupKey(g)), `${g.id}-leader`) })),
    dutyPhone: duty ?? step.dutyPhone,
    paSystem: yn('paSystem', step.paSystem),
    imGroup: yn('imGroup', step.imGroup),
  };
}

function organizationFrom(step: OrganizationStep): Organization {
  const members = (ps: DraftPerson[]) => ps.map(draftPerson).filter((p): p is Person => !!p);
  // 另加了编制组成员的，编制小组整张按自填第 2 步的规则列出；没加的由生成按同一规则排
  const team = step.compilationExtras.some((e) => e.name.trim()) ? compilationTeamOf(step).filter((r) => r.name.trim()) : [];
  const leader = team.find((r) => r.role === '组长');
  return {
    commander: draftPerson(step.commander),
    deputies: members(step.deputies),
    hasEmergencyOffice: false,
    groups: step.groups.map((g) => ({
      kind: g.kind,
      name: g.name,
      leader: draftPerson(g.leader),
      members: members(g.members),
      addressId: g.addressId,
    })),
    dutyPhone: step.dutyPhone,
    paSystem: step.paSystem,
    imGroup: step.imGroup,
    compilationTeam: team.length
      ? {
          leader: leader && { name: leader.name, title: leader.title, duty: leader.duty },
          members: team.filter((r) => r !== leader).map((r) => ({ name: r.name, title: r.title, duty: r.duty || undefined })),
        }
      : undefined,
  };
}

function agenciesOf(location: Location, data: WorkupData, districts?: readonly AgencyDistrict[]): LocalAgencies {
  const agencies = localAgenciesOf(location.siteAddress, districts);
  const o = (key: string) => agencyOf(data.overrides[key]?.value);
  return {
    ...agencies,
    emergencyBureau: o('agency.emergencyBureau') ?? agencies.emergencyBureau,
    streetOffice: o('agency.streetOffice') ?? agencies.streetOffice,
    fireDept: o('agency.fireDept') ?? agencies.fireDept,
  };
}

function factsOf(data: WorkupData, buildings: ReturnType<typeof productionView>['buildings']): ExpertFacts {
  const o = (key: string) => text(data.overrides[key]?.value);
  const hospital = o('hospital');
  const department = o('trainingDepartment');
  const rated = buildings.filter((b) => b.fireRating && b.name.trim());
  return {
    shortName: o('shortName'),
    establishedDate: o('establishedDate'),
    superior: o('superior'),
    surroundings: o('surroundings'),
    hospital: hospital ? { name: hospital } : undefined,
    training: department ? { department } : undefined,
    buildings: rated.length ? Object.fromEntries(rated.map((b) => [b.name.trim(), { fireRating: FIRE_RATINGS[b.fireRating!] }])) : undefined,
  };
}

export interface WorkupGap {
  key: string;
  label: string;
  module: 'facts' | ProductionList | 'scope' | 'figures';
  section?: FactSection;
}

// 还差的项：企业事实的必需项在前，生产设备与物料待确认的判断、适用范围待确认的开关、待采用的图在后。
// 专家页底栏、「下一个缺失项」和确认生成的检查共用
export function workupGaps(snapshot: WorkupSnapshot, data: WorkupData): { required: number; gaps: WorkupGap[] } {
  const progress = workupProgress(workupFacts(snapshot, data));
  const production = productionView(snapshot, data);
  const scope = scopeView(snapshot, data);
  const figures = figuresView(snapshot, data);
  const gaps: WorkupGap[] = [
    ...progress.missing.map((f) => ({ key: f.key, label: f.label, module: 'facts' as const, section: f.section })),
    ...production.pending.map((p) => ({ key: p.key, label: p.label, module: p.list })),
    ...scope.pending.map((s) => ({ key: `scope:${s.key}`, label: s.label, module: 'scope' as const })),
    ...figures.pending.map((f) => ({ key: `figure:${f.key}`, label: `${f.label}待采用`, module: 'figures' as const })),
  ];
  return { required: progress.required + production.required + scope.required + figures.required, gaps };
}

const compact =<T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

// districts：知识库里的属地机构（生成时从数据库取）；不传时用内置数据
export function planInputOf(snapshot: WorkupSnapshot, data: WorkupData, issuedOn: string, districts?: readonly AgencyDistrict[]): PlanInput {
  const production = productionView(snapshot, data);
  const { hazardousMaterials, ...plan } = planProductionOf(snapshot, production);
  const location = locationOf(snapshot, data);
  return {
    basic: basicOf(snapshot, data),
    location,
    organization: organizationFrom(organizationStepOf(snapshot, data)),
    ...plan,
    agencies: agenciesOf(location, data, districts),
    issuedOn,
    expert: {
      hazardousMaterials,
      hazards: planHazardsOf(riskView(snapshot, data)),
      scope: planScopeOf(scopeView(snapshot, data)),
      facts: compact(factsOf(data, production.buildings)),
      figures: planFiguresOf(figuresView(snapshot, data)),
    },
  };
}
