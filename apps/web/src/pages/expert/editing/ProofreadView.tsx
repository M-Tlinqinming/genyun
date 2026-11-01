import { checkedCount, checkStale, checkValid, DRAFT_KINDS, nextToCheck, reviewValid, type DraftKind, type ReviewView } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Checkbox, Spin } from 'antd';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { downloadCurrentWord } from '../../../api/editing';
import { ApiError } from '../../../api/request';
import { checkDraft, previewFileUrl, previewKey, retryPreview, reviewKey, usePreview } from '../../../api/review';
import { linkButton } from '../../../components/ui';
import { gy } from '../../../theme/tokens';
import { stamp, ViewSwitch } from './EditDialogs';
import { PdfPages, type PdfPagesHandle } from './PdfPages';

// Word 校对（14 页 E18-05）：当前稿的 Word 版式逐页看，核对后记下这一份，接着打开下一份；
// 三份都核对过去确认审核结论（E18-06）
const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const panel: CSSProperties = {
  background: gy.surface,
  border: `1px solid ${gy.split}`,
  borderRadius: 6,
};
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function ProofreadView({
  taskId,
  kind,
  review,
  onBackToText,
  onOpen,
  onConclude,
}: {
  taskId: string;
  kind: DraftKind;
  review: ReviewView;
  onBackToText: () => void;
  /** 打开另一份的 Word 预览；focus = 核对完自动打开的，焦点放到页面标题 */
  onOpen: (kind: DraftKind, focus?: boolean) => void;
  onConclude: () => void;
}) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const preview = usePreview(taskId, kind, true);
  const doc = review.docs.find((d) => d.kind === kind)!;
  const pages = useRef<PdfPagesHandle>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [fitScale, setFitScale] = useState(1);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  // 预览区按实际位置和底栏实际高度（需重新核对时有三行）定高，和底栏隔 24，
  // 不让吸底的底栏盖住预览区下沿
  const footer = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ top: 264, footer: 70 });
  useEffect(() => {
    const el = footer.current;
    const r = row.current;
    if (!el || !r) return;
    const measure = () => {
      const top = Math.round(r.getBoundingClientRect().top + window.scrollY);
      const height = el.offsetHeight;
      setLayout((l) => (l.top === top && l.footer === height ? l : { top, footer: height }));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    setConfirmed(false);
    setTotal(0);
    setPage(1);
    setLoadFailed(false);
  }, [kind]);

  const p = preview.data;
  const valid = checkValid(doc);
  const stale = checkStale(doc);
  const count = checkedCount(review.docs);
  const next = nextToCheck(review.docs, kind);
  const passed = reviewValid(review);
  // 核对本份后还剩哪份没核对（本份算核对过）
  const after = nextToCheck(
    review.docs.map((d) => (d.kind === kind ? { ...d, check: { byName: '', at: '', version: d.version } } : d)),
    kind,
  );
  const download = () => downloadCurrentWord(taskId, kind).catch(() => message.error('没有下载成功，请检查网络后重试'));
  const scale = zoom === 'fit' ? fitScale : zoom;
  const stepZoom = (dir: 1 | -1) => {
    // 适合宽度时比例不在档位上：放大取上一档、缩小取下一档
    const z = dir === 1 ? ZOOMS.find((x) => x > scale + 0.001) : [...ZOOMS].reverse().find((x) => x < scale - 0.001);
    if (z) setZoom(z);
  };

  const confirm = async () => {
    setChecking(true);
    try {
      // 带上页面看到的这一版：之后又有人保存，后台拒绝
      const view = await checkDraft(taskId, kind, p?.version ?? doc.version);
      client.setQueryData(reviewKey(taskId), view);
      const n = nextToCheck(view.docs, kind);
      message.success(`已记下${DRAFT_KINDS[kind]}的核对`);
      if (n) onOpen(n, true);
      else onConclude();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { view?: ReviewView } | undefined;
        if (body?.view) client.setQueryData(reviewKey(taskId), body.view);
        void client.invalidateQueries({ queryKey: previewKey(taskId, kind) });
        message.warning(err.message);
      } else {
        message.error('没有记下核对，请检查网络后重试');
      }
    } finally {
      setChecking(false);
    }
  };

  const retry = async () => {
    setLoadFailed(false);
    try {
      client.setQueryData(previewKey(taskId, kind), await retryPreview(taskId, kind));
    } catch {
      message.error('没有重新开始转换，请稍后重试');
    }
  };

  let body: React.ReactNode;
  if (preview.isLoading) {
    body = <Centered>正在打开当前稿…</Centered>;
  } else if (preview.isError || !p) {
    body = <Centered>没有取到当前稿的 Word 版式，请刷新后重试；也可以先下载校对稿，在 Word 里核对。</Centered>;
  } else if (p.status === 'converting') {
    body = (
      <Centered>
        <Spin size="small" />
        <span>正在按当前稿排版 Word 页面，通常需要一分钟左右…</span>
      </Centered>
    );
  } else if (p.status === 'failed' || loadFailed) {
    body = (
      <Centered>
        <span style={{ color: gy.error }}>{p.error ?? '当前稿的 Word 页面没有显示出来'}</span>
        <span>也可以先下载校对稿，在 Word 里核对。</span>
        <Button onClick={() => void retry()}>重新转换</Button>
      </Centered>
    );
  } else if (p.status === 'unavailable') {
    body = <Centered>暂时不能在页面里显示 Word 版式。请下载校对稿，在 Word 里逐页核对。</Centered>;
  } else {
    body = (
      <PdfPages
        ref={pages}
        url={previewFileUrl(taskId, kind, p.version)}
        zoom={zoom}
        onLoaded={setTotal}
        onPage={setPage}
        onFitScale={setFitScale}
        onError={() => setLoadFailed(true)}
      />
    );
  }

  const go = (n: number) => {
    const target = Math.min(Math.max(1, n), total);
    setPage(target);
    pages.current?.goTo(target);
  };

  return (
    <>
      <div
        ref={row}
        style={{
          display: 'flex',
          gap: 16,
          // 和底栏之间留 24（外层间距 12 + 这里 12）
          height: `calc(100vh - ${layout.top + layout.footer + 24}px)`,
          minHeight: 320,
          marginBottom: 12,
        }}
      >
        <section
          aria-label="Word 预览"
          style={{
            ...panel,
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              padding: '14px 20px',
              borderBottom: `1px solid ${gy.split}`,
              ...text14,
            }}
          >
            <ViewSwitch preview onText={onBackToText} onPreview={() => undefined} />
            <span style={{ marginLeft: 'auto', color: gy.secondary }}>
              {doc.version > 0 ? '已保存稿' : '生成稿'}
              {doc.savedAt ? ` · ${stamp(doc.savedAt)}` : ''}
            </span>
          </div>
          <div
            role="toolbar"
            aria-label="页面工具"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 20px',
              background: gy.canvas,
              borderBottom: `1px solid ${gy.split}`,
              ...text14,
            }}
          >
            <Button type="text" size="small" aria-label="上一页" disabled={!total || page <= 1} onClick={() => go(page - 1)}>
              ‹
            </Button>
            <span aria-live="polite" style={{ minWidth: 92, textAlign: 'center', color: gy.text }}>
              {total ? `第 ${page} 页 / ${total}` : '第 – 页'}
            </span>
            <Button type="text" size="small" aria-label="下一页" disabled={!total || page >= total} onClick={() => go(page + 1)}>
              ›
            </Button>
            <span style={{ flex: 1 }} />
            <Button type="text" size="small" aria-label="缩小" disabled={!total || scale <= ZOOMS[0]! + 0.001} onClick={() => stepZoom(-1)}>
              −
            </Button>
            <span style={{ minWidth: 48, textAlign: 'center', color: gy.text }}>{Math.round(scale * 100)}%</span>
            <Button type="text" size="small" aria-label="放大" disabled={!total || scale >= ZOOMS[ZOOMS.length - 1]! - 0.001} onClick={() => stepZoom(1)}>
              +
            </Button>
            <Button type="text" size="small" disabled={!total} aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
              适合宽度
            </Button>
            <span style={{ flex: 1 }} />
            <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => void download()}>
              下载校对稿
            </button>
          </div>
          {body}
        </section>

        <aside
          aria-label="本份核对提示"
          style={{
            ...panel,
            width: 252,
            flexShrink: 0,
            alignSelf: 'flex-start',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            padding: 20,
          }}
        >
          <span
            style={{
              fontSize: 16,
              lineHeight: '24px',
              fontWeight: 500,
              color: gy.text,
            }}
          >
            本份核对提示
          </span>
          <div style={{ ...text14, color: gy.text }}>
            全文与企业事实
            <div style={{ color: gy.secondary }}>核对名称、人员、资源及其引用。</div>
          </div>
          <div
            style={{
              ...text14,
              color: gy.text,
              paddingBottom: 16,
              borderBottom: `1px solid ${gy.split}`,
            }}
          >
            Word 版式
            <div style={{ color: gy.secondary }}>检查表格跨页、图件清晰度、目录与页码。</div>
          </div>
          <span style={{ ...text14, color: gy.secondary }}>发现问题时返回正文修改。保存后，本份核对确认将失效，需重新核对。</span>
          <button type="button" style={{ ...linkButton, ...text14, alignSelf: 'flex-start' }} onClick={onBackToText}>
            返回正文修改
          </button>
        </aside>
      </div>

      <div
        ref={footer}
        role="region"
        aria-label="核对本份"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '18px 20px',
          ...panel,
        }}
      >
        {!review.editable ? (
          <span style={{ flex: 1, ...text14, color: gy.secondary }}>
            {valid ? `本份已核对 · ${doc.check!.byName} ${stamp(doc.check!.at)}` : '本份待核对'}
            ；只有负责这个任务的专家可以核对。
          </span>
        ) : passed ? (
          <>
            <span style={{ flex: 1, ...text14, color: gy.success }}>
              ✓ 审核已通过 · {review.review!.byName} {stamp(review.review!.at)}
            </span>
            <Button type="primary" onClick={onConclude}>
              查看审核结论
            </Button>
          </>
        ) : valid ? (
          <>
            <span style={{ flex: 1, ...text14, color: gy.success }}>
              ✓ 本份已核对 · {doc.check!.byName} {stamp(doc.check!.at)} · 人工核对 {count} / 3
            </span>
            {next ? (
              <Button type="primary" onClick={() => onOpen(next)}>
                核对下一份：{DRAFT_KINDS[next]}
              </Button>
            ) : (
              <Button type="primary" onClick={onConclude}>
                去确认审核结论
              </Button>
            )}
          </>
        ) : (
          <>
            <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ flex: 1, ...text14 }}>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                {stale && <span style={{ color: gy.warning }}>本份在核对后又保存了修订，请按当前稿重新核对。</span>}
                <span style={{ color: gy.text }}>我已核对本份全文、企业事实及 Word 版式。</span>
                <span style={{ color: gy.secondary }}>
                  确认后记为 {count + 1} / 3，
                  {after ? `并打开${DRAFT_KINDS[after]}。` : '接着确认审核结论。'}
                </span>
              </span>
            </Checkbox>
            <Button type="primary" disabled={!confirmed || p?.status === 'converting'} loading={checking} onClick={() => void confirm()}>
              {after ? '确认本份并核对下一份' : '确认本份，去确认审核结论'}
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        background: gy.neutralBg,
        ...text14,
        color: gy.secondary,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}
