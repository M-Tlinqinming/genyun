// AI 按企业改写现场处置方案「事故风险描述」各段（Martin 10-29 定放宽到这一段）。
// 只给 AI 系统原文和企业的场所、工序、设备、物料名称；逐段校验，不过的段落用系统原文，并记下给专家看。
// 电话、人员、处置程序、安全要点句不在这一段，AI 碰不到。
import type { PlanInput } from '@genyun/shared';
import { riskParagraphs, type RiskRewrites } from '../plan/assemble.ts';
import type { RiskRequest, SlotDrafter } from './drafter.ts';
import type { SlotNote } from './slots.ts';

/** 常见的设备、物料、场所说法：AI 写出来的这些词必须在原文或企业资料里出现过，否则就是编的 */
const TERMS = [
  '行车', '行吊', '电动葫芦', '起重机', '塔吊', '门式起重机', '电梯', '升降机', '叉车', '电瓶车', '货车', '铲车',
  '锅炉', '蒸汽', '空压机', '储气罐', '气瓶', '反应釜', '压力容器', '压力管道', '冷却塔',
  '压铸机', '熔炉', '熔炼炉', '保温炉', '浇注', '铝液', '锌液', '钢水', '铁水', '熔融金属',
  '冲床', '注塑机', '车床', '铣床', '钻床', 'CNC', '剪板机', '折弯机', '焊机', '烘箱', '喷砂', '抛光', '打磨', '除尘器',
  '天然气', '液化气', '液化石油气', '乙炔', '氢气', '氧气', '氮气', '氩气', '二氧化碳', '一氧化碳', '甲烷',
  '酒精', '乙醇', '天那水', '汽油', '柴油', '油漆', '油墨', '稀释剂', '环氧乙烷', '盐酸', '硫酸', '硝酸', '氢氧化钠', '液压油',
  '污水池', '消防水池', '化粪池', '地下室', '危化仓', '配电房', '发电机房', '食堂', '宿舍',
];

export function riskFacts(input: PlanInput): RiskRequest['facts'] {
  const p = input.production;
  const names = (xs: { name: string }[]) => [...new Set(xs.map((x) => x.name.trim()).filter(Boolean))];
  return {
    sites: names(p.buildings),
    processes: names(p.processFlow.steps),
    equipment: names(p.equipment),
    materials: names(p.materials),
  };
}

/** 一段改写是否可用；不可用时返回原因 */
export function checkRiskParagraph(original: string, value: string, facts: RiskRequest['facts']): string | null {
  const v = value.trim();
  if (!v) return '内容为空';
  const label = /^（\d+）[^：]{1,20}：/.exec(original)?.[0];
  if (label && !v.startsWith(label)) return `没有保留「${label}」开头`;
  if (v.length < original.length * 0.5 || v.length > Math.max(original.length * 2, original.length + 120)) return '篇幅与原文相差太大';
  if (/\d{5,}|\d{3,4}-\d{7,8}/.test(v)) return '写了电话或长串数字';
  if (/有限公司|有限责任公司/.test(v)) return '写了企业名称';
  const known = [original, ...facts.sites, ...facts.processes, ...facts.equipment, ...facts.materials].join('\n');
  const numbers = (v.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !known.includes(n));
  if (numbers.length) return `写了原文和企业资料里没有的数字「${numbers[0]}」`;
  const invented = TERMS.find((t) => v.includes(t) && !known.includes(t));
  if (invented) return `写了企业资料里没有的「${invented}」`;
  return null;
}

/** 段落的业务名称，如「事故风险描述（2）事故区域」 */
function paragraphLabel(p: string, i: number): string {
  const m = /^（(\d+)）([^：]{1,20})：/.exec(p);
  return m ? `事故风险描述（${m[1]}）${m[2]}` : `事故风险描述第 ${i + 1} 段`;
}

export async function draftRisks(input: PlanInput, drafter: SlotDrafter | null): Promise<{ rewrites: RiskRewrites; notes: SlotNote[] }> {
  const rewrites: RiskRewrites = {};
  const notes: SlotNote[] = [];
  if (!drafter) return { rewrites, notes };
  const facts = riskFacts(input);
  const plans = riskParagraphs(input);
  // 各方案同时请求，结果按方案顺序记录
  const answers = await Promise.allSettled(plans.map((p) => drafter.rewrite({ plan: p.title, paragraphs: p.paragraphs, facts })));
  plans.forEach(({ id, title, paragraphs }, k) => {
    const answer = answers[k]!;
    const out = answer.status === 'fulfilled' ? answer.value : null;
    let failure = '';
    if (answer.status === 'rejected') {
      const e: unknown = answer.reason;
      failure = `AI 服务出错：${e instanceof Error ? e.message : String(e)}`;
    } else if (out!.length !== paragraphs.length) failure = `AI 返回的段数（${out!.length}）与原文（${paragraphs.length}）不符`;
    paragraphs.forEach((original, i) => {
      const label = paragraphLabel(original, i);
      const slot = `risk-${i + 1}`;
      const problem = failure || checkRiskParagraph(original, out![i]!, facts);
      if (problem) {
        notes.push({ plan: title, slot, label, source: 'system', note: `${problem}，改用系统原文` });
      } else if (out![i]!.trim() === original) {
        notes.push({ plan: title, slot, label, source: 'system', note: 'AI 认为系统原文已贴合企业，未改动' });
      } else {
        (rewrites[id] ??= {})[original] = out![i]!.trim();
        notes.push({ plan: title, slot, label, source: 'ai', note: 'AI 按企业的场所、设备、物料改写，已核对没有编造' });
      }
    });
  });
  return { rewrites, notes };
}
