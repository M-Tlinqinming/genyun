import { describe, expect, it } from 'vitest';
import { compareSheets } from './compare';

const sources = {
  'production.equipment.0.name': { sheet: '设备', cell: 'B5', row: 5 },
  'production.equipment.0.quantity': { sheet: '设备', cell: 'D5', row: 5 },
  'production.equipment.1.name': { sheet: '设备', cell: 'B6', row: 6 },
  'production.equipment.2.name': { sheet: '设备', cell: 'B7', row: 7 },
  'production.equipment.2.quantity': { sheet: '设备', cell: 'D7', row: 7 },
  'resources.firePool.answer': { sheet: '应急资源', cell: 'C3', row: 3 },
};
const original = {
  equipment: [
    { id: 'e1', name: '喷涂线', quantity: '1 条' },
    { id: 'e2', name: '空压机' },
    { id: 'e3', name: '叉车', quantity: '2 台' },
  ],
};

describe('对照客户原表', () => {
  it('没改过：格子按行列排好，客户空着的格子补成空', () => {
    const [sheet] = compareSheets(sources, { production: { original, current: original } });
    expect(sheet!.sheet).toBe('设备');
    expect(sheet!.rows.map((r) => r.row)).toEqual([5, 6, 7]);
    expect(sheet!.rows[1]!.cells).toEqual([
      { col: 'B', header: '名称', original: '空压机', current: '空压机' },
      { col: 'D', header: '数量', original: '', current: '' },
    ]);
    expect(sheet!.changed).toBe(0);
    expect(sheet!.empty).toBe(1);
  });

  it('专家改了、删了、挪了行：按行 id 对上，删掉的整行算一处', () => {
    const current = {
      equipment: [
        { id: 'e2', name: '空压机', quantity: '3 台' },
        { id: 'e1', name: '喷涂线（改）', quantity: '1 条' },
      ],
    };
    const [sheet] = compareSheets(sources, { production: { original, current } });
    const cell = (row: number, col: string) => sheet!.rows.find((r) => r.row === row)!.cells.find((c) => c.col === col)!;
    expect(cell(5, 'B').current).toBe('喷涂线（改）');
    expect(cell(6, 'D')).toMatchObject({ original: '', current: '3 台' });
    expect(sheet!.rows.find((r) => r.row === 7)!.removed).toBe(true);
    expect(sheet!.changed).toBe(3);
  });

  it('只取给了的那几步，有没有写成中文', () => {
    expect(compareSheets(sources, { resources: { original: { firePool: { answer: 'yes' } }, current: { firePool: { answer: 'no' } } } })).toEqual([
      { sheet: '应急资源', rows: [{ row: 3, removed: false, cells: [{ col: 'C', header: '有没有', original: '有', current: '没有' }] }], changed: 1, empty: 0 },
    ]);
  });
});
