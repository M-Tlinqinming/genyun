import { ASSIGNMENT_NOTE_MAX, INDUSTRY_NAMES, REASSIGN_REASONS, expertPickLine, type ReassignReason } from '@genyun/shared';
import { Alert, App, Button, Input, Modal, Radio, Skeleton, Tooltip } from 'antd';
import { useState } from 'react';
import { ApiError } from '../../api/request';
import { useAssignableExperts, useAssignExpert, type AssignableExpert, type OperatorTask } from '../../api/operator';
import { ExpertAvatar } from '../../components/ExpertAvatar';
import { requiredAfter } from '../../components/ui';
import { gy, type, weight } from '../../theme/tokens';
import { monthDayTime, regionShort } from './taskCenterText';

const body = { ...type.body, color: gy.text } as const;
const small = { ...type.caption, color: gy.secondary } as const;

// 悬停看全部行业
const industriesTip = (e: AssignableExpert) => {
  const names = e.industries.map((c) => INDUSTRY_NAMES[c]).filter(Boolean);
  return names.length > 0 ? `擅长 ${names.join('、')}` : undefined;
};

// 分配专家（Paper 16 页「分配专家弹窗」）；已有负责专家时就是改派（画板没单独画，同一个弹窗）。
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
  const verb = reassign ? '改派' : '分配';

  const submit = () => {
    if (!expertId) return;
    setError(null);
    assign.mutate(
      { expertId, currentExpertId: task.assignedExpertId, note, reason: reassign && reason ? reason : undefined },
      {
        onSuccess: (t) => {
          void message.success(`已${verb}给${t.assignedExpertName}，已通知对方`);
          onClose();
        },
        onError: (err) => {
          // 别的运营刚分配或改派过：弹窗里的「现在负责」已经过时，再提交也只会被拒，关掉看最新情况。
          // 其他被拒（专家刚暂停接单、客户刚撤回、任务已交付、已是负责专家）：照服务端说的写在弹窗里，留着可以改选
          if (err instanceof ApiError && err.status === 409 && err.body?.code === 'assignment_changed') {
            void message.warning(`已被其他运营处理：${err.message}`);
            onClose();
            return;
          }
          setError(err instanceof ApiError ? err.message : `没有${verb}成功，请稍后重试`);
          // 专家名单（在办数、暂停接单）可能也变了，重新取一次
          void experts.refetch();
        },
      },
    );
  };

  const meta = [task.number, task.orgName, regionShort(task), task.submittedAt ? `${monthDayTime(task.submittedAt)} 提交` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal
      open={open}
      width={560}
      onCancel={onClose}
      afterClose={afterClose}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{reassign ? '改派专家' : '分配专家'}</span>
          <span style={{ ...body, color: gy.secondary, fontWeight: 400 }}>
            {reassign ? '改派后，任务转到新专家的任务中心并通知双方。' : '分配后，任务进入对方的任务中心并通知对方。'}
          </span>
        </div>
      }
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="ok" type="primary" disabled={!chosen} loading={assign.isPending} onClick={submit}>
          {chosen ? `${verb}给${chosen.name}` : verb}
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
            background: gy.subtleBg,
          }}
        >
          <span style={{ ...body, fontWeight: 600 }}>
            {task.enterpriseName} · {task.name}
          </span>
          <span style={small}>{meta}</span>
        </div>

        <div role="group" aria-labelledby="assign-expert-label" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span id="assign-expert-label" style={body}>
            {requiredAfter('选择专家', { required: true })}
          </span>
          {experts.isPending ? (
            <Skeleton active paragraph={{ rows: 2 }} title={false} />
          ) : experts.isError ? (
            <Alert
              type="error"
              showIcon
              message="专家名单没有取到"
              action={
                <Button size="small" onClick={() => void experts.refetch()}>
                  重试
                </Button>
              }
            />
          ) : experts.data.length === 0 ? (
            <span style={small}>还没有专家账号，请先在「内部账号」里添加。</span>
          ) : (
            // 人多时名单在框里滚动，说明和按钮始终看得见
            <Radio.Group
              value={expertId}
              onChange={(e) => setExpertId(e.target.value as string)}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 284, overflowY: 'auto' }}
            >
              {experts.data.map((e) => {
                const on = e.id === expertId;
                // 现在负责的、已暂停接单的：画布底、浅描边，文字一律第三级色，不能选
                const off = e.current || e.paused;
                const line = e.current ? '现在负责' : e.paused ? '已暂停接单，不能分配' : expertPickLine(e.openTasks, e.industries);
                const tip = off ? undefined : industriesTip(e);
                return (
                  <Radio
                    key={e.id}
                    value={e.id}
                    disabled={off}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      margin: 0,
                      padding: '12px 16px',
                      borderRadius: 6,
                      border: `1px solid ${on ? gy.primary : off ? gy.split : gy.controlLine}`,
                      background: on ? gy.selected : off ? gy.canvas : gy.surface,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 4, minWidth: 0 }}>
                      <ExpertAvatar avatar={e.avatar} name={e.name} size={32} muted={off} />
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={off ? { ...body, color: gy.tertiary } : body}>{e.name}</span>
                        <Tooltip title={tip}>
                          <span
                            style={{
                              ...small,
                              color: off ? gy.tertiary : gy.secondary,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 400,
                            }}
                          >
                            {line}
                          </span>
                        </Tooltip>
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
          <span style={body}>给专家的说明（选填）</span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={ASSIGNMENT_NOTE_MAX}
            placeholder="比如：锡山区的属地机构已在知识库里"
          />
        </label>

        <div style={{ padding: '12px 16px', borderRadius: 6, background: gy.neutralBg, ...body, color: gy.secondary }}>
          {reassign
            ? `改派后，已有的核对记录都带给新专家，客户页面直接换成新的负责人（不另外通知客户）；${task.assignedExpertName}不再能打开这个任务。`
            : '客户提交时没有选专家，由耕云指定。之后还能改派，已有的核对记录保留。'}
        </div>

        {error && <Alert type="warning" showIcon message={error} />}
      </div>
    </Modal>
  );
}
