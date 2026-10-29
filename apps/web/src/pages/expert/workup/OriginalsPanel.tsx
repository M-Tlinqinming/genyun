import { useQuery } from '@tanstack/react-query';
import { Dropdown, Empty, Skeleton } from 'antd';
import type { CSSProperties } from 'react';
import { openFile } from '../../../api/documents';
import { inlineUrl, type WorkupOriginal } from '../../../api/workup';
import { FileTypeIcon } from '../../../components/FileTypeIcon';
import { linkButton } from '../../../components/ui';
import { gy } from '../../../theme/tokens';

const VISIBLE_TABS = 3;
const shows = (contentType: string) => contentType === 'application/pdf' || contentType.startsWith('image/');

// 去掉扩展名，版本号写在后面：「应急人员名册 V1」
export function originalTitle(o: WorkupOriginal): string {
  const base = o.name.replace(/\.[^.]+$/, '');
  return o.version ? `${base} V${o.version}` : base;
}

function uploadedAt(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('month')}.${p('day')} ${p('hour')}:${p('minute')}`;
}

const tab = (active: boolean): CSSProperties => ({
  ...linkButton,
  flexShrink: 0,
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  paddingBottom: 8,
  color: active ? gy.primary : gy.secondary,
  borderBottom: `2px solid ${active ? gy.primary : 'transparent'}`,
});

// 右栏「原件对照」：任务里客户上传的文件，PDF 和图片直接显示，其他格式在新窗口打开
export function OriginalsPanel({
  originals,
  selectedId,
  onSelect,
}: {
  originals: WorkupOriginal[];
  selectedId: string | null;
  onSelect: (fileId: string) => void;
}) {
  const selected = originals.find((o) => o.fileId === selectedId) ?? originals[0];
  // 选中的那份不在前几个里时，放到最后一个位置上，保证当前看的文件总有标签
  const head = originals.slice(0, VISIBLE_TABS);
  if (selected && !head.includes(selected)) head[VISIBLE_TABS - 1] = selected;
  const rest = originals.filter((o) => !head.includes(o));

  return (
    <aside
      aria-label="原件对照"
      style={{
        width: 360,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: gy.surface,
        border: `1px solid ${gy.split}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 0', borderBottom: `1px solid ${gy.split}` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>原件对照</h2>
          {selected && (
            <button type="button" style={linkButton} onClick={() => void openFile(selected.fileId)}>
              新窗口打开
            </button>
          )}
        </div>
        <div role="tablist" style={{ display: 'flex', gap: 20, minHeight: 31 }}>
          {head.map((o) => (
            <button
              key={o.fileId}
              type="button"
              role="tab"
              aria-selected={o === selected}
              title={o.name}
              style={tab(o === selected)}
              onClick={() => onSelect(o.fileId)}
            >
              {originalTitle(o)}
            </button>
          ))}
          {rest.length > 0 && (
            <Dropdown
              menu={{ items: rest.map((o) => ({ key: o.fileId, label: originalTitle(o) })), onClick: ({ key }) => onSelect(key) }}
            >
              <button type="button" style={tab(false)}>
                +{rest.length}
              </button>
            </Dropdown>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: gy.neutralBg }}>
        {selected ? (
          <Preview key={selected.fileId} original={selected} />
        ) : (
          <Empty
            style={{ margin: 'auto', padding: 24 }}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="客户没有上传文件，企业事实来自客户自填"
          />
        )}
      </div>
      {selected && (
        <div style={{ display: 'flex', gap: 12, padding: '10px 16px', borderTop: `1px solid ${gy.split}`, fontSize: 13, lineHeight: '20px' }}>
          <span style={{ flex: 1, color: gy.secondary }}>
            {originalTitle(selected)} · 客户上传 {uploadedAt(selected.uploadedAt)}
          </span>
        </div>
      )}
    </aside>
  );
}

// 一份原件的预览（右栏，危险源辨识的「原件」标签也用）
export function Preview({ original }: { original: WorkupOriginal }) {
  const inline = shows(original.contentType);
  const url = useQuery({
    queryKey: ['files', original.fileId, 'inline'],
    queryFn: () => inlineUrl(original.fileId),
    enabled: inline,
    // 链接 5 分钟有效，提前换新
    staleTime: 4 * 60_000,
  });
  if (!inline) {
    return (
      <div style={{ margin: 'auto', padding: 24, textAlign: 'center', color: gy.secondary }}>
        <FileTypeIcon contentType={original.contentType} />
        <p style={{ margin: '12px 0 4px', color: gy.text }}>{original.name}</p>
        <p style={{ margin: '0 0 12px', fontSize: 13 }}>Word、Excel 文件不能在这里显示</p>
        <button type="button" style={linkButton} onClick={() => void openFile(original.fileId)}>
          新窗口打开
        </button>
      </div>
    );
  }
  if (url.isPending) return <Skeleton active style={{ padding: 20 }} />;
  if (url.isError) return <p style={{ margin: 'auto', color: gy.error }}>文件打不开，请稍后重试</p>;
  return original.contentType === 'application/pdf' ? (
    <iframe title={original.name} src={url.data.url} style={{ flex: 1, width: '100%', border: 0 }} />
  ) : (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <img src={url.data.url} alt={original.name} style={{ display: 'block', maxWidth: '100%', margin: '0 auto' }} />
    </div>
  );
}
