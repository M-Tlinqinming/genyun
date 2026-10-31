// 生成一份草稿的 Word 和 PDF（M2 第 10 项后台队列里跑）。
// 测试换成假的实现，可以模拟某一份失败；默认按环境变量选 AI 起草，配了 LibreOffice 才转 PDF。
import type { DraftKind, PlanInput } from '@genyun/shared';
import { defaultDrafter } from './ai/drafter.ts';
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
}

// drawings：应急预案附件 7 的客户图纸图片（按 input.drawings 锁定的页取好），另两份用不到
export type DraftRenderer = (kind: DraftKind, input: PlanInput, drawings?: PlanDrawings) => Promise<RenderedDraft>;

export const DRAFT_RENDERER = Symbol('DRAFT_RENDERER');

export function defaultRenderer(): DraftRenderer {
  const drafter = defaultDrafter();
  // 服务器镜像装了 LibreOffice（见 Dockerfile）；本机用 SOFFICE_PATH 指定
  const pdf = Boolean(process.env.SOFFICE_PATH) || process.env.NODE_ENV === 'production';
  // 浏览器测试模拟失败：DRAFT_FAIL_ONCE=risk 让这一份第一次生成失败；正式环境不认
  const failOnce = new Set(process.env.NODE_ENV === 'production' ? [] : (process.env.DRAFT_FAIL_ONCE ?? '').split(',').filter(Boolean));
  return async (kind, input, drawings) => {
    if (failOnce.delete(kind)) throw new Error('模拟连接中断');
    const { document, notes } = await generateDocument(kind, input, { drafter, drawings });
    const word = await renderWord(document);
    return { word, pdf: pdf ? await convertToPdf(word) : null, notes };
  };
}
