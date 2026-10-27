import { TASK_STATUSES, type TaskStatus } from '@genyun/shared';
import { stage } from '../theme/tokens';

// 资料准备中需要客户动手（橙）；已提交轮到耕云处理（灰）
const TONE: Record<TaskStatus, keyof typeof stage> = {
  preparing: 'action',
  submitted: 'progress',
};

export function TaskStageTag({ status }: { status: TaskStatus }) {
  const tone = stage[TONE[status]];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 4,
        fontSize: 13,
        lineHeight: '20px',
        color: tone.color,
        background: tone.bg,
      }}
    >
      {TASK_STATUSES[status]}
    </span>
  );
}

export function taskStageTone(status: TaskStatus) {
  return stage[TONE[status]];
}
