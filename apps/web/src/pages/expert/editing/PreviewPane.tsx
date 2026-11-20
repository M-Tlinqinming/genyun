import { ExclamationCircleOutlined } from '@ant-design/icons';
import type { DraftKind } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button } from 'antd';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { previewFileUrl, previewKey, retryPreview, usePreview } from '../../../api/review';
import { ContactLink } from '../../../components/ContactLink';
import { PdfPages, type PdfPagesHandle } from '../../../components/PdfPages';
import { gy } from '../../../theme/tokens';
import { when } from './EditDialogs';

// 核对定稿 · Word 预览（E18-05 的预览部分、E18-12）：这一份现在的 Word 版式逐页看，只看版式，不挡核对完成。
// 加载中显示骨架页；排版失败可以重试，连续两次失败提示联系耕云客服
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const caption: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary };
const toolButton: CSSProperties = {
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'none',
  cursor: 'pointer',
  color: gy.secondary,
  fontSize: 14,
  lineHeight: '22px',
};

export function PreviewPane({ taskId, kind, savedAt, onBackToText }: { taskId: string; kind: DraftKind; savedAt: string | null; onBackToText: () => void }) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const preview = usePreview(taskId, kind, true);
  const pages = useRef<PdfPagesHandle>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [fitScale, setFitScale] = useState(1);
  const [loadFailed, setLoadFailed] = useState(false);
  // 这一份连续排版失败了几次（转换失败、PDF 打不开都算）
  const [failures, setFailures] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setTotal(0);
    setPage(1);
    setLoadFailed(false);
    setFailures(0);
  }, [kind]);

  const p = preview.data;
  const failed = preview.isError || p?.status === 'failed' || loadFailed;
  // 第一次看到失败记一次
  const seen = useRef(false);
  useEffect(() => {
    if (failed && !seen.current) setFailures((n) => n + 1);
    seen.current = failed;
  }, [failed]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  // 按显示的百分比比较：适合宽度算出 124.9% 时显示 125%，放大要到 150%
  const percent = Math.round(scale * 100);
  const pct = (x: number) => Math.round(x * 100);
  const stepZoom = (dir: 1 | -1) => {
    // 适合宽度时比例不在档位上：放大取上一档、缩小取下一档
    const z = dir === 1 ? ZOOMS.find((x) => pct(x) > percent) : [...ZOOMS].reverse().find((x) => pct(x) < percent);
    if (z) setZoom(z);
  };
  const basis = savedAt ? `按${when(savedAt)} 保存的内容排版` : '按生成的内容排版';

  const retry = async () => {
    setRetrying(true);
    setLoadFailed(false);
    try {
      client.setQueryData(previewKey(taskId, kind), await retryPreview(taskId, kind));
    } catch {
      message.error('没有重新开始排版，请稍后重试');
    } finally {
      setRetrying(false);
    }
  };

  const loading = preview.isLoading || p?.status === 'converting';
  const toolbar = (
    <div role="toolbar" aria-label="页面工具" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: gy.surface, borderBottom: `1px solid ${gy.split}` }}>
      <span aria-live="polite" style={caption}>
        {loading ? `正在${basis}…` : total ? `第 ${page} 页，共 ${total} 页 · ${basis}` : basis}
      </span>
      <span style={{ flex: 1 }} />
      <button type="button" aria-label="缩小" style={toolButton} disabled={!total || percent <= pct(ZOOMS[0]!)} onClick={() => stepZoom(-1)}>
        −
      </button>
      <span style={{ ...caption, minWidth: 40, textAlign: 'center', color: gy.text }}>{percent}%</span>
      <button type="button" aria-label="放大" style={toolButton} disabled={!total || percent >= pct(ZOOMS[ZOOMS.length - 1]!)} onClick={() => stepZoom(1)}>
        +
      </button>
    </div>
  );

  let content: React.ReactNode;
  if (loading) {
    content = <Skeleton />;
  } else if (failed) {
    content = (
      <div role="alert" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
        <ExclamationCircleOutlined aria-hidden style={{ fontSize: 24, color: gy.tertiary }} />
        <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>Word 预览没排出来</span>
        <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary, maxWidth: 420 }}>
          您的正文已经保存，不受影响。可以再试一次，或者先切回「正文」继续核对。
        </span>
        {failures >= 2 && (
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
            已经连续两次没排出来，请<ContactLink>联系耕云客服</ContactLink>。
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button onClick={onBackToText}>切回正文</Button>
          <Button type="primary" loading={retrying} onClick={() => void retry()}>
            重新排版
          </Button>
        </div>
      </div>
    );
  } else if (p?.status === 'unavailable') {
    content = (
      <div role="status" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
        现在不能在页面里显示 Word 版式，可以点下面的「下载 Word」在 Word 里看。
      </div>
    );
  } else if (p) {
    content = (
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

  return (
    <section aria-label="Word 预览" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: `1px solid ${gy.split}`, borderRadius: 8, overflow: 'hidden', background: gy.neutralBg }}>
      {toolbar}
      {content}
    </section>
  );
}

// 排版中：灰底上一张骨架页
function Skeleton() {
  const bar = (w: string): CSSProperties => ({ height: 10, width: w, borderRadius: 4, background: gy.neutralBg });
  return (
    <div role="status" aria-label="正在排版" style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '70%', maxWidth: 560, aspectRatio: '210 / 297', background: gy.surface, boxShadow: '0 1px 3px rgb(24 36 59 / 10%)', padding: '48px 56px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={bar('40%')} />
        <div style={{ height: 8 }} />
        {['100%', '95%', '98%', '60%', '100%', '92%', '80%'].map((w, i) => (
          <div key={i} style={bar(w)} />
        ))}
      </div>
    </div>
  );
}
