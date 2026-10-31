// 专家编辑页「帮我改写这段」（M2 第 11 项，TECH-PLAN 4.1 大模型使用规划第 ③ 处）。
// 只发这一段、预案名、所在章节和企业的场所 / 设备 / 物料；企业名称、人名、电话发送前换成占位，回来后还原。
// AI 写的要过系统检查（占位不少、不新增数字、不编设备物料、篇幅相当），不通过或服务出错都用原文，并告诉专家原因。
import type { RewriteResult } from '@genyun/shared';
import type { ParagraphPolisher, PolishRequest } from './drafter.ts';
import { TERMS } from './risk.ts';

export interface PolishContext {
  plan: string;
  section: string;
  companyName: string;
  /** 资料里的人名（总指挥、小组成员等），发送前遮掉 */
  people: string[];
  facts: PolishRequest['facts'];
}

const PHONE = /1\d{10}|0\d{2,3}-?\d{7,8}|\d{3,4}-\d{7,8}/g;

function mask(text: string, ctx: PolishContext): { masked: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  let masked = text;
  const put = (value: string, token: string) => {
    if (!value || !masked.includes(value)) return;
    masked = masked.split(value).join(token);
    tokens.set(token, value);
  };
  put(ctx.companyName, '〔企业〕');
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

function problemOf(original: string, value: string, maskedOriginal: string, tokens: Map<string, string>, facts: PolishRequest['facts']): string | null {
  const v = value.trim();
  if (!v) return '内容为空';
  for (const token of tokens.keys()) {
    if (maskedOriginal.split(token).length !== v.split(token).length) return '改动了人名、电话或企业名称';
  }
  if (/〔[^〕]*〕/.test(v.replace(/〔(企业|人员\d+|电话\d+)〕/g, ''))) return '多出了不认识的占位';
  const plain = v.replace(/〔(企业|人员\d+|电话\d+)〕/g, '');
  if (v.length < maskedOriginal.length * 0.5 || v.length > Math.max(maskedOriginal.length * 1.6, maskedOriginal.length + 60)) return '篇幅与原文相差太大';
  if (/\d{5,}/.test(plain)) return '写了电话或长串数字';
  if (/有限公司|有限责任公司/.test(plain)) return '写了企业名称';
  const numbers = (plain.match(/\d+(?:\.\d+)?/g) ?? []).filter((x) => !original.includes(x));
  if (numbers.length) return `写了原文里没有的数字「${numbers[0]}」`;
  const known = [original, ...facts.sites, ...facts.processes, ...facts.equipment, ...facts.materials].join('\n');
  const invented = TERMS.find((t) => plain.includes(t) && !known.includes(t));
  if (invented) return `写了原文和企业资料里没有的「${invented}」`;
  return null;
}

export async function polishParagraph(drafter: ParagraphPolisher | null, ctx: PolishContext, text: string): Promise<RewriteResult> {
  if (!drafter) return { text, source: 'system', note: 'AI 改写没有开启，保留原文' };
  const { masked, tokens } = mask(text, ctx);
  let answer: string;
  try {
    answer = await drafter.polish({ plan: ctx.plan, section: ctx.section, text: masked, facts: ctx.facts });
  } catch (err) {
    console.error('AI 改写一段失败', err);
    return { text, source: 'system', note: 'AI 服务出错，保留原文；可以稍后再试' };
  }
  const problem = problemOf(text, answer, masked, tokens, ctx.facts);
  if (problem) return { text, source: 'system', note: `AI 写的${problem}，没有通过系统检查，保留原文` };
  let restored = answer.trim();
  for (const [token, value] of tokens) restored = restored.split(token).join(value);
  if (restored === text) return { text, source: 'system', note: 'AI 认为原文已经通顺，没有改动' };
  return { text: restored, source: 'ai', note: 'AI 只改了措辞，已核对没有新增数字、设备和物料，人名电话未动' };
}
