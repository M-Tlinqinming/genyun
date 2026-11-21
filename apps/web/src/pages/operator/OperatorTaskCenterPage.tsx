import {
  OPERATOR_TASK_GROUP_LABELS,
  operatorTaskCounts,
  operatorWorkingLine,
  waitingLine,
  type OperatorTaskGroup,
} from '@genyun/shared';
import { Button, Input, Select } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useOperatorTasks, type OperatorTask } from '../../api/operator';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatCells } from '../../components/StatCells';
import { StatusTag } from '../../components/StatusTag';
import { Loading, Notice, linkButton, panel } from '../../components/ui';
import { gy, stage, type, weight } from '../../theme/tokens';
import { AssignExpertModal } from './AssignExpertModal';
import { OperatorTaskDrawer } from './OperatorTaskDrawer';
import { dayTime } from './taskCenterText';

type Cell = Exclude<OperatorTaskGroup, 'delivered'>;

// 表格列宽（Paper I04）；操作列自适应、右对齐
const COLS: { title: string; width?: number }[] = [
  { title: '企业 / 任务', width: 240 },
  { title: '客户组织', width: 200 },
  { title: '负责专家', width: 110 },
  { title: '阶段', width: 240 },
  { title: '等了多久 / 最近更新', width: 170 },
  { title: '操作' },
];
const col = (i: number): CSSProperties =>
  COLS[i]!.width
    ? { width: COLS[i]!.width, flexShrink: 0, minWidth: 0, paddingRight: 16 }
    : { flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' };

const outlineBtn: CSSProperties = { width: 88, height: 32, borderColor: gy.controlLine, padding: 0 };
const textLink: CSSProperties = { ...linkButton, color: gy.primary };

// 时间列：要运营动手的两组写等了多久（警示色），已交付写交付时间，其余写最近更新
function TimeCell({ t }: { t: OperatorTask }) {
  if ((t.group === 'to_assign' || t.group === 'awaiting') && t.waitingSince) {
    return <span style={{ ...type.body, color: stage.action.color }}>{waitingLine(t.waitingSince)}</span>;
  }
  const at = t.group === 'delivered' && t.deliveredAt ? t.deliveredAt : t.activityAt;
  return <span style={{ ...type.body, color: gy.secondary }}>{dayTime(at)}</span>;
}

function Row({ t, onOpen, onAssign }: { t: OperatorTask; onOpen: () => void; onAssign: () => void }) {
  const [hover, setHover] = useState(false);
  // 按钮、链接各做各的事，不再冒泡去开抽屉
  const own = (fn: () => void) => (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    fn();
  };
  const view = (
    <button type="button" style={textLink} onClick={own(onOpen)}>
      查看
    </button>
  );
  const action =
    t.group === 'to_assign' ? (
      <Button style={outlineBtn} disabled={!!t.assignBlockedReason} title={t.assignBlockedReason ?? undefined} onClick={own(onAssign)}>
        分配专家
      </Button>
    ) : t.group === 'awaiting' ? (
      <Button style={outlineBtn} onClick={own(onOpen)}>
        查看缺项
      </Button>
    ) : t.group === 'working' && t.canReassign ? (
      <span style={{ display: 'flex', gap: 16 }}>
        <button type="button" style={textLink} onClick={own(onAssign)}>
          改派
        </button>
        {view}
      </span>
    ) : (
      view
    );
  const expert = t.assignedExpertName ? (
    <span style={{ ...type.body, color: gy.text }}>{t.assignedExpertName}</span>
  ) : (
    <span style={{ ...type.body, color: gy.tertiary }}>{t.group === 'preparing' ? '提交后再分配' : '还没分配'}</span>
  );
  return (
    <div
      role="row"
      data-task={t.number}
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 24px',
        borderBottom: `1px solid ${gy.split}`,
        cursor: 'pointer',
        background: hover ? gy.canvas : gy.surface,
      }}
    >
      <div role="cell" style={{ ...col(0), display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{t.enterpriseName}</span>
        <span style={{ ...type.caption, color: gy.tertiary }}>{t.number}</span>
      </div>
      <div role="cell" style={{ ...col(1), ...type.body, color: gy.text }}>
        {t.orgName}
      </div>
      <div role="cell" style={col(2)}>
        {expert}
      </div>
      <div role="cell" style={col(3)}>
        <StatusTag tone={t.view.tone} note={t.view.detail ?? undefined}>
          {t.view.label}
        </StatusTag>
      </div>
      <div role="cell" style={col(4)}>
        <TimeCell t={t} />
      </div>
      <div role="cell" style={col(5)}>
        {action}
      </div>
    </div>
  );
}

// 运营任务中心（Paper 16 页 I04）：四格统计点了筛选，下面一张表；点行打开右侧抽屉
export function OperatorTaskCenterPage() {
  const tasks = useOperatorTasks();
  const [params, setParams] = useSearchParams();
  const [cell, setCell] = useState<Cell | undefined>();
  const [keyword, setKeyword] = useState('');
  const [org, setOrg] = useState<string>(() => params.get('org') ?? 'all');
  const [expert, setExpert] = useState<string>('all');
  const [showDelivered, setShowDelivered] = useState(false);
  // 弹窗常驻到关闭动画结束：open 控制显隐，afterClose 再卸载，焦点回到打开它的按钮
  const [assigning, setAssigning] = useState<OperatorTask | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const openAssign = (t: OperatorTask) => {
    setAssigning(t);
    setAssignOpen(true);
  };

  const drawerId = params.get('task');
  const openDrawer = (id: string) =>
    setParams(
      (p) => {
        p.set('task', id);
        return p;
      },
      { replace: true },
    );
  // 关抽屉时去掉 ?task=；旧链接带的 ?tab= 一并去掉
  const closeDrawer = () =>
    setParams(
      (p) => {
        p.delete('task');
        p.delete('tab');
        return p;
      },
      { replace: true },
    );

  const all = useMemo(() => tasks.data ?? [], [tasks.data]);
  // 统计格按全部任务算，不受搜索和筛选影响
  const counts = useMemo(() => operatorTaskCounts(all.map((t) => ({ group: t.group, key: t.view.key }))), [all]);
  const orgOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of all) m.set(t.orgId, t.orgName);
    return [...m].map(([value, label]) => ({ value, label }));
  }, [all]);
  const expertOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of all) if (t.assignedExpertId && t.assignedExpertName) m.set(t.assignedExpertId, t.assignedExpertName);
    return [...m].map(([value, label]) => ({ value, label }));
  }, [all]);

  const k = keyword.trim().toLowerCase();
  const filtering = !!cell || !!k || org !== 'all' || expert !== 'all';
  const matched = all.filter(
    (t) =>
      (!cell || t.group === cell) &&
      (org === 'all' || t.orgId === org) &&
      (expert === 'all' || t.assignedExpertId === expert) &&
      (!k || t.enterpriseName.toLowerCase().includes(k) || t.number.toLowerCase().includes(k)),
  );
  const shown = showDelivered ? matched : matched.filter((t) => t.group !== 'delivered');
  const delivered = counts.groups.delivered;
  const reset = () => {
    setCell(undefined);
    setKeyword('');
    setOrg('all');
    setExpert('all');
  };

  const header = (
    <PageHeader
      title="任务中心"
      description="客户没选专家的任务，由您指定专家；「等客户补资料」的任务，由您联系客户把资料要回来。"
    />
  );

  if (tasks.isPending) {
    return (
      <>
        {header}
        <Loading rows={6} />
      </>
    );
  }
  if (tasks.isError) {
    return (
      <>
        {header}
        <Notice
          tone="warning"
          title="任务列表暂时打不开"
          text={tasks.error.message}
          action={<Button onClick={() => void tasks.refetch()}>重新加载</Button>}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <StatCells
          label="按阶段筛选"
          selected={cell}
          onSelect={(key) => setCell(key as Cell | undefined)}
          items={[
            {
              key: 'to_assign',
              label: OPERATOR_TASK_GROUP_LABELS.to_assign,
              value: counts.groups.to_assign,
              tone: 'action',
              note: '客户提交时没选专家，等您指定',
            },
            {
              key: 'awaiting',
              label: OPERATOR_TASK_GROUP_LABELS.awaiting,
              value: counts.groups.awaiting,
              tone: 'action',
              note: '专家已列出缺项，等您联系客户',
            },
            {
              key: 'working',
              label: OPERATOR_TASK_GROUP_LABELS.working,
              value: counts.groups.working,
              tone: 'progress',
              note: operatorWorkingLine(counts.working),
            },
            {
              key: 'preparing',
              label: OPERATOR_TASK_GROUP_LABELS.preparing,
              value: counts.groups.preparing,
              tone: 'progress',
              note: '还没提交，不用您处理',
            },
          ]}
        />
        <div style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderBottom: `1px solid ${gy.split}` }}>
            <Input
              allowClear
              aria-label="搜索企业名称或任务编号"
              style={{ width: 280 }}
              value={keyword}
              prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
              placeholder="搜索企业名称或任务编号"
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              aria-label="客户组织"
              style={{ width: 200 }}
              value={org}
              onChange={setOrg}
              showSearch={{ optionFilterProp: 'label' }}
              options={[{ value: 'all', label: '全部客户组织' }, ...orgOptions]}
            />
            <Select
              aria-label="负责专家"
              style={{ width: 160 }}
              value={expert}
              onChange={setExpert}
              options={[{ value: 'all', label: '全部专家' }, ...expertOptions]}
            />
          </div>
          <div role="table" aria-label="任务列表">
            <div
              role="row"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 24px',
                background: gy.canvas,
                borderBottom: `1px solid ${gy.split}`,
              }}
            >
              {COLS.map((c, i) => (
                <div key={c.title} role="columnheader" style={{ ...col(i), ...type.body, fontWeight: weight.strong, color: gy.secondary }}>
                  {c.title}
                </div>
              ))}
            </div>
            {shown.length === 0 ? (
              all.length === 0 ? (
                <EmptyState>还没有任务</EmptyState>
              ) : (
                <EmptyState
                  action={
                    filtering ? (
                      <button type="button" style={textLink} onClick={reset}>
                        清除筛选
                      </button>
                    ) : undefined
                  }
                >
                  没有符合条件的任务
                </EmptyState>
              )
            ) : (
              shown.map((t) => <Row key={t.id} t={t} onOpen={() => openDrawer(t.id)} onAssign={() => openAssign(t)} />)
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', ...type.caption, color: gy.tertiary }}>
            <span>
              {showDelivered
                ? `在办 ${counts.open} 个 · 已交付 ${delivered} 个`
                : `在办 ${counts.open} 个 · 要您处理的排在前面${delivered > 0 ? ` · 已交付的 ${delivered} 个默认不显示` : ''}`}
            </span>
            {delivered > 0 && (
              <button type="button" style={{ ...linkButton, ...type.caption, color: gy.primary }} onClick={() => setShowDelivered((v) => !v)}>
                {showDelivered ? '收起已交付' : '显示已交付'}
              </button>
            )}
          </div>
        </div>
      </div>
      <OperatorTaskDrawer taskId={drawerId} onClose={closeDrawer} onAssign={openAssign} />
      {assigning && (
        <AssignExpertModal
          key={assigning.id}
          task={assigning}
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
          afterClose={() => setAssigning(null)}
        />
      )}
    </>
  );
}
