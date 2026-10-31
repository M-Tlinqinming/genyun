// 把交付文档的结构按排版规范写成 Word。
// 页面顺序：封面 → 各前置页（批准发布令、编制小组）→ 目录，这几页没有页码，从排版规范指定的前置页起有页眉；
// 之后正文从第 1 页起，页眉是文档题名（排版规范不设页眉的没有）；横版图纸单独成横版节，页码接着往下数。
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type IParagraphStyleOptions,
  type ISectionOptions,
} from 'docx';
import type { Block, DeliveryDocument, DocSection, TextRun as Run } from '@genyun/shared';
import { exactLine, LAYOUTS, type Layout, type TextStyle } from './layout.ts';

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  both: AlignmentType.JUSTIFIED,
} as const;

/** 96 像素 = 1 英寸 = 1440 缇；docx 库的图片尺寸按像素算 */
const TWIPS_PER_PX = 15;

const HEADING_LEVELS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const LIST_REFERENCE = 'gy-list';
const BULLET_REFERENCE = 'gy-bullet';

export async function renderWord(doc: DeliveryDocument): Promise<Buffer> {
  return Packer.toBuffer(buildWord(doc));
}

export function buildWord(doc: DeliveryDocument): Document {
  const layout = LAYOUTS[doc.kind];
  const writer = new Writer(layout);

  const front = writer.frontMatter(doc);
  const body = writer.body(doc.sections);

  const pageSize = { width: layout.page.width, height: layout.page.height };
  const margin = layout.page.margin;
  const blankHeader = new Header({ children: [new Paragraph({})] });
  const header = layout.header
    ? new Header({
        children: [
          new Paragraph({
            alignment: ALIGN[layout.header.align ?? 'center'],
            // 页眉页脚和正文一样按 1.5 倍算行高（以前是从默认样式继承的）
            spacing: lineSpacing({ ...layout.header, line: layout.body.line }),
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: 'auto' } },
            children: [new TextRun({ text: doc.title, size: layout.header.size })],
          }),
        ],
      })
    : blankHeader;
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: ALIGN[layout.footer.align ?? 'center'],
        spacing: lineSpacing({ ...layout.footer, line: layout.body.line }),
        children: [new TextRun({ children: [PageNumber.CURRENT], size: layout.footer.size })],
      }),
    ],
  });
  const blank = { default: blankHeader };
  const blankFooter = { default: new Footer({ children: [new Paragraph({})] }) };

  const sections: ISectionOptions[] = [
    { properties: { page: { size: pageSize, margin } }, headers: blank, footers: blankFooter, children: front.plain },
    { properties: { page: { size: pageSize, margin } }, headers: { default: header }, footers: blankFooter, children: front.headed },
    ...body.map((part, i): ISectionOptions => ({
      properties: {
        page: {
          size: part.landscape
            ? { ...pageSize, orientation: PageOrientation.LANDSCAPE }
            : pageSize,
          margin,
          ...(i === 0 ? { pageNumbers: { start: 1 } } : {}),
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children: part.children,
    })),
  ];

  return new Document({
    title: doc.title,
    creator: '耕云',
    features: { updateFields: true },
    styles: styles(layout),
    numbering: {
      config: [
        {
          reference: LIST_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 480, hanging: 480 } } },
            },
          ],
        },
        {
          reference: BULLET_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 480, hanging: 480 } } },
            },
          ],
        },
      ],
    },
    sections,
  });
}

type Child = Paragraph | Table | TableOfContents;

class Writer {
  private pendingBreak = false;
  /** 每个列表单独从 1 编号 */
  private lists = 0;
  constructor(private readonly layout: Layout) {}

  /** 前置页分两段：没有页眉的（封面等）和有页眉的（编制小组、目录等），各成一节 */
  frontMatter(doc: DeliveryDocument): { plain: Child[]; headed: Child[] } {
    const { cover, frontPage, toc, frontHeaderFrom } = this.layout;
    const plain: Child[] = [];
    const headed: Child[] = [];
    const { code, version } = doc.cover;
    for (const line of [code && `预案编号：${code}`, version && `版 本 号：${version}`]) {
      if (line) plain.push(this.para(line, cover.meta));
    }
    plain.push(this.para(doc.cover.company, cover.company));
    plain.push(this.para(doc.cover.name, cover.title));
    for (const line of doc.cover.lines) plain.push(this.para(line, cover.line));
    const dates = cover.dateSeparator === undefined ? doc.cover.dates : [doc.cover.dates.join(cover.dateSeparator)];
    dates.forEach((line, i) => plain.push(this.para(line, i === 0 ? cover.firstDate : cover.date)));

    doc.frontPages.forEach((page, i) => {
      const out = i < frontHeaderFrom ? plain : headed;
      // 换节本身就换页，节内的前置页才要分页
      this.pendingBreak = !(i === frontHeaderFrom && out === headed);
      out.push(this.para(page.title, frontPage.title));
      out.push(...this.blocks(page.blocks, frontPage.body));
      for (const line of page.signature ?? []) out.push(this.para(line, frontPage.signature));
    });

    this.pendingBreak = headed.length > 0;
    headed.push(this.para('目  录', toc.heading));
    headed.push(new TableOfContents('目录', { hyperlink: true, headingStyleRange: `1-${toc.levels}` }));
    this.pendingBreak = false;
    return { plain, headed };
  }

  /** 正文按横竖版切成若干节 */
  body(sections: DocSection[]): { landscape: boolean; children: Child[] }[] {
    const parts: { landscape: boolean; children: Child[] }[] = [{ landscape: false, children: [] }];
    const current = () => parts[parts.length - 1]!;
    const emit = (child: Child) => current().children.push(child);
    const switchTo = (landscape: boolean) => {
      if (current().landscape === landscape) return false;
      parts.push({ landscape, children: [] });
      this.pendingBreak = false;
      return true;
    };

    const walk = (list: DocSection[], depth: number, newPageEach: boolean) => {
      list.forEach((section, i) => {
        switchTo(false);
        if (newPageEach && i > 0) this.pendingBreak = true;
        emit(this.heading(section.title, depth));
        let blocks = section.blocks;
        while (blocks.length) {
          const at = blocks.findIndex((b) => b.type === 'figure' && b.placement === 'landscape');
          const flowing = at < 0 ? blocks : blocks.slice(0, at);
          // 连续的横版图纸共用一个横版节，中间有文字才切回竖版
          if (flowing.length) switchTo(false);
          this.blocks(flowing, this.layout.body).forEach(emit);
          if (at < 0) break;
          const figure = blocks[at] as Extract<Block, { type: 'figure' }>;
          if (!switchTo(true)) this.pendingBreak = true;
          this.landscapeFigure(figure).forEach(emit);
          blocks = blocks.slice(at + 1);
        }
        walk(section.sections, depth + 1, section.childrenOnNewPage ?? false);
      });
    };
    walk(sections, 0, this.layout.partsOnNewPage);
    return parts.filter((p) => p.children.length > 0);
  }

  private blocks(blocks: Block[], text: TextStyle): Child[] {
    const out: Child[] = [];
    blocks.forEach((block, i) => {
      switch (block.type) {
        case 'paragraph':
          out.push(this.para(block.text, block.align ? { ...text, align: block.align, firstLineChars: 0 } : text));
          break;
        case 'list': {
          const list = block.ordered === false ? { reference: BULLET_REFERENCE, instance: 0 } : { reference: LIST_REFERENCE, instance: ++this.lists };
          for (const item of block.items) out.push(this.para(item, this.layout.list, { list }));
          break;
        }
          break;
        case 'table':
          out.push(...this.table(block));
          if (this.layout.table.spacerAfter && i < blocks.length - 1) {
            out.push(this.para('', { ...this.layout.body, size: this.layout.table.cell.size, firstLineChars: 0 }));
          }
          break;
        case 'figure':
          out.push(...this.figure(block));
          break;
      }
    });
    return out;
  }

  private heading(title: string, depth: number): Paragraph {
    const level = Math.min(depth, HEADING_LEVELS.length - 1);
    const pageBreakBefore = this.takeBreak();
    return new Paragraph({ heading: HEADING_LEVELS[level], pageBreakBefore, children: [new TextRun(title)] });
  }

  private table(block: Extract<Block, { type: 'table' }>): Child[] {
    const { table } = this.layout;
    const out: Child[] = [];
    if (block.caption) out.push(this.para(block.caption, table.caption));
    else if (this.pendingBreak) out.push(this.breakParagraph());

    const all = [...block.header, ...block.rows];
    const columns = Math.max(...all.map((r) => r.length));
    const widths = columnWidths(block.header, block.rows, columns, contentWidth(this.layout), table);
    const cellStyles = Array.from({ length: columns }, (_, c): TextStyle => {
      if (table.cellAlign === 'left') return table.cell;
      const fits = block.rows.every((r) => chars(r[c]) * table.cell.size * 10 + table.cellPadding <= widths[c]!);
      return { ...table.cell, align: fits ? 'center' : 'left' };
    });
    const row = (cells: string[], header: boolean) =>
      new TableRow({
        tableHeader: header,
        cantSplit: true,
        children: Array.from({ length: columns }, (_, c) =>
          new TableCell({
            width: { size: widths[c]!, type: WidthType.DXA },
            verticalAlign: VerticalAlignTable.CENTER,
            children: [this.para(cells[c] ?? '', header ? table.header : cellStyles[c]!)],
          }),
        ),
      });
    const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
    out.push(
      new Table({
        width: { size: contentWidth(this.layout), type: WidthType.DXA },
        columnWidths: widths,
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
        rows: [...block.header.map((r) => row(r, true)), ...block.rows.map((r) => row(r, false))],
      }),
    );
    return out;
  }

  private figure(block: Extract<Block, { type: 'figure' }>): Child[] {
    const { figure } = this.layout;
    const ownPage = block.placement === 'page';
    if (ownPage) this.pendingBreak = true;
    const maxPx = contentWidth(this.layout) / TWIPS_PER_PX;
    // 单独占页的图不超出版心高度（竖版的客户图纸），给图题留两行
    const { page } = this.layout;
    const maxH = ownPage ? (page.height - page.margin.top - page.margin.bottom) / TWIPS_PER_PX - 64 : Infinity;
    const out: Child[] = [this.image(block, maxPx, maxH)];
    if (block.caption) out.push(this.para(block.caption, figure.caption));
    if (ownPage) this.pendingBreak = true;
    return out;
  }

  private landscapeFigure(block: Extract<Block, { type: 'figure' }>): Child[] {
    const { figure, page } = this.layout;
    const caption = block.caption ? this.para(block.caption, figure.caption) : undefined;
    // 横版版心：宽 = 纸高 - 左右边距，高 = 纸宽 - 上下边距，再给图题留两行
    const maxW = Math.min(figure.landscapeWidthInches * 96, (page.height - page.margin.left - page.margin.right) / TWIPS_PER_PX);
    const maxH = (page.width - page.margin.top - page.margin.bottom) / TWIPS_PER_PX - 64;
    const image = this.image(block, maxW, maxH);
    if (!caption) return [image];
    return figure.landscapeCaptionAbove ? [caption, image] : [image, caption];
  }

  private image(block: Extract<Block, { type: 'figure' }>, maxW: number, maxH: number): Paragraph {
    const scale = Math.min(1, maxW / block.width, maxH / block.height);
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      // 默认样式是固定行距，图所在的段落要改回自动，否则图被裁成一行高
      spacing: { line: 240, lineRule: LineRuleType.AUTO },
      pageBreakBefore: this.takeBreak(),
      keepNext: true,
      children: [
        new ImageRun({
          type: block.imageType ?? 'png',
          data: block.png,
          transformation: { width: Math.round(block.width * scale), height: Math.round(block.height * scale) },
        }),
      ],
    });
  }

  private para(text: string | Run[], style: TextStyle, opts: { list?: { reference: string; instance: number } } = {}): Paragraph {
    const runs = typeof text === 'string' ? [text] : text;
    return new Paragraph({
      alignment: style.align ? ALIGN[style.align] : undefined,
      spacing: { before: style.before, after: style.after, ...lineSpacing(style) },
      indent: style.firstLineChars ? { firstLineChars: style.firstLineChars * 100 } : undefined,
      numbering: opts.list ? { reference: opts.list.reference, level: 0, instance: opts.list.instance } : undefined,
      pageBreakBefore: this.takeBreak(),
      // 段内换行（编辑器里 Shift+Enter 存成 \n）写成 Word 的换行，不然显示成空格
      children: runs.flatMap((r) =>
        (typeof r === 'string' ? r : r.text).split('\n').map(
          (part, i) =>
            new TextRun({
              text: part,
              break: i > 0 ? 1 : undefined,
              bold: (typeof r !== 'string' && r.bold) || style.bold || undefined,
              size: style.size,
            }),
        ),
      ),
    });
  }

  private breakParagraph(): Paragraph {
    this.pendingBreak = false;
    return new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ size: 2, children: [new PageBreak()] })] });
  }

  private takeBreak(): boolean | undefined {
    if (!this.pendingBreak) return undefined;
    this.pendingBreak = false;
    return true;
  }
}

const chars = (s: string | undefined) => [...(s ?? '')].length;

function contentWidth(layout: Layout): number {
  return layout.page.width - layout.page.margin.left - layout.page.margin.right;
}

/**
 * 各列宽度按该列最长内容的长度取次方后分配，合计等于版心宽；
 * 但每列至少放得下表头的字（长表头按上限算，折行）和几个字的内容。
 */
export function columnWidths(
  header: string[][],
  rows: string[][],
  columns: number,
  total: number,
  rule: Layout['table'],
): number[] {
  const all = [...header, ...rows];
  const longest = Array.from({ length: columns }, (_, c) => Math.max(1, ...all.map((r) => chars(r[c]))));
  // 字宽按字号算：半磅 × 10 = 缇
  const minimum = Array.from({ length: columns }, (_, c) => {
    const head = Math.min(rule.maxHeaderChars, Math.max(0, ...header.map((r) => chars(r[c])))) * rule.header.size * 10;
    const body = Math.min(longest[c]!, rule.minCellChars) * rule.cell.size * 10;
    return Math.max(head, body) + rule.cellPadding;
  });
  // 列多、表头长时最小宽度加起来会超过版心：按最小宽度的比例整体缩进版心
  const floor = minimum.reduce((a, b) => a + b, 0);
  if (floor >= total) {
    const scaled = minimum.map((m) => Math.floor((m / floor) * total));
    scaled[columns - 1]! += total - scaled.reduce((a, b) => a + b, 0);
    return scaled;
  }
  const weights = longest.map((n) => n ** rule.widthExponent);
  // 先按比例分；分到的比最小宽度还窄的列定在最小宽度，余下的宽度在其他列里重新按比例分
  const pinned = new Set<number>();
  let widths: number[] = [];
  for (;;) {
    const room = total - [...pinned].reduce((a, c) => a + minimum[c]!, 0);
    const sum = weights.reduce((a, w, c) => (pinned.has(c) ? a : a + w), 0);
    widths = weights.map((w, c) => (pinned.has(c) ? minimum[c]! : Math.floor((w / sum) * room)));
    const tooNarrow = widths.findIndex((w, c) => !pinned.has(c) && w < minimum[c]!);
    if (tooNarrow < 0 || pinned.size === columns - 1) break;
    widths.forEach((w, c) => {
      if (!pinned.has(c) && w < minimum[c]!) pinned.add(c);
    });
  }
  widths[widths.length - 1]! += total - widths.reduce((a, b) => a + b, 0);
  return widths;
}

// 行距一律写成固定值，见 layout.ts 的 exactLine
function lineSpacing(s: TextStyle) {
  return s.line ? { line: exactLine(s.line, s.size), lineRule: LineRuleType.EXACT } : {};
}

function styles(layout: Layout) {
  const font = { ascii: layout.font, eastAsia: layout.font, hAnsi: layout.font, cs: layout.font };
  const paragraph = (s: TextStyle) => ({
    alignment: s.align ? ALIGN[s.align] : undefined,
    spacing: { before: s.before ?? 0, after: s.after ?? 0, ...lineSpacing(s) },
    indent: s.firstLineChars ? { firstLineChars: s.firstLineChars * 100 } : { firstLine: 0 },
  });
  const run = (s: TextStyle) => ({ font, size: s.size, bold: s.bold, italics: false, color: '000000' });

  const headings: IParagraphStyleOptions[] = HEADING_LEVELS.map((_, i) => {
    const s = layout.headings[Math.min(i, layout.headings.length - 1)]!;
    return {
      id: `Heading${i + 1}`,
      name: `Heading ${i + 1}`,
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      paragraph: { ...paragraph(s), keepNext: true, keepLines: true, outlineLevel: i },
      run: run(s),
    };
  });
  const tocEntries: IParagraphStyleOptions[] = layout.toc.indents.map((left, i) => ({
    id: `TOC${i + 1}`,
    name: `toc ${i + 1}`,
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: { spacing: { before: 0, after: layout.toc.entry.after ?? 0 }, indent: { left, firstLine: 0 } },
    run: run(layout.toc.entry),
  }));

  return {
    default: {
      // 正文的首行缩进、两端对齐只加在正文段落上，不放进默认样式，免得渗进表格、列表和图
      document: { run: { font, size: layout.body.size, color: '000000' }, paragraph: { spacing: { before: 0, after: 0, ...lineSpacing(layout.body) } } },
    },
    paragraphStyles: [...headings, ...tocEntries],
  };
}
