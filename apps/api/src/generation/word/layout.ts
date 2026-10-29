// 排版规范：交付 Word 的全部排版规则都在这里，生成器只照着执行。
// 应急预案的规则来自旧仓库与 Martin 多轮调出的版式（Word 样式模板 + 过滤脚本 + 后处理），
// 已和飞宇批注版样板的纸张、页边距、字号核对过。风险评估报告、应急资源调查报告暂用同一套，
// 等 Martin 按实际案例定了规则，只在 LAYOUTS 里给它们补差异。
//
// 单位：字号是半磅（Word 的 w:sz，三号 = 32）；间距、缩进、页边距是缇（1 厘米 ≈ 567）。
import type { DocumentKind } from '@genyun/shared';

/** 公文字号（半磅） */
export const SIZE = {
  一号: 52,
  小一: 48,
  三号: 32,
  四号: 28,
  小四: 24,
  小五: 18,
} as const;

/** 1.5 倍行距 */
const LINE_1_5 = 360;
const LINE_SINGLE = 240;

/** 仿宋的单倍行高是字号的这么多倍（Word 导出的 PDF 实测：四号 1.5 倍 = 27.25 磅） */
const FANGSONG_LINE_HEIGHT = 1.2976;

/**
 * 行距写进 Word 时换成同样高度的固定值（缇）。Word 里看起来不变；LibreOffice 转 PDF 时按倍数算得矮一截，
 * 飞宇预案会少 16 页、目录页码全错，写成固定值分页才和 Word 一致（Martin 2026-10-29 选定后台转 PDF 预览）。
 */
export function exactLine(line: number, size: number): number {
  return Math.round(((size / 2) * FANGSONG_LINE_HEIGHT * (line / 240)) * 20);
}

export interface TextStyle {
  size: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right' | 'both';
  /** 段前、段后（缇） */
  before?: number;
  after?: number;
  /** 行距（240 = 单倍） */
  line?: number;
  /** 首行缩进字符数（2 = 两个字） */
  firstLineChars?: number;
}

export interface Layout {
  font: string;
  page: {
    /** A4 竖版，缇 */
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number; header: number; footer: number };
  };
  body: TextStyle;
  /** 标题按层级：件、章、节、次（再往下沿用最后一级） */
  headings: TextStyle[];
  /** 每一件（综合预案、各专项预案、现场处置方案、附件）另起一页（按飞宇样板） */
  partsOnNewPage: boolean;
  list: TextStyle;
  cover: {
    meta: TextStyle;
    /** 题名第一行：单位名称（按飞宇样板，小一加粗） */
    company: TextStyle;
    title: TextStyle;
    line: TextStyle;
    /** 日期组第一行用段前大留白把日期整体压到页面下部 */
    firstDate: TextStyle;
    date: TextStyle;
    /** 日期放同一行，中间用这串空格隔开；不填则每个日期一行 */
    dateSeparator?: string;
  };
  frontPage: { title: TextStyle; body: TextStyle; signature: TextStyle };
  toc: {
    heading: TextStyle;
    /** 目录收哪几级标题 */
    levels: number;
    entry: TextStyle;
    /** 每级目录项的左缩进（缇） */
    indents: number[];
  };
  table: {
    caption: TextStyle;
    header: TextStyle;
    cell: TextStyle;
    /** 列宽按各列最长内容的这个次方分配：长列更宽但不独吞，短列也看得见 */
    widthExponent: number;
    /** 每列至少放得下表头的字和这么多个字的单元格内容，不出现一个字一行 */
    minCellChars: number;
    /** 单元格左右内边距合计（缇） */
    cellPadding: number;
    /** 表格后空一行（后面紧跟标题或分页时不空） */
    spacerAfter: boolean;
  };
  figure: {
    caption: TextStyle;
    /** 随正文和单独占页的图，图题在图下；横版图纸的图题作为标题放在图上 */
    landscapeCaptionAbove: boolean;
    /** 横版页上图片的最大宽度（英寸） */
    landscapeWidthInches: number;
  };
  /** 页眉：文档全称，居中，下框线 */
  header: TextStyle;
  /**
   * 从第几个前置页起显示页眉（0 = 批准发布令）：按飞宇样板，封面和批准发布令没有页眉，
   * 编制小组和目录有页眉但没有页码，正文页码从 1 起（Martin 2026-10-29 确认）
   */
  frontHeaderFrom: number;
  /** 页脚：正文页码，居中，从 1 起 */
  footer: TextStyle;
}

const base: Layout = {
  font: '仿宋',
  page: {
    width: 11906,
    height: 16838,
    margin: { top: 1418, right: 1418, bottom: 1418, left: 1418, header: 851, footer: 992 },
  },
  body: { size: SIZE.四号, align: 'both', line: LINE_1_5, before: 0, after: 0, firstLineChars: 2 },
  headings: [
    // 件标题居中（按飞宇样板，Martin 2026-10-29 确认）
    { size: SIZE.三号, bold: true, align: 'center', before: 240, after: 240, line: LINE_1_5 },
    { size: SIZE.四号, bold: true, line: LINE_1_5 },
    { size: SIZE.四号, bold: true, line: LINE_1_5 },
    { size: SIZE.四号, bold: true, line: LINE_1_5 },
  ],
  partsOnNewPage: true,
  // 带编号的列表左对齐：两端对齐会把短行拉出很大的字距（Martin 2026-05-19 反馈）
  list: { size: SIZE.四号, align: 'left', line: LINE_1_5, before: 0, after: 0 },
  cover: {
    meta: { size: SIZE.三号, bold: true, align: 'right', line: LINE_1_5, before: 0, after: 0 },
    company: { size: SIZE.小一, bold: true, align: 'center', before: 2600, after: 0, line: LINE_1_5 },
    title: { size: SIZE.一号, bold: true, align: 'center', before: 240, after: 1600, line: LINE_1_5 },
    line: { size: SIZE.三号, bold: true, align: 'center', line: LINE_1_5, before: 0, after: 0 },
    firstDate: { size: SIZE.三号, align: 'center', before: 1800, after: 0, line: LINE_1_5 },
    date: { size: SIZE.三号, align: 'center', line: LINE_1_5, before: 0, after: 0 },
    // 「发布日期：…   实施日期：…」同一行（按飞宇样板，Martin 2026-10-29 确认）
    dateSeparator: '   ',
  },
  frontPage: {
    title: { size: SIZE.三号, bold: true, align: 'center', before: 240, after: 240, line: LINE_1_5 },
    body: { size: SIZE.四号, align: 'both', line: LINE_1_5, before: 0, after: 0, firstLineChars: 2 },
    signature: { size: SIZE.四号, bold: true, align: 'right', line: LINE_1_5, before: 0, after: 0 },
  },
  toc: {
    heading: { size: SIZE.四号, bold: true, align: 'center', before: 0, after: 240, line: LINE_1_5 },
    levels: 3,
    entry: { size: SIZE.小四, after: 80 },
    indents: [0, 220, 440],
  },
  table: {
    caption: { size: SIZE.小四, bold: true, align: 'center', before: 0, after: 80 },
    // 单元格不带正文的首行缩进和两端对齐，否则窄列会一个字一行
    header: { size: SIZE.四号, bold: true, align: 'center', line: LINE_SINGLE, before: 0, after: 0 },
    cell: { size: SIZE.小四, align: 'left', line: LINE_SINGLE, before: 0, after: 0 },
    widthExponent: 0.6,
    minCellChars: 3,
    cellPadding: 230,
    spacerAfter: true,
  },
  figure: {
    caption: { size: SIZE.四号, align: 'center', line: LINE_1_5, before: 0, after: 0 },
    landscapeCaptionAbove: true,
    landscapeWidthInches: 9.2,
  },
  header: { size: SIZE.小五, align: 'center' },
  frontHeaderFrom: 1,
  footer: { size: SIZE.四号, align: 'center' },
};

export const LAYOUTS: Record<DocumentKind, Layout> = {
  plan: base,
  // 待 Martin 按实际案例确定（PROGRESS 第 9c 项），先与应急预案相同
  risk: base,
  resource: base,
};
