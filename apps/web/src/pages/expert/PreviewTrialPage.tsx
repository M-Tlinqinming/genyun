// 第 2 项小样：Word 校对页（Paper 14 页 E18-05）的两种预览方式并排试看，Martin 选定后删掉本页。
// 浏览器直接显示：docx-preview 在页面里排版 .docx；后台转 PDF：LibreOffice 转好后用 pdf.js 逐页画出。
import { LeftOutlined, MinusOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { Alert, Button, Segmented, Spin } from 'antd';
import { renderAsync } from 'docx-preview';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WizardHeader } from '../../components/WizardHeader';
import { gy } from '../../theme/tokens';

GlobalWorkerOptions.workerSrc = workerUrl;

type Mode = 'docx' | 'pdf';

// A4 宽 21 cm，100% 时按屏幕 96 dpi 显示
const PAGE_WIDTH = 794;
const PDF_SCALE = 96 / 72;

const MODES: { value: Mode; label: string }[] = [
  { value: 'docx', label: '浏览器直接显示' },
  { value: 'pdf', label: '后台转成 PDF' },
];

const NOTES: Record<Mode, string[]> = {
  docx: [
    '服务器不用装额外软件，打开快。',
    '不按 A4 分页：只在「另起一页」处断开，整份预案显示成 20 段长页（Word 里是 130 页），表格跨页、页码都看不到。',
    '目录只有条目，没有页码。',
    '段首空两格没有显示；字体用看的人电脑上的字体。',
  ],
  pdf: [
    '按 A4 真实分页：飞宇预案 131 页，Word 里 130 页；目录页码、表格跨页、图件都能看。',
    '服务器要装 LibreOffice 和中文字体；每份第一次打开要等转换（本机约 30 秒），可以在生成草稿时就转好。',
    '个别地方和 Word 略有出入：页码前后差一两页，宽表格的窄列比 Word 更挤。',
  ],
};

function useStatus() {
  const [state, setState] = useState<{ loading: boolean; error?: string; detail?: string }>({ loading: true });
  return [state, setState] as const;
}

export function PreviewTrialPage() {
  const [mode, setMode] = useState<Mode>('docx');
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [status, setStatus] = useStatus();
  const scroller = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const pageEls = useRef<HTMLElement[]>([]);

  // 换方式时重新加载
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let cancelled = false;
    el.innerHTML = '';
    pageEls.current = [];
    setPages(0);
    setPage(1);
    setStatus({ loading: true });
    const start = performance.now();
    (async () => {
      const res = await fetch(`/api/preview-trial/plan.${mode}`, { credentials: 'include' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(res.status === 401 ? '请先登录（任一演示账号）再打开本页' : (body?.message ?? '加载失败'));
      }
      const blob = await res.blob();
      if (cancelled) return;
      const convertMs = Number(res.headers.get('X-Convert-Ms') ?? 0);
      if (mode === 'docx') {
        await renderAsync(blob, el, undefined, { inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: true });
        pageEls.current = [...el.querySelectorAll<HTMLElement>('section.docx')];
      } else {
        pageEls.current = await layoutPdf(await getDocument({ data: await blob.arrayBuffer() }).promise, el);
      }
      if (cancelled) return;
      setPages(pageEls.current.length);
      const total = Math.round(performance.now() - start);
      setStatus({
        loading: false,
        detail:
          mode === 'pdf' && convertMs
            ? `打开用时 ${(total / 1000).toFixed(1)} 秒（其中后台转换 ${(convertMs / 1000).toFixed(1)} 秒，同一份第二次打开不再转换）`
            : `打开用时 ${(total / 1000).toFixed(1)} 秒`,
      });
    })().catch((err: Error) => !cancelled && setStatus({ loading: false, error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [mode, setStatus]);

  // 滚动时更新当前页码
  const onScroll = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const middle = box.getBoundingClientRect().top + box.clientHeight / 3;
    const index = pageEls.current.findIndex((p) => p.getBoundingClientRect().bottom > middle);
    if (index >= 0) setPage(index + 1);
  }, []);

  const goTo = (n: number) => {
    const target = pageEls.current[n - 1];
    if (target) scroller.current?.scrollTo({ top: target.offsetTop * zoom - 24 });
  };

  const fitWidth = () => {
    const width = scroller.current?.clientWidth ?? PAGE_WIDTH;
    setZoom(Math.min(2, Math.round(((width - 64) / PAGE_WIDTH) * 100) / 100));
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: gy.canvas }}>
      <WizardHeader
        enterpriseName="飞宇样例 · Word 预览方式小样（只在本机）"
        extra={<Segmented<Mode> options={MODES} value={mode} onChange={setMode} />}
      />
      <div style={{ flex: 1, display: 'flex', gap: 20, padding: '24px 32px', minHeight: 0 }}>
        <section
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: gy.surface,
            border: `1px solid ${gy.split}`,
            borderRadius: 8,
            height: 'calc(100vh - 112px)',
          }}
        >
          <div
            style={{
              height: 46,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 20px',
              borderBottom: `1px solid ${gy.split}`,
              fontSize: 14,
              color: gy.text,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button type="text" size="small" icon={<LeftOutlined />} disabled={page <= 1} onClick={() => goTo(page - 1)} />
              第 {pages ? page : '–'} 页 / {pages || '–'}
              <Button
                type="text"
                size="small"
                icon={<RightOutlined />}
                disabled={page >= pages}
                onClick={() => goTo(page + 1)}
              />
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                type="text"
                size="small"
                icon={<MinusOutlined />}
                onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
              />
              <span style={{ width: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
              />
              <Button type="text" size="small" onClick={fitWidth}>
                适合宽度
              </Button>
            </span>
            <a href="/api/preview-trial/plan.docx" download="样例-飞宇应急预案.docx">
              下载校对稿
            </a>
          </div>
          <div ref={scroller} onScroll={onScroll} style={{ flex: 1, overflow: 'auto', background: gy.neutralBg }}>
            {status.loading && (
              <div style={{ padding: 80, textAlign: 'center' }}>
                <Spin tip={mode === 'pdf' ? '正在转换，第一次约需十几秒' : '正在排版'}>
                  <div style={{ height: 40 }} />
                </Spin>
              </div>
            )}
            {status.error && <Alert type="error" showIcon title={status.error} style={{ margin: 24 }} />}
            <div
              ref={holder}
              className="preview-trial-pages"
              style={{ zoom, padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}
            />
          </div>
        </section>
        <aside
          style={{
            width: 252,
            flexShrink: 0,
            alignSelf: 'flex-start',
            background: gy.surface,
            border: `1px solid ${gy.split}`,
            borderRadius: 8,
            padding: 20,
            fontSize: 14,
            lineHeight: '22px',
            color: gy.text,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>这种方式的特点</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {NOTES[mode].map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          {status.detail && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${gy.split}`, color: gy.secondary }}>
              {status.detail}
            </div>
          )}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${gy.split}`, color: gy.secondary }}>
            建议对照着看：目录页、第一个长表格、组织机构图、附件里的通讯录。
          </div>
        </aside>
      </div>
      <style>{`.preview-trial-pages section.docx, .preview-trial-pages canvas { box-shadow: 0 1px 4px rgb(24 36 59 / 16%); background: #fff; }`}</style>
    </div>
  );
}

// 先按每页尺寸放好空白画布，滚到附近再画，免得一百多页一次画完卡住
async function layoutPdf(pdf: PDFDocumentProxy, el: HTMLElement): Promise<HTMLElement[]> {
  const canvases: HTMLCanvasElement[] = [];
  const drawn = new Set<number>();
  const ratio = window.devicePixelRatio || 1;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const canvas = entry.target as HTMLCanvasElement;
        const index = canvases.indexOf(canvas);
        if (!entry.isIntersecting || drawn.has(index)) continue;
        drawn.add(index);
        void pdf.getPage(index + 1).then((p) => {
          // 按 2 倍清晰度画，放大到 200% 也不糊
          const viewport = p.getViewport({ scale: PDF_SCALE * 2 * ratio });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          return p.render({ canvas, viewport }).promise;
        });
      }
    },
    { rootMargin: '1200px 0px' },
  );
  for (let i = 1; i <= pdf.numPages; i++) {
    const viewport = (await pdf.getPage(i)).getViewport({ scale: PDF_SCALE });
    const canvas = document.createElement('canvas');
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    el.appendChild(canvas);
    canvases.push(canvas);
    observer.observe(canvas);
  }
  return canvases;
}
