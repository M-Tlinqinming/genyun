// 生成一份草稿的 Word 和 PDF（M2 第 10 项后台队列里跑）。
// 测试换成假的实现，可以模拟某一份失败；默认按环境变量选 AI 起草，配了 LibreOffice 才转 PDF。
import { resolveScope, selectPlans, type DeliveryDocument, type DraftKind, type DraftStep, type DraftStepProgress, type PlanInput } from '@genyun/shared';
import { defaultDrafter, type SlotDrafter } from './ai/drafter.ts';
import type { SlotNote } from './ai/slots.ts';
import { generateDocument } from './documents.ts';
import type { PlanDrawings } from './plan/assemble.ts';
import { convertToPdf } from './word/pdf.ts';
import { renderWord } from './word/render.ts';

export interface RenderedDraft {
  word: Buffer;
  // 没装转换工具（本机没配 SOFFICE_PATH）时为 null，只存 Word
  pdf: Buffer | null;
  notes: SlotNote[];
  // 生成时的文档结构：正文编辑在它上面按节修订（第 11 项）
  document: DeliveryDocument;
}

// drawings：应急预案附件 7 的客户图纸图片（按 input.drawings 锁定的页取好），另两份用不到
// onProgress：每一步开始时报一次（生成页显示「正在写……」和进度条）；调用方 await 它
export type DraftRenderer = (
  kind: DraftKind,
  input: PlanInput,
  drawings?: PlanDrawings,
  onProgress?: (p: DraftStepProgress) => Promise<void> | void,
) => Promise<RenderedDraft>;

// 这一份要走的步骤：应急预案配了 AI 时每个模板写一步、再写风险描述；其它先整理内容；然后排版，要转 PDF 再加一步
export function draftSteps(kind: DraftKind, input: PlanInput, drafter: SlotDrafter | null, pdf: boolean): { step: DraftStep; title?: string }[] {
  const steps: { step: DraftStep; title?: string }[] = [];
  if (kind === 'plan' && drafter) {
    const selection = selectPlans(resolveScope(input));
    for (const t of [...selection.specialty, ...selection.site]) steps.push({ step: 'write', title: t.title });
    steps.push({ step: 'risk' });
  } else {
    steps.push({ step: 'content' });
  }
  steps.push({ step: 'layout' });
  if (pdf) steps.push({ step: 'pdf' });
  return steps;
}

export const DRAFT_RENDERER = Symbol('DRAFT_RENDERER');

export function defaultRenderer(): DraftRenderer {
  const drafter = defaultDrafter();
  // 服务器镜像装了 LibreOffice（见 Dockerfile）；本机用 SOFFICE_PATH 指定
  const pdf = Boolean(process.env.SOFFICE_PATH) || process.env.NODE_ENV === 'production';
  // 浏览器测试模拟失败：DRAFT_FAIL_ONCE=risk 让这一份第一次生成失败；正式环境不认
  const failOnce = new Set(process.env.NODE_ENV === 'production' ? [] : (process.env.DRAFT_FAIL_ONCE ?? '').split(',').filter(Boolean));
  return async (kind, input, drawings, onProgress) => {
    if (failOnce.delete(kind)) throw new Error('模拟连接中断');
    const steps = draftSteps(kind, input, drafter, pdf);
    const at = async (i: number) => {
      const s = steps[i];
      if (s) await onProgress?.({ done: i, total: steps.length, step: s.step, ...(s.title ? { title: s.title } : {}) });
    };
    const { document, notes } = await generateDocument(kind, input, {
      drafter,
      drawings,
      onProgress: onProgress && ((p) => at(p.step === 'write' ? p.index : steps.findIndex((s) => s.step === p.step))),
    });
    await at(steps.findIndex((s) => s.step === 'layout'));
    const word = await renderWord(document);
    if (pdf) await at(steps.findIndex((s) => s.step === 'pdf'));
    return { word, pdf: pdf ? await convertToPdf(word) : null, notes, document };
  };
}
