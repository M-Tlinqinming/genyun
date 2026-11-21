import { CheckOutlined, CloseOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { UPLOAD_RULES, UPLOAD_RULE_OF_TARGET, parseUploadTarget } from '@genyun/shared';
import { App } from 'antd';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { downloadFile, viewFile } from '../../../../api/intake';
import { ApiError } from '../../../../api/request';
import { inlineUrl, useWorkupUpload, type Workup } from '../../../../api/workup';
import { SourceTag } from '../../../../components/SourceTag';
import { gy, type, viewer, weight } from '../../../../theme/tokens';
import { caption, dayOf, link14 } from './parts';
import type { Autosave } from './useAutosave';

// 看原图与代客户上传（13 页 S03）：
// ① 「查看原图」「看铭牌照片」「查看图片」都打开同一个预览层（图片在页面里看，PDF 新开一页）；
// ② 代客户上传：上传中 / 传上以后（您代传，查看 · 替换 · 再传一张）/ 没传上（重试 · 移除）

export interface PreviewFile {
  fileId: string;
  name?: string;
  contentType?: string;
  // 「客户 11 月 16 日上传 · 来自「其他图纸与照片」」
  note?: string;
}

const isPdf = (f: PreviewFile) => f.contentType === 'application/pdf' || /\.pdf$/i.test(f.name ?? '');

/** 预览层：缩小 / 100% / 放大 / 旋转 / 下载，左右切换，滚轮缩放、拖动平移，Esc 关闭 */
export function FilePreview({ title, files, index, onClose }: { title: string; files: PreviewFile[]; index: number | null; onClose: () => void }) {
  const { message } = App.useApp();
  const [i, setI] = useState(index ?? 0);
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const open = index !== null;
  const file = files[i];

  useEffect(() => {
    if (index !== null) setI(index);
  }, [index]);
  useEffect(() => {
    setScale(1);
    setRotate(0);
    setOffset({ x: 0, y: 0 });
    setUrl(null);
    setFailed(false);
    if (!open || !file || isPdf(file)) return;
    let live = true;
    inlineUrl(file.fileId)
      .then((r) => live && setUrl(r.url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, file]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
      if (e.key === 'ArrowRight') setI((n) => Math.min(files.length - 1, n + 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose, files.length]);

  if (!open || !file) return null;
  const run = (job: Promise<void>) => job.catch((err) => message.error(err instanceof Error ? err.message : '打不开这份文件，请稍后再试'));
  const tool: CSSProperties = { ...link14, color: viewer.text, fontWeight: weight.strong };
  const zoom = (f: number) => setScale((s) => Math.min(8, Math.max(0.2, Math.round(s * f * 100) / 100)));
  const nav = (dir: -1 | 1): CSSProperties => ({
    position: 'absolute',
    top: '50%',
    [dir < 0 ? 'left' : 'right']: 24,
    width: 40,
    height: 40,
    marginTop: -20,
    borderRadius: 20,
    border: 'none',
    background: viewer.toolBg,
    color: viewer.text,
    cursor: 'pointer',
  });

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', flexDirection: 'column', background: viewer.mask }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 24px' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: viewer.text }}>
            {title}
            {files.length > 1 ? ` · 第 ${i + 1} 张，共 ${files.length} 张` : ''}
          </span>
          {(file.note || file.name) && <span style={{ ...type.caption, color: viewer.muted }}>{file.note ?? file.name}</span>}
        </div>
        {!isPdf(file) && (
          <>
            <button type="button" style={tool} onClick={() => zoom(1 / 1.25)}>
              缩小
            </button>
            <button type="button" style={tool} onClick={() => (setScale(1), setOffset({ x: 0, y: 0 }))}>
              {Math.round(scale * 100)}%
            </button>
            <button type="button" style={tool} onClick={() => zoom(1.25)}>
              放大
            </button>
            <button type="button" style={tool} onClick={() => setRotate((r) => (r + 90) % 360)}>
              旋转
            </button>
          </>
        )}
        <button type="button" style={tool} onClick={() => void run(downloadFile(file.fileId))}>
          下载
        </button>
        <button type="button" aria-label="关闭" style={tool} onClick={onClose}>
          <CloseOutlined />
        </button>
      </div>
      <div
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: drag.current ? 'grabbing' : 'grab' }}
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onMouseMove={(e) => {
          const d = drag.current;
          if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        {isPdf(file) ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: viewer.text }}>
            <span style={type.body}>PDF 文件在新标签页里看</span>
            <button type="button" style={tool} onClick={() => void run(viewFile(file.fileId))}>
              打开 {file.name ?? 'PDF'}
            </button>
          </div>
        ) : failed ? (
          <span style={{ ...type.body, color: viewer.text }}>这份文件在页面里打不开，请点「下载」查看。</span>
        ) : url ? (
          <img
            src={url}
            alt={file.name ?? title}
            draggable={false}
            onError={() => setFailed(true)}
            style={{
              maxWidth: '80%',
              maxHeight: '100%',
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotate}deg)`,
              transition: drag.current ? undefined : 'transform 120ms',
              userSelect: 'none',
            }}
          />
        ) : (
          <span style={{ ...type.body, color: viewer.muted }}>正在打开…</span>
        )}
        {files.length > 1 && i > 0 && (
          <button type="button" aria-label="上一张" style={nav(-1)} onClick={() => setI(i - 1)}>
            <LeftOutlined />
          </button>
        )}
        {files.length > 1 && i < files.length - 1 && (
          <button type="button" aria-label="下一张" style={nav(1)} onClick={() => setI(i + 1)}>
            <RightOutlined />
          </button>
        )}
      </div>
      <span style={{ padding: '12px 0 16px', textAlign: 'center', ...type.caption, color: viewer.muted }}>滚轮缩放，拖动平移；按 Esc 关闭</span>
    </div>
  );
}

/** 一处预览层的开关：open(文件, 第几张) */
export function usePreview() {
  const [state, setState] = useState<{ title: string; files: PreviewFile[]; index: number } | null>(null);
  const close = useCallback(() => setState(null), []);
  const node = <FilePreview title={state?.title ?? ''} files={state?.files ?? []} index={state ? state.index : null} onClose={close} />;
  return { open: (title: string, files: PreviewFile[], index = 0) => files.length && setState({ title, files, index }), node };
}

// ── 代客户上传 ──

type SlotState = { kind: 'uploading'; name: string; abort: AbortController } | { kind: 'failed'; name: string; file: File; replace?: string; error: string };

/**
 * 代客户上传：先把没存的改动存掉（服务端从已存的内容上写），传上以后缓存里的任务资料换成新的，
 * onDone 把新文件并进页面上的这一步
 */
export function useExpertUpload({
  taskId,
  autosave,
  latestVersion,
  onDone,
}: {
  taskId: string;
  autosave: Autosave;
  latestVersion: () => number;
  onDone: (saved: Workup, target: string) => void;
}) {
  const { message } = App.useApp();
  const upload = useWorkupUpload(taskId);
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  const set = (target: string, s: SlotState | null) =>
    setSlots((all) => {
      const next = { ...all };
      if (s) next[target] = s;
      else delete next[target];
      return next;
    });

  const start = async (target: string, file: File, replace?: string) => {
    const t = parseUploadTarget(target);
    const rule = t ? UPLOAD_RULES[UPLOAD_RULE_OF_TARGET[t.kind]] : undefined;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (rule && !(rule.types as readonly string[]).includes(ext === 'jpeg' ? 'jpg' : ext)) {
      message.error(`只能传 ${rule.types.join(' / ')} 格式的文件`);
      return;
    }
    if (rule && file.size > rule.maxBytes) {
      message.error(`文件不能超过 ${Math.round(rule.maxBytes / 1024 / 1024)} MB`);
      return;
    }
    const abort = new AbortController();
    set(target, { kind: 'uploading', name: file.name, abort });
    try {
      await autosave.flush();
      const saved = await upload.mutateAsync({ target, version: latestVersion(), file, replace, signal: abort.signal });
      set(target, null);
      onDone(saved, target);
    } catch (err) {
      if (abort.signal.aborted) {
        set(target, null);
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        set(target, null);
        message.warning(err.message);
        await autosave.stale();
        return;
      }
      const error = err instanceof ApiError && err.status > 0 && err.status < 500 ? err.message : '网络断了，没传上去。';
      set(target, { kind: 'failed', name: file.name, file, replace, error });
    }
  };

  return {
    slots,
    start: (target: string, file: File, replace?: string) => void start(target, file, replace),
    cancel: (target: string) => {
      const s = slots[target];
      if (s?.kind === 'uploading') s.abort.abort();
      set(target, null);
    },
    retry: (target: string) => {
      const s = slots[target];
      if (s?.kind === 'failed') void start(target, s.file, s.replace);
    },
    remove: (target: string) => set(target, null),
  };
}
export type ExpertUploads = ReturnType<typeof useExpertUpload>;

/** 选文件的隐藏输入框 */
function pick(accept: string, onFile: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) onFile(f);
  };
  input.click();
}

export const acceptOf = (target: string) => {
  const t = parseUploadTarget(target);
  return t ? UPLOAD_RULES[UPLOAD_RULE_OF_TARGET[t.kind]].types.map((e) => (e === 'jpg' ? '.jpg,.jpeg' : `.${e}`)).join(',') : '';
};

export function chooseFile(target: string, onFile: (f: File) => void) {
  pick(acceptOf(target), onFile);
}

export interface SlotFile {
  fileId: string;
  name: string;
  // 专家代传的（不在客户快照里）
  byExpert: boolean;
  at?: string;
  contentType?: string;
}

/** 上传中 / 没传上的那一块（图纸卡、MSDS 行里都用） */
export function UploadProgress({ state, onCancel, onRetry, onRemove }: { state: SlotState; onCancel: () => void; onRetry: () => void; onRemove: () => void }) {
  if (state.kind === 'uploading') {
    return (
      <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, ...type.body, color: gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.name}</span>
          <span style={caption}>上传中…</span>
        </div>
        <span aria-hidden style={{ position: 'relative', height: 4, borderRadius: 2, background: gy.neutralBg, overflow: 'hidden' }}>
          <span style={{ position: 'absolute', inset: 0, width: '40%', borderRadius: 2, background: gy.primary, animation: 'gy-upload 1.2s ease-in-out infinite' }} />
        </span>
        <style>{'@keyframes gy-upload { from { left: -40%; } to { left: 100%; } }'}</style>
        <button type="button" style={{ ...link14, alignSelf: 'flex-start' }} onClick={onCancel}>
          取消
        </button>
      </div>
    );
  }
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>{state.name}</span>
      <span style={{ ...type.caption, color: gy.error }}>{state.error}</span>
      <span style={{ display: 'flex', gap: 16 }}>
        <button type="button" style={link14} onClick={onRetry}>
          重试
        </button>
        <button type="button" style={link14} onClick={onRemove}>
          移除
        </button>
      </span>
    </div>
  );
}

/** 传上以后的一个文件：✓ 名称、「您代传」、时间，查看 / 替换 */
export function UploadedFile({ file, onView, onReplace, extra }: { file: SlotFile; onView: () => void; onReplace?: () => void; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <CheckOutlined aria-hidden style={{ color: gy.success, fontSize: 12 }} />
        <span style={{ ...type.body, color: gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
        {file.byExpert && <SourceTag kind="expert" text="您代传" />}
      </span>
      {file.byExpert && file.at && <span style={caption}>{dayOf(file.at, true)} 您代客户上传</span>}
      <span style={{ display: 'flex', gap: 16 }}>
        <button type="button" style={link14} onClick={onView}>
          查看
        </button>
        {onReplace && (
          <button type="button" style={link14} onClick={onReplace}>
            替换
          </button>
        )}
        {extra}
      </span>
    </div>
  );
}

/** 任务里某个文件叫什么、是不是专家代传的（代传记录里有的就是） */
export function fileInfo(workup: Workup, fileId: string, fallback: string): SlotFile {
  const up = workup.data.expertUploads?.find((u) => u.fileId === fileId);
  const intake = workup.intakeFiles.find((f) => f.fileId === fileId);
  const drawing = workup.drawings.find((d) => d.fileId === fileId);
  return {
    fileId,
    name: up?.name ?? intake?.name ?? drawing?.name ?? fallback,
    byExpert: Boolean(up),
    at: up?.at,
    contentType: intake?.contentType ?? drawing?.contentType,
  };
}
