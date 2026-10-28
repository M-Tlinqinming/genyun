import type { SubmittedAnswer, SubmittedDocument } from '@genyun/shared';
import { ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Grid, Modal, Result, Spin } from 'antd';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../../api/request';
import {
  fetchTaskSubmission,
  submitTask,
  SubmitUnknownError,
  taskKey,
  type SubmissionPreview,
  type Task,
} from '../../../api/tasks';
import { gy } from '../../../theme/tokens';

// confirm = 确认资料版本（F02）；submitting = 提交中（F04）；unknown = 结果未知，先查询（F06、F08）；
// failed = 查过确认没交上，可以重试（F05）
type Phase = 'loading' | 'confirm' | 'submitting' | 'unknown' | 'querying' | 'failed';

// 同一个任务的同一次提交用同一个编号：断网后重发、刷新页面后再交，后台都只记一次
function requestIdFor(taskId: string): string {
  const key = `genyun.submit.${taskId}`;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

// 提交生成申请的确认框（13 页 F02、F04、F05、F06，窄屏 F08）。资料在确认之后有变化（F07）时
// 不提交，交给 onChanged 在检查页提示重新检查
export function SubmitDialog({
  task,
  open,
  onClose,
  onChanged,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
  onChanged: (changes: string[]) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const narrow = !Grid.useBreakpoint().md;
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<SubmissionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const done = async () => {
    try {
      sessionStorage.removeItem(`genyun.submit.${task.id}`);
    } catch {
      // 浏览器不让用就算了，编号只是防重复
    }
    await client.invalidateQueries({ queryKey: taskKey(task.id) });
    onClose();
    message.success('申请已提交，耕云开始整理');
    navigate(`/customer/tasks/${task.id}?tab=records`);
  };

  useEffect(() => {
    if (!open) return;
    setPhase('loading');
    setLoadError(null);
    fetchTaskSubmission(task.id)
      .then((s) => {
        if (s.submitted) return done();
        setPreview(s.preview);
        setPhase('confirm');
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : '加载失败'));
    // 每次打开重新读一遍最新资料
  }, [open, task.id]);

  const send = async () => {
    if (!preview) return;
    setPhase('submitting');
    try {
      await submitTask(task.id, {
        requestId: requestIdFor(task.id),
        fingerprint: preview.fingerprint,
        documents: preview.taskDocuments,
      });
      await done();
    } catch (err) {
      if (err instanceof SubmitUnknownError) return setPhase('unknown');
      if (err instanceof ApiError && err.body?.code === 'materials_changed') {
        setPhase('confirm');
        onClose();
        onChanged(Array.isArray(err.body.changes) ? (err.body.changes as string[]) : []);
        return;
      }
      setPhase('confirm');
      message.error(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
    }
  };

  // 查询不会重新提交：查到已提交就算成功，确认没交上才给重试
  const query = async () => {
    setPhase('querying');
    try {
      const s = await fetchTaskSubmission(task.id);
      if (s.submitted) return await done();
      setPhase('failed');
    } catch {
      setPhase('unknown');
      message.warning('仍无法连接，请检查网络后再查询');
    }
  };

  // 提交中、结果未知时不能随手关掉，避免客户以为没交又去重新填
  const closable = phase === 'confirm' || phase === 'failed' || phase === 'loading';
  const head = HEADS[phase === 'querying' ? 'unknown' : phase];
  const status = phase === 'unknown' || phase === 'querying' ? '提交结果待确认' : phase === 'failed' ? '本次未提交' : '资料检查已满足';

  // 窄屏（F08）：按钮整行宽、主按钮在上
  const big = narrow ? { block: true, size: 'large' as const } : {};
  const leave = () => navigate(`/customer/enterprises/${task.enterpriseId}`);
  const buttons: ReactNode[] =
    phase === 'confirm'
      ? [
          <Button key="back" {...big} onClick={onClose}>
            返回核对
          </Button>,
          <Button key="ok" type="primary" {...big} onClick={() => void send()}>
            确认提交
          </Button>,
        ]
      : phase === 'submitting'
        ? [
            <Button key="leave" {...big} onClick={leave}>
              返回业务任务
            </Button>,
            <Button key="busy" {...big} disabled>
              提交中…
            </Button>,
          ]
        : phase === 'unknown' || phase === 'querying'
          ? [
              <Button key="leave" {...big} onClick={leave}>
                返回业务任务
              </Button>,
              <Button key="query" type="primary" {...big} loading={phase === 'querying'} onClick={() => void query()}>
                查询提交结果
              </Button>,
            ]
          : phase === 'failed'
            ? [
                <Button key="back" {...big} onClick={onClose}>
                  返回检查
                </Button>,
                <Button key="retry" type="primary" {...big} onClick={() => void send()}>
                  重试提交
                </Button>,
              ]
            : [];

  return (
    <Modal
      open={open}
      onCancel={closable ? onClose : undefined}
      closable={closable}
      mask={{ closable: false }}
      keyboard={closable}
      width={narrow ? '100%' : 560}
      style={narrow ? { top: 0, maxWidth: '100vw', margin: 0, paddingBottom: 0 } : undefined}
      title={
        head && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, lineHeight: '28px', fontWeight: 500 }}>
            {head.icon}
            {head.title}
          </span>
        )
      }
      footer={
        <div
          style={
            narrow
              ? { display: 'flex', flexDirection: 'column', gap: 12 }
              : { display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 4 }
          }
        >
          {narrow ? [...buttons].reverse() : buttons}
        </div>
      }
      destroyOnHidden
    >
      {loadError ? (
        <Result status="error" title="资料加载失败" subTitle={loadError} />
      ) : phase === 'loading' || !preview ? (
        <Spin style={{ display: 'block', padding: '48px 0' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }} data-testid="submit-dialog" data-phase={phase}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{head?.text}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 6, background: gy.canvas }}>
            <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{task.enterpriseName}</span>
            <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>{task.name}</span>
            <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
              {task.number} · 首次申请 · {status}
            </span>
          </div>
          <DocumentList documents={preview.documents} />
          {phase === 'confirm' && <AnswerList answers={preview.answers} />}
          <Note phase={phase} pendingCount={preview.pendingCount} />
        </div>
      )}
    </Modal>
  );
}

const HEADS: Record<Exclude<Phase, 'querying'>, { title: string; text: string; icon?: ReactNode } | null> = {
  loading: { title: '确认提交生成申请', text: '' },
  confirm: {
    title: '确认提交生成申请',
    text: '请确认企业、任务与资料版本。提交成功后，由耕云继续编制和专家审核。',
  },
  submitting: {
    title: '正在提交申请',
    text: '正在记录本次申请和资料版本，请勿重复提交。离开当前页面不会取消已发送的申请。',
    icon: <LoadingOutlined style={{ color: gy.primary }} />,
  },
  unknown: {
    title: '暂时无法确认提交结果',
    text: '连接已中断，申请可能已经提交。请先查询结果，避免重复申请。已保存的资料仍然保留。',
    icon: <ExclamationCircleFilled style={{ color: gy.warning }} />,
  },
  failed: {
    title: '申请未提交，请重试',
    text: '系统暂时无法提交申请，已确认本次没有提交成功。您的文件与检查结果已保留，无需重复上传。',
    icon: <ExclamationCircleFilled style={{ color: gy.error }} />,
  },
};

export function DocumentList({ documents }: { documents: SubmittedDocument[] }) {
  if (documents.length === 0) {
    return <span style={{ fontSize: 14, color: gy.secondary }}>本次没有上传文件，资料由您在线填写与确认。</span>;
  }
  return (
    <ul aria-label="本次资料版本" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {documents.map((d) => (
        <li key={d.fileId} style={row}>
          <span style={{ flex: 1, minWidth: 0, color: gy.text, overflowWrap: 'anywhere' }}>{d.name}</span>
          <span style={{ width: 48, flexShrink: 0, textAlign: 'right', color: gy.secondary }}>{d.version ? `V${d.version}` : '照片'}</span>
        </li>
      ))}
    </ul>
  );
}

export function AnswerList({ answers, title = '由您确认的事项' }: { answers: SubmittedAnswer[]; title?: string }) {
  if (answers.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: `1px solid ${gy.split}` }}>
      <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>{title}</span>
      {answers.map((a) => (
        <div key={a.label} style={row}>
          <span style={{ color: gy.text }}>{a.label}</span>
          <span style={{ color: gy.text, textAlign: 'right', overflowWrap: 'anywhere' }}>{a.answer}</span>
        </div>
      ))}
    </div>
  );
}

function Note({ phase, pendingCount }: { phase: Phase; pendingCount: number }) {
  const box = (text: string, style: CSSProperties) => (
    <div style={{ padding: '12px 16px', borderRadius: 6, fontSize: 14, lineHeight: '22px', color: gy.text, ...style }}>{text}</div>
  );
  if (phase === 'unknown' || phase === 'querying') {
    return box('查询结果不会重新提交申请。若长时间无法确认，可联系耕云协助核实。', { border: `1px solid ${gy.warning}` });
  }
  if (phase === 'failed') {
    return box('重试时会再次核对资料版本和检查结果。您也可以返回检查页面，稍后继续申请。', { border: `1px solid ${gy.error}` });
  }
  if (phase === 'submitting') {
    return box('您可以返回业务任务查看处理状态；如暂时无法确认结果，请先查询提交结果，避免重复申请。', { background: gy.selected });
  }
  return box(
    `本次提交将记录以上资料版本和您确认的事项。后续上传新文件，不会自动替换本任务已提交的资料。${
      pendingCount > 0 ? `还有 ${pendingCount} 项可稍后补，提交后在任务里继续补。` : ''
    }`,
    { background: gy.selected },
  );
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  fontSize: 14,
  lineHeight: '22px',
};
