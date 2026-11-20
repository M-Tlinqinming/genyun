import { describe, expect, it } from 'vitest';
import type { DeliveryDocument, DocSection } from './document/model.ts';
import { applyEdits } from './editing.ts';
import { docChapters, pendingCount, pendingOf, textLabel } from './pending.ts';

const sec = (id: string, title: string, blocks: DocSection['blocks'], sections: DocSection[] = []): DocSection => ({ id, title, blocks, sections });
const docOf = (kind: DeliveryDocument['kind'], sections: DocSection[]): DeliveryDocument => ({
  kind,
  title: '飞宇',
  cover: { company: '飞宇', name: '应急预案', lines: [], dates: [] },
  frontPages: [],
  sections,
});

const plan = docOf('plan', [
  sec('p.c', '一、综合应急预案', [{ type: 'paragraph', text: ['本预案适用于全厂。'] }], [
    sec('p.c.1', '1. 总则', [], [
      sec('p.c.1.1', '1.1 适用范围', [{ type: 'paragraph', text: ['总指挥：（待补充），副总指挥为（待补充）。'] }]),
      sec('p.c.1.2', '1.2 响应分级', [{ type: 'list', items: [['值班电话是（待补充）'], ['（待补充）']] }]),
    ]),
    sec('p.c.2', '2. 应急组织机构及职责', [
      { type: 'paragraph', text: ['各小组如下。'] },
      {
        type: 'table',
        caption: '表 2-1 应急小组',
        header: [['小组', '组长', '组员']],
        rows: [
          ['通讯联络组', '李某', '（待补充）'],
          ['（待补充）', '王某', '张某'],
        ],
      },
    ]),
  ]),
  sec('p.s', '二、火灾事故专项应急预案', [], [sec('p.s.1', '1. 适用范围', [{ type: 'paragraph', text: ['适用于火灾。'] }])]),
  sec('p.a', '三、附件', [{ type: 'paragraph', text: ['厂区平面图（待补充）：由企业提供后纳入正式文本。'] }]),
]);

describe('章怎么分', () => {
  it('应急预案：部分当分组，部分下的二级是章；部分自带正文的单算一章；没有子节的部分本身是一章', () => {
    const ch = docChapters(plan);
    expect(ch.map((c) => [c.id, c.group?.title ?? null])).toEqual([
      ['p.c', '一、综合应急预案'],
      ['p.c.1', '一、综合应急预案'],
      ['p.c.2', '一、综合应急预案'],
      ['p.s.1', '二、火灾事故专项应急预案'],
      ['p.a', null],
    ]);
    // 章本身没有正文就不算一节；子节按顺序展开
    expect(ch[1]!.sections.map((s) => [s.id, s.level])).toEqual([
      ['p.c.1.1', 1],
      ['p.c.1.2', 1],
    ]);
    expect(ch[2]!.sections.map((s) => s.id)).toEqual(['p.c.2']);
  });
  it('两份报告：第一层就是章，没有分组', () => {
    const risk = docOf('risk', [sec('r.1', '1 概述', [], [sec('r.1.1', '1.1 目的', [])]), sec('r.2', '2 风险', [{ type: 'paragraph', text: ['甲'] }])]);
    const ch = docChapters(risk);
    expect(ch.map((c) => [c.id, c.group])).toEqual([
      ['r.1', null],
      ['r.2', null],
    ]);
    expect(ch[0]!.sections.map((s) => s.id)).toEqual(['r.1.1']);
    expect(ch[1]!.sections.map((s) => s.id)).toEqual(['r.2']);
  });
});

describe('标签', () => {
  it('取占位前到上一个标点之间的字，去掉末尾的为、是、冒号', () => {
    expect(textLabel('总指挥：')).toBe('总指挥');
    expect(textLabel('总指挥：李某，副总指挥为')).toBe('副总指挥');
    expect(textLabel('值班电话是')).toBe('值班电话');
    expect(textLabel('')).toBe('');
  });

  it('段落、列表、表格三种情况', () => {
    const v = pendingOf(plan, plan);
    expect(v.items.map((i) => [i.sectionId, i.label, i.where])).toEqual([
      ['p.c.1.1', '总指挥', 'text'],
      ['p.c.1.1', '副总指挥', 'text'],
      ['p.c.1.2', '值班电话', 'text'],
      // 取不到字就用节标题
      ['p.c.1.2', '1.2 响应分级', 'text'],
      ['p.c.2', '通讯联络组 · 组员', 'table'],
      ['p.c.2', '第 2 行 · 小组', 'table'],
      ['p.a', '厂区平面图', 'text'],
    ]);
    expect(v.items.every((i) => !i.handled)).toBe(true);
  });

  it('每章的数只数没处理的', () => {
    const v = pendingOf(plan, plan);
    expect(Object.fromEntries(v.chapters.map((c) => [c.id, c.pending]))).toEqual({ 'p.c': 0, 'p.c.1': 4, 'p.c.2': 2, 'p.s.1': 0, 'p.a': 1 });
    expect(pendingCount(v)).toBe(7);
  });
});

describe('已处理', () => {
  it('改掉一处算已处理；专家自己写的「（待补充）」算待补充', () => {
    const current = applyEdits(plan, {
      'p.c.1.1': [{ type: 'paragraph', text: ['总指挥：李某，副总指挥为（待补充）。'] }],
      'p.s.1': [{ type: 'paragraph', text: ['适用于火灾，联系人（待补充）。'] }],
    });
    const v = pendingOf(plan, current);
    const one = v.items.filter((i) => i.sectionId === 'p.c.1.1');
    expect(one.map((i) => [i.label, i.handled])).toEqual([
      ['副总指挥', false],
      ['总指挥', true],
    ]);
    expect(v.items.find((i) => i.sectionId === 'p.s.1')).toMatchObject({ label: '联系人', handled: false, chapterId: 'p.s.1' });
    expect(v.chapters.find((c) => c.id === 'p.c.1')!.pending).toBe(3);
    expect(v.chapters.find((c) => c.id === 'p.s.1')!.pending).toBe(1);
  });
});
