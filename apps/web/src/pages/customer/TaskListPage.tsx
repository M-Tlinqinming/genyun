import { SearchOutlined } from '@ant-design/icons';
import { customerTaskTab, formatTaskDay, formatTaskDayTime, type CustomerTaskTab } from '@genyun/shared';
import { Input, Pagination, Result, Select } from 'antd';
import { useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { useOrgTasks, type TaskSummary } from '../../api/enterprises';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { Loading, panel } from '../../components/ui';
import { useWorkspace } from '../../layouts/workspace';
import { gy, type, weight } from '../../theme/tokens';
import { byUpdated, ContractNotice, CreateTaskButton, TaskActionButton, useContract } from './tasks/shared';

type Tab = CustomerTaskTab | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'todo', label: '待我处理' },
  { key: 'expert', label: '专家编制' },
  { key: 'delivered', label: '已交付' },
  { key: 'all', label: '全部' },
];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.key === v);
const PAGE = 20;

// C04 任务｜跨企业看所有任务：要自己处理的在前；按企业名、任务编号搜索，按企业筛选；按钮直达要做的那一步
export function TaskListPage() {
  const { orgId } = useWorkspace();
  const tasks = useOrgTasks(orgId);
  const contract = useContract(orgId);
  const [search, setSearch] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [enterprise, setEnterprise] = useState<string>('all');
  const [page, setPage] = useState(1);
  const now = new Date();

  const rows = useMemo(() => (tasks.data ?? []).map((t) => ({ task: t, tab: customerTaskTab(t.view) })), [tasks.data]);
  const counts: Record<Tab, number> = { todo: 0, expert: 0, delivered: 0, all: rows.length };
  for (const r of rows) if (r.tab) counts[r.tab]++;
  const asked = search.get('tab');
  const tab: Tab = isTab(asked) ? asked : counts.todo > 0 ? 'todo' : 'all';

  const k = keyword.trim().toUpperCase();
  const shown = rows
    .filter((r) => tab === 'all' || r.tab === tab)
    .filter((r) => enterprise === 'all' || r.task.enterpriseId === enterprise)
    .filter((r) => !k || r.task.enterpriseName.toUpperCase().includes(k) || r.task.number.toUpperCase().includes(k))
    .map((r) => r.task)
    // 「全部」里要处理的排在前面，再按更新时间
    .sort((a, b) => (tab === 'all' ? Number(b.view.needsAction) - Number(a.view.needsAction) : 0) || byUpdated(a, b));
  const enterprises = [...new Map(rows.map((r) => [r.task.enterpriseId, r.task.enterpriseName])).entries()];
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);

  return (
    <>
      <PageHeader
        title="任务"
        description="所有企业的任务都在这里，要您处理的排在前面。"
        extra={<CreateTaskButton canCreate={contract.canCreate} />}
      />
      {contract.state !== null && contract.state !== 'active' && (
        <div style={{ marginBottom: 24 }}>
          <ContractNotice state={contract.state} daysLeft={contract.daysLeft} endsAt={contract.endsAt} />
        </div>
      )}

      {tasks.isPending ? (
        <Loading rows={6} />
      ) : tasks.isError ? (
        <Result status="error" title="任务加载失败" subTitle={tasks.error.message} />
      ) : (
        <section aria-label="任务列表" style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '0 24px', borderBottom: `1px solid ${gy.split}` }}>
            <div role="tablist" aria-label="任务分类" style={{ display: 'flex', gap: 32 }}>
              {TABS.map((t) => {
                const active = t.key === tab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setPage(1);
                      setSearch({ tab: t.key }, { replace: true });
                    }}
                    style={{
                      padding: active ? '13px 0 9px' : '13px 0 11px',
                      border: 'none',
                      borderBottom: active ? `2px solid ${gy.primary}` : 'none',
                      background: 'none',
                      cursor: 'pointer',
                      ...type.body,
                      fontWeight: active ? weight.strong : weight.normal,
                      color: active ? gy.primary : gy.secondary,
                    }}
                  >
                    {t.label} {counts[t.key]}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                allowClear
                aria-label="搜索任务"
                prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
                placeholder="搜索企业名称或任务编号"
                onChange={(e) => {
                  setPage(1);
                  setKeyword(e.target.value);
                }}
                style={{ width: 280 }}
              />
              <Select
                aria-label="按企业筛选"
                value={enterprise}
                onChange={(v) => {
                  setPage(1);
                  setEnterprise(v);
                }}
                style={{ width: 160 }}
                options={[{ value: 'all', label: '全部企业' }, ...enterprises.map(([id, name]) => ({ value: id, label: name }))]}
              />
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 24px',
              background: gy.canvas,
              borderBottom: `1px solid ${gy.split}`,
              ...type.caption,
              color: gy.secondary,
            }}
          >
            <span style={{ width: 320, flexShrink: 0 }}>企业 / 任务</span>
            <span style={{ width: 160, flexShrink: 0 }}>阶段</span>
            <span style={{ flex: '1 1 0' }}>下一步</span>
            <span style={{ width: 140, flexShrink: 0 }}>更新</span>
            <span style={{ width: 88, flexShrink: 0 }}>操作</span>
          </div>
          {shown.length === 0 ? (
            <EmptyState minHeight={160}>{tab === 'todo' && !k && enterprise === 'all' ? '暂时没有需要您处理的任务' : '没有符合条件的任务'}</EmptyState>
          ) : (
            pageRows.map((t, i) => <TaskLine key={t.id} task={t} now={now} last={i === pageRows.length - 1} />)
          )}
          {shown.length > PAGE && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 24px', borderTop: `1px solid ${gy.split}` }}>
              <Pagination current={page} pageSize={PAGE} total={shown.length} showSizeChanger={false} onChange={setPage} />
            </div>
          )}
        </section>
      )}
    </>
  );
}

const sub: CSSProperties = { ...type.caption, color: gy.tertiary };

function TaskLine({ task: t, now, last }: { task: TaskSummary; now: Date; last: boolean }) {
  // 画板上准备资料的写到几点几分（「今天 09:40」），其余只写日子（「11 月 15 日」）
  const when = t.view.stage === 0 && t.view.needsAction ? formatTaskDayTime(new Date(t.updatedOn), now) : formatTaskDay(new Date(t.updatedOn), now);
  return (
    <div
      data-testid={`task-${t.number}`}
      style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', ...(last ? {} : { borderBottom: `1px solid ${gy.split}` }) }}
    >
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', paddingRight: 16, minWidth: 0 }}>
        <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{t.enterpriseName}</span>
        <span style={sub}>
          {t.name} · {t.number}
        </span>
      </div>
      <div style={{ width: 160, flexShrink: 0, display: 'flex', paddingRight: 16 }}>
        <StatusTag tone={t.view.tone}>{t.view.label}</StatusTag>
      </div>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', paddingRight: 16 }}>
        <span style={{ ...type.body, color: gy.text }}>{t.view.nextStep}</span>
        {t.view.detail && <span style={sub}>{t.view.detail}</span>}
      </div>
      <span style={{ width: 140, flexShrink: 0, ...type.body, color: gy.secondary }}>{when}</span>
      <TaskActionButton task={t} place="list" />
    </div>
  );
}
