import { CheckCircleFilled, CloseOutlined, PaperClipOutlined, PlusOutlined } from '@ant-design/icons';
import { FEEDBACK_CONTENT_MAX, FEEDBACK_FILES_MAX, type FeedbackSource } from '@genyun/shared';
import { App, Button, Input, Modal, Upload } from 'antd';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useSubmitFeedback } from '../api/feedback';
import { uploadFile } from '../api/profile';
import { ApiError } from '../api/request';
import { gy } from '../theme/tokens';

// 客户提交反馈（Paper 20 页「产品与服务反馈」线框：填写 → 感谢）。
// 两个入口：顶栏「意见反馈」（通用）、成果文档页「反馈文稿问题」（带上任务和交付版本）。
// 提交失败时意见和附件都保留；成功后可以去「我的反馈」看处理进度，处理结果也会在站内提醒里告诉客户
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp';

const text14 = { fontSize: 14, lineHeight: '22px' } as const;

export interface FeedbackContext {
  taskId: string;
  deliveryVersion: number;
  // 弹窗里显示「关于：示例包装 · GY-2026-003 · 交付 V1」
  label: string;
}

export function FeedbackModal({
  orgId,
  trigger,
  title = '产品与服务反馈',
  intro = '使用过程中有哪些不便，或希望耕云改进的地方？欢迎告诉我们。',
  context,
  source = 'general',
}: {
  orgId: string;
  trigger: (open: () => void) => ReactNode;
  title?: string;
  intro?: string;
  context?: FeedbackContext;
  source?: FeedbackSource;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      {open && <FeedbackDialog orgId={orgId} title={title} intro={intro} context={context} source={source} onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDialog({
  orgId,
  title,
  intro,
  context,
  source,
  onClose,
}: {
  orgId: string;
  title: string;
  intro: string;
  context?: FeedbackContext;
  source: FeedbackSource;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const submit = useSubmitFeedback(orgId);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [pending, setPending] = useState(0);
  const uploading = pending > 0;
  // 已占的名额（已附上 + 正在上传）。Upload 一次选多个文件时 beforeUpload 会连着调用，
  // 这时 files 还是旧值，所以用 ref 同步记数，按剩余名额截断
  const taken = useRef(0);
  const warnedBatch = useRef<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const add = (file: File, batch: unknown) => {
    if (taken.current >= FEEDBACK_FILES_MAX) {
      // 同一批只提示一次
      if (warnedBatch.current !== batch) {
        warnedBatch.current = batch;
        message.warning(`最多附 ${FEEDBACK_FILES_MAX} 个文件，超出的没有上传`);
      }
      return;
    }
    taken.current += 1;
    setPending((n) => n + 1);
    void uploadFile(orgId, file, 'material')
      .then((id) => setFiles((list) => [...list, { id, name: file.name }]))
      .catch((err: unknown) => {
        taken.current -= 1;
        message.error(`附件没能上传：${err instanceof ApiError ? err.message : '请稍后重试'}`);
      })
      .finally(() => setPending((n) => n - 1));
  };

  const send = () => {
    if (!content.trim()) {
      setError('请写下您的意见');
      return;
    }
    setError(null);
    submit.mutate(
      {
        content,
        fileIds: files.map((f) => f.id),
        source,
        ...(context && { taskId: context.taskId, deliveryVersion: context.deliveryVersion }),
      },
      {
        onSuccess: () => setDone(true),
        // 失败时意见和附件都保留，可以直接再点提交
        onError: (err) => setError(err instanceof ApiError ? err.message : '没能提交，请稍后重试'),
      },
    );
  };

  if (done) {
    return (
      <Modal
        open
        title={null}
        width={480}
        onCancel={onClose}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Link to="/customer/feedback" onClick={onClose}>
              <Button>查看我的反馈</Button>
            </Link>
            <Button type="primary" onClick={onClose}>
              返回原页面
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 16, paddingTop: 8 }}>
          <CheckCircleFilled style={{ fontSize: 22, color: gy.success, marginTop: 2 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>感谢您的反馈</span>
            <span style={{ ...text14, color: gy.text }}>您的意见已提交，耕云团队会查看并跟进，处理结果会通过站内提醒告诉您。</span>
            <span style={{ ...text14, color: gy.secondary }}>{context ? '您可以继续查看和下载已交付成果，当前版本不受影响。' : '您可以继续使用耕云。'}</span>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title={title}
      width={520}
      onCancel={onClose}
      mask={{ closable: false }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submit.isPending} disabled={uploading} onClick={send}>
            提交反馈
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
        <p style={{ ...text14, margin: 0, color: gy.secondary }}>{intro}</p>
        {context && (
          <div style={{ ...text14, padding: '8px 12px', borderRadius: 6, background: gy.canvas, color: gy.text }}>
            <span style={{ color: gy.secondary }}>关于：</span>
            {context.label}
          </div>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...text14, color: gy.text }}>
            您的意见 <span style={{ color: gy.error }}>*</span>
          </span>
          <Input.TextArea
            aria-label="您的意见"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (error) setError(null);
            }}
            maxLength={FEEDBACK_CONTENT_MAX}
            showCount
            autoSize={{ minRows: 5, maxRows: 10 }}
            status={error ? 'error' : undefined}
            placeholder={context ? '请写明是哪份文档、哪一处需要更正，以及正确的情况。' : '请描述使用体验、遇到的问题或改进建议。'}
          />
          {error && <span style={{ fontSize: 12, lineHeight: '20px', color: gy.error }}>{error}</span>}
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...text14, color: gy.text }}>截图或附件（选填）</span>
          {files.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {files.map((f) => (
                <li key={f.id} style={{ ...text14, display: 'flex', alignItems: 'center', gap: 8, color: gy.text }}>
                  <PaperClipOutlined style={{ color: gy.secondary }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    aria-label={`移除 ${f.name}`}
                    onClick={() => {
                      taken.current -= 1;
                      setFiles((list) => list.filter((x) => x.id !== f.id));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {files.length < FEEDBACK_FILES_MAX && (
            <Upload
              accept={ACCEPT}
              showUploadList={false}
              multiple
              disabled={uploading}
              beforeUpload={(file, batch) => {
                add(file, batch);
                return false;
              }}
            >
              <Button icon={<PlusOutlined />} loading={uploading}>
                添加附件
              </Button>
            </Upload>
          )}
        </div>
      </div>
    </Modal>
  );
}
