// 是否危化品的系统建议：按《危险化学品目录（2015 版）》查 CAS 号、品名、别名（实施指南第二条：CAS 号相同即为同一危险化学品），
// 名称里写了成分的按成分判；目录查不到的混合物（天那水、洗板水这类商品名）按目录第 2828 号的闪点规则提示，
// 再查不到的沿用名称关键词兜底。都只是建议，危化品由专家在「生产设备与物料」里确认。
import { isGeneralMaterial } from '../profile/production-step.ts';
import { HAZCHEM_ROWS } from './hazchem-data.ts';

export interface HazchemEntry {
  /** 目录序号 */
  no: number;
  name: string;
  aliases: string[];
  cas: string[];
  /** 危险性类别，如「易燃液体2」「加压气体」 */
  classes: string[];
  /** 备注栏标「剧毒」 */
  toxic: boolean;
  /** 同一序号下列出的其他品名（如第 2828 号下的各类涂料、油墨） */
  variants: string[];
}

/** 适用范围用到的几类 */
export type HazchemKind = 'flammableLiquid' | 'flammableGas' | 'inertGas' | 'oxidizer' | 'toxic' | 'corrosive';

const split = (s: string | undefined) => (s ? s.split('；').filter(Boolean) : []);

let entries: HazchemEntry[] | undefined;
let byCas: Map<string, HazchemEntry> | undefined;
let byTerm: Map<string, HazchemEntry> | undefined;
// 包含匹配用的词，长的在前
let terms: string[] | undefined;

// 品名后的方括号是限定（「氮[压缩的或液化的]」「乙醇[无水]」），去掉后也能查
const baseName = (name: string) => name.replace(/\[[^\]]*\]/g, '').trim();

// 日常叫法 → 目录序号：只收目录里查不到、又常见的叫法
const COMMON_NAMES: Record<string, number> = {
  酒精: 2568,
  工业酒精: 2568,
  无水酒精: 2568,
  液化气: 2548,
  天然气: 2123,
  冰醋酸: 2630,
  双氧水: 903,
  过氧化氢: 903,
  二甲苯: 358,
};

function load() {
  if (entries) return;
  entries = HAZCHEM_ROWS.map(([no, name, alias, cas, classes, toxic, variants]) => ({
    no,
    name,
    aliases: split(alias),
    cas: split(cas),
    classes: split(classes),
    toxic: toxic === 1,
    variants: split(variants),
  }));
  byCas = new Map();
  byTerm = new Map();
  const add = (term: string, e: HazchemEntry) => {
    const t = term.replace(/\s+/g, '');
    if (t && !byTerm!.has(t)) byTerm!.set(t, e);
  };
  for (const e of entries) {
    for (const c of e.cas) if (!byCas.has(c)) byCas.set(c, e);
    add(e.name, e);
    add(baseName(e.name), e);
    for (const a of e.aliases) add(a, e), add(baseName(a), e);
    for (const v of e.variants) add(v, e), add(baseName(v), e);
  }
  for (const [term, no] of Object.entries(COMMON_NAMES)) add(term, entries[no - 1]!);
  // 单字（钠、氧、苯…）只做整名匹配，不做包含匹配，免得「锂离子电池」算成锂
  terms = [...byTerm.keys()].filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
}

/** 按目录序号取条目 */
export function hazchemEntry(no: number): HazchemEntry | undefined {
  load();
  return entries![no - 1];
}

/** 目录总条数（2015 版 2828 条） */
export function hazchemCount(): number {
  return HAZCHEM_ROWS.length;
}

const normCas = (s: string) => s.replace(/[－—–‐]/g, '-').replace(/\s+/g, '');

export function hazchemByCas(cas: string | undefined): HazchemEntry | undefined {
  if (!cas) return undefined;
  load();
  for (const c of cas.split(/[;；,，、/\s]+/)) {
    const e = byCas!.get(normCas(c));
    if (e) return e;
  }
  return undefined;
}

// 整名查：原名、去括号说明、「X 气」「液 X」（氮气、液氩 → 氮、氩）
function exactOf(name: string): { entry: HazchemEntry; term: string } | undefined {
  load();
  const n = name.replace(/\s+/g, '');
  const bare = n.replace(/[（(][^）)]*[）)]/g, '');
  const forms = [n, bare];
  for (const f of [n, bare]) {
    if (f.length >= 2 && f.endsWith('气')) forms.push(f.slice(0, -1));
    if (f.length >= 2 && f.startsWith('液')) forms.push(f.slice(1), f.slice(1).replace(/气$/, ''));
  }
  for (const f of forms) {
    const e = byTerm!.get(f);
    if (e) return { entry: e, term: f };
  }
  return undefined;
}

// 包含匹配时，命中词前后紧跟这些字说明是另一种物质（乙醇胺、硫酸铜、二甲苯、聚苯乙烯…）
const COMPOUND_NEXT = /^[胺酸酯醚醛酮钠钾钙镁铜铁锌铝亚盐基烯酚腈铵]/;
const COMPOUND_PREV = /[一二三四五六七八九邻间对异正叔仲氯溴碘氟硝氨羟甲乙丙丁戊己环苯聚\d,-]$/;
// 所在的词以「聚」开头的是聚合物
const inPolymer = (n: string, i: number) => /聚[^（(、，,；;\s]*$/.test(n.slice(0, i));
export const isOtherCompound = (n: string, i: number, len: number) =>
  COMPOUND_PREV.test(n.slice(0, i)) || COMPOUND_NEXT.test(n.slice(i + len)) || inPolymer(n, i);

interface Contained {
  entry: HazchemEntry;
  term: string;
  // 括号里或「含」之后写的是成分
  component: boolean;
}

// 名称里出现的目录品名，长词优先、互不重叠，按出现顺序
function containedOf(name: string): Contained[] {
  load();
  const n = name.replace(/\s+/g, '');
  const taken: [number, number][] = [];
  const found: (Contained & { at: number })[] = [];
  for (const t of terms!) {
    let from = 0;
    while (true) {
      const i = n.indexOf(t, from);
      if (i < 0) break;
      from = i + 1;
      if (taken.some(([a, b]) => i < b && i + t.length > a)) continue;
      if (isOtherCompound(n, i, t.length)) continue;
      taken.push([i, i + t.length]);
      const before = n.slice(0, i);
      found.push({ entry: byTerm!.get(t)!, term: t, component: /[（(][^）)]*$/.test(before) || /含[^，,；;]*$/.test(before), at: i });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

// 目录按形态区分的（铝粉、锌粉）：块状、锭料与目录不是同一种
const POWDER = /粉|尘/;
const formMismatch = (e: HazchemEntry, name: string) => POWDER.test(baseName(e.name)) && !POWDER.test(name);

export function hazchemKindsOf(e: HazchemEntry): HazchemKind[] {
  const has = (re: RegExp) => e.classes.some((c) => re.test(c));
  const kinds: HazchemKind[] = [];
  if (has(/^易燃液体/)) kinds.push('flammableLiquid');
  if (has(/^易燃气体/)) kinds.push('flammableGas');
  if (has(/^氧化性/)) kinds.push('oxidizer');
  // 加压气体里不燃、不助燃的（氮、氩、二氧化碳、氦），泄漏积聚致窒息
  if (has(/^加压气体/) && !kinds.includes('flammableGas') && !kinds.includes('oxidizer') && !has(/^急性毒性/)) kinds.push('inertGas');
  // 中毒按急性毒性与剧毒算；致癌、慢性毒性不在应急处置范围里
  if (e.toxic || has(/^急性毒性/)) kinds.push('toxic');
  if (has(/^皮肤腐蚀\/刺激1/)) kinds.push('corrosive');
  return kinds;
}

const KIND_LABEL: Record<HazchemKind, string> = {
  flammableLiquid: '易燃液体',
  flammableGas: '易燃气体',
  inertGas: '加压气体',
  oxidizer: '氧化性物质',
  toxic: '急性毒性',
  corrosive: '腐蚀品',
};

/** 「易燃液体」「易燃气体、急性毒性」：给专家看的危险性 */
export function hazchemLabel(e: HazchemEntry): string {
  const kinds = hazchemKindsOf(e);
  const label = kinds.map((k) => (k === 'toxic' && e.toxic ? '剧毒' : KIND_LABEL[k])).join('、');
  if (label) return label;
  // 其余写目录里的前两项类别，如「皮肤腐蚀/刺激 类别 2、严重眼损伤/眼刺激 类别 2」
  const listed = e.classes.filter((c) => !/^[（(]/.test(c)).slice(0, 2);
  return listed.map((c) => c.replace(/([\d.]+[A-Z]?\*?|[A-G]型?)$/, ' 类别 $1').replace(/\*$/, '')).join('、') || '危险化学品';
}

// 目录查不到的混合物：商品名多为含易燃溶剂的制品，按第 2828 号「闭杯闪点≤60℃」判
const MIXTURE_CUES = ['天那水', '香蕉水', '开油水', '洗枪水', '洗网水', '洗板水', '白电油', '稀释剂', '油漆', '油墨', '涂料', '助焊剂'];
const WATER_BASED = /水基|水性/;

// 目录查不到时的名称兜底（第一版的名单）：可燃液体来自知识库「产生可燃液体蒸气化学品」，腐蚀品来自「化学品灼烫分类」
const FALLBACK_GROUPS: { kind: string; kinds: HazchemKind[]; names: string[] }[] = [
  { kind: '易燃液体', kinds: ['flammableLiquid'], names: ['汽油', '柴油', '煤油', '甲醇', '乙醇', '酒精', '丁醇', '乙醚', '二甲苯', '甲苯', '丙酮', '环己烷'] },
  { kind: '易燃气体', kinds: ['flammableGas'], names: ['液化石油气', '液化气', '天然气', '氢气', '乙炔', '甲烷', '丙烷', '丁烷'] },
  { kind: '腐蚀品', kinds: ['corrosive'], names: ['硫酸', '盐酸', '硝酸', '氢氟酸', '磷酸', '醋酸', '氢氧化钠', '烧碱', '氢氧化钾', '氨水'] },
  { kind: '有毒品', kinds: ['toxic'], names: ['苯酚', '甲醛', '氰', '硫化氢', '氯气', '液氨', '光气', '二氧化硫', '丙烯腈'] },
];
const FALLBACK_NEG = ['乙醇胺', '聚苯', '苯板'];

export interface HazchemSuggestion {
  value: boolean;
  /** 给专家看的依据，业务语言 */
  reason: string;
  /** 目录里的条目（查到时） */
  entry?: HazchemEntry;
  kinds: HazchemKind[];
}

// 第 2828 号是按闪点判定的一类制品，不是一种物质
const FLASH_POINT_NO = 2828;
const mixtureOf = (what: string): HazchemSuggestion => ({
  value: true,
  reason: `「${what}」一般是含易燃溶剂的混合物，目录第 ${FLASH_POINT_NO} 号规定闭杯闪点≤60℃ 的属于危化品，建议判定为危化品，请按 MSDS 的闪点和成分确认`,
  entry: hazchemEntry(FLASH_POINT_NO),
  kinds: ['flammableLiquid'],
});

const fromCatalog = (e: HazchemEntry, why: string, term: string): HazchemSuggestion =>
  e.no === FLASH_POINT_NO
    ? mixtureOf(term)
    : {
        value: true,
        reason: `${why}，列在《危险化学品目录》第 ${e.no} 号（${hazchemLabel(e)}），建议判定为危化品`,
        entry: e,
        kinds: hazchemKindsOf(e),
      };

/** 一种物料的系统建议；名单内的一般原料直接判不是，查不到也不像危化品的返回 undefined（请专家对照标签或 MSDS） */
export function hazchemSuggestionOf(m: { name: string; casNumber?: string }): HazchemSuggestion | undefined {
  const name = m.name.trim();
  if (!name) return undefined;
  const cas = hazchemByCas(m.casNumber);
  if (cas && formMismatch(cas, name)) {
    // 铝锭、锌锭的 CAS 号与铝粉、锌尘相同，目录只收粉状
    return { value: false, reason: `CAS 号与目录第 ${cas.no} 号${baseName(cas.name)}相同，但目录只收粉状，块料、锭料不是危化品；如是粉料请改判`, kinds: [] };
  }
  if (cas) {
    const same = exactOf(name)?.entry === cas;
    return fromCatalog(cas, same ? `CAS 号 ${m.casNumber!.trim()}` : `CAS 号 ${m.casNumber!.trim()} 为${baseName(cas.name)}`, name);
  }
  const exact = exactOf(name);
  if (exact && !formMismatch(exact.entry, name)) {
    const e = exact.entry;
    return fromCatalog(e, exact.term === baseName(e.name) || exact.term === e.name ? '品名在目录里' : `即${baseName(e.name)}`, exact.term);
  }
  const mixture = MIXTURE_CUES.find((c) => name.includes(c));
  const inside = containedOf(name).filter((x) => !formMismatch(x.entry, name) && x.entry.no !== FLASH_POINT_NO);
  const parts = inside.filter((x) => x.component);
  if (parts.length) {
    // 混合物按写明的成分判：成分里有一种在目录里就建议判为危化品，危险性取各成分之和
    const entries = [...new Set(parts.map((x) => x.entry))];
    const kinds = [...new Set(entries.flatMap(hazchemKindsOf))];
    const what = entries.map((e) => baseName(e.name)).join('、');
    return {
      value: true,
      reason: `成分含${what}，列在《危险化学品目录》第 ${entries.map((e) => e.no).join('、')} 号（${entries.map(hazchemLabel).join('；')}），建议判定为危化品，请按 MSDS 的成分含量确认`,
      entry: entries[0],
      kinds,
    };
  }
  if (inside[0] && !mixture) return fromCatalog(inside[0].entry, `名称含「${inside[0].term}」`, inside[0].term);
  if (mixture && !WATER_BASED.test(name)) return mixtureOf(mixture);
  if (!FALLBACK_NEG.some((x) => name.includes(x))) {
    for (const g of FALLBACK_GROUPS) {
      const hit = g.names.find((x) => {
        const i = name.indexOf(x);
        return i >= 0 && !isOtherCompound(name, i, x.length);
      });
      if (hit) return { value: true, reason: `名称含「${hit}」，属于${g.kind}，建议判定为危化品，请对照 MSDS 确认`, kinds: g.kinds };
    }
  }
  if (isGeneralMaterial(name)) return { value: false, reason: '一般原料，不是危化品', kinds: [] };
  return undefined;
}
