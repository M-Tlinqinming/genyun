import { SCOPE_KEYS, planSignals, selectPlans, resolveScope, type Block as DocBlock, type DocSection, type PlanInput, type Scope } from '@genyun/shared';
import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderWord } from '../word/render.ts';
import { applyConditions, buildPlan } from './assemble.ts';
import { usesKnowledgeBlock } from './content.ts';
import { humanize } from './humanize.ts';
import { parseMarkdown, toSections } from './markdown.ts';

/** 文档结构里的全部文字（标题 + 段落 + 表格 + 图题） */
function allText(doc: ReturnType<typeof buildPlan>): string {
  const out: string[] = [];
  const runs = (r: (string | { text: string })[]) => r.map((x) => (typeof x === 'string' ? x : x.text)).join('');
  const blocks = (bs: DocBlock[]) => {
    for (const b of bs) {
      if (b.type === 'paragraph') out.push(runs(b.text));
      else if (b.type === 'list') b.items.forEach((i) => out.push(runs(i)));
      else if (b.type === 'table') [...(b.header ?? []), ...b.rows].forEach((r) => out.push(r.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).join(' ')));
      else if (b.type === 'figure' && b.caption) out.push(b.caption);
    }
  };
  const walk = (s: DocSection) => {
    out.push(s.title);
    blocks(s.blocks);
    s.sections?.forEach(walk);
  };
  out.push(...doc.cover.lines, ...doc.cover.dates);
  doc.frontPages.forEach((p) => {
    out.push(p.title);
    blocks(p.blocks);
    out.push(...(p.signature ?? []));
  });
  doc.sections.forEach(walk);
  return out.join('\n');
}

// 没有压铸、粉尘、危化品的装配厂：知识块（按压铸厂写的）一个都不能用
const assembler: PlanInput = {
  ...feiyuPlanInput,
  basic: { ...feiyuPlanInput.basic, companyName: '惠州市示例电子有限公司' },
  production: {
    ...feiyuPlanInput.production,
    buildings: [{ name: '1 号厂房', floors: 2, floorAreaM2: 1800 }],
    equipment: [],
    specialEquipment: {
      pressureVessels: { answer: 'no' },
      boilers: { answer: 'no' },
      pressurePipelines: { answer: 'no' },
      storageTanks: { answer: 'no' },
    },
    materials: feiyuPlanInput.production.materials.filter((m) => m.name === '电线'),
    processFlow: {
      ...feiyuPlanInput.production.processFlow,
      steps: ['组装', '品质检测', '包装出货'].map((name) => ({ name, equipment: [], inputs: [], next: 'next' as const })),
    },
  },
  // 飞宇专家写的分级举例里有压铸，换企业时不带过来
  expert: { ...feiyuPlanInput.expert, hazardousMaterials: [], hazards: [], facts: { ...feiyuPlanInput.expert.facts!, responseGrading: undefined } },
};

describe('飞宇整份应急预案', () => {
  let plan: ReturnType<typeof buildPlan>;
  let text = '';
  beforeAll(() => {
    plan = buildPlan(feiyuPlanInput);
    text = allText(plan);
  }, 60_000);

  it('件的顺序与旧仓库一致：综合、两个专项、现场处置方案、附件', () => {
    expect(plan.sections.map((s) => s.title)).toEqual([
      '一、综合应急预案',
      '二、火灾爆炸事故专项应急预案',
      '三、粉尘爆炸事故专项应急预案',
      '四、现场处置方案',
      '五、附件',
    ]);
  });

  it('综合预案五章，专项五要素，现场处置 14 个方案，附件 10 个', () => {
    const [comprehensive, fire, , site, attachments] = plan.sections;
    expect(comprehensive!.sections!.map((s) => s.title)).toEqual(['1. 总则', '2. 应急组织机构及职责', '3. 应急响应', '4. 后期处置', '5. 应急保障']);
    expect(comprehensive!.sections![2]!.sections![0]!.title).toBe('3.1 信息报告');
    expect(fire!.sections!.map((s) => s.title)).toEqual(['1. 适用范围', '2. 应急组织机构及职责', '3. 响应启动', '4. 处置措施', '5. 应急保障']);
    expect(site!.sections).toHaveLength(14);
    expect(site!.sections![0]!.title).toBe('1. 火灾事故现场处置方案');
    expect(site!.sections![1]!.title).toBe('2. 触电事故现场处置方案');
    expect(site!.sections![1]!.sections![0]!.title).toMatch(/^2\.1 /);
    expect(attachments!.childrenOnNewPage).toBe(true);
    expect(attachments!.sections!.map((s) => s.title)).toEqual([
      '附件1、生产经营单位概况',
      '附件2、风险评估的结果',
      '附件3、预案体系与衔接',
      '附件4、应急物资装备的名录或清单',
      '附件5、有关应急部门、机构或人员的联系方式',
      '附件6、格式化文本',
      '附件7、关键图纸',
      '附件8、应急资源调查报告',
      '附件9、应急培训计划与演练安排',
      '附件10、报警流程',
    ]);
    expect(attachments!.sections![0]!.sections![0]!.title).toMatch(/^附1\.1\. /);
  });

  it('封面、批准发布令、编制小组', () => {
    expect(plan.cover).toMatchObject({ code: 'FY2026', version: 'A 2026', dates: ['发布日期：2026年4月11日', '实施日期：2026年4月12日'] });
    expect(plan.frontPages.map((p) => p.title)).toEqual(['预案批准发布令', '应急预案编制小组']);
    expect(text).toContain('签发：主要负责人 李文聪');
  });

  it('交付物里没有内部编号、导则章节号、警示图标、未替换的占位符', () => {
    expect(text).not.toMatch(/\bS?P\d{1,2}[ab]?\b/);
    expect(text).not.toMatch(/\bE[1-6]\b/);
    expect(text).not.toMatch(/§/);
    expect(text).not.toMatch(/🛑|⚠/);
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(text).not.toMatch(/undefined|null|NaN/);
  });

  it('飞宇资料齐全，没有「待补充」', () => {
    expect(text).not.toContain('（待补充）');
  });

  it('值班电话、属地机构、消防大队按企业数据填', () => {
    expect(text).toContain('0752-3324567');
    expect(text).toContain('仲恺高新区消防救援大队');
    expect(text).toContain('0752-3271388');
  });

  it('压铸、金属粉尘、酒精的知识块都用上了，安全要点句一字不差', () => {
    const signals = planSignals(feiyuPlanInput);
    const selection = selectPlans(resolveScope(feiyuPlanInput));
    const used = [...selection.specialty, ...selection.site].filter((t) => usesKnowledgeBlock(t, signals)).map((t) => t.id);
    expect(used.sort()).toEqual(['P1', 'P2', 'SP01', 'SP03', 'SP05', 'SP06', 'SP10', 'SP20', 'SP21']);
    expect(text).toContain('严禁用水扑救与熔融物直接接触或邻近的可燃物');
    expect(text).toContain('严禁用高压水枪或压缩空气直吹积尘部位');
    expect(text).toContain('不可用倒转设备的方法取出肢体');
  });

  it('图都画出来了：组织机构图、响应流程、工艺流程、预案体系、报警流程', () => {
    const figures: DocBlock[] = [];
    const walk = (s: DocSection) => {
      figures.push(...s.blocks.filter((b) => b.type === 'figure'));
      s.sections?.forEach(walk);
    };
    plan.sections.forEach(walk);
    expect(figures).toHaveLength(5);
  });

  describe('生成 Word', () => {
    let document = '';
    let media = 0;
    beforeAll(async () => {
      const zip = await JSZip.loadAsync(await renderWord(plan));
      document = await zip.file('word/document.xml')!.async('string');
      media = Object.keys(zip.files).filter((n) => /^word\/media\/.+\.png$/.test(n)).length;
    }, 60_000);

    it('打得开，五张图都嵌进去了', () => {
      expect(document).toContain('火灾事故现场处置方案');
      expect(media).toBe(5);
    });
  });
});

describe('没有压铸、粉尘的企业', () => {
  let plan: ReturnType<typeof buildPlan>;
  beforeAll(() => {
    plan = buildPlan(assembler);
  }, 60_000);

  it('知识块一个都不用，回到通用模板；不出现压铸厂的内容', () => {
    const signals = planSignals(assembler);
    const selection = selectPlans(resolveScope(assembler));
    expect([...selection.specialty, ...selection.site].filter((t) => usesKnowledgeBlock(t, signals))).toEqual([]);
    const text = allText(plan);
    expect(text).toContain('惠州市示例电子有限公司');
    expect(text).not.toMatch(/压铸|熔融金属|铝液|锌液/);
    expect(text).not.toMatch(/\bS?P\d{1,2}[ab]?\b|§|\{\{/);
  });

  it('只有火灾专项时件号顺延：一、综合；二、火灾专项；三、现场处置方案；四、附件', () => {
    expect(plan.sections.map((s) => s.title)).toEqual(['一、综合应急预案', '二、火灾爆炸事故专项应急预案', '三、现场处置方案', '四、附件']);
  });
});

describe('所有开关都打开', () => {
  it('28 份模板都能生成，不带知识库成稿里别家企业的电话、地名、物料', () => {
    const all = Object.fromEntries(SCOPE_KEYS.map((k) => [k, true])) as Scope;
    const plan = buildPlan({ ...assembler, expert: { ...assembler.expert, scope: all } });
    const text = allText(plan);
    expect(text).toContain('起重致害事故现场处置方案');
    expect(text).not.toMatch(/15986988133|0752-(?:2230498|2312399|3223119|3328738|6761118|7872806|7783260)|13113411616|15875227223|13719613523/);
    expect(text).not.toMatch(/水口街道|龙门县|专职消防队|油墨|稀释剂|环氧乙烷/);
    expect(text).not.toMatch(/\bS?P\d{1,2}[ab]?\b|§|\{\{|\[\[/);
  }, 60_000);
});

describe('按企业情况取舍的段落', () => {
  it('任一条件为真就保留，!key 取反，可嵌套；未知条件、没配对的 endif 报错', () => {
    const md = ['甲', '[[if:a|b]]', '乙', '[[if:!a]]', '丙', '[[endif]]', '[[endif]]', '丁'].join('\n');
    expect(applyConditions(md, { a: true, b: false })).toBe('甲\n乙\n丁');
    expect(applyConditions(md, { a: false, b: true })).toBe('甲\n乙\n丙\n丁');
    expect(applyConditions(md, { a: false, b: false })).toBe('甲\n丁');
    expect(() => applyConditions('[[if:c]]\n[[endif]]', { a: true })).toThrow('未知的条件');
    expect(() => applyConditions('[[endif]]', {})).toThrow('多了');
    expect(() => applyConditions('[[if:a]]', { a: true })).toThrow('缺少');
  });

  it('起重致害合成一份：只有电梯写电梯，只有行车写行车', () => {
    const withScope = (scope: Partial<Scope>) => ({ ...assembler, expert: { ...assembler.expert, scope: { ...assembler.expert.scope, ...scope } } });
    const lifting = (plan: ReturnType<typeof buildPlan>) => {
      const site = plan.sections.find((s) => s.title.endsWith('现场处置方案'))!;
      const sp08 = site.sections!.find((s) => s.title.includes('起重致害'))!;
      return allText({ ...plan, cover: { ...plan.cover, lines: [], dates: [] }, frontPages: [], sections: [sp08] });
    };
    const elevator = lifting(buildPlan(withScope({ elevator: true, craneHoist: false })));
    expect(elevator).toContain('电梯伤害处置措施');
    expect(elevator).not.toContain('行车');
    const crane = lifting(buildPlan(withScope({ elevator: false, craneHoist: true })));
    expect(crane).toContain('行车伤害处置措施');
    expect(crane).not.toContain('电梯');
  }, 60_000);
});

describe('可读化', () => {
  it('编号后面已有名称时去掉编号，裸编号换成名称', () => {
    expect(humanize('按 SP18 管道爆炸事故现场处置方案处置')).toBe('按 管道爆炸事故现场处置方案处置');
    expect(humanize('按 SP18 处置')).toBe('按 管道爆炸事故现场处置方案处置');
    expect(humanize('按 SP04/SP11 处置原则')).toBe('按 物体打击事故现场处置方案 / 高处坠落事故现场处置方案处置原则');
  });

  it('导则章节号换成本预案章节号，图标去掉', () => {
    expect(humanize('见 §6.3.1 信息报告')).toBe('见 3.1 信息报告');
    expect(humanize('见 §6.3.5')).toBe('见 3.5 应急支援');
    expect(humanize('见 §9.9')).toBe('见 本预案相关附件');
    expect(humanize('🛑 严禁向熔融物注水')).toBe('严禁向熔融物注水');
  });
});

describe('Markdown 转文档结构', () => {
  const md = [
    '# 甲',
    '导语',
    '## 一',
    '- 圆点',
    '1. 编号',
    '**表 1 清单**',
    '| 名称 | 数量 |',
    '| --- | --- |',
    '| 灭火器 | 2 |',
    '### 深',
    '#### 更深',
    '正文',
  ].join('\n');

  it('标题成节，表题、列表、表格各归其位，超过层数的标题拍平成加粗段落', () => {
    const { sections } = parseMarkdown(md, {});
    const [root] = sections;
    expect(root!.title).toBe('甲');
    const out = toSections(root!.children, 'x', { maxDepth: 2, title: (p, t) => `${p.join('.')} ${t}` });
    expect(out[0]!.title).toBe('1 一');
    const blocks = out[0]!.blocks;
    expect(blocks.find((b) => b.type === 'list' && b.ordered === false)).toBeTruthy();
    expect(blocks.find((b) => b.type === 'table')).toMatchObject({ caption: '表 1 清单', rows: [['灭火器', '2']] });
    const deep = out[0]!.sections![0]!;
    expect(deep.title).toBe('1.1 深');
    expect(deep.sections ?? []).toHaveLength(0);
    expect(JSON.stringify(deep.blocks)).toContain('更深');
  });

  it('引用了没画的图就报错', () => {
    expect(() => parseMarkdown('[[figure:nope]]', {})).toThrow();
  });
});
