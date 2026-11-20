import { contractState, taskTodo, type TaskTodo } from '@genyun/shared';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import type { TaskSummary } from '../../../api/enterprises';
import { useOrganization } from '../../../api/tasks';
import { gy, type } from '../../../theme/tokens';

export interface TaskRow extends TaskSummary {
  todo: TaskTodo;
}

// 待我处理在前，同一栏里最近有动静的在前
export function taskRows(tasks: TaskSummary[] | undefined): TaskRow[] {
  const order = { mine: 0, gengyun: 1, delivered: 2 };
  return (tasks ?? [])
    .map((t) => ({ ...t, todo: withDelivery(taskTodo(t), t) }))
    .sort((a, b) => order[a.todo.bucket] - order[b.todo.bucket] || b.activityAt.localeCompare(a.activityAt));
}

// 已交付的写明交付过（客户只看最新一次交付，不写版本号）
function withDelivery(todo: TaskTodo, t: TaskSummary): TaskTodo {
  return todo.bucket === 'delivered' && t.delivery ? { ...todo, next: t.delivery.version > 1 ? '成果已更新，可查看和下载' : '成果已交付，可查看和下载' } : todo;
}

// 点进去直达要做的那一步：已交付看成果；已提交看处理记录；其余进任务页
export function taskHref(t: TaskRow): string {
  const base = `/customer/tasks/${t.id}`;
  if (t.todo.bucket === 'delivered') return `/customer/documents/${t.id}`;
  if (t.todo.bucket !== 'mine') return `${base}?tab=records`;
  return base;
}

// 今天 09:40 / 昨天 16:40 / 10.26（北京时间）
export function whenText(iso: string, now: Date = new Date()): string {
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, ...opts }).format(d);
  const day = (d: Date) => fmt(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const d = new Date(iso);
  const time = fmt(d, { hour: '2-digit', minute: '2-digit' });
  if (day(d) === day(now)) return `今天 ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `昨天 ${time}`;
  return fmt(d, { month: '2-digit', day: '2-digit' }).replace('/', '.');
}

// 四个阶段的小进度条：已过的蓝色，当前一段待客户处理为橙色、耕云处理为蓝色，其余灰色
export function StageBar({ todo }: { todo: TaskTodo }) {
  return (
    <span aria-hidden style={{ display: 'flex', gap: 4 }}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 47,
            height: 4,
            borderRadius: 2,
            background:
              i < todo.stage || (i === todo.stage && todo.bucket === 'delivered')
                ? gy.primary
                : i === todo.stage
                  ? todo.bucket === 'mine'
                    ? gy.warning
                    : gy.primary
                  : gy.split,
          }}
        />
      ))}
    </span>
  );
}

// 年度服务（合同有效期）：到期前 30 天提醒，过期后不能新建任务
export function useContract(orgId: string) {
  const org = useOrganization(orgId);
  const c = org.data ? contractState(org.data) : null;
  return {
    state: c?.state ?? null,
    daysLeft: c?.daysLeft ?? null,
    endsAt: org.data?.contractEndsAt ?? null,
    // 还没读到时先不置灰，免得按钮闪一下；后台建任务时同样会检查合同
    canCreate: c === null || c.state === 'active' || c.state === 'expiring',
  };
}

// 年度服务到期或组织还没开通时，「新建任务」旁边（或悬停）给的说明
export const CREATE_BLOCKED = '续约生效后可创建新任务；已有资料与交付记录保留。';

// 「新建任务」：到新建任务页选企业、填任务名称；在企业页里带上这家企业。
// 年度服务到期或还没开通时置灰：explain="inline" 把说明写在按钮右边（工作台），默认悬停才显示
export function CreateTaskButton({
  canCreate,
  enterpriseId,
  size = 'large',
  explain = 'tooltip',
}: {
  canCreate: boolean;
  enterpriseId?: string;
  size?: 'large' | 'middle';
  explain?: 'inline' | 'tooltip';
}) {
  const navigate = useNavigate();
  const button = (
    <Button
      type={canCreate ? 'primary' : 'default'}
      size={size}
      icon={canCreate ? <PlusOutlined /> : undefined}
      disabled={!canCreate}
      style={size === 'large' ? { fontSize: 16 } : undefined}
      onClick={() => navigate(enterpriseId ? `/customer/tasks/new?enterpriseId=${enterpriseId}` : '/customer/tasks/new')}
    >
      新建任务
    </Button>
  );
  if (canCreate) return button;
  if (explain === 'inline') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {button}
        <span style={{ ...type.body, color: gy.secondary }}>{CREATE_BLOCKED}</span>
      </span>
    );
  }
  // 置灰的按钮收不到鼠标事件，外面包一层才能显示悬停说明
  return (
    <Tooltip title={CREATE_BLOCKED}>
      <span style={{ display: 'inline-flex' }}>{button}</span>
    </Tooltip>
  );
}

export const link: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '22px',
  color: gy.primary,
};
