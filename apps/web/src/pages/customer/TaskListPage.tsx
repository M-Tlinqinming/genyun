import { ArrowRightOutlined, SearchOutlined } from '@ant-design/icons';
import { TASK_BUCKETS, TASK_STAGES, type TaskBucket } from '@genyun/shared';
import { Input, Result, Select, Table, Tabs } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useOrgTasks } from '../../api/enterprises';
import { PageHeader } from '../../components/PageHeader';
import { Loading } from '../../components/ui';
import { useWorkspace } from '../../layouts/workspace';
import { gy, stage } from '../../theme/tokens';
import { ContractNotice } from './WorkbenchPage';
import { CreateTaskButton, link, StageBar, taskHref, taskRows, useContract, whenText, type TaskRow } from './tasks/shared';

type Tab = TaskBucket | 'all';

// C04 业务任务｜跨企业找到待办：待我处理在前；按企业名、任务编号搜索，按企业筛选；点进去直达要做的那一步
export function TaskListPage() {
  const { orgId } = useWorkspace();
  const tasks = useOrgTasks(orgId);
  const contract = useContract(orgId);
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [enterprise, setEnterprise] = useState<string>('all');

  const rows = useMemo(() => taskRows(tasks.data), [tasks.data]);
  const counts = { mine: 0, gengyun: 0, delivered: 0, all: rows.length };
  for (const r of rows) counts[r.todo.bucket]++;
  const tab = (search.get('tab') as Tab | null) ?? (counts.mine > 0 ? 'mine' : 'all');

  const k = keyword.trim().toUpperCase();
  const shown = rows
    .filter((r) => tab === 'all' || r.todo.bucket === tab)
    .filter((r) => enterprise === 'all' || r.enterpriseId === enterprise)
    .filter((r) => !k || r.enterpriseName.toUpperCase().includes(k) || r.number.toUpperCase().includes(k));
  const others = (['mine', 'gengyun', 'delivered'] as TaskBucket[])
    .filter((b) => b !== tab && counts[b] > 0)
    .map((b) => `${counts[b]} 项${TASK_BUCKETS[b]}`);
  const enterprises = [...new Map(rows.map((r) => [r.enterpriseId, r.enterpriseName])).entries()];

  return (
    <>
      <PageHeader
        title="业务任务"
        description="跨企业查看编制进度，先处理需要您动手的任务。"
        extra={<CreateTaskButton orgId={orgId} canCreate={contract.canCreate} />}
      />
      <ContractNotice state={contract.state} daysLeft={contract.daysLeft} endsAt={contract.endsAt} />

      {tasks.isPending ? (
        <Loading rows={6} />
      ) : tasks.isError ? (
        <Result status="error" title="任务加载失败" subTitle={tasks.error.message} />
      ) : (
        <>
          <div style={{ background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, overflow: 'hidden' }}>
            <Tabs
              activeKey={tab}
              onChange={(key) => setSearch({ tab: key }, { replace: true })}
              tabBarStyle={{ margin: 0, padding: '0 24px' }}
              items={(['mine', 'gengyun', 'delivered', 'all'] as Tab[]).map((key) => ({
                key,
                label: `${key === 'all' ? '全部' : TASK_BUCKETS[key]} ${counts[key]}`,
              }))}
            />
            <div style={{ display: 'flex', gap: 12, padding: '16px 24px', borderTop: `1px solid ${gy.split}` }}>
              <Input
                allowClear
                prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
                placeholder="搜索企业 / 任务编号"
                onChange={(e) => setKeyword(e.target.value)}
                style={{ flex: 1 }}
              />
              <Select
                aria-label="按企业筛选"
                value={enterprise}
                onChange={setEnterprise}
                style={{ width: 168 }}
                options={[{ value: 'all', label: '企业：全部' }, ...enterprises.map(([id, name]) => ({ value: id, label: name }))]}
              />
            </div>
            <Table<TaskRow>
              rowKey="id"
              dataSource={shown}
              pagination={shown.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
              onRow={(r) => ({ onClick: () => navigate(taskHref(r)), style: { cursor: 'pointer' } })}
              locale={{ emptyText: tab === 'mine' ? '暂时没有需要您处理的任务' : '没有符合条件的任务' }}
              columns={[
                {
                  title: '企业 / 任务',
                  render: (_, r) => (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ color: gy.text }}>{r.enterpriseName}</span>
                      <span style={{ color: gy.secondary }}>
                        {r.name} · {r.number}
                      </span>
                    </div>
                  ),
                },
                {
                  title: '当前阶段',
                  width: 216,
                  render: (_, r) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} title={TASK_STAGES[r.todo.stage]}>
                      <StageBar todo={r.todo} />
                      <span style={{ fontSize: 13, color: gy.secondary }}>{r.todo.stageText}</span>
                    </div>
                  ),
                },
                {
                  title: '下一步',
                  render: (_, r) => (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          flexShrink: 0,
                          padding: '0 6px',
                          borderRadius: 4,
                          fontSize: 12,
                          lineHeight: '20px',
                          ...(r.todo.bucket === 'mine'
                            ? { color: stage.action.color, background: stage.action.bg }
                            : { color: stage.progress.color, background: stage.progress.bg }),
                        }}
                      >
                        {r.todo.bucket === 'mine' ? '您' : '耕云'}
                      </span>
                      <span style={{ color: gy.text }}>{r.todo.next}</span>
                    </span>
                  ),
                },
                { title: '更新', width: 116, render: (_, r) => <span style={{ color: gy.secondary }}>{whenText(r.activityAt)}</span> },
                {
                  title: '操作',
                  width: 116,
                  render: (_, r) => (
                    <button
                      type="button"
                      style={link}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(taskHref(r));
                      }}
                    >
                      {r.todo.action} <ArrowRightOutlined />
                    </button>
                  ),
                },
              ]}
            />
            {others.length > 0 && tab !== 'all' && (
              <div style={{ padding: '16px 24px', borderTop: `1px solid ${gy.split}`, fontSize: 14, color: gy.secondary }}>
                另有 {others.join('、')}，可在其他标签查看。
              </div>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 24,
              marginTop: 24,
              padding: '20px 20px',
              borderRadius: 8,
              background: gy.surface,
              border: `1px solid ${gy.split}`,
              fontSize: 14,
            }}
          >
            <span style={{ fontWeight: 500, color: gy.text }}>四个阶段</span>
            <span style={{ color: gy.secondary }}>
              {TASK_STAGES.join(' → ')}。您只需在「资料准备」和被请求补件时动手；其余由耕云完成。
            </span>
          </div>
        </>
      )}
    </>
  );
}
