// 交付文档的结构：规则和模板先产出这份结构，再由它生成 Word、供专家逐节编辑、供客户在线阅读。
// 结构只描述「写什么、是什么」，不描述字号、页边距这些排版细节——排版由 Word 生成时的排版规范决定。

/** 三份交付文档 */
export type DocumentKind = 'plan' | 'risk' | 'resource';

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  plan: '应急预案',
  risk: '风险评估报告',
  resource: '应急资源调查报告',
};

/** 一段文字里的一小段；只有加粗这一种强调 */
export type TextRun = string | { text: string; bold?: boolean };

export type Block =
  | { type: 'paragraph'; text: TextRun[]; align?: 'center' | 'right' }
  /** 列表：默认按 1. 2. 3. 自动编号；ordered 为 false 时是圆点列表 */
  | { type: 'list'; items: TextRun[][]; ordered?: boolean }
  | {
      type: 'table';
      /** 表题，如「表 2-1 应急物资清单」，放在表格上方 */
      caption?: string;
      /** 表头可以有多行 */
      header: string[][];
      rows: string[][];
    }
  | {
      type: 'figure';
      /** 图片内容：默认 PNG；客户拍的图纸照片是 JPEG（imageType = 'jpg'） */
      png: Uint8Array;
      imageType?: 'png' | 'jpg';
      /** 原图宽高（像素），用来按比例缩放 */
      width: number;
      height: number;
      /** 图题，放在图下方 */
      caption?: string;
      /**
       * 图在版面上怎么放：inline 随正文；page 单独占一页（如应急响应流程图）；
       * landscape 单独占一张横版页（如附件里的总平面图、疏散图）
       */
      placement?: 'inline' | 'page' | 'landscape';
    };

/**
 * 一节。标题层级由嵌套深度决定：第 1 层是「件」（一、综合应急预案），第 2 层是「章」（1. 总则），
 * 再往下是节、次。标题文字里带好编号。
 */
export interface DocSection {
  /** 稳定编号，专家逐节修改、新旧稿对照时靠它对上同一节 */
  id: string;
  title: string;
  blocks: Block[];
  sections: DocSection[];
  /** 下一级每一节都另起一页（如附件下的附件 1、附件 2…） */
  childrenOnNewPage?: boolean;
}

export interface DocCover {
  /** 封面题名分两行：单位名称一行、文档名称一行（如「生产安全事故应急预案」） */
  company: string;
  name: string;
  /** 预案编号、版本号，放右上角；报告类可以不填 */
  code?: string;
  version?: string;
  /** 单位名称、主要负责人等，题名下方居中 */
  lines: string[];
  /** 颁布日期、实施日期等，靠下居中 */
  dates: string[];
}

/** 封面之后、目录之前的固定页（批准发布令、编制小组） */
export interface FrontPage {
  title: string;
  blocks: Block[];
  /** 页末靠右的落款（签发人、盖章、日期） */
  signature?: string[];
}

export interface DeliveryDocument {
  kind: DocumentKind;
  /** 文档全称（单位名称 + 文档名称）：每页页眉、Word 文件标题 */
  title: string;
  cover: DocCover;
  frontPages: FrontPage[];
  /** 正文从「件」开始 */
  sections: DocSection[];
}
