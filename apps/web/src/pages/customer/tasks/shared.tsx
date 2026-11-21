import { contractState } from '@genyun/shared';
import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Tooltip } from 'antd';
import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { downloadBundle } from '../../../api/deliveries';
import { ContactLink } from '../../../components/ContactLink';
import { NoticeBar } from '../../../components/NoticeBar';
import type { TaskSummary } from '../../../api/enterprises';
import { useOrganization } from '../../../api/tasks';
import { gy, type } from '../../../theme/tokens';

// 每种状态的按钮：文字和去处（任务列表、工作台各一套说法）。
// 已交付在任务列表里直接下载整套 Word，在工作台里去成果页
export type TaskActionPlace = 'list' | 'workbench';

export function taskAction(t: TaskSummary, place: TaskActionPlace): { label: string; to: string | null } {
  const prepare = `/customer/tasks/${t.id}/prepare`;
  const result = `/customer/documents/${t.id}`;
  switch (t.view.key) {
    case 'preparing_no_table':
      return { label: '去上传', to: prepare };
    case 'preparing_missing':
      return { label: '去补齐', to: prepare };
    case 'preparing_ready':
      return { label: '去提交', to: prepare };
    case 'expert_working':
      return { label: place === 'list' ? '查看' : '查看进度', to: `/customer/tasks/${t.id}` };
    case 'delivered':
      return place === 'list' && t.delivery ? { label: '下载', to: null } : { label: '查看成果', to: result };
    case 'delivered_locked':
      return { label: '查看', to: result };
    default:
      // 老流程的任务：没提交的回任务页，提交过的看记录（和原来一样）
      return { label: '查看', to: t.view.stage === 0 ? `/customer/tasks/${t.id}` : `/customer/tasks/${t.id}?tab=records` };
  }
}

/** 行尾的描边按钮（88×32）：去对应的页面，或者在任务列表里直接下载整套 Word */
export function TaskActionButton({ task, place, width = 88 }: { task: TaskSummary; place: TaskActionPlace; width?: number | 'auto' }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const action = taskAction(task, place);
  const onClick = async () => {
    if (action.to) return navigate(action.to);
    if (!task.delivery) return;
    setBusy(true);
    try {
      await downloadBundle(task.id, task.delivery.version, task.enterpriseName, task.delivery.publishedAt);
    } catch (err) {
      message.error(`整套 Word 没能下载：${err instanceof Error ? err.message : '请稍后重试'}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      loading={busy}
      aria-label={`${action.label} ${task.enterpriseName} ${task.number}`}
      onClick={() => void onClick()}
      style={{ width, flexShrink: 0, borderColor: gy.controlLine, ...(width === 'auto' ? { paddingInline: 15 } : { paddingInline: 0 }) }}
    >
      {action.label}
    </Button>
  );
}

/** 「更新」列新的在前 */
export function byUpdated(a: TaskSummary, b: TaskSummary) {
  return b.updatedOn.localeCompare(a.updatedOn);
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
  /** 能不能新建：年度服务不在有效期内或组织还没开通时为 false，按钮置灰 */
  canCreate: boolean;
  /** 从企业页进来时带上这家企业，新建任务页会预先选好 */
  enterpriseId?: string;
  /** 按钮大小：页头用 large，企业概览里用 middle */
  size?: 'large' | 'middle';
  /** 不能新建时原因怎么说：inline 写在按钮旁边，tooltip 悬停时显示 */
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

// 年度服务提醒（快到期、未开始、未开通、已到期）：一行提示条，右边一个联系耕云的文字链接。
// 已到期在工作台另有两行的提醒块，任务列表用这里的一行
export function ContractNotice({
  state,
  daysLeft,
  endsAt,
}: {
  state: ReturnType<typeof useContract>['state'];
  daysLeft: number | null;
  endsAt: string | null;
}) {
  if (state === null || state === 'active') return null;
  const text =
    state === 'expiring'
      ? `${daysLeft === 0 ? '年度服务今天到期' : `年度服务将于 ${endsAt} 到期，还有 ${daysLeft} 天`}。到期后不能创建新的编制任务；在办任务和已交付成果不受影响。`
      : state === 'expired'
        ? '年度服务已到期。新任务暂不可创建。在办任务按服务约定处理，历史成果仍可下载。'
        : state === 'upcoming'
          ? '年度服务尚未开始。服务开始后即可创建编制任务。'
          : '年度服务尚未开通。耕云登记合同后即可创建编制任务。';
  return (
    <NoticeBar
      tone="warning"
      label="年度服务提醒"
      action={
        <ContactLink
          title="联系耕云续约"
          hint="续约或开通年度服务，请直接联系耕云。"
          trigger={(open) => (
            <Button type="link" onClick={open} style={{ padding: 0, height: 'auto' }}>
              {state === 'upcoming' ? '联系耕云' : state === 'none' ? '联系耕云开通' : '联系耕云续约'}
            </Button>
          )}
        />
      }
    >
      {text}
    </NoticeBar>
  );
}
