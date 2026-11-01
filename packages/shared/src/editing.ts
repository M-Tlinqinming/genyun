// 正文编辑（M2 第 11 项，14 页 E18-03、E18-04、E18-07、E18-08）：专家按节修改生成的草稿。
// 一节里的段落和列表可以改；表格和图来自专业整理，在正文里锁定（只能在专业整理里改后重新生成）。
// 修订只存改过的节（按节的稳定编号），生成 Word 时盖到生成时存下的文档结构上。
import { z } from 'zod';
import type { Block, DeliveryDocument, DocSection, TextRun } from './document/model.ts';
import type { DraftKind } from './generation.ts';

/** 编辑时的一块：段落、列表照原样；表格和图只留位置和名称 */
export type EditBlock =
  | { type: 'paragraph'; text: TextRun[]; align?: 'center' | 'right' }
  | { type: 'list'; items: TextRun[][]; ordered?: boolean }
  /** index = 在原来这一节里是第几块（从 0 起）；label 给页面显示，如「表格：表 2-1 应急物资清单」 */
  | { type: 'locked'; index: number; label: string };

export interface OutlineNode {
  id: string;
  title: string;
  /** 这一节有专家保存过的修订 */
  edited: boolean;
  children: OutlineNode[];
}

/** 一节已保存的修订（存在 draft_edits.sections 里，以节编号为键） */
export interface SectionEdit {
  blocks: EditBlock[];
  /** 这一节保存过几次；保存时带上读到的值，别人刚保存过就拒绝 */
  rev: number;
  note: string;
  by: string;
  byName: string;
  at: string;
}

export const EDIT_LIMITS = { blocks: 400, textChars: 5000, note: 200 } as const;

function lockedLabel(block: Block, nth: number): string {
  if (block.type === 'table') return `表格：${block.caption?.trim() || `本节第 ${nth} 个表格`}`;
  if (block.type === 'figure') return `图：${block.caption?.trim() || `本节第 ${nth} 张图`}`;
  return '';
}

export function editableOf(blocks: Block[]): EditBlock[] {
  const seen = { table: 0, figure: 0 };
  return blocks.map((b, index): EditBlock => {
    if (b.type === 'paragraph') return b.align ? { type: 'paragraph', text: b.text, align: b.align } : { type: 'paragraph', text: b.text };
    if (b.type === 'list') return b.ordered === undefined ? { type: 'list', items: b.items } : { type: 'list', items: b.items, ordered: b.ordered };
    return { type: 'locked', index, label: lockedLabel(b, ++seen[b.type]) };
  });
}

/** 锁定的表格和图在编辑页里只读显示：表格给内容，图给缩略图（data URL） */
export type LockedPreview =
  | { index: number; kind: 'table'; header: string[][]; rows: string[][] }
  | { index: number; kind: 'figure'; src: string };

/** 把锁定块换回原来的表格和图 */
export function resolveEdit(original: Block[], edit: EditBlock[]): Block[] {
  return edit.map((b): Block => (b.type === 'locked' ? original[b.index]! : b));
}

const runText = (r: TextRun) => (typeof r === 'string' ? r : r.text);
const runsText = (rs: TextRun[]) => rs.map(runText).join('');

/** 保存前检查：表格和图都在、顺序不变，正文不能为空；没有问题返回 null */
export function editBlocksError(original: Block[], edit: EditBlock[]): string | null {
  const want = original.flatMap((b, i) => (b.type === 'table' || b.type === 'figure' ? [i] : []));
  const got = edit.flatMap((b) => (b.type === 'locked' ? [b.index] : []));
  if (want.length !== got.length || want.some((i, k) => got[k] !== i)) {
    return '表格和图来自专业整理，不能在正文里删除或调整顺序；请撤销后再保存';
  }
  const text = edit.map((b) => (b.type === 'paragraph' ? runsText(b.text) : b.type === 'list' ? b.items.map(runsText).join('') : '')).join('');
  if (!text.trim() && want.length === 0 && original.length > 0) return '本节正文不能为空';
  return null;
}

/** 合并相邻同样式的文字、去掉空的；不加粗的写成纯字符串 */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const text = runText(r);
    if (!text) continue;
    const bold = typeof r !== 'string' && r.bold === true;
    const last = out[out.length - 1];
    const lastBold = last !== undefined && typeof last !== 'string' && last.bold === true;
    if (last !== undefined && lastBold === bold) out[out.length - 1] = bold ? { text: runText(last) + text, bold: true } : runText(last) + text;
    else out.push(bold ? { text, bold: true } : text);
  }
  return out;
}

function normalizeBlock(b: EditBlock): unknown {
  if (b.type === 'paragraph') return { t: 'p', a: b.align ?? null, r: normalizeRuns(b.text) };
  if (b.type === 'list') return { t: 'l', o: b.ordered !== false, i: b.items.map(normalizeRuns) };
  return { t: 'k', i: b.index };
}

export function sameBlocks(a: EditBlock[], b: EditBlock[]): boolean {
  return JSON.stringify(a.map(normalizeBlock)) === JSON.stringify(b.map(normalizeBlock));
}

/** 纯文字，冲突对照与「复制本节内容」用 */
export function blocksText(blocks: EditBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'paragraph') return runsText(b.text);
      if (b.type === 'list') return b.items.map((it, i) => `${b.ordered === false ? '•' : `${i + 1}.`} ${runsText(it)}`).join('\n');
      return `［${b.label}］`;
    })
    .join('\n');
}

export function findSection(doc: DeliveryDocument, id: string): { section: DocSection; path: string[] } | null {
  const walk = (list: DocSection[], path: string[]): { section: DocSection; path: string[] } | null => {
    for (const s of list) {
      const here = [...path, s.title];
      if (s.id === id) return { section: s, path: here };
      const hit = walk(s.sections, here);
      if (hit) return hit;
    }
    return null;
  };
  return walk(doc.sections, []);
}

export function outlineOf(doc: DeliveryDocument, edited: Record<string, unknown>): OutlineNode[] {
  const walk = (list: DocSection[]): OutlineNode[] =>
    list.map((s) => ({ id: s.id, title: s.title, edited: s.id in edited, children: walk(s.sections) }));
  return walk(doc.sections);
}

/** 把各节修订盖到生成时的文档结构上（不改原文档） */
export function applyEdits(doc: DeliveryDocument, edits: Record<string, EditBlock[]>): DeliveryDocument {
  if (Object.keys(edits).length === 0) return doc;
  const walk = (list: DocSection[]): DocSection[] =>
    list.map((s) => {
      const edit = edits[s.id];
      const sections = walk(s.sections);
      if (!edit && sections.every((c, i) => c === s.sections[i])) return s;
      return { ...s, blocks: edit ? resolveEdit(s.blocks, edit) : s.blocks, sections };
    });
  return { ...doc, sections: walk(doc.sections) };
}

const runSchema = z.union([
  z.string().max(EDIT_LIMITS.textChars),
  z.object({ text: z.string().max(EDIT_LIMITS.textChars), bold: z.boolean().optional() }),
]);
const runsSchema = z.array(runSchema).max(200);

export const editBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: runsSchema, align: z.enum(['center', 'right']).optional() }),
  z.object({ type: z.literal('list'), items: z.array(runsSchema).min(1).max(200), ordered: z.boolean().optional() }),
  z.object({ type: z.literal('locked'), index: z.number().int().min(0), label: z.string().max(300) }),
]);

// saveId：页面每次点保存生成一个；同一次保存重试时不变，后台据此不重复记修订（结果不确定时先查询）
// baseRev：打开这一节时读到的修订次数（没改过为 0）
// batchId：打开编辑页时的那一批草稿；之后重新生成过就拒绝，免得改动写进新生成的稿
// aiPromptVersion：本节这次修改用过「帮我改写这段」并采用了 AI 的文字时，带上提示词版本
export const sectionSaveSchema = z.object({
  saveId: z.uuid(),
  batchId: z.uuid(),
  aiPromptVersion: z.string().trim().min(1).max(40).optional(),
  baseRev: z.number().int().min(0),
  blocks: z.array(editBlockSchema).max(EDIT_LIMITS.blocks),
  note: z
    .string()
    .trim()
    .min(1, '请写修订说明：改了什么、依据是什么')
    .max(EDIT_LIMITS.note, `修订说明不超过 ${EDIT_LIMITS.note} 字`),
});
export type SectionSave = z.infer<typeof sectionSaveSchema>;

// 「帮我改写这段」：只发一段文字
export const rewriteRequestSchema = z.object({ text: z.string().trim().min(4, '这段太短，不需要改写').max(1000, '一次只改写一段，这段太长') });

/** 编辑页拿到的一节 */
export interface SectionView {
  id: string;
  title: string;
  /** 从「件」到这一节的标题 */
  path: string[];
  blocks: EditBlock[];
  rev: number;
  /** 最后一次保存；没改过为 null */
  saved: { note: string; byName: string; at: string } | null;
  /** 这一节里锁定的表格和图的内容（只读显示） */
  locked: LockedPreview[];
}

export interface EditDocumentView {
  batchId: string;
  kind: DraftKind;
  /** 整份文档的修订次数（任何一节保存都加 1；第 12 项按它判断核对是否失效） */
  version: number;
  outline: OutlineNode[];
  /** 当前账号能不能改（只有负责专家能改，运营只能看） */
  editable: boolean;
  /** 「帮我改写这段」是否可用（服务器配了 AI） */
  rewrite: boolean;
  /** 生成时每个空位、每段用的是 AI 还是系统的内容 */
  notes: { plan: string; label: string; source: 'ai' | 'system'; note: string }[];
}

export interface RewriteResult {
  /** 采用的文字：AI 写的过了系统检查就是 AI 的，否则是原文 */
  text: string;
  source: 'ai' | 'system';
  note: string;
  /** 用的提示词版本；没开启 AI 时为 null。保存时带上，记进修订记录 */
  promptVersion: string | null;
}
