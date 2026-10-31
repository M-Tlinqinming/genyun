// 把模板的 Markdown 转成交付文档结构。模板（apps/api/content/plan）和综合预案各章都用 Markdown 写，
// 这里只认模板里实际用到的写法：标题、段落、加粗、表格、圆点 / 数字列表、引用、图的占位。
// 每一行是一段（模板一段一行，不靠空行分段）；「**表…**」紧挨表格时作表题，「**图…**」紧跟图时作图题。
import type { Block, DocSection, TextRun } from '@genyun/shared';

export type Figure = Extract<Block, { type: 'figure' }>;

export interface MdNode {
  title: string;
  blocks: Block[];
  children: MdNode[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const TABLE_ROW = /^\|.*\|\s*$/;
const TABLE_RULE = /^\|(\s*:?-{2,}:?\s*\|)+\s*$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+\.\s+(.*)$/;
/** 图的占位：[[figure:key]]，图由调用方给 */
const FIGURE = /^\[\[figure:([\w-]+)\]\]$/;
const BOLD_LINE = /^\*\*([^*]+)\*\*[:：]?$/;
/** 中文字或中文标点之间多出的空格（模板里变量两边留的），加粗、代码标记两边也算；中英文、数字之间的空格不动 */
const CJK_GAP = /(?<=[一-龥，。；：、（）「」《》？！](?:\*\*|`)?) (?=(?:\*\*|`)?[一-龥，。；：、（）「」《》？！])/g;

/** 行内只保留加粗；去掉代码标记 */
export function inline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.replace(/`([^`]*)`/g, '$1').split(/\*\*/);
  parts.forEach((part, i) => {
    if (!part) return;
    runs.push(i % 2 === 1 ? { text: part, bold: true } : part);
  });
  return runs.length ? runs : [''];
}

const plain = (text: string) => text.replace(/`([^`]*)`/g, '$1').replace(/\*\*/g, '').trim();

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(plain);

/** 解析成「第一个标题之前的内容」和标题树 */
export function parseMarkdown(md: string, figures: Record<string, Figure> = {}): { blocks: Block[]; sections: MdNode[] } {
  const lines = md
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(CJK_GAP, '')
    .split('\n');
  const root: MdNode = { title: '', blocks: [], children: [] };
  const stack: { level: number; node: MdNode }[] = [{ level: 0, node: root }];
  const current = () => stack[stack.length - 1]!.node;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    i += 1;
    if (!line || /^-{3,}$/.test(line) || /^```/.test(line)) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      while (stack.length > 1 && stack[stack.length - 1]!.level >= level) stack.pop();
      const node: MdNode = { title: plain(heading[2]!), blocks: [], children: [] };
      current().children.push(node);
      stack.push({ level, node });
      continue;
    }

    const blocks = current().blocks;

    if (TABLE_ROW.test(line)) {
      const rows = [line];
      while (i < lines.length && TABLE_ROW.test(lines[i]!.trim())) rows.push(lines[i++]!.trim());
      const ruleAt = rows.findIndex((r) => TABLE_RULE.test(r));
      const header = ruleAt > 0 ? rows.slice(0, ruleAt).map(cells) : [cells(rows[0]!)];
      const body = rows.slice(ruleAt > 0 ? ruleAt + 1 : 1).map(cells);
      // 紧挨着的「**表 x**」作表题
      const prev = blocks[blocks.length - 1];
      let caption: string | undefined;
      if (prev?.type === 'paragraph' && prev.text.length === 1 && typeof prev.text[0] !== 'string' && /^表/.test(prev.text[0]!.text)) {
        caption = prev.text[0]!.text.replace(/[:：]$/, '');
        blocks.pop();
      }
      blocks.push({ type: 'table', caption, header, rows: body });
      continue;
    }

    const figure = FIGURE.exec(line);
    if (figure) {
      const fig = figures[figure[1]!];
      if (!fig) throw new Error(`没有提供图：${figure[1]}`);
      // 紧跟的「**图 x**」或「**…图**」作图题
      let next = i;
      while (next < lines.length && !lines[next]!.trim()) next += 1;
      const captionLine = BOLD_LINE.exec(lines[next]?.trim() ?? '');
      if (captionLine && /图/.test(captionLine[1]!)) {
        blocks.push({ ...fig, caption: captionLine[1] });
        i = next + 1;
      } else blocks.push(fig);
      continue;
    }

    const bullet = BULLET.exec(line) ?? ORDERED.exec(line);
    if (bullet) {
      const ordered = !BULLET.test(line);
      const items = [inline(bullet[1]!)];
      // 列表项之间可以有空行
      while (i < lines.length) {
        let j = i;
        while (j < lines.length && !lines[j]!.trim()) j += 1;
        const m = (ordered ? ORDERED : BULLET).exec(lines[j]?.trim() ?? '');
        if (!m) break;
        items.push(inline(m[1]!));
        i = j + 1;
      }
      blocks.push({ type: 'list', items, ordered });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    blocks.push({ type: 'paragraph', text: inline(quote ? quote[1]! : line) });
  }
  return { blocks: root.blocks, sections: root.children };
}

export interface NumberingRule {
  /** 最深到第几层还是标题；再深的改为加粗的一段，不进目录 */
  maxDepth: number;
  /** path 是从 1 起的序号，如 [2, 1] = 第 2 章第 1 节 */
  title: (path: number[], title: string) => string;
}

/** 标题树转文档的节：编号、稳定的 id、过深的标题降为加粗段落 */
export function toSections(nodes: MdNode[], idPrefix: string, rule: NumberingRule, path: number[] = []): DocSection[] {
  return nodes.map((node, i) => {
    const here = [...path, i + 1];
    const blocks = [...node.blocks];
    const sections: DocSection[] = [];
    if (here.length >= rule.maxDepth) blocks.push(...flatten(node.children));
    else sections.push(...toSections(node.children, idPrefix, rule, here));
    return { id: `${idPrefix}.${here.join('.')}`, title: rule.title(here, node.title), blocks, sections };
  });
}

function flatten(nodes: MdNode[]): Block[] {
  return nodes.flatMap((n) => [{ type: 'paragraph' as const, text: [{ text: n.title, bold: true }] }, ...n.blocks, ...flatten(n.children)]);
}
