import { contractState, taskTodo, type TaskTodo } from '@genyun/shared';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Modal, Select } from 'antd';
import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { useEnterprises, type TaskSummary } from '../../../api/enterprises';
import { useOrganization } from '../../../api/tasks';
import { useWorkspace } from '../../../layouts/workspace';
import { gy } from '../../../theme/tokens';

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

// 已交付的写明是第几个交付版本
function withDelivery(todo: TaskTodo, t: TaskSummary): TaskTodo {
  return todo.bucket === 'delivered' && t.delivery ? { ...todo, next: `已发布交付 V${t.delivery.version}，可查看和下载` } : todo;
}

// 点进去直达要做的那一步：没选开始方式先选；上传路线资料齐了直接到检查页提交；已提交看处理记录
export function taskHref(t: TaskRow): string {
  const base = `/customer/tasks/${t.id}`;
  if (t.todo.bucket === 'delivered') return `/customer/documents/${t.id}`;
  if (t.todo.bucket !== 'mine') return `${base}?tab=records`;
  if (t.startMethod === null) return `${base}/start`;
  if (t.startMethod === 'upload' && t.missing.length === 0) return `${base}?view=check`;
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

// 「创建编制任务」：先选企业，再到该企业的建任务页（12 页 P02）。合同不在有效期内置灰
export function CreateTaskButton({ orgId, canCreate, size = 'large' }: { orgId: string; canCreate: boolean; size?: 'large' | 'middle' }) {
  const navigate = useNavigate();
  const enterprises = useEnterprises(orgId);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const list = enterprises.data ?? [];
  // 成员不能新建企业，只能在分配给自己的企业下建任务
  const canNewEnterprise = useWorkspace().role !== 'customer_member';

  return (
    <>
      <Button
        type={canCreate ? 'primary' : 'default'}
        size={size}
        icon={<PlusOutlined />}
        disabled={!canCreate}
        style={size === 'large' ? { fontSize: 16 } : undefined}
        onClick={() => (list.length === 0 && canNewEnterprise ? navigate('/customer/enterprises/new') : setOpen(true))}
      >
        创建编制任务
      </Button>
      <Modal
        open={open}
        title="为哪家企业创建编制任务？"
        okText="下一步"
        cancelText="取消"
        okButtonProps={{ disabled: picked === null }}
        onCancel={() => setOpen(false)}
        onOk={() => navigate(`/customer/enterprises/${picked}/tasks/new`)}
        destroyOnHidden
      >
        <Select
          showSearch
          aria-label="选择企业"
          placeholder="搜索或选择企业"
          style={{ width: '100%', margin: '8px 0' }}
          optionFilterProp="label"
          value={picked}
          onChange={setPicked}
          options={list.map((e) => ({ value: e.id, label: e.name }))}
        />
        {canNewEnterprise ? (
          <span style={{ fontSize: 13, color: gy.secondary }}>
            企业还没建档？
            <button type="button" style={link} onClick={() => navigate('/customer/enterprises/new')}>
              先新建企业
            </button>
          </span>
        ) : (
          <span style={{ fontSize: 13, color: gy.secondary }}>只列出分配给您的企业。找不到企业，请联系机构管理员新建或分配。</span>
        )}
      </Modal>
    </>
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
