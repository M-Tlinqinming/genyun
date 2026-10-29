// AI 起草的提示词，集中放在这里并带版本号；改提示词要升版本，并用飞宇和两家企业案例重跑样例对比。
// 生成记录里写下用的是哪个版本，专家和以后排查都能对上。
import type { RiskRequest, SlotRequest } from './drafter.ts';

export const PROMPT_VERSION = 'slot-v1+risk-v1';

export const SLOT_SYSTEM = [
  '你是注册安全工程师的起草助手，为企业生产安全事故应急预案的一个空位写一个名词短语。',
  '硬性要求：',
  '1. 只能使用「候选」里给出的词语，可以挑选、调整顺序，用顿号「、」分隔；不得改写、扩写、添加任何候选以外的设备、物料、数字或地点。',
  '2. 不得与「安全要点句」抵触。',
  '3. 只输出这个名词短语本身，不要解释、不要标点结尾、不要引号。',
].join('\n');

export function slotUserPrompt(req: SlotRequest): string {
  return [
    `预案：${req.plan}`,
    `空位要求：${req.contract || '（无）'}`,
    `候选：${req.candidates.join('、')}`,
    `安全要点句（不得抵触）：\n${req.anchors.map((a) => `- ${a}`).join('\n') || '（无）'}`,
    '请输出填入空位的名词短语：',
  ].join('\n');
}

// 风险描述改写（risk-v1，Martin 10-29 定放宽到「事故风险描述」段）：按企业实际的场所、设备、物料改写系统原文，
// 一个方案一次请求，逐段对应返回；电话、人员、处置程序和安全要点句不在这里，AI 碰不到。
export const RISK_SYSTEM = [
  '你是注册安全工程师的起草助手，把企业生产安全事故现场处置方案「事故风险描述」里的几段通用写法，改写成贴合这家企业的写法。',
  '硬性要求：',
  '1. 逐段改写，段数与原文相同，每段一行，按原顺序输出；每段开头的「（1）事故类型：」这类序号和标签原样保留。',
  '2. 只能使用「企业资料」里给出的场所、工序、设备、物料名称；企业资料里没有的设备、物料、场所，一律不得写进去。没有合适的就保留原文的通用说法。',
  '3. 只写与本类事故确实相关的场所、设备、物料，每段最多举 3 个，不要把企业资料整串罗列；与本类事故无关的段落保持原文。',
  '4. 不得写任何电话、人员姓名、企业名称，不得新增数字；不得改变事故类型，不得削弱原文的危险性描述。',
  '5. 篇幅与原文相当，只输出改写后的各段，不要解释、不要加其他标记。',
].join('\n');

export function riskUserPrompt(req: RiskRequest): string {
  const list = (xs: string[]) => xs.join('、') || '（无）';
  return [
    `预案：${req.plan}`,
    '企业资料：',
    `- 场所：${list(req.facts.sites)}`,
    `- 工序：${list(req.facts.processes)}`,
    `- 设备：${list(req.facts.equipment)}`,
    `- 物料：${list(req.facts.materials)}`,
    `原文（共 ${req.paragraphs.length} 段）：`,
    ...req.paragraphs,
    `请输出改写后的 ${req.paragraphs.length} 段，每段一行：`,
  ].join('\n');
}
