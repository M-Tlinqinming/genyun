// 生成应急预案时各章共用的企业数据：一次算好，各章直接取。
// 缺的必填内容写「（待补充）」，交专家核对时补；可不填的写「—」。
import {
  hazardousMaterialsOf,
  planSignals,
  resolveScope,
  selectPlans,
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
  /** 「李文聪（总指挥）」 */
  commanderLabel: string;
  dutyPhone: string;
  /** 按 id 找人（物资保管人） */
  person: (id: string | undefined) => Person | undefined;
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
    commanderLabel: org.commander ? `${fill(org.commander.name)}（总指挥）` : MISSING,
    dutyPhone: fill(org.dutyPhone),
    person: (id) => (id ? people.find((p) => p.id === id) : undefined),
  };
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

/** 第一栋建筑的名称，写应急器材柜、集结点等位置用 */
export const mainBuilding = (ctx: PlanContext) => ctx.input.production.buildings[0]?.name || '生产厂房';
