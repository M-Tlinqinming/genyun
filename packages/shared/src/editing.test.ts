import { describe, expect, it } from 'vitest';
import type { Block, DeliveryDocument } from './document/model.ts';
import {
  applyEdits,
  blocksText,
  editableOf,
  editBlocksError,
  findSection,
  normalizeRuns,
  outlineOf,
  resolveEdit,
  sameBlocks,
  sectionSaveSchema,
  type EditBlock,
} from './editing.ts';

const table: Block = { type: 'table', caption: '表 1 应急通讯录', header: [['姓名', '电话']], rows: [['李某', '138']] };
const figure: Block = { type: 'figure', png: new Uint8Array([1, 2]), width: 10, height: 10, caption: '图 1 组织机构图' };

const doc: DeliveryDocument = {
  kind: 'plan',
  title: '飞宇应急预案',
  cover: { company: '飞宇', name: '应急预案', lines: [], dates: [] },
  frontPages: [],
  sections: [
    {
      id: 'general',
      title: '一、综合应急预案',
      blocks: [],
      sections: [
        {
          id: 'general.1',
          title: '1 总则',
          blocks: [{ type: 'paragraph', text: ['为了', { text: '规范', bold: true }, '应急工作。'] }, table],
          sections: [],
        },
      ],
    },
    { id: 'annex', title: '附件', blocks: [figure, { type: 'list', items: [['第一条'], ['第二条']] }], sections: [] },
  ],
};

describe('正文编辑：可编辑的内容', () => {
  it('段落和列表可编辑，表格与图锁定并带业务名称', () => {
    const blocks = editableOf(findSection(doc, 'general.1')!.section.blocks);
    expect(blocks).toEqual([
      { type: 'paragraph', text: ['为了', { text: '规范', bold: true }, '应急工作。'] },
      { type: 'locked', index: 1, label: '表格：表 1 应急通讯录' },
    ]);
    expect(editableOf([figure])[0]).toEqual({ type: 'locked', index: 0, label: '图：图 1 组织机构图' });
  });

  it('找到小节和它的上级标题', () => {
    const hit = findSection(doc, 'general.1')!;
    expect(hit.section.title).toBe('1 总则');
    expect(hit.path).toEqual(['一、综合应急预案', '1 总则']);
    expect(findSection(doc, 'nope')).toBeNull();
  });

  it('保存后的内容把锁定块换回原来的表格和图', () => {
    const original = findSection(doc, 'general.1')!.section.blocks;
    const edit: EditBlock[] = [
      { type: 'paragraph', text: ['新的总则。'] },
      { type: 'locked', index: 1, label: '表格：表 1 应急通讯录' },
    ];
    expect(resolveEdit(original, edit)).toEqual([{ type: 'paragraph', text: ['新的总则。'] }, table]);
  });

  it('表格和图不能在正文里删除或挪动；正文不能为空', () => {
    const original = [table, figure];
    expect(editBlocksError(original, [{ type: 'locked', index: 0, label: '' }])).toMatch(/表格和图/);
    expect(
      editBlocksError(original, [
        { type: 'locked', index: 1, label: '' },
        { type: 'locked', index: 0, label: '' },
      ]),
    ).toMatch(/表格和图/);
    expect(
      editBlocksError(original, [
        { type: 'locked', index: 0, label: '' },
        { type: 'paragraph', text: ['补一句'] },
        { type: 'locked', index: 1, label: '' },
      ]),
    ).toBeNull();
    expect(editBlocksError([{ type: 'paragraph', text: ['原文'] }], [{ type: 'paragraph', text: ['  '] }])).toMatch(/不能为空/);
  });

  it('合并相邻同样式的文字，去掉空的', () => {
    expect(normalizeRuns(['甲', '', { text: '乙', bold: false }, { text: '丙', bold: true }, { text: '丁', bold: true }])).toEqual([
      '甲乙',
      { text: '丙丁', bold: true },
    ]);
  });

  it('判断内容有没有改', () => {
    const a: EditBlock[] = [{ type: 'paragraph', text: ['甲', '乙'] }];
    expect(sameBlocks(a, [{ type: 'paragraph', text: ['甲乙'] }])).toBe(true);
    expect(sameBlocks(a, [{ type: 'paragraph', text: [{ text: '甲乙', bold: true }] }])).toBe(false);
  });

  it('纯文字：冲突对照和复制用', () => {
    const blocks = editableOf(findSection(doc, 'annex')!.section.blocks);
    expect(blocksText(blocks)).toBe('［图：图 1 组织机构图］\n1. 第一条\n2. 第二条');
  });
});

describe('正文编辑：整份文档', () => {
  it('目录：每节标题、层级和是否改过', () => {
    const outline = outlineOf(doc, { 'general.1': true });
    expect(outline).toEqual([
      {
        id: 'general',
        title: '一、综合应急预案',
        edited: false,
        children: [{ id: 'general.1', title: '1 总则', edited: true, children: [] }],
      },
      { id: 'annex', title: '附件', edited: false, children: [] },
    ]);
  });

  it('套用修订：改过的节换成新内容，其余不动', () => {
    const out = applyEdits(doc, { 'general.1': [{ type: 'paragraph', text: ['改过'] }, { type: 'locked', index: 1, label: '' }] });
    expect(out.sections[0]!.sections[0]!.blocks).toEqual([{ type: 'paragraph', text: ['改过'] }, table]);
    expect(out.sections[1]).toBe(doc.sections[1]);
    // 原文档不被改动
    expect(doc.sections[0]!.sections[0]!.blocks[0]).toEqual({ type: 'paragraph', text: ['为了', { text: '规范', bold: true }, '应急工作。'] });
  });
});

describe('保存请求格式', () => {
  const ok = {
    saveId: '3f1c2b9e-1d2a-4c5b-8e7f-0a1b2c3d4e5f',
    baseRev: 0,
    blocks: [{ type: 'paragraph', text: ['甲'] }],
    note: '按名册更正联系人',
  };
  it('修订说明必填', () => {
    expect(sectionSaveSchema.safeParse(ok).success).toBe(true);
    expect(sectionSaveSchema.safeParse({ ...ok, note: '  ' }).success).toBe(false);
  });
  it('块的类型只能是段落、列表或锁定块', () => {
    expect(sectionSaveSchema.safeParse({ ...ok, blocks: [{ type: 'table', header: [], rows: [] }] }).success).toBe(false);
  });
});
