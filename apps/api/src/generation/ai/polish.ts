// 专家编辑页「帮我改写这段」（M2 第 11 项，TECH-PLAN 4.1 大模型使用规划第 ③ 处）。
// 只发这一段、预案名、所在章节和企业的场所 / 设备 / 物料；企业名称、人名、电话发送前换成占位，回来后还原。
// AI 写的要过系统检查（占位不少、原文数字不丢不新增、强制性措辞不减少、不编设备物料、篇幅相当），
// 不通过或服务出错都用原文，并告诉专家原因。
import type { RewriteResult } from '@genyun/shared';
import type { ParagraphPolisher, PolishRequest } from './drafter.ts';
import { POLISH_PROMPT_VERSION } from './prompts.ts';
import { TERMS } from './risk.ts';

export interface PolishContext {
  plan: string;
  section: string;
  companyName: string;
  /** 企业简称，同样遮掉 */
  shortName?: string;
  /** 资料里的人名（法定代表人、联系人、总指挥、小组成员等），发送前遮掉 */
  people: string[];
  facts: PolishRequest['facts'];
}

// 手机（可带空格、短横线分段）、400 / 800 客服电话（10 位，可分段）、带区号的座机（区号可加括号）、不带区号的座机「xxxx-xxxx」
const PHONE =
  /(?<!\d)(?:1\d{2}[ -]?\d{4}[ -]?\d{4}|[48]00[ -]?\d{3}[ -]?\d{4}|[（(]?0\d{2,3}[）)]?[ -]?\d{7,8}|\d{3,4}-\d{7,8}|\d{4}-\d{4})(?!\d)/g;

// 强制性措辞：改写后每个词出现的次数不能比原文少
const MANDATORY = ['立即', '严禁', '必须', '不得', '禁止', '应当', '务必'];

const TOKEN = /〔(企业|简称|人员\d+|电话\d+)〕/g;
// 完整的数字串（含小数），按整串比，不按单个数字字符比
const numbersOf = (text: string): string[] => text.replace(TOKEN, '').match(/\d+(?:\.\d+)?/g) ?? [];
const countOf = (text: string, word: string) => text.split(word).length - 1;
const timesIn = (list: string[], x: string) => list.filter((y) => y === x).length;

function mask(text: string, ctx: PolishContext): { masked: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  let masked = text;
  const put = (value: string, token: string) => {
    if (!value || !masked.includes(value)) return;
    masked = masked.split(value).join(token);
    tokens.set(token, value);
  };
  put(ctx.companyName, '〔企业〕');
  if (ctx.shortName && ctx.shortName.trim().length >= 2) put(ctx.shortName.trim(), '〔简称〕');
  // 长的名字先换，免得「陈志刚」被「陈志」拆开
  [...new Set(ctx.people.filter((p) => p.trim().length >= 2))]
    .sort((a, b) => b.length - a.length)
    .forEach((name, i) => put(name, `〔人员${i + 1}〕`));
  let n = 0;
  masked = masked.replace(PHONE, (m) => {
    const token = `〔电话${++n}〕`;
    tokens.set(token, m);
    return token;
  });
  return { masked, tokens };
}

function problemOf(value: string, maskedOriginal: string, tokens: Map<string, string>, facts: PolishRequest['facts']): string | null {
  const v = value.trim();
  if (!v) return '内容为空';
  for (const token of tokens.keys()) {
    if (maskedOriginal.split(token).length !== v.split(token).length) return '改动了人名、电话或企业名称';
  }
  if (/〔[^〕]*〕/.test(v.replace(TOKEN, ''))) return '多出了不认识的占位';
  const plain = v.replace(TOKEN, '');
  if (v.length < maskedOriginal.length * 0.5 || v.length > Math.max(maskedOriginal.length * 1.6, maskedOriginal.length + 60)) return '篇幅与原文相差太大';
  // 原文里有的长数字（如国标编号 GB/T 29639-2020 里的 29639）照常保留，只拒绝原文里没有的
  const long = (plain.match(/\d{5,}/g) ?? []).find((x) => !maskedOriginal.replace(TOKEN, '').includes(x));
  if (long) return `写了原文里没有的电话或长串数字「${long}」`;
  if (/有限公司|有限责任公司/.test(plain)) return '写了企业名称';
  const before = numbersOf(maskedOriginal);
  const after = numbersOf(v);
  const added = after.find((x) => !before.includes(x));
  if (added) return `写了原文里没有的数字「${added}」`;
  const lost = before.find((x) => timesIn(after, x) < timesIn(before, x));
  if (lost) return `漏了原文里的数字「${lost}」`;
  const weakened = MANDATORY.find((w) => countOf(v, w) < countOf(maskedOriginal, w));
  if (weakened) return `少了原文里的「${weakened}」`;
  const known = [maskedOriginal, ...facts.sites, ...facts.processes, ...facts.equipment, ...facts.materials].join('\n');
  const invented = TERMS.find((t) => plain.includes(t) && !known.includes(t));
  if (invented) return `写了原文和企业资料里没有的「${invented}」`;
  return null;
}

export async function polishParagraph(drafter: ParagraphPolisher | null, ctx: PolishContext, text: string): Promise<RewriteResult> {
  if (!drafter) return { text, source: 'system', note: 'AI 改写没有开启，保留原文', promptVersion: null };
  const { masked, tokens } = mask(text, ctx);
  let answer: string;
  try {
    answer = await drafter.polish({ plan: ctx.plan, section: ctx.section, text: masked, facts: ctx.facts });
  } catch (err) {
    console.error('AI 改写一段失败', err);
    return { text, source: 'system', note: 'AI 服务出错，保留原文；可以稍后再试', promptVersion: POLISH_PROMPT_VERSION };
  }
  const problem = problemOf(answer, masked, tokens, ctx.facts);
  if (problem) return { text, source: 'system', note: `AI 改写没有通过系统检查（${problem}），保留原文`, promptVersion: POLISH_PROMPT_VERSION };
  let restored = answer.trim();
  for (const [token, value] of tokens) restored = restored.split(token).join(value);
  if (restored === text) return { text, source: 'system', note: 'AI 认为原文已经通顺，没有改动', promptVersion: POLISH_PROMPT_VERSION };
  return {
    text: restored,
    source: 'ai',
    note: 'AI 只改了措辞；系统已核对数字和「立即、严禁、必须」等强制性措辞没有变少，企业名称、人名、电话原样保留，没有新增常见设备物料名称',
    promptVersion: POLISH_PROMPT_VERSION,
  };
}
