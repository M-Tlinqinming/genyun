import { DRAFT_KINDS, DRAFT_KIND_KEYS, type DraftKind } from '@genyun/shared';
import { Button, InputNumber, Result } from 'antd';
import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { deliveryPdfUrl, downloadWord, useTaskDeliveries } from '../../../api/deliveries';
import { PdfPages, type PdfOutlineItem, type PdfPagesHandle } from '../../../components/PdfPages';
import { Loading } from '../../../components/ui';
import { gy, layout } from '../../../theme/tokens';
import { card, MissingVersion, NOT_READABLE, pickVersion, stampFull, text14, textLink, versionText } from './shared';

// R06 在线阅读｜一份成果按发布时的 Word 版式只读显示：左侧章节目录（来自文档自带的标题书签），
// 底部翻页；下载失败时提示可继续在线阅读，重试仍下载同一版本
export function DeliveryReaderPage() {
  const { taskId = '', kind = '' } = useParams();
  const [params] = useSearchParams();
  const query = useTaskDeliveries(taskId);

  if (query.isPending) return <Loading rows={6} />;
  const back = `/customer/documents/${taskId}`;
  if (query.isError) return <Result status="404" title="找不到这份成果" subTitle={query.error.message} extra={<Link to="/customer/documents">返回成果文档</Link>} />;
  const data = query.data;
  const latest = data.versions[0];
  const { current, missing } = pickVersion(data.versions, params.get('v'));
  const file = (DRAFT_KIND_KEYS as string[]).includes(kind) ? current?.files.find((f) => f.kind === kind) : undefined;
  if (!current || !file) {
    return <Result status="404" title="找不到这份成果" extra={<Link to={back}>返回编制成果</Link>} />;
  }
  return (
    <Reader
      key={`${current.version}-${file.kind}`}
      taskId={taskId}
      enterpriseName={data.enterpriseName}
      taskNumber={data.taskNumber}
      version={current.version}
      isLatest={current === latest}
      publishedAt={current.publishedAt}
      kind={file.kind}
      fileId={file.fileId}
      fileName={file.name}
      readable={file.readable}
      back={current === latest ? back : `${back}?v=${current.version}`}
      missing={missing}
    />
  );
}

function Reader(props: {
  taskId: string;
  enterpriseName: string;
  taskNumber: string;
  version: number;
  isLatest: boolean;
  publishedAt: string;
  kind: DraftKind;
  fileId: string;
  fileName: string;
  readable: boolean;
  back: string;
  missing: string | null;
}) {
  const { taskId, enterpriseName, taskNumber, version, isLatest, publishedAt, kind, fileId, fileName, readable, back, missing } = props;
  const pages = useRef<PdfPagesHandle>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const v = versionText(version);
  const docName = DRAFT_KINDS[kind];

  const download = async () => {
    setDownloading(true);
    try {
      await downloadWord(fileId, fileName);
      setDownloadFailed(false);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };
  const go = (n: number) => {
    const target = Math.min(Math.max(1, n), total || 1);
    setPage(target);
    pages.current?.goTo(target);
  };
  // 当前所在章节：页码不超过当前页的最后一条
  const activeIndex = outline.reduce((acc, o, i) => (o.page <= page ? i : acc), -1);
  const canRead = readable && !loadFailed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {missing && <MissingVersion text={missing} />}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Link to={back} style={{ ...text14, color: gy.primary, alignSelf: 'flex-start' }}>
            ‹ 返回{enterpriseName}的编制成果
          </Link>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: '40px', fontWeight: 500, color: gy.text }}>
            {docName} · {v}
          </h1>
          <span style={{ ...text14, color: gy.secondary }}>
            {taskNumber} · {isLatest ? '当前交付版本' : '历史交付版本'} · {stampFull(publishedAt)}
          </span>
        </div>
        <Button type="primary" loading={downloading} onClick={() => void download()} style={{ flexShrink: 0, height: 'auto', padding: '8px 16px' }}>
          下载此 Word
        </Button>
      </div>

      {downloadFailed && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderRadius: 6, background: gy.warningBg }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ ...text14, fontWeight: 500, color: gy.warning }}>此次下载未完成，可继续在线阅读</span>
            <span style={{ ...text14, color: gy.text }}>网络连接中断或暂时取不到文件。重试仍下载同一份 {v}，不生成新版本。</span>
          </div>
          <button type="button" style={textLink} onClick={() => void download()}>
            重试下载
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, height: `calc(100vh - ${layout.header + 196}px)`, minHeight: 420 }}>
        {canRead && outline.length > 0 && (
          <nav
            aria-label="章节目录"
            style={{ ...card, width: 180, flexShrink: 0, padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}
          >
            <span style={{ ...text14, fontWeight: 500, color: gy.text, padding: '0 8px' }}>章节目录</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {outline.map((o, i) => (
                <button
                  key={`${o.page}-${i}`}
                  type="button"
                  onClick={() => go(o.page)}
                  aria-current={i === activeIndex ? 'true' : undefined}
                  style={{
                    ...text14,
                    textAlign: 'left',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 6,
                    padding: 8,
                    background: i === activeIndex ? gy.selected : 'none',
                    color: i === activeIndex ? gy.primary : gy.text,
                  }}
                >
                  {o.title}
                </button>
              ))}
            </div>
          </nav>
        )}

        <section
          aria-label={`${docName} 在线阅读`}
          style={{ ...card, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '24px 40px', gap: 20, overflow: 'hidden' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, paddingBottom: 12, borderBottom: `1px solid ${gy.split}`, ...text14 }}>
            <span style={{ color: gy.text, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {enterpriseName} · {docName}
            </span>
            <span style={{ color: gy.secondary, flexShrink: 0 }}>{v} · 只读</span>
          </div>

          {canRead ? (
            <PdfPages
              ref={pages}
              url={deliveryPdfUrl(taskId, version, kind)}
              zoom="fit"
              label={`${docName}版式`}
              onLoaded={setTotal}
              onPage={setPage}
              onFitScale={() => undefined}
              onError={() => setLoadFailed(true)}
              onOutline={setOutline}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, ...text14, color: gy.secondary }}>
              <span>{loadFailed ? '在线阅读没能打开，请下载 Word 查看。' : NOT_READABLE}</span>
              <Button onClick={() => void download()} loading={downloading}>
                下载此 Word
              </Button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 16, borderTop: `1px solid ${gy.split}`, ...text14 }}>
            <span style={{ flex: 1, color: gy.secondary }}>
              {docName} · {v}
            </span>
            {canRead && total > 0 && (
              <>
                <Button disabled={page <= 1} onClick={() => go(page - 1)}>
                  上一页
                </Button>
                <InputNumber
                  aria-label="页码"
                  size="middle"
                  min={1}
                  max={total}
                  value={page}
                  controls={false}
                  onPressEnter={(e) => go(Number((e.target as HTMLInputElement).value))}
                  onBlur={(e) => go(Number(e.target.value))}
                  style={{ width: 56 }}
                />
                <span style={{ color: gy.secondary }}>/ {total} 页</span>
                <Button disabled={page >= total} onClick={() => go(page + 1)}>
                  下一页
                </Button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
