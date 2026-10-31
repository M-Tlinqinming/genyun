// 生成应急预案时各章共用的企业数据：一次算好，各章直接取。
// 缺的必填内容写「（待补充）」，交专家核对时补；可不填的写「—」。
import {
  accidentTypeOf,
  addressLabelOf,
  addressOptions,
  groupDisplayNames,
  hazardousMaterialsOf,
  planSignals,
  resolveScope,
  selectPlans,
  PRESET_GROUPS,
  type Person,
  type PlanInput,
  type PlanSelection,
  type PlanSignals,
  type Scope,
  type SiteAddressOption,
  type EmergencyGroup,
  type Hazard,
} from '@genyun/shared';

export const MISSING = '（待补充）';

/** 「2026-04-11」→「2026年4月11日」 */
export function cnDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

export interface PlanContext {
  input: PlanInput;
  company: string;
  scope: Scope;
  selection: PlanSelection;
  signals: PlanSignals;
  hazardous: string[];
  /** 「（酒精）」这样跟在「危险化学品」后面的举例；没有危化品为空 */
  chemNote: string;
  bureau: string;
  bureauPhone?: string;
  street: string;
  streetPhone?: string;
  fireDept: string;
  firePhone: string;
  /** 辖区消防大队值班座机，查不到为 undefined */
  fireDutyPhone?: string;
  hospital: string;
  commander?: Person;
  /** 总指挥姓名，正文写成「总指挥（李文聪）」 */
  commanderName: string;
  dutyPhone: string;
  /** 按 id 找人（物资保管人） */
  person: (id: string | undefined) => Person | undefined;
  /** 资料里有依据才能写成现状的设施与安排 */
  facts: PlanFacts;
  /** 一照多址时的各处厂址（实际生产地址在前）；只有一处为空，生成稿不出厂址 */
  addresses: SiteAddressOption[];
  /** 按厂址 id 取短写，表格「厂址」列用；只有一处地址或没标的为空 */
  siteOf: (id: string | undefined) => string;
  /** 应急小组在正文里的名称：分厂址的同名小组带厂址 */
  groupName: (g: EmergencyGroup) => string;
  /** 位于园区：信息报告、应急支援先报园区管理方并与园区联动；不在园区或没回答为空 */
  park?: { manager: string; dutyPhone?: string };
  /** 签了救援协议、互助协议的对象名称；没写名称为空 */
  rescueParties: string;
  mutualAidParties: string;
  /** 紧急集合点位置；没写为空 */
  assemblyPoint: string;
}

/**
 * 通讯设施、车辆、备用电源、协议、集合点等：资料里有才写成现状，没有的写成要求（「应…」）或不写。
 * 模板里按 [[if:hasRadio]] 引用。应急广播、工作群、协议、集合点按客户选填的问项（答「有」才算），没答、答不清楚都按没有。
 */
export interface PlanFacts {
  /** 应急物资里有对讲机 */
  hasRadio: boolean;
  /** 应急物资里有扩音器 / 广播器 / 喊话器 */
  hasMegaphone: boolean;
  /** 固定式应急广播系统：客户答了有，或应急物资里写了「广播系统 / 应急广播」 */
  hasPaSystem: boolean;
  /** 应急物资里有消防警铃 / 声光报警器 */
  hasAlarmBell: boolean;
  /** 设备或应急物资里有视频监控 */
  hasCctv: boolean;
  /** 设备或应急物资里有发电机 / UPS / 备用电源 */
  hasBackupPower: boolean;
  /** 自填答了有自有车辆，或应急物资里有应急车辆 */
  hasVehicle: boolean;
  /** 设了应急办公室（自填或专家图件） */
  hasEmergencyOffice: boolean;
  /** 应急微信群 / 工作群：客户答了有 */
  hasImGroup: boolean;
  /** 与相邻企业签订的应急互助协议：客户答了有 */
  hasMutualAid: boolean;
  /** 与医院、消防或专业救援队伍签订的救援协议：客户答了有 */
  hasRescueAgreements: boolean;
  /** 已设定的紧急集合点：客户答了有 */
  hasAssemblyPoint: boolean;
}

const supplyHas = (input: PlanInput, re: RegExp) =>
  input.production.emergencySupplies.some((s) => re.test(s.name) && s.quantity !== 0);

export function planFacts(input: PlanInput): PlanFacts {
  const equipment = input.production.equipment.map((e) => e.name);
  return {
    hasRadio: supplyHas(input, /对讲机/),
    hasMegaphone: supplyHas(input, MEGAPHONE),
    hasPaSystem: input.organization.paSystem === 'yes' || supplyHas(input, /广播系统|应急广播/),
    hasAlarmBell: supplyHas(input, /警铃|声光报警/),
    hasCctv: supplyHas(input, /监控/) || equipment.some((n) => /监控/.test(n)),
    hasBackupPower: supplyHas(input, /发电机|UPS|备用电源/i) || equipment.some((n) => /发电机|UPS/i.test(n)),
    hasVehicle: input.business.ownVehicles === true || supplyHas(input, /车辆|救护车/),
    hasEmergencyOffice: input.organization.hasEmergencyOffice || input.expert.figures?.org?.office === true,
    hasImGroup: input.organization.imGroup === 'yes',
    hasMutualAid: input.location.mutualAid?.answer === 'yes',
    hasRescueAgreements: input.location.rescueAgreement?.answer === 'yes',
    hasAssemblyPoint: input.production.assemblyPoint?.answer === 'yes',
  };
}

const MEGAPHONE = /扩音器|广播器|广播话筒|喊话器|喇叭/;

/** 现场可用的通讯手段，按应急物资带出 */
export function commsMeans(ctx: PlanContext): string[] {
  const f = ctx.facts;
  const megaphone = ctx.input.production.emergencySupplies.find((s) => MEGAPHONE.test(s.name) && s.quantity !== 0);
  return [
    '电话',
    ...(f.hasRadio ? ['对讲机'] : []),
    ...(megaphone ? [megaphone.name.replace(/（.*?）/g, '')] : []),
    ...(f.hasAlarmBell ? ['消防警铃'] : []),
    ...(f.hasPaSystem ? ['应急广播'] : []),
    '现场呼喊',
  ];
}

/**
 * 某类事故专家确认的危险源场所（「、」分隔的多场所拆开去重）；没有的返回空，用模板的通用写法。
 * 「厂内车辆致害」与「厂（场）内车辆致害」、「其他伤害」与「其他」、「淹溺（二）」与「淹溺」算同一类。
 */
export function hazardArea(input: PlanInput, title: string): string {
  const norm = (s: string) => s.replace(/（[^）]*）/g, '').trim().replace(/^其他伤害$/, '其他');
  const type = norm(accidentTypeOf(title));
  const addresses = addressesOf(input);
  const places = (input.expert.hazards ?? [])
    .filter((h) => norm(h.factor) === type)
    .flatMap((h) => {
      const site = addressLabelOf(addresses, h.addressId);
      return h.workplace
        .split(/[、，,；;]/)
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => (site ? `${site}${w}` : w));
    });
  return [...new Set(places)].join('、');
}

/** 一照多址时的各处厂址；只有一处为空 */
export function addressesOf(input: PlanInput): SiteAddressOption[] {
  const main = input.location.siteAddress.detail || input.basic.registeredAddress?.detail;
  return addressOptions(main, input.location.otherAddresses);
}

/** 危险源的作业场所：标了厂址的前面带厂址（「示例三路8号厂房5楼 生产车间」） */
export function hazardPlace(input: PlanInput, h: Pick<Hazard, 'workplace' | 'addressId'>): string {
  const site = addressLabelOf(addressesOf(input), h.addressId);
  return site ? `${site} ${h.workplace}` : h.workplace;
}

/**
 * 签了医疗救援协议：答了有救援协议，且签订对象是医院 / 急救机构（没写对象的按医疗协议）。
 * 只与消防、专业救援队伍签的，医疗仍写成要求
 */
export function medicalAgreement(ctx: Pick<PlanContext, 'facts' | 'rescueParties'>): boolean {
  return ctx.facts.hasRescueAgreements && (!ctx.rescueParties || /医院|卫生院|医疗|急救|诊所/.test(ctx.rescueParties));
}

/**
 * 一照多址时表格最后加一列「厂址」：head / sep 接在表头、分隔行后面，cell 接在每行后面；只有一处地址时都为空，表格照旧
 */
export function siteColumn(ctx: Pick<PlanContext, 'addresses' | 'siteOf'>) {
  const on = ctx.addresses.length > 0;
  return {
    on,
    head: on ? ' 厂址 |' : '',
    sep: on ? ' --- |' : '',
    cell: (id: string | undefined) => (on ? ` ${ctx.siteOf(id) || '—'} |` : ''),
    empty: on ? '  |' : '',
  };
}

export const fill = (s: string | number | undefined | null) => {
  const v = s === undefined || s === null ? '' : String(s).trim();
  return v || MISSING;
};
export const dash = (s: string | number | undefined | null) => {
  const v = s === undefined || s === null ? '' : String(s).trim();
  return v || '—';
};

export function planContext(input: PlanInput): PlanContext {
  const scope = resolveScope(input);
  const hazardous = hazardousMaterialsOf(input);
  const { agencies, organization: org } = input;
  const people = [org.commander, ...org.deputies, ...org.groups.flatMap((g) => [g.leader, ...g.members])].filter(
    (p): p is Person => Boolean(p),
  );
  const addresses = addressesOf(input);
  const groupNames = groupDisplayNames(org.groups, addresses);
  const loc = input.location;
  // 答了在园区但没写管理方名称的，写「园区管理方」
  const parkManager = loc.park?.answer === 'yes' ? loc.park.manager?.trim() || '园区管理方' : undefined;
  const answered = (a: { answer: string; parties?: string } | undefined) => (a?.answer === 'yes' ? a.parties?.trim() ?? '' : '');
  const point = input.production.assemblyPoint;
  return {
    input,
    company: fill(input.basic.companyName),
    scope,
    selection: selectPlans(scope),
    signals: planSignals(input),
    hazardous,
    chemNote: hazardous.length ? `（${hazardous.join('、')}）` : '',
    bureau: fill(agencies.emergencyBureau?.name),
    bureauPhone: agencies.emergencyBureau?.phone,
    street: fill(agencies.streetOffice?.name),
    streetPhone: agencies.streetOffice?.phone,
    fireDept: fill(agencies.fireDept?.name),
    // 正文里的报警电话一律 119；大队值班电话只进联系方式表
    firePhone: '119',
    fireDutyPhone: agencies.fireDept?.phone,
    hospital: input.expert.facts?.hospital?.name || '属地医疗急救机构',
    commander: org.commander,
    commanderName: org.commander ? fill(org.commander.name) : MISSING,
    dutyPhone: fill(org.dutyPhone),
    person: (id) => (id ? people.find((p) => p.id === id) : undefined),
    facts: planFacts(input),
    addresses,
    siteOf: (id) => addressLabelOf(addresses, id),
    groupName: (g) => groupNames[org.groups.indexOf(g)] ?? g.name,
    park: parkManager ? { manager: parkManager, dutyPhone: loc.park?.dutyPhone?.trim() || undefined } : undefined,
    rescueParties: answered(loc.rescueAgreement),
    mutualAidParties: answered(loc.mutualAid),
    assemblyPoint: point?.answer === 'yes' ? point.location?.trim() ?? '' : '',
  };
}

/**
 * 模板与正文按预置组名写（综合保障组…）；企业把某类组改了名（如「后勤保障组」）时换成企业的组名。
 * 同类组有多个（分厂址各设一套）时不换，留预置名。
 */
export function ownGroupNames(md: string, input: PlanInput): string {
  const renames = new Map<string, string>();
  for (const [kind, preset] of Object.entries(PRESET_GROUPS)) {
    const same = input.organization.groups.filter((g) => g.kind === kind);
    if (same.length === 1 && same[0]!.name !== preset) renames.set(preset, same[0]!.name);
  }
  if (!renames.size) return md;
  return md.replace(new RegExp([...renames.keys()].join('|'), 'g'), (m) => renames.get(m)!);
}

/** 名称列表：多于 4 项写「前 4 项等」 */
export function summarize(names: string[], fallback: string): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return fallback;
  return unique.length <= 4 ? unique.join('、') : `${unique.slice(0, 4).join('、')}等`;
}

/** 按顺序挑出每个规则命中的第一项 */
export function pick(names: string[], patterns: RegExp[], fallback: string): string {
  return summarize(
    patterns.map((re) => names.find((n) => re.test(n))).filter((n): n is string => Boolean(n)),
    fallback,
  );
}

export function supplyNames(ctx: PlanContext): string[] {
  return ctx.input.production.emergencySupplies.map((s) => s.name);
}

export function firstAidNames(ctx: PlanContext): string[] {
  const kit = ctx.input.production.firstAidKit;
  return kit?.answer === 'yes' ? kit.items.map((i) => i.name) : [];
}

export const firstAidText = (ctx: PlanContext) =>
  pick(firstAidNames(ctx), [/急救箱/, /AED|自动体外除颤|除颤器/, /纱布|绷带|止血|消毒|碘伏/], '急救药品与基础急救器材');

export const practiceItemsText = (ctx: PlanContext) =>
  pick([...supplyNames(ctx), ...firstAidNames(ctx)], [/灭火器/, /空气呼吸器/, /防化服|隔热服/, /AED|自动体外除颤|除颤器/], '灭火器等应急器材');

export const hasAed = (ctx: PlanContext) => firstAidNames(ctx).some((n) => /AED|自动体外除颤|除颤器/.test(n));

/** 第一栋建筑的名称 */
export const mainBuilding = (ctx: PlanContext) => ctx.input.production.buildings[0]?.name || '生产厂房';

/** 资料里写了存放位置的急救药品 / 器材位置；没有为空 */
export const firstAidLocation = (ctx: PlanContext) =>
  ctx.input.production.emergencySupplies.find((s) => /急救|药箱|药品/.test(s.name) && s.location?.trim())?.location?.trim() ?? '';

/** 安全管理岗位：组织里有职务含「安全」的人就用其职务，没有用「总指挥」 */
export function safetyLead(ctx: PlanContext): string {
  const org = ctx.input.organization;
  const people = [org.commander, ...org.deputies, ...org.groups.flatMap((g) => [g.leader, ...g.members])];
  return people.find((p) => p?.position && /安全/.test(p.position))?.position?.trim() || '总指挥';
}
