import type { Block, DeliveryDocument, DocSection } from '@genyun/shared';
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

const titles = (doc: DeliveryDocument) => doc.sections.map((s) => [s.title, ...s.sections.map((c) => c.title)]);

describe('风险评估报告', () => {
  let doc: DeliveryDocument;
  let text = '';
  beforeAll(() => {
    doc = buildRiskReport(feiyuPlanInput);
    text = allText(doc);
  }, 60_000);

  it('章节与旧仓库目录一致', () => {
    expect(titles(doc)).toEqual([
      ['1. 危险有害因素辨识', '1.1 依据', '1.2 公司基本概况', '1.3 危险有害因素辨识'],
      ['2. 事故风险分析', '2.1 现有安全生产管理情况', '2.2 事故风险分析'],
      ['3. 事故风险评价', '3.1 事故风险程度', '3.2 划定事故风险等级'],
      ['4. 结论建议', '4.1 评估结论', '4.2 建议'],
    ]);
    expect(doc.cover).toMatchObject({ name: '生产安全事故风险评估报告', dates: ['编制日期：2026年4月11日'] });
  });

  it('LEC 评估表 22 项，D 值和风险程度由系统算', () => {
    const table = doc.sections[1]!.sections[1]!.blocks.find((b) => b.type === 'table' && b.caption?.includes('2.2-5'));
    expect(table?.type === 'table' && table.rows).toHaveLength(22);
    expect(text).toMatch(/当前风险值较高的危险有害因素为：.+（D=\d+/);
  });

  it('飞宇资料齐全，没有待补充、内部编号', () => {
    expect(text).not.toContain('（待补充）');
    expect(text).not.toMatch(/\bE[1-6]\b|\{\{|undefined|null|NaN/);
    expect(text).toContain('酒精');
  });
});

describe('应急资源调查报告', () => {
  let doc: DeliveryDocument;
  let text = '';
  beforeAll(() => {
    doc = buildResourceReport(feiyuPlanInput);
    text = allText(doc);
  }, 60_000);

  it('章节与旧仓库目录一致', () => {
    expect(titles(doc)).toEqual([
      ['1. 单位内部应急资源', '1.1 依据', '1.2 调查工作', '1.3 公司基本情况', '1.4 公司内部人力和物资应急资源'],
      ['2. 单位外部应急资源'],
      ['3. 应急资源差距分析'],
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
});
