import { createCanvas } from '@napi-rs/canvas';
import { afterAll, describe, expect, it } from 'vitest';
import { DrawingRenderer, FULL_SIDE, THUMB_SIDE } from './renderer.ts';
import { A3, LANDSCAPE, PORTRAIT, testPdf } from './test-pdf.ts';

const renderer = new DrawingRenderer();
afterAll(() => renderer.close());

const isPng = (b: Uint8Array) => Buffer.from(b.subarray(0, 4)).toString('hex') === '89504e47';
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

describe('客户图纸转图片', () => {
  const pdf = testPdf([A3, PORTRAIT, LANDSCAPE]);

  it('数出 PDF 页数；图片算一页', async () => {
    expect(await renderer.count(pdf, 'application/pdf')).toBe(3);
    const photo = await createCanvas(40, 30).encode('png');
    expect(await renderer.count(photo, 'image/png')).toBe(1);
  });

  it('PDF 一页转成长边 2400 的 PNG 和长边 480 的缩略图，横竖不变', async () => {
    const wide = await renderer.render(pdf, 'application/pdf', 1);
    expect(wide).toMatchObject({ fullType: 'png', width: FULL_SIDE, height: Math.round((FULL_SIDE * A3.height) / A3.width) });
    expect(isPng(wide.full)).toBe(true);
    expect(isJpeg(wide.thumb)).toBe(true);

    const tall = await renderer.render(pdf, 'application/pdf', 2);
    expect(tall.height).toBe(FULL_SIDE);
    expect(tall.width).toBeLessThan(tall.height);
    expect(THUMB_SIDE).toBeLessThan(FULL_SIDE);
  });

  it('照片转 JPEG，不放大', async () => {
    const canvas = createCanvas(800, 600);
    canvas.getContext('2d').fillRect(10, 10, 100, 100);
    const page = await renderer.render(await canvas.encode('png'), 'image/png', 1);
    expect(page).toMatchObject({ fullType: 'jpg', width: 800, height: 600 });
    expect(isJpeg(page.full)).toBe(true);
  });

  it('没有的页、打不开的文件报错，线程还能接着用', async () => {
    await expect(renderer.render(pdf, 'application/pdf', 4)).rejects.toThrow('没有第 4 页');
    await expect(renderer.count(Buffer.from('不是 PDF'), 'application/pdf')).rejects.toThrow();
    expect(await renderer.count(pdf, 'application/pdf')).toBe(3);
  });

  it('超时就换一个线程，后面的页照常转', async () => {
    const slow = new DrawingRenderer(1);
    await expect(slow.render(pdf, 'application/pdf', 1)).rejects.toThrow('转换超时');
    await slow.close();
    expect((await renderer.render(pdf, 'application/pdf', 3)).fullType).toBe('png');
  });
});
