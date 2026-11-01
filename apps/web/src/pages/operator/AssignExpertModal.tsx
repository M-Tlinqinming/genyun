import { ASSIGNMENT_NOTE_MAX, REASSIGN_REASONS, expertLoadLine, type ReassignReason } from '@genyun/shared';
import { Alert, App, Button, Input, Modal, Radio, Skeleton } from 'antd';
import { useState } from 'react';
import { ApiError } from '../../api/request';
import { useAssignableExperts, useAssignExpert, type OperatorTask } from '../../api/operator';
import { requiredAfter } from '../../components/ui';
import { gy } from '../../theme/tokens';
import { submittedLine, taskTitle } from './taskCenterText';

const body = { fontSize: 14, lineHeight: '22px', color: gy.text } as const;
const small = { fontSize: 12, lineHeight: '20px', color: gy.secondary } as const;

// 分配注安师（Paper 16 页「I01 运营概览 · 分配专业人员弹窗」）；已有负责注安师时就是改派。
// open 控制显隐：关掉时先播完动画，再由页面卸载，焦点回到打开它的按钮
export function AssignExpertModal({
  task,
  open,
  onClose,
  afterClose,
}: {
  task: OperatorTask;
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
}) {
  const { message } = App.useApp();
  const experts = useAssignableExperts(task.id);
  const assign = useAssignExpert(task.id);
  const [expertId, setExpertId] = useState<string | null>(null);
  const [reason, setReason] = useState<ReassignReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reassign = task.assignedExpertId !== null;
  const chosen = experts.data?.find((e) => e.id === expertId);

  const submit = () => {
    if (!expertId) return;
    setError(null);
    assign.mutate(
      { expertId, currentExpertId: task.assignedExpertId, note, reason: reassign && reason ? reason : undefined },
      {
        onSuccess: (t) => {
          void message.success(`已${reassign ? '改派' : '分配'}给${t.assignedExpertName}，已通知对方`);
          onClose();
        },
        onError: (err) => {
          // 别的运营刚分派或改派过：弹窗里的「当前负责注安师」已经过时，再提交也只会被拒，直接关掉看最新情况
          if (err instanceof ApiError && err.status === 409) {
            void message.warning(`已被其他运营处理：${err.message}`);
            onClose();
            return;
          }
          setError(err instanceof ApiError ? err.message : '没有分配成功，请稍后重试');
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      width={560}
      onCancel={onClose}
      afterClose={afterClose}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500 }}>{reassign ? '改派注安师' : '分配注安师'}</span>
          <span style={{ ...body, color: gy.secondary, fontWeight: 400 }}>
            {reassign ? '改派后，任务转到新注安师的任务中心并通知双方。' : '分配后，任务进入注安师的任务中心并通知对方。'}
          </span>
        </div>
      }
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="ok" type="primary" disabled={!chosen} loading={assign.isPending} onClick={submit}>
          {chosen ? `${reassign ? '改派' : '分配'}给${chosen.name}` : reassign ? '改派' : '分配'}
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '12px 16px',
            borderRadius: 6,
            border: `1px solid ${gy.split}`,
            background: '#FAFAFB',
          }}
        >
          <span style={{ ...body, fontWeight: 500 }}>{taskTitle(task)}</span>
          <span style={small}>{[task.number, task.orgName, task.orgRegion, submittedLine(task)].filter(Boolean).join(' · ')}</span>
        </div>

        <div role="group" aria-labelledby="assign-expert-label" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span id="assign-expert-label" style={body}>
            {requiredAfter('选择注安师', { required: true })}
          </span>
          {experts.isPending ? (
            <Skeleton active paragraph={{ rows: 2 }} title={false} />
          ) : experts.isError ? (
            <Alert
              type="error"
              showIcon
              message="注安师名单没有取到"
              action={
                <Button size="small" onClick={() => void experts.refetch()}>
                  重试
                </Button>
              }
            />
          ) : experts.data.length === 0 ? (
            <span style={small}>还没有注安师账号，请先在「内部账号」里添加。</span>
          ) : (
            // 人多时名单在框里滚动，说明和按钮始终看得见
            <Radio.Group
              value={expertId}
              onChange={(e) => setExpertId(e.target.value as string)}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 272, overflowY: 'auto' }}
            >
              {experts.data.map((e) => {
                const on = e.id === expertId;
                return (
                  <Radio
                    key={e.id}
                    value={e.id}
                    disabled={e.current}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      margin: 0,
                      padding: '12px 16px',
                      borderRadius: 6,
                      border: `1px solid ${on ? gy.primary : '#D9D9D9'}`,
                      // 当前负责人整张卡片置灰
                      background: e.current ? gy.neutralBg : on ? '#F7F9FF' : gy.surface,
                      opacity: e.current ? 0.6 : 1,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 4 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          flexShrink: 0,
                          background: '#F2F4F7',
                          textAlign: 'center',
                          ...body,
                          color: gy.secondary,
                          lineHeight: '32px',
                        }}
                      >
                        {e.name.slice(0, 1)}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={body}>{e.name}</span>
                        <span style={small}>{e.current ? '当前负责注安师' : expertLoadLine(e)}</span>
                      </span>
                    </span>
                  </Radio>
                );
              })}
            </Radio.Group>
          )}
        </div>

        {reassign && (
          <div role="group" aria-labelledby="reassign-reason-label" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span id="reassign-reason-label" style={body}>
              改派理由（选填，会告诉{task.assignedExpertName}）
            </span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(Object.keys(REASSIGN_REASONS) as ReassignReason[]).map((k) => (
                <Button
                  key={k}
                  size="small"
                  aria-pressed={reason === k}
                  type={reason === k ? 'primary' : 'default'}
                  ghost={reason === k}
                  // 再点一次取消选择
                  onClick={() => setReason(reason === k ? null : k)}
                >
                  {REASSIGN_REASONS[k]}
                </Button>
              ))}
            </span>
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={body}>给注安师的说明（选填）</span>
          <Input.TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={ASSIGNMENT_NOTE_MAX}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="如客户的时间要求、需要留意的情况；会随提醒一起发给对方"
          />
        </label>

        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            ...small,
            ...(reassign ? { background: gy.warningBg, color: gy.warning } : { background: gy.selected }),
          }}
        >
          {reassign
            ? `改派后，已整理的内容和联系记录都带给新注安师，客户页面直接换成新的负责人（不另外通知客户）；${task.assignedExpertName}不再能打开这个任务。`
            : '之后可以改派。改派保留已有的整理和处理记录，客户页面直接换成新的负责人。'}
        </div>

        {error && <Alert type="warning" showIcon message={error} />}
      </div>
    </Modal>
  );
}
