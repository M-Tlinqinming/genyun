import { TASK_STATUSES, type TaskStatus } from '@genyun/shared';
import { stage } from '../theme/tokens';
import { StatusTag, type StatusTone } from './StatusTag';

// 资料准备中需要客户动手（琥珀）；已提交轮到耕云处理（灰）
const TONE: Record<TaskStatus, StatusTone> = {
  preparing: 'action',
  submitted: 'progress',
};

// 任务阶段标签：按任务状态选颜色，文字用业务名
export function TaskStageTag({
  status,
  note,
}: {
  /** 任务状态 */
  status: TaskStatus;
  /** 标签下面一行的说明，可不传 */
  note?: string;
}) {
  return (
    <StatusTag tone={TONE[status]} note={note}>
      {TASK_STATUSES[status]}
    </StatusTag>
  );
}

export function taskStageTone(status: TaskStatus) {
  return stage[TONE[status]];
}
