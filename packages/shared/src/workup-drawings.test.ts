import { describe, expect, it } from 'vitest';
import { drawingKeyOf, drawingsSaveSchema, planDrawingsOf, selectedPages, type CustomerDrawing } from './workup-drawings.ts';

const A = '0b6f1f7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const B = '1c7a2b8f-2d3e-4f60-9b0c-1d2e3f4a5b6c';

describe('客户图纸选页', () => {
  it('没选过默认第 1 页；选过的去重排序，超出页数的不算；空数组 = 一页都不放', () => {
    expect(selectedPages(undefined, A, 7)).toEqual([1]);
    expect(selectedPages({ [A]: [4, 2, 4, 9] }, A, 7)).toEqual([2, 4]);
    expect(selectedPages({ [A]: [] }, A, 7)).toEqual([]);
    expect(selectedPages({ [A]: [3] }, B, 1)).toEqual([1]);
  });

  it('选页只收文件编号和正整数页码', () => {
    expect(drawingsSaveSchema.safeParse({ [A]: [1, 2] }).success).toBe(true);
    expect(drawingsSaveSchema.safeParse({ 'f-site-plan': [1] }).success).toBe(false);
    expect(drawingsSaveSchema.safeParse({ [A]: [0] }).success).toBe(false);
    expect(drawingsSaveSchema.safeParse({ [A]: [1.5] }).success).toBe(false);
  });

  it('一份文件挂在几项图纸上时归到附件 7 里靠前的那项', () => {
    expect(drawingKeyOf(['fire_facility_plan', 'site_plan'])).toBe('site_plan');
    expect(drawingKeyOf(['emergency_groups'])).toBeUndefined();
  });

  it('生成输入按总平面、疏散、消防设施的先后排，同一种按文件顺序', () => {
    const d = (fileId: string, key: CustomerDrawing['key'], selected: number[]): CustomerDrawing => ({
      fileId,
      name: fileId,
      contentType: 'application/pdf',
      key,
      pageCount: 9,
      selected,
      customized: true,
    });
    expect(planDrawingsOf([d(A, 'evacuation_plan', [3, 5]), d(B, 'site_plan', [1]), d('c', 'fire_facility_plan', [])])).toEqual([
      { key: 'site_plan', fileId: B, page: 1 },
      { key: 'evacuation_plan', fileId: A, page: 3 },
      { key: 'evacuation_plan', fileId: A, page: 5 },
    ]);
  });
});
