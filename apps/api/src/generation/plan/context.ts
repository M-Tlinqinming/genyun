// 生成应急预案时各章共用的企业数据：一次算好，各章直接取。
// 缺的必填内容写「（待补充）」，交专家核对时补；可不填的写「—」。
import {
  accidentTypeOf,
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
  hospital: string;
  commander?: Person;
  /** 总指挥姓名，正文写成「总指挥（李文聪）」 */
  commanderName: string;
  dutyPhone: string;
  /** 按 id 找人（物资保管人） */
  person: (id: string | undefined) => Person | undefined;
  /** 资料里有依据才能写成现状的设施与安排 */
  facts: PlanFacts;
}

/**
 * 通讯设施、车辆、备用电源、协议、集合点等：资料里有才写成现状，没有的写成要求（「应…」）或不写。
 * 模板里按 [[if:hasRadio]] 引用。资料清单还没有问项的（即时通讯群、互助协议、救援协议、集合点）先恒为 false，
 * 资料加了问项后在这里接上。
 */
export interface PlanFacts {
  /** 应急物资里有对讲机 */
  hasRadio: boolean;
  /** 应急物资里有扩音器 / 广播器 / 喊话器 */
  hasMegaphone: boolean;
  /** 固定式应急广播系统：应急物资里写了「广播系统 / 应急广播」 */
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
  /** 资料无问项：应急指挥部即时通讯群（企业微信等） */
  hasImGroup: boolean;
  /** 资料无问项：与邻企签订的互助协议 */
  hasMutualAid: boolean;
  /** 资料无问项：与消防、医院签订的应急救援 / 医疗协议 */
  hasRescueAgreements: boolean;
  /** 资料无问项：已设定的紧急集合点 */
  hasAssemblyPoint: boolean;
}

const supplyHas = (input: PlanInput, re: RegExp) =>
  input.production.emergencySupplies.some((s) => re.test(s.name) && s.quantity !== 0);

export function planFacts(input: PlanInput): PlanFacts {
  const equipment = input.production.equipment.map((e) => e.name);
  return {
    hasRadio: supplyHas(input, /对讲机/),
    hasMegaphone: supplyHas(input, MEGAPHONE),
    hasPaSystem: supplyHas(input, /广播系统|应急广播/),
    hasAlarmBell: supplyHas(input, /警铃|声光报警/),
    hasCctv: supplyHas(input, /监控/) || equipment.some((n) => /监控/.test(n)),
    hasBackupPower: supplyHas(input, /发电机|UPS|备用电源/i) || equipment.some((n) => /发电机|UPS/i.test(n)),
    hasVehicle: input.business.ownVehicles === true || supplyHas(input, /车辆|救护车/),
    hasEmergencyOffice: input.organization.hasEmergencyOffice || input.expert.figures?.org?.office === true,
    hasImGroup: false,
    hasMutualAid: false,
    hasRescueAgreements: false,
    hasAssemblyPoint: false,
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
 * 「厂内车辆致害」与「厂（场）内车辆致害」、「淹溺（二）」与「淹溺」算同一类。
 */
export function hazardArea(input: PlanInput, title: string): string {
  const norm = (s: string) => s.replace(/（[^）]*）/g, '').trim();
  const type = norm(accidentTypeOf(title));
  const places = (input.expert.hazards ?? [])
    .filter((h) => norm(h.factor) === type)
    .flatMap((h) => h.workplace.split(/[、，,；;]/))
    .map((w) => w.trim())
    .filter(Boolean);
  return [...new Set(places)].join('、');
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
    hospital: input.expert.facts?.hospital?.name || '属地医疗急救机构',
    commander: org.commander,
    commanderName: org.commander ? fill(org.commander.name) : MISSING,
    dutyPhone: fill(org.dutyPhone),
    person: (id) => (id ? people.find((p) => p.id === id) : undefined),
    facts: planFacts(input),
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
