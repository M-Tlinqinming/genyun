import type { IntakeView } from '@genyun/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { App, Button, Modal } from 'antd';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { deleteTask, intakeKey, submitIntake, withdrawIntake } from '../../../api/intake';
import { ApiError } from '../../../api/request';
import { taskKey, type Task } from '../../../api/tasks';
import { NoticeBar } from '../../../components/NoticeBar';
import { gy, type, weight } from '../../../theme/tokens';
import { currentRows, deleteBody, submitHint, type MaterialRow } from './materialRows';

// 提交确认（12 页 U2c）、撤回确认（S01 ①）、删除任务确认（S06）三个弹窗，和它们成功后要刷新的查询

/** 提交、撤回、删除以后：任务、资料、工作台、任务列表、企业详情都重新取 */
export function refreshTaskQueries(client: QueryClient, taskId: string) {
  void client.invalidateQueries({ queryKey: taskKey(taskId) });
  void client.invalidateQueries({ queryKey: ['orgs'] });
  void client.invalidateQueries({ queryKey: ['enterprises'] });
}

/** 先把缓存里的任务改成新状态，跳页时不会被旧状态转回去 */
function patchTask(client: QueryClient, taskId: string, patch: Partial<Task>) {
  client.setQueryData<Task>(taskKey(taskId), (old) => (old ? { ...old, ...patch } : old));
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : '没有成功，请再试一次');

/** 弹窗外框：白底、圆角 8、内边距 24、块间距 16，不带右上角关闭 */
function Dialog({
  open,
  width,
  onCancel,
  children,
}: {
  open: boolean;
  width: number;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      width={width}
      title={null}
      footer={null}
      closable={false}
      centered
      destroyOnHidden
      onCancel={onCancel}
      styles={{ container: { padding: 24, borderRadius: 8, boxShadow: '0 12px 32px rgb(24 36 59 / 18%)' } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </Modal>
  );
}

const Title = ({ children }: { children: ReactNode }) => (
  <div style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{children}</div>
);
const Body = ({ children }: { children: ReactNode }) => <div style={{ ...type.body, color: gy.secondary }}>{children}</div>;
const Buttons = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>{children}</div>
);
const plain = { borderColor: gy.controlLine } as const;

/** 资料清单（弹窗里的那种）：外框 1px、圆角 8，一行一个文件，行多了在里面滚动 */
function RowList({ rows }: { rows: MaterialRow[] }) {
  return (
    <ul
      aria-label="要交给专家的资料"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '4px 16px',
        border: `1px solid ${gy.split}`,
        borderRadius: 8,
        maxHeight: 320,
        overflowY: 'auto',
      }}
    >
      {rows.map((r, i) => (
        <li
          key={r.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 0',
            borderTop: i === 0 ? undefined : `1px solid ${gy.split}`,
          }}
        >
          <span style={{ flex: '1 1 0', minWidth: 0, ...type.body, color: gy.text }}>{r.name}</span>
          <span style={{ flexShrink: 0, ...type.body, color: r.warn ? gy.warning : gy.secondary }}>{r.note}</span>
        </li>
      ))}
    </ul>
  );
}

function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="5.5" r="2.8" fill="none" stroke={gy.tertiary} strokeWidth="1.4" />
      <path d="M2.8 14c.6-2.8 2.7-4.3 5.2-4.3s4.6 1.5 5.2 4.3" fill="none" stroke={gy.tertiary} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="7" fill={gy.primary} />
      <path d="M8 7.2v4M8 4.6v.3" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** 提交确认弹窗（U2c）。requestId 每打开一次生成一个（弹窗关掉就丢），失败重试沿用 */
export function SubmitDialog({
  open,
  taskId,
  enterpriseName,
  view,
  onClose,
}: {
  open: boolean;
  taskId: string;
  enterpriseName: string;
  view: IntakeView;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} width={560} onCancel={onClose}>
      <SubmitBody taskId={taskId} enterpriseName={enterpriseName} view={view} onClose={onClose} />
    </Dialog>
  );
}

function SubmitBody({
  taskId,
  enterpriseName,
  view,
  onClose,
}: {
  taskId: string;
  enterpriseName: string;
  view: IntakeView;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [requestId] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const next = await submitIntake(taskId, requestId);
      patchTask(client, taskId, { status: 'submitted', submittedAt: next.submission?.submittedAt ?? new Date().toISOString() });
      client.setQueryData(intakeKey(taskId), next);
      refreshTaskQueries(client, taskId);
      navigate(`/customer/tasks/${taskId}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && err.status === 409) void client.invalidateQueries({ queryKey: intakeKey(taskId) });
      setSending(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Title>确认提交给专家？</Title>
        <Body>下面这些资料会交给专家，用来编制{enterpriseName}的应急预案。</Body>
      </div>
      <RowList rows={currentRows(view)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>编制专家</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            border: `1px solid ${gy.split}`,
            borderRadius: 8,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              background: gy.neutralBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <PersonIcon />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ ...type.body, color: gy.text }}>由耕云安排</span>
            <span style={{ ...type.caption, color: gy.secondary }}>耕云会安排合适的专家</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 8, background: gy.selected }}>
        <span style={{ display: 'flex', alignItems: 'center', height: 22, flexShrink: 0 }}>
          <InfoIcon />
        </span>
        <span style={{ flex: '1 1 0', ...type.body, color: gy.text }}>{submitHint(view)}</span>
      </div>
      {error && <NoticeBar tone="error">{error}</NoticeBar>}
      <Buttons>
        <Button style={plain} onClick={onClose} disabled={sending}>
          再看看
        </Button>
        <Button type="primary" loading={sending} onClick={() => void send()}>
          确认提交
        </Button>
      </Buttons>
    </>
  );
}

/** 撤回确认弹窗（S01 ①）。onExpertStarted：撞上专家开始核对，页面换成「专家已开始核对」并在顶部说明 */
export function WithdrawDialog({
  open,
  taskId,
  onClose,
  onExpertStarted,
}: {
  open: boolean;
  taskId: string;
  onClose: () => void;
  onExpertStarted: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const next = await withdrawIntake(taskId);
      patchTask(client, taskId, { status: 'preparing', submittedAt: null });
      client.setQueryData(intakeKey(taskId), next);
      refreshTaskQueries(client, taskId);
      navigate(`/customer/tasks/${taskId}/prepare`, { replace: true });
    } catch (err) {
      onClose();
      if (err instanceof ApiError && err.body?.code === 'expert_started') onExpertStarted();
      else message.error(errorText(err));
      refreshTaskQueries(client, taskId);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} width={544} onCancel={onClose}>
      <Title>撤回这次提交？</Title>
      <Body>撤回后任务回到「准备资料」，可以改表格、换图纸，改好再提交给专家。</Body>
      <div style={{ padding: '12px 16px 12px 24px', borderRadius: 8, background: gy.warningBg, ...type.body, color: gy.text }}>
        只能撤回这一次。下次提交后就不能再撤回了。
      </div>
      <Buttons>
        <Button style={plain} onClick={onClose} disabled={sending}>
          再想想
        </Button>
        <Button type="primary" loading={sending} onClick={() => void send()}>
          撤回
        </Button>
      </Buttons>
    </Dialog>
  );
}

/** 「任务已删除」：白底卡片、8px 绿点（S06 ②） */
const deletedNotice = {
  content: '任务已删除',
  icon: (
    <span
      aria-hidden
      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: gy.success, marginInlineEnd: 8, verticalAlign: 'middle' }}
    />
  ),
};

/** 删除任务确认弹窗（S06）：删了回工作台，提示「任务已删除」 */
export function DeleteTaskDialog({
  open,
  taskId,
  enterpriseName,
  view,
  onClose,
}: {
  open: boolean;
  taskId: string;
  enterpriseName: string;
  view: IntakeView;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await deleteTask(taskId);
      navigate('/customer', { replace: true });
      client.removeQueries({ queryKey: taskKey(taskId) });
      void client.invalidateQueries({ queryKey: ['orgs'] });
      void client.invalidateQueries({ queryKey: ['enterprises'] });
      message.open(deletedNotice);
    } catch (err) {
      onClose();
      message.error(errorText(err));
      refreshTaskQueries(client, taskId);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} width={544} onCancel={onClose}>
      <Title>删除这个任务？</Title>
      <Body>{deleteBody(enterpriseName, view)}</Body>
      <Buttons>
        <Button style={plain} onClick={onClose} disabled={sending}>
          取消
        </Button>
        <Button type="primary" danger loading={sending} onClick={() => void send()}>
          删除
        </Button>
      </Buttons>
    </Dialog>
  );
}
