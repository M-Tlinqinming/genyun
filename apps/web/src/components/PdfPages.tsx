import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { gy } from '../theme/tokens';

// PDF 逐页显示（注安师 Word 校对页、客户成果在线阅读）：先按每页尺寸放好空白页，滚到附近才画，一百多页也不卡。
// pdf.js 按需加载，不进首屏包

export interface PdfPagesHandle {
  goTo: (page: number) => void;
}

/** PDF 自带的目录（Word 标题转出来的书签）：一级标题和它所在的页 */
export interface PdfOutlineItem {
  title: string;
  page: number;
}

type Pdfjs = typeof import('pdfjs-dist');
let pdfjs: Promise<Pdfjs> | null = null;
function loadPdfjs() {
  pdfjs ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjs;
}

const GAP = 16;
const PAD = 24;

export const PdfPages = forwardRef<
  PdfPagesHandle,
  {
    url: string;
    /** 缩放比例；fit = 按容器宽度 */
    zoom: number | 'fit';
    onLoaded: (pages: number) => void;
    onPage: (page: number) => void;
    onFitScale: (scale: number) => void;
    onError: () => void;
    /** 需要目录时传：载入后给出一级书签和页码（没有书签为空） */
    onOutline?: (items: PdfOutlineItem[]) => void;
    /** 屏幕阅读器读到的区域名 */
    label?: string;
  }
>(function PdfPages({ url, zoom, onLoaded, onPage, onFitScale, onError, onOutline, label = 'Word 版式预览' }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  // 每页按 100% 的尺寸（CSS 像素）
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [width, setWidth] = useState(0);
  const callbacks = useRef({ onLoaded, onPage, onFitScale, onError, onOutline });
  callbacks.current = { onLoaded, onPage, onFitScale, onError, onOutline };

  useEffect(() => {
    let cancelled = false;
    let loading: { destroy: () => Promise<void> } | null = null;
    setDoc(null);
    setSizes([]);
    void (async () => {
      try {
        const lib = await loadPdfjs();
        const task = lib.getDocument({ url, withCredentials: true });
        loading = task;
        const loaded = await task.promise;
        const list: { w: number; h: number }[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 });
          list.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return;
        setSizes(list);
        setDoc(loaded);
        callbacks.current.onLoaded(loaded.numPages);
        if (callbacks.current.onOutline) {
          const items = await outlineOf(loaded);
          if (!cancelled) callbacks.current.onOutline?.(items);
        }
      } catch {
        if (!cancelled) callbacks.current.onError();
      }
    })();
    return () => {
      cancelled = true;
      void loading?.destroy();
    };
  }, [url]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const widest = sizes.reduce((m, s) => Math.max(m, s.w), 0);
  const fit = widest && width ? Math.max(0.3, (width - PAD * 2) / widest) : 1;
  const scale = zoom === 'fit' ? fit : zoom;
  useEffect(() => {
    if (widest && width) callbacks.current.onFitScale(fit);
  }, [fit, widest, width]);

  const tops = useRef<number[]>([]);
  tops.current = sizes.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? PAD : acc[i - 1]! + sizes[i - 1]!.h * scale + GAP], []);

  const onScroll = useCallback(() => {
    const el = box.current;
    if (!el || !tops.current.length) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let page = 1;
    tops.current.forEach((t, i) => {
      if (t <= mid) page = i + 1;
    });
    callbacks.current.onPage(page);
  }, []);

  useImperativeHandle(ref, () => ({
    goTo: (page) => box.current?.scrollTo({ top: (tops.current[page - 1] ?? 0) - PAD / 2 }),
  }));

  return (
    <div
      ref={box}
      onScroll={onScroll}
      aria-label={label}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        background: gy.neutralBg,
        padding: `${PAD}px 0`,
      }}
    >
      {doc && sizes.map((s, i) => <PdfPage key={i} doc={doc} index={i + 1} width={s.w * scale} height={s.h * scale} scale={scale} root={box} />)}
    </div>
  );
});

// 一级书签对应的页码；解析不了的跳过，整份没有书签返回空
async function outlineOf(doc: PDFDocumentProxy): Promise<PdfOutlineItem[]> {
  const outline = await doc.getOutline().catch(() => null);
  const items: PdfOutlineItem[] = [];
  for (const o of outline ?? []) {
    try {
      const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest;
      const target: unknown = dest?.[0];
      if (target === undefined || target === null) continue;
      const index = typeof target === 'number' ? target : await doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
      if (o.title.trim()) items.push({ title: o.title.trim(), page: index + 1 });
    } catch {
      // 这一条跳过
    }
  }
  return items;
}

function PdfPage({
  doc,
  index,
  width,
  height,
  scale,
  root,
}: {
  doc: PDFDocumentProxy;
  index: number;
  width: number;
  height: number;
  scale: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(Boolean(e?.isIntersecting)), { root: root.current, rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near || !canvas.current) return;
    let task: { cancel: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      const page = await doc.getPage(index);
      if (cancelled || !canvas.current) return;
      const ratio = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: scale * ratio });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      const render = page.render({ canvas: c, viewport: vp });
      task = render;
      await render.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, doc, index, scale]);

  return (
    <div
      ref={holder}
      role="img"
      aria-label={`第 ${index} 页`}
      style={{
        width,
        height,
        margin: `0 auto ${GAP}px`,
        background: '#fff',
        boxShadow: '0 1px 3px rgb(24 36 59 / 12%)',
      }}
    >
      {near && <canvas ref={canvas} style={{ width, height, display: 'block' }} />}
    </div>
  );
}
