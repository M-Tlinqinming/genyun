import { SearchOutlined } from '@ant-design/icons';
import { EXPERT_CENTER_STATS, expertCenterStatOf, type ExpertCenterRow, type ExpertCenterStat } from '@genyun/shared';
import { App, Button, Input, Switch, Table, Tabs } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useExpertTasks, useSetAccepting } from '../../api/expert';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatCells, type StatItem } from '../../components/StatCells';
import { StatusTag, type StatusTone } from '../../components/StatusTag';
import { linkButton, Loading } from '../../components/ui';
import { gy, stage, type, weight } from '../../theme/tokens';

type Tab = 'mine' | 'all';
const TABS: Record<Tab, string> = { mine: '我的任务', all: '全部任务' };

// 暂停接单时开关轨道的颜色：设计稿上的值，令牌里没有，只在这里用
const PAUSED_TRACK = '#BFC4CC';

const STAT_TEXT: Record<ExpertCenterStat, { label: string; note: string; tone: StatusTone }> = {
  to_check: { label: '待核对资料', note: '客户已提交，等您开始', tone: 'action' },
  working: { label: '编制中', note: '已开始，还没交付', tone: 'action' },
  awaiting: { label: '等客户补资料', note: '缺项清单已发出，客服在联系客户', tone: 'progress' },
  delivered_month: { label: '本月已交付', note: '在「全部任务」里看', tone: 'done' },
};

// 描边按钮、搜索框用浅描边（设计稿）
const outlined = { borderColor: gy.controlLine };

// 专家任务中心：分给自己的任务，要动手的排在前面；右上角接单开关
export function TaskCenterPage() {
  const query = useExpertTasks();
  const setAccepting = useSetAccepting();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('mine');
  const [stat, setStat] = useState<ExpertCenterStat | undefined>();
  const [keyword, setKeyword] = useState('');

  const toggle = (acceptingOrders: boolean) =>
    setAccepting.mutate({ acceptingOrders }, { onError: (err) => message.error(err.message) });

  const accepting = query.data?.acceptingOrders ?? true;
  const rows = query.data?.rows ?? [];
  const openRows = rows.filter((r) => r.isOpen);
  const inTab = tab === 'mine' ? openRows : rows;
  const k = keyword.trim().toUpperCase();
  const shown = inTab
    .filter((r) => !stat || expertCenterStatOf(r) === stat)
    .filter((r) => !k || r.enterpriseName.toUpperCase().includes(k) || r.number.toUpperCase().includes(k));
  const filtered = !!stat || !!k;
  const clear = () => {
    setStat(undefined);
    setKeyword('');
  };

  const pickStat = (key: string | undefined) => {
    const next = key as ExpertCenterStat | undefined;
    setStat(next);
    // 本月已交付只在「全部任务」里；其余三格在「我的任务」
    if (next) setTab(next === 'delivered_month' ? 'all' : 'mine');
  };
  const pickTab = (key: Tab) => {
    setTab(key);
    if (key === 'mine' && stat === 'delivered_month') setStat(undefined);
  };

  const stats: StatItem[] = EXPERT_CENTER_STATS.map((key) => ({
    key,
    ...STAT_TEXT[key],
    value: query.data?.stats[key] ?? 0,
  }));
  const open = (id: string) => navigate(`/expert/tasks/${id}`);

  return (
    <>
      <PageHeader
        title="任务中心"
        description="分给您的任务都在这里。要您动手的排在前面。"
        actions={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32 }}>
            <span style={{ ...type.body, color: gy.secondary }}>{accepting ? '接单中' : '已暂停接单'}</span>
            <Switch
              aria-label="接单"
              checked={accepting}
              disabled={!query.data}
              loading={setAccepting.isPending}
              onChange={toggle}
              style={accepting ? undefined : { background: PAUSED_TRACK }}
            />
          </span>
        }
      />

      {query.isPending ? (
        <Loading rows={6} />
      ) : query.isError ? (
        <EmptyState
          action={
            <Button style={outlined} onClick={() => query.refetch()}>
              重新加载
            </Button>
          }
        >
          {query.error.message}
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {!accepting && <PausedBanner openCount={openRows.length} onResume={() => toggle(true)} pending={setAccepting.isPending} />}

          <StatCells items={stats} selected={stat} onSelect={pickStat} />

          <div style={{ borderRadius: 8, background: gy.surface, border: `1px solid ${gy.split}`, overflow: 'hidden' }}>
            <Tabs
              activeKey={tab}
              onChange={(key) => pickTab(key as Tab)}
              tabBarStyle={{ margin: 0, padding: '0 24px' }}
              tabBarExtraContent={
                <Input
                  allowClear
                  aria-label="搜索企业名称或任务编号"
                  value={keyword}
                  prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
                  placeholder="搜索企业名称或任务编号"
                  onChange={(e) => setKeyword(e.target.value)}
                  style={{ ...outlined, width: 280 }}
                />
              }
              items={(Object.keys(TABS) as Tab[]).map((key) => ({
                key,
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: tab === key ? weight.strong : weight.normal }}>{TABS[key]}</span>
                    <span className="gy-tabular" style={{ ...type.caption, color: tab === key ? gy.primary : gy.tertiary }}>
                      {key === 'mine' ? openRows.length : rows.length}
                    </span>
                  </span>
                ),
              }))}
            />
            <Table<ExpertCenterRow>
              rowKey="id"
              dataSource={shown}
              pagination={false}
              // 整行都能点进任务；企业名称、按钮是同一个去处
              onRow={(r) => ({ onClick: () => open(r.id), style: { cursor: 'pointer' } })}
              locale={{
                emptyText:
                  rows.length === 0 ? (
                    <EmptyState>
                      <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: gy.text }}>还没有分给您的任务</span>
                        <span>耕云分配任务后会出现在这里，也会通知您。</span>
                      </span>
                    </EmptyState>
                  ) : filtered ? (
                    <EmptyState
                      action={
                        <button type="button" style={linkButton} onClick={clear}>
                          清空搜索和筛选
                        </button>
                      }
                    >
                      没有符合条件的任务
                    </EmptyState>
                  ) : (
                    <EmptyState>手上没有在办的任务，已交付的在「全部任务」里</EmptyState>
                  ),
              }}
              footer={
                shown.length === 0
                  ? undefined
                  : () => (
                      <span style={{ ...type.caption, color: gy.tertiary }}>
                        {tab === 'mine'
                          ? `在办 ${openRows.length} 个 · 要您动手的排在前面 · 已交付的在「全部任务」里`
                          : `共 ${rows.length} 个 · 要您动手的排在前面`}
                      </span>
                    )
              }
              columns={[
                {
                  title: '企业 / 任务',
                  width: 300,
                  render: (_, r) => (
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <Link to={`/expert/tasks/${r.id}`} onClick={(e) => e.stopPropagation()} style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>
                        {r.enterpriseName}
                      </Link>
                      <span className="gy-tabular" style={{ ...type.caption, color: gy.tertiary }}>
                        {r.number}
                      </span>
                    </span>
                  ),
                },
                { title: '客户组织', width: 220, render: (_, r) => <span style={{ color: gy.text }}>{r.orgName}</span> },
                {
                  title: '阶段',
                  width: 260,
                  render: (_, r) => (
                    <StatusTag tone={r.view.tone} note={r.view.detail ?? undefined}>
                      {r.view.label}
                    </StatusTag>
                  ),
                },
                {
                  title: '等了多久 / 最近更新',
                  width: 180,
                  render: (_, r) => (
                    <span style={{ color: r.time.tone === 'action' ? stage.action.color : gy.secondary }}>{r.time.text}</span>
                  ),
                },
                {
                  title: '操作',
                  align: 'right',
                  render: (_, r) => (
                    <Button
                      style={{ ...outlined, minWidth: 88 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        open(r.id);
                      }}
                    >
                      {r.button}
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}
    </>
  );
}

// 暂停接单时统计格上面的提示：左边标题 + 说明，右边「恢复接单」
function PausedBanner({ openCount, onResume, pending }: { openCount: number; onResume: () => void; pending: boolean }) {
  return (
    <div
      role="status"
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderRadius: 8, background: gy.warningBg }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...type.body, fontWeight: weight.strong, color: gy.warning }}>已暂停接单</span>
        <span style={{ ...type.body, color: gy.secondary }}>
          客户在专家列表里选不到您，耕云也不再给您派新任务。
          {openCount > 0 && `手上这 ${openCount} 个任务照常进行，不受影响。`}
        </span>
      </div>
      <Button style={{ ...outlined, flexShrink: 0 }} loading={pending} onClick={onResume}>
        恢复接单
      </Button>
    </div>
  );
}
