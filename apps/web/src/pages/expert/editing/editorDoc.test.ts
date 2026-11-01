import { sameBlocks, type EditBlock } from '@genyun/shared';
import { describe, expect, it } from 'vitest';
import { blocksToDoc, docToBlocks, lockedOrder } from './editorDoc';

const blocks: EditBlock[] = [
  { type: 'paragraph', text: ['应急办公室联系人：', { text: '陈某', bold: true }, '\n电话 13800000001'] },
  { type: 'paragraph', text: ['居中'], align: 'center' },
  { type: 'list', items: [['第一项'], ['第二项']] },
  { type: 'list', items: [['圆点']], ordered: false },
  { type: 'locked', index: 4, label: '表格：表 1 应急通讯录' },
];

describe('编辑器内容与修订块互转', () => {
  it('原样转过去再转回来不变（加粗、换行、对齐、两种列表、锁定块）', () => {
    expect(sameBlocks(docToBlocks(blocksToDoc(blocks)), blocks)).toBe(true);
  });

  it('空段落、空列表项不保存', () => {
    const doc = blocksToDoc(blocks);
    doc.content!.splice(1, 0, { type: 'paragraph', attrs: { align: null } });
    doc.content![3]!.content!.push({ type: 'listItem', content: [{ type: 'paragraph' }] });
    expect(sameBlocks(docToBlocks(doc), blocks)).toBe(true);
  });

  it('空的一节给一个空段落，编辑器才有地方输入', () => {
    expect(blocksToDoc([])).toEqual({ type: 'doc', content: [{ type: 'paragraph', attrs: { align: null } }] });
  });

  it('锁定块顺序', () => {
    expect(lockedOrder([1, 3], [1, 3])).toBe(true);
    expect(lockedOrder([1, 3], [3, 1])).toBe(false);
    expect(lockedOrder([1, 3], [1])).toBe(false);
  });
});
