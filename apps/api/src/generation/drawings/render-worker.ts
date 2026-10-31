// 在工作线程里把客户图纸（PDF 某一页或图片）转成图片：CAD 导出的 PDF 一页可能有几十万条线，
// 转一页要半分钟，放在主线程会卡住整个服务。只依赖第三方库，没有相对引用（开发时直接跑 .ts）。
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { parentPort } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type RenderRequest =
  | { id: number; op: 'count'; data: Uint8Array; contentType: string }
  | { id: number; op: 'render'; data: Uint8Array; contentType: string; page: number; fullSide: number; thumbSide: number };

export interface RenderedPage {
  // PDF 页（线条图）存 PNG；照片存 JPEG，文件小得多
  full: Uint8Array;
  fullType: 'png' | 'jpg';
  width: number;
  height: number;
  thumb: Uint8Array;
}

export type RenderResponse =
  | { id: number; ok: true; pageCount: number }
  | { id: number; ok: true; page: RenderedPage }
  | { id: number; ok: false; error: string };

// 没嵌字体的 PDF 要用 pdfjs 自带的标准字体与中文编码表
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const dirUrl = (name: string) => `${join(pdfjsRoot, name)}/`.replace(/\\/g, '/');

function openPdf(data: Uint8Array) {
  return getDocument({
    // pdfjs 会接管传入的内存，复制一份
    data: new Uint8Array(data),
    standardFontDataUrl: dirUrl('standard_fonts'),
    cMapUrl: dirUrl('cmaps'),
    cMapPacked: true,
    verbosity: 0,
  }).promise;
}

const fit = (w: number, h: number, side: number) => {
  const scale = side / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
};

// 白底，图纸透明的地方在 Word 里不会变黑
function whiteCanvas(width: number, height: number) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

async function count(req: Extract<RenderRequest, { op: 'count' }>): Promise<number> {
  if (req.contentType !== 'application/pdf') return 1;
  const doc = await openPdf(req.data);
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

async function render(req: Extract<RenderRequest, { op: 'render' }>): Promise<RenderedPage> {
  if (req.contentType === 'application/pdf') {
    const doc = await openPdf(req.data);
    try {
      if (req.page < 1 || req.page > doc.numPages) throw new Error(`没有第 ${req.page} 页`);
      const page = await doc.getPage(req.page);
      const base = page.getViewport({ scale: 1 });
      const size = fit(base.width, base.height, req.fullSide);
      const viewport = page.getViewport({ scale: size.width / base.width });
      const { canvas, ctx } = whiteCanvas(size.width, size.height);
      await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
      const full = await canvas.encode('png');
      const t = fit(size.width, size.height, req.thumbSide);
      const small = whiteCanvas(t.width, t.height);
      small.ctx.drawImage(canvas, 0, 0, t.width, t.height);
      return { full, fullType: 'png', ...size, thumb: await small.canvas.encode('jpeg', 80) };
    } finally {
      await doc.destroy();
    }
  }
  if (req.page !== 1) throw new Error(`没有第 ${req.page} 页`);
  const image = await loadImage(Buffer.from(req.data));
  const size = fit(image.width, image.height, Math.min(req.fullSide, Math.max(image.width, image.height)));
  const { canvas, ctx } = whiteCanvas(size.width, size.height);
  ctx.drawImage(image, 0, 0, size.width, size.height);
  const t = fit(size.width, size.height, req.thumbSide);
  const small = whiteCanvas(t.width, t.height);
  small.ctx.drawImage(canvas, 0, 0, t.width, t.height);
  return { full: await canvas.encode('jpeg', 88), fullType: 'jpg', ...size, thumb: await small.canvas.encode('jpeg', 80) };
}

parentPort?.on('message', async (req: RenderRequest) => {
  let res: RenderResponse;
  try {
    res = req.op === 'count' ? { id: req.id, ok: true, pageCount: await count(req) } : { id: req.id, ok: true, page: await render(req) };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  parentPort!.postMessage(res);
});
