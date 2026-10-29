// AI 起草的提示词，集中放在这里并带版本号；改提示词要升版本，并用飞宇和两家企业案例重跑样例对比。
// 生成记录里写下用的是哪个版本，专家和以后排查都能对上。
import type { SlotRequest } from './drafter.ts';

export const PROMPT_VERSION = 'slot-v1';

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
