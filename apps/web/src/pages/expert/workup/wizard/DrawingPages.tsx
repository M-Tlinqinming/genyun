import { selectedPages, type CustomerDrawing } from '@genyun/shared';
import { App, Button, Checkbox, Modal } from 'antd';
import { useEffect, useState } from 'react';
import { ApiError } from '../../../../api/request';
import { drawingPageUrl, useDrawings, useSaveFigures, type Workup } from '../../../../api/workup';
import { gy, type } from '../../../../theme/tokens';
import { caption, link14 } from './parts';

// 第 4 步图纸卡里多页 PDF 的「选页」：哪几页放进应急预案附件 7（原来在旧整理页的图件面板里，搬到这里）。
// 没选过的默认只放第 1 页；选页存在 data.figures.drawings
const THUMB_W = 152;
const THUMB_H = 108;

/** 图纸卡里的一行：「共 N 页 · 放进附件 M 页」+「选页」；单页或打不开的文件不显示 */
export function DrawingPagesLink({ taskId, workup, fileId, latestVersion }: { taskId: string; workup: Workup; fileId: string; latestVersion: () => number }) {
  const drawings = useDrawings(taskId, true);
  const [open, setOpen] = useState(false);
  const d = drawings.data?.drawings.find((x) => x.fileId === fileId);
  if (!d?.pageCount || d.pageCount < 2) return null;
  const selected = selectedPages(workup.data.figures?.drawings, fileId, d.pageCount);
  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={caption}>
          共 {d.pageCount} 页 · 放进附件 {selected.length} 页
        </span>
        <button type="button" style={link14} onClick={() => setOpen(true)}>
          选页
        </button>
      </span>
      {open && <PagesModal taskId={taskId} drawing={d} saved={selected} latestVersion={latestVersion} onClose={() => setOpen(false)} />}
    </>
  );
}

function PagesModal({
  taskId,
  drawing: d,
  saved,
  latestVersion,
  onClose,
}: {
  taskId: string;
  drawing: CustomerDrawing;
  saved: number[];
  latestVersion: () => number;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const save = useSaveFigures(taskId);
  const [pages, setPages] = useState(saved);
  const [zoom, setZoom] = useState<number | null>(null);
  const all = Array.from({ length: d.pageCount ?? 0 }, (_, i) => i + 1);
  const toggle = (p: number) => setPages((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p].sort((a, b) => a - b)));
  const submit = async () => {
    try {
      await save.mutateAsync({ version: latestVersion(), drawings: { [d.fileId]: pages } });
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    }
  };
  return (
    <Modal
      title={`${d.name} · 选页`}
      open
      width={760}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, textAlign: 'left', ...caption, color: pages.length ? gy.tertiary : gy.error }}>
            {pages.length ? `放进附件 7 共 ${pages.length} 页，每页单独占一页` : '一页都不放进附件 7'}
          </span>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
            保存
          </Button>
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ flex: 1, ...type.body, color: gy.secondary }}>勾选要放进应急预案附件 7 的页。设计说明、图纸目录等页不用放。</span>
          <button type="button" style={link14} onClick={() => setPages(all)}>
            全选
          </button>
          <button type="button" style={link14} onClick={() => setPages([])}>
            全不选
          </button>
        </span>
        <ol aria-label={`${d.name}的页`} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: 0, padding: 0, listStyle: 'none' }}>
          {all.map((p) => (
            <Thumb key={p} url={drawingPageUrl(taskId, d.fileId, p, 'thumb')} page={p} checked={pages.includes(p)} onToggle={() => toggle(p)} onZoom={() => setZoom(p)} />
          ))}
        </ol>
      </div>
      <Modal title={`${d.name} · 第 ${zoom} 页`} open={zoom !== null} width={1100} footer={null} onCancel={() => setZoom(null)} destroyOnHidden>
        {zoom !== null && (
          <div style={{ display: 'flex', justifyContent: 'center', minHeight: 200 }}>
            <img src={drawingPageUrl(taskId, d.fileId, zoom, 'full')} alt={`${d.name}第 ${zoom} 页`} style={{ maxWidth: '100%', maxHeight: '75vh' }} />
          </div>
        )}
      </Modal>
    </Modal>
  );
}

function Thumb({ url, page, checked, onToggle, onZoom }: { url: string; page: number; checked: boolean; onToggle: () => void; onZoom: () => void }) {
  const [state, setState] = useState<'loading' | 'done' | 'failed'>('loading');
  useEffect(() => setState('loading'), [url]);
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
          background: gy.canvas,
          cursor: 'zoom-in',
        }}
      >
        {state !== 'done' && <span style={{ position: 'absolute', ...caption }}>{state === 'failed' ? '预览失败' : '转换中…'}</span>}
        <img
          src={url}
          alt={`第 ${page} 页`}
          loading="lazy"
          onLoad={() => setState('done')}
          onError={() => setState('failed')}
          style={{ maxWidth: '100%', maxHeight: '100%', opacity: state === 'done' ? 1 : 0 }}
        />
      </button>
      <Checkbox checked={checked} onChange={onToggle}>
        第 {page} 页
      </Checkbox>
    </li>
  );
}
