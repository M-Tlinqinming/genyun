import { planHazardsOf, riskView, type Block, type DeliveryDocument, type DocSection } from '@genyun/shared';
import { feiyuSnapshot } from '@genyun/shared/fixtures/feiyu-profile';
import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderWord } from '../word/render.ts';
import { buildResourceReport } from './resource.ts';
import { buildRiskReport } from './risk.ts';

function allText(doc: DeliveryDocument): string {
  const out: string[] = [doc.cover.company, doc.cover.name, ...doc.cover.lines, ...doc.cover.dates];
  const runs = (r: (string | { text: string })[]) => r.map((x) => (typeof x === 'string' ? x : x.text)).join('');
  const blocks = (bs: Block[]) => {
    for (const b of bs) {
      if (b.type === 'paragraph') out.push(runs(b.text));
      else if (b.type === 'list') b.items.forEach((i) => out.push(runs(i)));
      else if (b.type === 'table') [...(b.header ?? []), ...b.rows].forEach((r) => out.push(r.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).join(' | ')));
    }
  };
  const walk = (s: DocSection) => {
    out.push(s.title);
    blocks(s.blocks);
    s.sections.forEach(walk);
  };
  doc.sections.forEach(walk);
  return out.join('\n');
}

const stamp = { by: 'u-zhou', byName: '周工', at: '2026-10-29T08:00:00.000Z' };
const titles = (doc: DeliveryDocument) => doc.sections.map((s) => [s.title, ...s.sections.map((c) => c.title)]);

describe('风险评估报告', () => {
  let doc: DeliveryDocument;
  let text = '';
  beforeAll(() => {
    doc = buildRiskReport(feiyuPlanInput);
    text = allText(doc);
  }, 60_000);

  it('章节与旧仓库目录一致，编号后不空格（按专家稿）', () => {
    expect(titles(doc)).toEqual([
      ['1.危险有害因素辨识', '1.1依据', '1.2公司基本概况', '1.3危险有害因素辨识'],
      ['2.事故风险分析', '2.1现有安全生产管理情况', '2.2事故风险分析'],
      ['3.事故风险评价', '3.1事故风险程度', '3.2划定事故风险等级'],
      ['4.结论建议', '4.1评估结论', '4.2建议'],
    ]);
    expect(doc.cover).toMatchObject({ name: '生产安全事故风险评估报告', dates: ['编制日期：2026年4月11日'] });
  });

  it('LEC 评估表 22 项，D 值和风险程度由系统算', () => {
    const table = doc.sections[1]!.sections[1]!.blocks.find((b) => b.type === 'table' && b.caption?.includes('2.2-5'));
    expect(table?.type === 'table' && table.rows).toHaveLength(22);
    expect(text).toMatch(/当前风险值较高的危险有害因素为：.+（D=\d+/);
  });

  it('专家在危险源辨识里的取值进评估表：改过的值、不适用的去掉、新增的加上', () => {
    const view = riskView(feiyuSnapshot, {
      risks: {
        rows: {
          SP01: { ...stamp, value: { factor: '火灾', workplace: '1 号生产厂房', l: 1, e: 6, c: 40 } },
          SP02: { ...stamp, value: { factor: '触电', workplace: '配电房', l: 1, e: 6, c: 7, excluded: true } },
          xr1: { ...stamp, value: { factor: '其他爆炸', workplace: '气瓶间', l: 1, e: 3, c: 40 } },
        },
      },
    });
    const report = buildRiskReport({ ...feiyuPlanInput, expert: { ...feiyuPlanInput.expert, hazards: planHazardsOf(view) } });
    const table = report.sections[1]!.sections[1]!.blocks.find((b) => b.type === 'table' && b.caption?.includes('2.2-5'));
    const rows = table?.type === 'table' ? table.rows.map((r) => r.join(' | ')) : [];
    expect(rows).toHaveLength(view.rows.length - 1);
    expect(rows).toContain('1 | 火灾 | 1 | 6 | 40 | 240 | 高度危险');
    expect(rows.some((r) => r.includes('触电'))).toBe(false);
    expect(rows.at(-1)).toMatch(/其他爆炸 \| 1 \| 3 \| 40 \| 120 \| 显著危险$/);
  });

  it('飞宇资料齐全，没有待补充、内部编号', () => {
    expect(text).not.toContain('（待补充）');
    expect(text).not.toMatch(/\bE[1-6]\b|\{\{|undefined|null|NaN/);
    expect(text).toContain('酒精');
  });

  it('危险有害因素按事故类型逐条写场所和成因', () => {
    expect(text).toMatch(/（1）火灾：主要场所：/);
    expect(text).toMatch(/粉尘爆炸：主要场所：[^\n]*抛光/);
  });

  it('重大危险源由系统按 ∑q/Q 判定', () => {
    expect(text).toMatch(/酒精 \| [\d.]+ \| 500 \| [\d.]+/);
    expect(text).toContain('不构成危险化学品重大危险源');
    expect(text).not.toContain('待核定');
  });

  it('不写没有依据的班制，现有管理情况写到指挥部和小组', () => {
    expect(text).not.toContain('年工作日按 300 天');
    expect(text).toMatch(/总指挥/);
    expect(text).toMatch(/小组/);
  });
});

describe('应急资源调查报告', () => {
  let doc: DeliveryDocument;
  let text = '';
  beforeAll(() => {
    doc = buildResourceReport(feiyuPlanInput);
    text = allText(doc);
  }, 60_000);

  it('章节与旧仓库目录一致，编号后不空格（按专家稿）', () => {
    expect(titles(doc)).toEqual([
      ['1.单位内部应急资源', '1.1依据', '1.2调查工作', '1.3公司基本情况', '1.4公司内部人力和物资应急资源'],
      ['2.单位外部应急资源'],
      ['3.应急资源差距分析'],
    ]);
  });

  it('值班电话用客户填的 24 小时值班电话；应急组织成员与物资保管人带出', () => {
    expect(text).toContain('企业 24 小时值班电话 | 0752-3324567');
    expect(text).toContain('应急指挥部 | 李文聪 | 总指挥');
    expect(text).toContain('仲恺高新区消防救援大队');
    expect(text).not.toContain('（待补充）');
  });

  it('建议补充的装备不列企业已有的', () => {
    const existing = feiyuPlanInput.production.emergencySupplies.map((s) => s.name);
    const gap = doc.sections[2]!.blocks.find((b) => b.type === 'table');
    const names = gap?.type === 'table' ? gap.rows.map((r) => String(r[1])) : [];
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(existing.some((e) => e.includes(n))).toBe(false);
  });
});

describe('两份报告生成 Word', () => {
  it('都能打开，风险评估报告带工艺流程图', async () => {
    for (const [doc, images] of [
      [buildRiskReport(feiyuPlanInput), 1],
      [buildResourceReport(feiyuPlanInput), 0],
    ] as const) {
      const zip = await JSZip.loadAsync(await renderWord(doc));
      expect(await zip.file('word/document.xml')!.async('string')).toContain(doc.sections[0]!.title);
      expect(Object.keys(zip.files).filter((n) => /^word\/media\/.+\.png$/.test(n))).toHaveLength(images);
    }
  }, 60_000);

  it('按专家稿排版：没有页眉有页码，章标题四号加粗靠左，封面小二，表题四号不加粗，短列居中', async () => {
    const zip = await JSZip.loadAsync(await renderWord(buildRiskReport(feiyuPlanInput)));
    const read = (n: string) => zip.file(n)!.async('string');
    const document = await read('word/document.xml');
    const styles = await read('word/styles.xml');
    const parts = Object.keys(zip.files);
    const headers = await Promise.all(parts.filter((n) => /^word\/header\d+\.xml$/.test(n)).map(read));
    const footers = await Promise.all(parts.filter((n) => /^word\/footer\d+\.xml$/.test(n)).map(read));
    expect(headers.every((h) => !/<w:t[ >]/.test(h))).toBe(true);
    expect(footers.some((f) => /PAGE/.test(f))).toBe(true);

    const heading1 = styles.match(/<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)![0];
    expect(heading1).toMatch(/<w:sz w:val="28"\/>/);
    expect(heading1).toMatch(/<w:b\/>/);
    expect(heading1).toMatch(/<w:jc w:val="left"\/>/);
    expect(document).toMatch(/<w:instrText[^>]*>TOC [^<]*\\o &quot;1-2&quot;/);

    const paragraphs = document.split('</w:p>');
    const para = (t: string) => paragraphs.find((p) => p.includes(`>${t}<`))!;
    expect(para('生产安全事故风险评估报告')).toMatch(/<w:sz w:val="36"\/>/);
    const caption = para('表1.2-1企业基本情况表');
    expect(caption).toMatch(/<w:sz w:val="28"\/>/);
    expect(caption).not.toMatch(/<w:b\/>/);
    // 序号列整列一行放得下，居中；作业场所列有长地址，靠左
    expect(paragraphs.find((p) => /<w:tc>/.test(p) && />1</.test(p) && !/<w:b\/>/.test(p))).toMatch(/<w:jc w:val="center"\/>/);
  }, 60_000);
});
