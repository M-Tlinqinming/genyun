// 待补充清单：生成时缺的必填内容在正文里写成「（待补充）」，专家核对时补上或留空。
// 核对定稿页的左栏（每章几处）、右栏（逐条），以及交付时的待补充清单都用这里的函数。
//
// 章怎么分（看过三份生成稿的大纲后定的）：
// - 应急预案：第一层是「部分」（一、综合应急预案；二、××专项应急预案；三、现场处置方案；四、附件），
//   页面上当分组标题；部分下面的第二层是章。部分下面没有子节的，部分本身就是一章。
//   部分自己带正文（如综合应急预案开头的说明）又有子节的，这段正文单独算一章，排在这一部分的最前面。
// - 风险评估报告、应急资源调查报告：第一层就是章，没有分组。
// - 一章里的节：章本身有正文的算第一节，后面是章下所有子节按顺序展开（不论几级）。
import type { Block, DeliveryDocument, DocSection, TextRun } from './document/model.ts';

/** 生成时缺内容的占位，和生成代码里的写法一致 */
export const PENDING_MARK = '（待补充）';

export interface PendingItem {
  /** 所在节 */
  sectionId: string;
  sectionTitle: string;
  /** 所在章 */
  chapterId: string;
  /** 缺的是什么：正文里取占位前面的几个字，表格里是「这一行第一格 · 这一列表头」 */
  label: string;
  /** 在正文里还是在表格里（表格来自资料核对，要回那里补） */
  where: 'text' | 'table';
  /** 生成时有、现在已经补上（或删掉）了 */
  handled: boolean;
}

export interface DocChapterSection {
  id: string;
  title: string;
  /** 相对这一章的层级：章本身是 0，章下一级是 1 */
  level: number;
}

export interface DocChapter {
  id: string;
  title: string;
  /** 所在分组（只有应急预案有） */
  group: { id: string; title: string } | null;
  /** 这一章按顺序排下来的节 */
  sections: DocChapterSection[];
}

export interface PendingChapter extends DocChapter {
  /** 这一章还有几处没处理 */
  pending: number;
}

export interface PendingView {
  items: PendingItem[];
  chapters: PendingChapter[];
}

function flatten(s: DocSection, level: number, withSelf: boolean): DocChapterSection[] {
  const self = withSelf ? [{ id: s.id, title: s.title, level }] : [];
  return [...self, ...s.sections.flatMap((c) => flatten(c, level + 1, true))];
}

function chapterOf(s: DocSection, group: DocChapter['group']): DocChapter {
  return { id: s.id, title: s.title, group, sections: flatten(s, 0, s.blocks.length > 0 || s.sections.length === 0) };
}

/** 一份文稿分成哪几章（规则见文件头） */
export function docChapters(doc: DeliveryDocument): DocChapter[] {
  if (doc.kind !== 'plan') return doc.sections.map((s) => chapterOf(s, null));
  return doc.sections.flatMap((part): DocChapter[] => {
    if (part.sections.length === 0) return [chapterOf(part, null)];
    const group = { id: part.id, title: part.title };
    const intro: DocChapter[] = part.blocks.length > 0 ? [{ id: part.id, title: part.title, group, sections: [{ id: part.id, title: part.title, level: 0 }] }] : [];
    return [...intro, ...part.sections.map((s) => chapterOf(s, group))];
  });
}

const runsText = (rs: TextRun[]) => rs.map((r) => (typeof r === 'string' ? r : r.text)).join('');

const STOPS = '，。；：、,;:';

/** 正文里一处占位的标签：占位前面到上一个标点（或段首）之间的字，去掉末尾的「为」「是」「：」 */
export function textLabel(before: string): string {
  let s = before.replace(/[\s：:]+$/u, '');
  let cut = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    if (STOPS.includes(s[i]!) || (i >= PENDING_MARK.length - 1 && s.startsWith(PENDING_MARK, i - PENDING_MARK.length + 1))) {
      cut = i;
      break;
    }
  }
  s = s.slice(cut + 1).trim();
  s = s.replace(/[为是：:]+$/u, '').trim();
  return s;
}

/** 一段文字里每处占位的标签 */
function labelsInText(text: string): string[] {
  const out: string[] = [];
  let at = text.indexOf(PENDING_MARK);
  while (at >= 0) {
    out.push(textLabel(text.slice(0, at)));
    at = text.indexOf(PENDING_MARK, at + PENDING_MARK.length);
  }
  return out;
}

function headerAt(header: string[][], col: number): string {
  for (let r = header.length - 1; r >= 0; r--) {
    const h = header[r]?.[col]?.trim();
    if (h && !h.includes(PENDING_MARK)) return h;
  }
  return `第 ${col + 1} 列`;
}

type Found = { label: string; where: 'text' | 'table' };

/** 一节自己的块里（不含子节）的所有占位，按出现顺序 */
function foundIn(blocks: Block[], sectionTitle: string): Found[] {
  const out: Found[] = [];
  const text = (t: string) => {
    for (const l of labelsInText(t)) out.push({ label: l || sectionTitle, where: 'text' });
  };
  for (const b of blocks) {
    if (b.type === 'paragraph') text(runsText(b.text));
    else if (b.type === 'list') b.items.forEach((it) => text(runsText(it)));
    else if (b.type === 'table') {
      b.rows.forEach((row, r) => {
        row.forEach((cell, c) => {
          const n = cell.split(PENDING_MARK).length - 1;
          if (n === 0) return;
          const first = row[0]?.trim();
          const head = first && !first.includes(PENDING_MARK) && c > 0 ? first : `第 ${r + 1} 行`;
          for (let k = 0; k < n; k++) out.push({ label: `${head} · ${headerAt(b.header, c)}`, where: 'table' });
        });
      });
    }
  }
  return out;
}

function sectionsById(doc: DeliveryDocument): Map<string, DocSection> {
  const map = new Map<string, DocSection>();
  const walk = (list: DocSection[]) =>
    list.forEach((s) => {
      map.set(s.id, s);
      walk(s.sections);
    });
  walk(doc.sections);
  return map;
}

/**
 * 待补充清单。generated 是生成时的文档，current 是盖过专家修改的文档（applyEdits 的结果）。
 * 现在正文里的每处占位都算待补充（包括专家自己写的）；生成时有、现在没有的，
 * 在同一节里按标签对出来，算已处理，排在这一节待补充的后面。
 */
export function pendingOf(generated: DeliveryDocument, current: DeliveryDocument): PendingView {
  const chapters = docChapters(current);
  const before = sectionsById(generated);
  const now = sectionsById(current);
  const items: PendingItem[] = [];
  for (const ch of chapters) {
    for (const ref of ch.sections) {
      const sec = now.get(ref.id);
      if (!sec) continue;
      const cur = foundIn(sec.blocks, sec.title);
      const gen = before.get(ref.id);
      const left = new Map<string, number>();
      for (const f of cur) left.set(f.label, (left.get(f.label) ?? 0) + 1);
      const handled: Found[] = [];
      for (const f of gen ? foundIn(gen.blocks, gen.title) : []) {
        const n = left.get(f.label) ?? 0;
        if (n > 0) left.set(f.label, n - 1);
        else handled.push(f);
      }
      const base = { sectionId: sec.id, sectionTitle: sec.title, chapterId: ch.id };
      for (const f of cur) items.push({ ...base, ...f, handled: false });
      for (const f of handled) items.push({ ...base, ...f, handled: true });
    }
  }
  return {
    items,
    chapters: chapters.map((c) => ({ ...c, pending: items.filter((i) => i.chapterId === c.id && !i.handled).length })),
  };
}

/** 还没处理的处数 */
export function pendingCount(view: PendingView): number {
  return view.items.filter((i) => !i.handled).length;
}
