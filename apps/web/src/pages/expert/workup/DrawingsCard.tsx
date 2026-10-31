import {
  CUSTOMER_DRAWING_KEYS,
  CUSTOMER_DRAWINGS,
  selectedPages,
  type CustomerDrawing,
  type DrawingSelection,
} from '@genyun/shared';
import { Checkbox, Modal } from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import { drawingPageUrl, useDrawings } from '../../../api/workup';
import { linkButton } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';
import type { FiguresSaveInput } from './FiguresPanel';

const small: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.text };
const muted: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.secondary };
const link13: CSSProperties = { ...linkButton, fontSize: 13, lineHeight: '20px' };
const THUMB_W = 152;
const THUMB_H = 108;

export interface DrawingsCardProps {
  taskId: string;
  // 已保存的选页（整理数据 figures.drawings）
  selection: DrawingSelection | undefined;
  saving: boolean;
  onSave: (input: FiguresSaveInput) => Promise<boolean>;
}

// 图件页「客户图纸」（M2 第 10c 项，Martin 2026-11-01 定在图件模块里选页；设计稿没有这一块，见 DESIGN-DIFF）：
// 客户上传的总平面图、疏散图、消防设施布置图放进应急预案附件 7。PDF 常有设计说明、图纸目录等页，由专家勾选；
// 没选过的默认只放第 1 页。
export function DrawingsCard({ taskId, selection, saving, onSave }: DrawingsCardProps) {
  const drawings = useDrawings(taskId, true);
  const list = drawings.data?.drawings ?? [];
  const missing = CUSTOMER_DRAWING_KEYS.filter((k) => !list.some((d) => d.key === k));
  const total = list.reduce((n, d) => n + (d.pageCount ? selectedPages(selection, d.fileId, d.pageCount).length : 0), 0);

  return (
    <article
      aria-label="客户图纸"
      style={{ display: 'flex', flexDirection: 'column', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', borderBottom: `1px solid ${gy.split}` }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: '24px', color: gy.text }}>客户图纸 · 放进应急预案附件 7</h3>
          <span style={muted}>勾选要放进附件 7 的页（每页单独占一页）；没选过的每份只放第 1 页。设计说明、图纸目录等页不用放。</span>
        </div>
        {!drawings.isLoading && list.length > 0 && <span style={muted}>共选 {total} 页</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '16px 20px 20px' }}>
        {drawings.isLoading && <span style={muted}>正在读取图纸页数…</span>}
        {drawings.isError && <span style={{ ...small, color: stage.action.color }}>图纸没有读取成功，请刷新页面重试</span>}
        {list.map((d) => (
          <DrawingFile key={d.fileId} taskId={taskId} drawing={d} selection={selection} saving={saving} onSave={onSave} />
        ))}
        {!drawings.isLoading && missing.length > 0 && (
          <span style={muted}>
            {missing.map((k) => CUSTOMER_DRAWINGS[k]).join('、')}：客户没有上传，附件 7 写「由企业提供后纳入正式文本」。
          </span>
        )}
      </div>
    </article>
  );
}

function DrawingFile({
  taskId,
  drawing: d,
  selection,
  saving,
  onSave,
}: {
  taskId: string;
  drawing: CustomerDrawing;
  selection: DrawingSelection | undefined;
  saving: boolean;
  onSave: (input: FiguresSaveInput) => Promise<boolean>;
}) {
  const [zoom, setZoom] = useState<number | null>(null);
  const pageCount = d.pageCount ?? 0;
  const saved = d.pageCount ? selectedPages(selection, d.fileId, d.pageCount) : [];
  // 勾选立刻显示，保存失败退回已保存的选页
  const [pending, setPending] = useState<number[] | null>(null);
  const savedKey = saved.join(',');
  useEffect(() => setPending(null), [savedKey]);
  const selected = pending ?? saved;
  const save = (pages: number[]) => {
    setPending(pages);
    void onSave({ drawings: { [d.fileId]: pages } }).then((ok) => {
      if (!ok) setPending(null);
    });
  };
  const toggle = (page: number) => save(selected.includes(page) ? selected.filter((p) => p !== page) : [...selected, page].sort((a, b) => a - b));
  const all = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <section aria-label={d.name} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ padding: '0 8px', borderRadius: 4, background: gy.neutralBg, color: gy.secondary, fontSize: 12, lineHeight: '22px', whiteSpace: 'nowrap' }}>
          {CUSTOMER_DRAWINGS[d.key]}
        </span>
        <span style={{ ...small, fontWeight: 500 }}>{d.name}</span>
        {d.pageCount !== null && (
          <span style={muted}>
            共 {d.pageCount} 页 · 已选 {selected.length} 页{pending || selection?.[d.fileId] ? '' : '（默认）'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {pageCount > 1 && (
          <>
            <button type="button" style={link13} disabled={saving || selected.length === pageCount} onClick={() => save(all)}>
              全选
            </button>
            <button type="button" style={link13} disabled={saving || selected.length === 0} onClick={() => save([])}>
              全不选
            </button>
          </>
        )}
      </div>
      {d.pageCount === null ? (
        <span style={{ ...small, color: stage.action.color }}>{d.error ?? '这份文件打不开'}</span>
      ) : (
        <ol aria-label={`${d.name}的页`} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: 0, padding: 0, listStyle: 'none' }}>
          {all.map((page) => (
            <PageThumb
              key={page}
              url={drawingPageUrl(taskId, d.fileId, page, 'thumb')}
              page={page}
              checked={selected.includes(page)}
              disabled={saving}
              onToggle={() => toggle(page)}
              onZoom={() => setZoom(page)}
            />
          ))}
        </ol>
      )}
      {selected.length === 0 && d.pageCount !== null && <span style={{ fontSize: 12, lineHeight: '20px', color: stage.action.color }}>这份图纸一页都不放进附件 7</span>}
      <Modal title={`${d.name} · 第 ${zoom} 页`} open={zoom !== null} width={1100} footer={null} onCancel={() => setZoom(null)} destroyOnHidden>
        {zoom !== null && (
          <div style={{ display: 'flex', justifyContent: 'center', minHeight: 200 }}>
            <img src={drawingPageUrl(taskId, d.fileId, zoom, 'full')} alt={`${d.name}第 ${zoom} 页`} style={{ maxWidth: '100%', maxHeight: '75vh' }} />
          </div>
        )}
      </Modal>
    </section>
  );
}

function PageThumb({
  url,
  page,
  checked,
  disabled,
  onToggle,
  onZoom,
}: {
  url: string;
  page: number;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onZoom: () => void;
}) {
  const [state, setState] = useState<'loading' | 'done' | 'failed'>('loading');
  return (
    <li style={{ width: THUMB_W, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        aria-label={`放大第 ${page} 页`}
        onClick={onZoom}
        style={{
          position: 'relative',
          width: THUMB_W,
          height: THUMB_H,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 6,
          border: `${checked ? 2 : 1}px solid ${checked ? gy.primary : gy.split}`,
          background: '#FAFBFC',
          cursor: 'zoom-in',
        }}
      >
        {state !== 'done' && (
          <span style={{ position: 'absolute', fontSize: 12, color: gy.tertiary }}>{state === 'failed' ? '预览失败' : '转换中…'}</span>
        )}
        <img
          src={url}
          alt={`第 ${page} 页`}
          loading="lazy"
          onLoad={() => setState('done')}
          onError={() => setState('failed')}
          style={{ maxWidth: '100%', maxHeight: '100%', opacity: state === 'done' ? 1 : 0 }}
        />
      </button>
      <Checkbox checked={checked} disabled={disabled} onChange={onToggle} style={{ fontSize: 13 }}>
        第 {page} 页
      </Checkbox>
    </li>
  );
}
