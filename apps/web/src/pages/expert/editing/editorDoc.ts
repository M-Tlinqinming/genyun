// 编辑器内容（TipTap / ProseMirror 的 JSON）与一节的修订块之间互相转换。
// 段落、列表可改；表格和图是锁定块（locked 节点），只能看不能删、不能挪。
import { normalizeRuns, type EditBlock, type TextRun } from '@genyun/shared';

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string }[];
}

function runsToInline(runs: TextRun[]): PmNode[] {
  const out: PmNode[] = [];
  for (const r of runs) {
    const text = typeof r === 'string' ? r : r.text;
    const bold = typeof r !== 'string' && r.bold === true;
    text.split('\n').forEach((part, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (part) out.push(bold ? { type: 'text', text: part, marks: [{ type: 'bold' }] } : { type: 'text', text: part });
    });
  }
  return out;
}

function inlineToRuns(nodes: PmNode[] | undefined): TextRun[] {
  const runs: TextRun[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') runs.push('\n');
    else if (n.type === 'text' && n.text) runs.push(n.marks?.some((m) => m.type === 'bold') ? { text: n.text, bold: true } : n.text);
  }
  return normalizeRuns(runs);
}

const paragraph = (runs: TextRun[], align?: string | null): PmNode => {
  const content = runsToInline(runs);
  return { type: 'paragraph', attrs: { align: align ?? null }, ...(content.length ? { content } : {}) };
};

export function blocksToDoc(blocks: EditBlock[]): PmNode {
  const content = blocks.map((b): PmNode => {
    if (b.type === 'paragraph') return paragraph(b.text, b.align);
    if (b.type === 'list') {
      return {
        type: b.ordered === false ? 'bulletList' : 'orderedList',
        content: b.items.map((it) => ({ type: 'listItem', content: [paragraph(it)] })),
      };
    }
    return { type: 'locked', attrs: { index: b.index, label: b.label } };
  });
  return { type: 'doc', content: content.length ? content : [paragraph([])] };
}

const isEmpty = (runs: TextRun[]) => runs.every((r) => !(typeof r === 'string' ? r : r.text).trim());

// 列表项里的段落各成一项；嵌套的列表摊平成后面的项
function listItems(list: PmNode): TextRun[][] {
  const items: TextRun[][] = [];
  for (const item of list.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') {
        const runs = inlineToRuns(child.content);
        if (!isEmpty(runs)) items.push(runs);
      } else if (child.type === 'bulletList' || child.type === 'orderedList') items.push(...listItems(child));
    }
  }
  return items;
}

/** 空段落、空列表不保存 */
export function docToBlocks(doc: PmNode): EditBlock[] {
  const blocks: EditBlock[] = [];
  for (const n of doc.content ?? []) {
    if (n.type === 'paragraph') {
      const text = inlineToRuns(n.content);
      if (isEmpty(text)) continue;
      const align = n.attrs?.align;
      blocks.push(align === 'center' || align === 'right' ? { type: 'paragraph', text, align } : { type: 'paragraph', text });
    } else if (n.type === 'bulletList' || n.type === 'orderedList') {
      const items = listItems(n);
      if (items.length) blocks.push(n.type === 'bulletList' ? { type: 'list', items, ordered: false } : { type: 'list', items });
    } else if (n.type === 'locked') {
      blocks.push({ type: 'locked', index: Number(n.attrs?.index), label: String(n.attrs?.label ?? '') });
    }
  }
  return blocks;
}

/** 锁定块的顺序（编辑器拦下会删掉或挪动表格、图的操作） */
export function lockedOrder(indices: number[], next: number[]): boolean {
  return indices.length === next.length && indices.every((v, i) => next[i] === v);
}
