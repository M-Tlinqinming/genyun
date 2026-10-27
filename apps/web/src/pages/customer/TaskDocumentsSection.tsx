import { uploadRuleHint } from '@genyun/shared';
import { LoadingOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Upload } from 'antd';
import { useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  addTaskDocument,
  openFile,
  removeTaskDocument,
  taskDocumentsKey,
  useTaskDocuments,
  type TaskDocument,
} from '../../api/documents';
import { uploadFile } from '../../api/profile';
import { ApiError } from '../../api/request';
import type { Task } from '../../api/tasks';
import { LibraryPickerModal } from './LibraryPickerModal';
import { gy } from '../../theme/tokens';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp';

// 还没保存成功的文件：上传中或失败。失败的留在列表里，可以重试或换一个文件
interface Pending {
  key: string;
  file: File;
  status: 'uploading' | 'failed';
  error?: string;
}

// 「上传已有资料」路线：任务页「资料与检查」（12 页 P03 上传、P03B 从企业资料中选用、P04 部分失败只重试失败项）。
// 每个文件单独上传、单独登记进企业资料库并关联到任务，一个失败不影响其他文件
export function TaskDocumentsSection({ task }: { task: Task }) {
  const docs = useTaskDocuments(task.id);
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);
  const dropZone = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const patch = (key: string, next: Partial<Pending> | null) =>
    setPending((list) =>
      next === null ? list.filter((p) => p.key !== key) : list.map((p) => (p.key === key ? { ...p, ...next } : p)),
    );

  const send = async (key: string, file: File) => {
    patch(key, { file, status: 'uploading', error: undefined });
    try {
      const fileId = await uploadFile(task.orgId, file, 'material');
      const list = await addTaskDocument(task.id, fileId);
      client.setQueryData(taskDocumentsKey(task.id), list);
      patch(key, null);
    } catch (err) {
      // 后台拒绝时给出原因（格式、大小）；网络中断时浏览器的英文报错不给客户看
      const reason = err instanceof ApiError ? err.message : '上传时连接中断，请检查网络后重试';
      patch(key, { status: 'failed', error: reason });
    }
  };

  const add = (files: File[]) => {
    const rows = files.map((file) => ({ key: `p${++seq.current}`, file, status: 'uploading' as const }));
    setPending((list) => [...list, ...rows]);
    // 逐个上传，网络慢时不至于同时占满带宽
    void rows.reduce((chain, r) => chain.then(() => send(r.key, r.file)), Promise.resolve());
  };

  const remove = (doc: TaskDocument) =>
    modal.confirm({
      title: `从本任务移除「${doc.name}」？`,
      content: '只取消本任务的关联，企业资料库里的原件保留。',
      okText: '移除',
      cancelText: '取消',
      onOk: async () => {
        try {
          client.setQueryData(taskDocumentsKey(task.id), await removeTaskDocument(task.id, doc.documentId));
        } catch (err) {
          message.error(err instanceof Error ? err.message : '移除失败，请稍后重试');
        }
      },
    });

  const preview = (fileId: string) =>
    openFile(fileId).catch((err: unknown) => message.error(err instanceof Error ? err.message : '打开失败'));

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) add([...e.dataTransfer.files]);
  };

  const saved = docs.data ?? [];
  const failed = pending.filter((p) => p.status === 'failed');
  const uploading = pending.some((p) => p.status === 'uploading');
  const locked = task.status !== 'preparing';

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 24,
        borderRadius: 8,
        background: gy.surface,
        border: `1px solid ${gy.split}`,
      }}
    >
      {failed.length > 0 ? (
        <Heading
          title={`${saved.length} 份文件已保存，${failed.length} 份上传失败`}
          color={gy.error}
          description={`${failed.map((f) => f.file.name).join('、')} 上传失败，尚未保存。已成功的文件不受影响，无需重新上传。`}
        />
      ) : (
        <Heading
          title="先准备企业已有资料"
          description="一个文件可支持多项事实检查。实际资料要求根据企业情况确定，无需凑齐固定文件数量。"
        />
      )}

      {!locked && (
        <div
          data-testid="drop-zone"
          ref={dropZone}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            padding: 24,
            borderRadius: 6,
            border: `1px dashed ${dragging ? gy.primary : gy.border}`,
            background: dragging ? gy.selected : gy.canvas,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>拖入资料，或选择多个文件</span>
            <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{uploadRuleHint('material')}</span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button onClick={() => setPicking(true)}>从企业资料中选择</Button>
            <Upload
              accept={ACCEPT}
              multiple
              showUploadList={false}
              beforeUpload={(_file, list) => {
                // 多选时 beforeUpload 每个文件调一次，只在第一个时整批加入
                if (_file === list[0]) add(list);
                return false;
              }}
            >
              <Button type="primary">选择文件上传</Button>
            </Upload>
          </div>
        </div>
      )}

      <div role="table" aria-label="本次原始资料" style={{ borderRadius: 6, border: `1px solid ${gy.split}` }}>
        <Row header>
          <span style={{ ...nameCell, fontWeight: 500 }}>
            {saved.length > 0 ? `已关联 ${saved.length} 份原始文件` : '还没有关联文件'}
          </span>
          <span style={{ ...cell, width: 96 }}>版本</span>
          <span style={{ ...cell, width: 110 }}>保存状态</span>
          <span style={{ ...cell, width: 96 }}>操作</span>
        </Row>
        {saved.map((d) => (
          <Row key={d.documentId}>
            <span style={nameCell}>{d.name}</span>
            <span style={{ ...cell, width: 96, display: 'flex', flexDirection: 'column' }}>
              V{d.version}
              {d.latestVersion > d.version && (
                <span style={{ fontSize: 12, lineHeight: '18px', color: gy.warning, whiteSpace: 'nowrap' }}>有新版本 V{d.latestVersion}</span>
              )}
            </span>
            <span style={{ ...cell, width: 110, color: gy.success }}>已保存并关联</span>
            <span style={{ width: 96, flexShrink: 0, display: 'flex', gap: 14 }}>
              <button type="button" style={link} aria-label={`预览${d.name}`} onClick={() => void preview(d.fileId)}>
                预览
              </button>
              {!locked && (
                <button type="button" style={link} aria-label={`移除${d.name}`} onClick={() => remove(d)}>
                  移除
                </button>
              )}
            </span>
          </Row>
        ))}
        {pending.map((p) => (
          <Row key={p.key} tone={p.status === 'failed' ? 'failed' : undefined} testId="pending-row">
            <span style={{ ...nameCell, display: 'flex', flexDirection: 'column' }}>
              {p.file.name}
              {p.error && <span style={{ fontSize: 12, lineHeight: '20px', color: gy.error }}>{p.error}</span>}
            </span>
            <span style={{ ...cell, width: 96, color: gy.tertiary }}>—</span>
            {p.status === 'uploading' ? (
              <span style={{ ...cell, width: 110, color: gy.secondary }}>
                <LoadingOutlined style={{ marginRight: 6 }} />
                正在上传
              </span>
            ) : (
              <span style={{ ...cell, width: 110, color: gy.error }}>失败 · 未保存</span>
            )}
            <span style={{ width: 96, flexShrink: 0, display: 'flex', gap: 14 }}>
              {p.status === 'failed' && (
                <>
                  <button type="button" style={link} aria-label={`重试${p.file.name}`} onClick={() => void send(p.key, p.file)}>
                    重试
                  </button>
                  <Upload
                    accept={ACCEPT}
                    showUploadList={false}
                    beforeUpload={(file) => {
                      void send(p.key, file);
                      return false;
                    }}
                  >
                    <button type="button" style={link} aria-label={`重选${p.file.name}`}>
                      重选
                    </button>
                  </Upload>
                </>
              )}
            </span>
          </Row>
        ))}
      </div>

      <LibraryPickerModal
        task={task}
        linked={saved}
        open={picking}
        onClose={() => setPicking(false)}
        onSaved={(list) => client.setQueryData(taskDocumentsKey(task.id), list)}
        onUploadLocal={() => dropZone.current?.querySelector<HTMLInputElement>('input[type=file]')?.click()}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, paddingTop: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
          <span>资料与草稿已保存，可随时返回继续。</span>
          <span>
            {failed.length > 0
              ? '现在离开不会丢失已保存文件；失败文件需回来重试或重新选择。'
              : '选用资料前请核对有效性；新版本需明确选用，不会自动替换。'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Button size="large" onClick={() => navigate(`/customer/enterprises/${task.enterpriseId}`)}>
            稍后继续
          </Button>
          <Button
            size="large"
            type="primary"
            disabled={saved.length === 0 || uploading}
            onClick={() => message.info('资料检查即将开放；已上传的文件都已保存。')}
          >
            {failed.length > 0 ? '先检查已保存资料' : '检查资料'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function Heading({ title, description, color = gy.text }: { title: string; description: string; color?: string }) {
  return (
    <>
      <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 500, color }}>{title}</h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{description}</p>
    </>
  );
}

function Row({
  header,
  tone,
  testId,
  children,
}: {
  header?: boolean;
  tone?: 'failed';
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="row"
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: header ? '12px 16px' : 16,
        borderTop: header ? undefined : `1px solid ${gy.split}`,
        background: header ? gy.canvas : tone === 'failed' ? '#FFF7E6' : undefined,
      }}
    >
      {children}
    </div>
  );
}

const cell: CSSProperties = { flexShrink: 0, fontSize: 14, lineHeight: '22px', color: gy.text };
const nameCell: CSSProperties = { flex: '1 1 0', minWidth: 0, fontSize: 14, lineHeight: '22px', color: gy.text };
const link: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '22px',
  color: gy.primary,
};
