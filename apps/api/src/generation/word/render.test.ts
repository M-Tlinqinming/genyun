import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { LAYOUTS } from './layout.ts';
import { columnWidths, renderWord } from './render.ts';
import { samplePlan } from './sample.ts';

const text = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

describe('按排版规范生成 Word', () => {
  let document = '';
  let styles = '';
  let settings = '';
  let headers: string[] = [];

  beforeAll(async () => {
    const zip = await JSZip.loadAsync(await renderWord(samplePlan()));
    document = await zip.file('word/document.xml')!.async('string');
    styles = await zip.file('word/styles.xml')!.async('string');
    settings = await zip.file('word/settings.xml')!.async('string');
    headers = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => /^word\/header\d+\.xml$/.test(n))
        .map((n) => zip.file(n)!.async('string')),
    );
  });

  it('页面顺序：封面、批准发布令、编制小组、目录，然后才是正文', () => {
    const all = text(document);
    const order = ['预案编号：FY2026', '生产安全事故应急预案', '发布日期：2026年4月11日   实施日期：2026年4月12日', '预案批准发布令', '应急预案编制小组', '目  录', '一、综合应急预案'];
    const positions = order.map((t) => all.indexOf(t));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('封面和批准发布令没有页眉，编制小组和目录有页眉没页码，正文页码从 1 起，页眉是文档全称', () => {
    const sections = [...document.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)].map((m) => m[0]);
    const starts = document.split(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
    expect(text(starts[0]!)).toContain('预案批准发布令');
    expect(text(starts[0]!)).not.toContain('成员构成及分工如下');
    // 节的分隔记在上一节最后一段里，这一段的文字会落到下一截开头，所以只看包含关系
    expect(text(starts[1]!)).toContain('成员构成及分工如下');
    expect(text(starts[1]!)).toContain('目  录');
    expect(sections[2]).toMatch(/<w:pgNumType w:start="1"/);
    expect(sections.filter((s) => /pgNumType w:start/.test(s)).length).toBe(1);
    expect(headers.some((h) => text(h) === '惠阳飞宇电器有限公司生产安全事故应急预案')).toBe(true);
  });

  it('图纸单独放在横版页，其余是 A4 竖版', () => {
    const sizes = [...document.matchAll(/<w:pgSz [^>]*\/>/g)].map((m) => m[0]);
    const landscape = sizes.filter((s) => /w:orient="landscape"/.test(s));
    expect(landscape.length).toBe(1);
    expect(landscape[0]).toMatch(/w:w="16838"/);
    expect(sizes.filter((s) => !/landscape/.test(s)).every((s) => /w:w="11906"[^>]*w:h="16838"/.test(s))).toBe(true);
  });

  it('目录收三级标题，打开时自动更新', () => {
    expect(document).toMatch(/<w:instrText[^>]*>TOC [^<]*\\o &quot;1-3&quot;/);
    expect(settings).toMatch(/<w:updateFields(?: w:val="true")?\/>/);
  });

  it('仿宋，正文四号，一级标题三号加粗', () => {
    expect(styles).toMatch(/w:eastAsia="仿宋"/);
    const heading1 = styles.match(/<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)![0];
    expect(heading1).toMatch(/<w:sz w:val="32"\/>/);
    expect(heading1).toMatch(/<w:b\/>/);
    expect(styles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)![0]).toMatch(/<w:sz w:val="28"\/>/);
  });

  it('行距写成固定值（转 PDF 时分页才和 Word 一致），图所在段落是自动行距', () => {
    expect(styles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)![0]).toMatch(
      /<w:spacing [^>]*w:line="545"[^>]*w:lineRule="exact"/,
    );
    expect(document).not.toMatch(/<w:spacing [^>]*w:line="360"/);
    const lines = [...document.matchAll(/<w:spacing [^>]*w:line="\d+"[^>]*\/>/g)].map((m) => m[0]);
    expect(lines.filter((s) => !/lineRule="exact"/.test(s)).every((s) => /w:line="240" w:lineRule="auto"/.test(s))).toBe(
      true,
    );
    const imageParagraph = document.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*?<w:drawing>/)![0];
    expect(imageParagraph).toMatch(/w:lineRule="auto"/);
  });

  it('每个列表从 1 重新编号', () => {
    const numIds = new Set([...document.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
    expect(numIds.size).toBe(2);
  });

  it('每一件另起一页，附件逐个另起一页', () => {
    // 目录里也有同名条目，只看正文标题
    const paragraphs = document.split('</w:p>');
    const breaksBefore = (title: string) => {
      const p = paragraphs.find((x) => /<w:pStyle w:val="Heading\d"\/>/.test(x) && text(x) === title)!;
      return /<w:pageBreakBefore\/>/.test(p);
    };
    expect(breaksBefore('二、火灾事故专项应急预案')).toBe(true);
    expect(breaksBefore('九、附件')).toBe(true);
    expect(breaksBefore('附件4、应急物资装备的名录或清单')).toBe(false);
    expect(breaksBefore('附件8、应急资源调查报告')).toBe(true);
  });
});

describe('表格列宽', () => {
  const rule = LAYOUTS.plan.table;

  it('合计等于版心宽，长内容的列最宽', () => {
    const widths = columnWidths([['序号', '分工']], [['1', '制定应急预案编制计划，组织技术人员编制、评审、修订应急预案']], 2, 9070, rule);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(9070);
    expect(widths[1]!).toBeGreaterThan(widths[0]!);
  });

  it('每列至少放得下表头，不会一个字一行', () => {
    const header = [['序号', '项目', '姓名', '应急职务', '分工', '签名']];
    const rows = [['1', '编制组成员', '陈某', '总指挥', '制定应急预案编制计划，组织技术人员编制、评审、修订应急预案，并签署、颁布实施', '']];
    const widths = columnWidths(header, rows, 6, 9070, rule);
    header[0]!.forEach((h, c) => expect(widths[c]!).toBeGreaterThanOrEqual([...h].length * rule.header.size * 10 + rule.cellPadding));
  });
});
