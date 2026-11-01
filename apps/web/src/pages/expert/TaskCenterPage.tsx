import { ArrowRightOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { EXPERT_STAGES, expertTodo, type ExpertStage, type ExpertTodo } from '@genyun/shared';
import { Button, Input, Result, Select, Table, Tabs } from 'antd';
import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useExpertTasks, type ExpertEvent, type ExpertTask } from '../../api/expert';
import { PageHeader } from '../../components/PageHeader';
import { linkButton, Loading, panel } from '../../components/ui';
import { gy } from '../../theme/tokens';

type Tab = 'mine' | 'verify' | 'all';
const TABS: Record<Tab, string> = { mine: '我的任务', verify: '待资料核实', all: '全部可见任务' };

interface Row extends ExpertTask {
  todo: ExpertTodo;
}

// 设计稿实测：卡片与表格分隔线、灰色标签
const line = '#E5E8EE';
const label: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text, marginBottom: 8 };

// 北京时间 MM.DD HH:mm；只要时刻时传 timeOnly
function clock(iso: string, timeOnly = false): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return timeOnly ? `${p('hour')}:${p('minute')}` : `${p('month')}.${p('day')} ${p('hour')}:${p('minute')}`;
}
const sameDay = (iso: string, now = new Date()) => clock(iso).slice(0, 5) === clock(now.toISOString()).slice(0, 5);

// 客户名字只露姓（设计稿写法：陈 ●●）
const masked = (name: string) => `${name.slice(0, 1)} ●●`;

export function GreyTag({ children }: { children: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        flexShrink: 0,
        padding: '2px 7px',
        borderRadius: 4,
        border: '1px solid #E4E7EC',
        background: '#F5F6F8',
        fontSize: 12,
        lineHeight: '16px',
        color: '#525D70',
      }}
    >
      {children}
    </span>
  );
}

// I04 任务中心｜从待办继续：专家只看到分派给自己的任务
export function TaskCenterPage() {
  const query = useExpertTasks();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [org, setOrg] = useState('all');
  const [stage, setStage] = useState<ExpertStage | 'all'>('all');

  const rows = useMemo<Row[]>(
    () =>
      (query.data?.tasks ?? [])
        .map((t) => ({
          ...t,
          todo: expertTodo({
            status: t.status,
            closedAt: t.closedAt,
            verifyCount: t.verifyItems.length,
            contactCount: t.verifyItems.filter((v) => v.kind === 'call').length,
          }),
        }))
        .sort((a, b) => b.activityAt.localeCompare(a.activityAt)),
    [query.data],
  );
  const inTab: Record<Tab, (r: Row) => boolean> = {
    mine: (r) => r.todo.stage !== 'delivered',
    verify: (r) => r.todo.stage !== 'delivered' && r.verifyItems.length > 0,
    all: () => true,
  };
  const tab = (search.get('tab') as Tab | null) ?? 'mine';
  const k = keyword.trim().toUpperCase();
  const shown = rows
    .filter(inTab[tab])
    .filter((r) => org === 'all' || r.orgId === org)
    .filter((r) => stage === 'all' || r.todo.stage === stage)
    .filter((r) => !k || r.enterpriseName.toUpperCase().includes(k) || r.number.toUpperCase().includes(k));
  const orgs = [...new Map(rows.map((r) => [r.orgId, r.orgName])).entries()];
  const open = (id: string) => navigate(`/expert/tasks/${id}`);

  return (
    <>
      <PageHeader
        eyebrow="耕云内部 / 专业处理"
        title="任务中心"
        description="从待办继续，处理获授权的企业任务。"
        extra={
          <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => query.refetch()}>
            刷新任务
          </Button>
        }
      />

      {query.isPending ? (
        <Loading rows={6} />
      ) : query.isError ? (
        <Result status="error" title="任务加载失败" subTitle={query.error.message} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <ContactBanner rows={rows} onOpen={open} />
          <Stats rows={rows} />

          <div style={{ ...panel, borderColor: line, overflow: 'hidden' }}>
            <div style={{ padding: '0 24px' }}>
              <Tabs
                activeKey={tab}
                onChange={(key) => setSearch({ tab: key }, { replace: true })}
                items={(Object.keys(TABS) as Tab[]).map((key) => ({
                  key,
                  label: key === 'verify' ? `${TABS[key]} ${rows.filter(inTab.verify).length}` : TABS[key],
                }))}
              />
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '4px 0 24px' }}>
                <div style={{ flex: 1 }}>
                  <div style={label}>搜索企业或任务</div>
                  <Input
                    allowClear
                    value={keyword}
                    prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
                    placeholder="企业名称 / 任务编号"
                    onChange={(e) => setKeyword(e.target.value)}
                  />
                </div>
                <div style={{ width: 175 }}>
                  <div style={label}>客户组织</div>
                  <Select
                    aria-label="客户组织"
                    value={org}
                    onChange={setOrg}
                    style={{ width: '100%' }}
                    options={[{ value: 'all', label: '全部组织' }, ...orgs.map(([id, name]) => ({ value: id, label: name }))]}
                  />
                </div>
                <div style={{ width: 185 }}>
                  <div style={label}>任务阶段</div>
                  <Select
                    aria-label="任务阶段"
                    value={stage}
                    onChange={setStage}
                    style={{ width: '100%' }}
                    options={[
                      { value: 'all', label: '全部阶段' },
                      ...(Object.keys(EXPERT_STAGES) as ExpertStage[]).map((s) => ({ value: s, label: EXPERT_STAGES[s] })),
                    ]}
                  />
                </div>
                <Button
                  onClick={() => {
                    setKeyword('');
                    setOrg('all');
                    setStage('all');
                  }}
                >
                  重置
                </Button>
              </div>
            </div>
            <Table<Row>
              rowKey="id"
              dataSource={shown}
              pagination={{ pageSize: 20, hideOnSinglePage: false, showSizeChanger: false, showTotal: (n) => `共 ${n} 个任务`, style: { padding: '0 24px' } }}
              onRow={(r) => ({ onClick: () => open(r.id), style: { cursor: 'pointer' } })}
              locale={{ emptyText: tab === 'verify' ? '没有等待核实的资料' : '没有符合条件的任务' }}
              columns={[
                {
                  title: '企业 / 任务',
                  render: (_, r) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: gy.text }}>{r.enterpriseName}</span>
                      <span style={{ fontSize: 12, lineHeight: '19px', color: gy.tertiary }}>{r.number}</span>
                    </div>
                  ),
                },
                { title: '所属客户组织', width: 171, render: (_, r) => <span style={{ color: gy.secondary }}>{r.orgName}</span> },
                { title: '当前进度', width: 187, render: (_, r) => <GreyTag>{EXPERT_STAGES[r.todo.stage]}</GreyTag> },
                { title: '待办事项', width: 205, render: (_, r) => r.todo.todo },
                {
                  title: '最近更新',
                  width: 146,
                  render: (_, r) => <span style={{ fontSize: 13, color: gy.tertiary }}>{clock(r.activityAt)}</span>,
                },
                {
                  title: '操作',
                  width: 132,
                  render: (_, r) => (
                    <button
                      type="button"
                      style={linkButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        open(r.id);
                      }}
                    >
                      {r.todo.action} <ArrowRightOutlined />
                    </button>
                  ),
                },
              ]}
            />
          </div>

          <Recent events={query.data.events} onOpen={open} />
        </div>
      )}
    </>
  );
}

// 客户点了「请专家电话联系」：显示最急的一条，2 个工作日内没联系转运营兜底
function ContactBanner({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  const requests = rows
    .filter((r): r is Row & { contact: NonNullable<Row['contact']> } => r.contact !== null)
    .sort((a, b) => a.contact.deadline.localeCompare(b.contact.deadline));
  const first = requests[0];
  if (!first) return null;
  const { contact } = first;
  // 剩几个工作日由接口按知识库里的节假日算好
  const left = contact.daysLeft;
  const due =
    left < 0
      ? '已超过 2 个工作日，已转运营兜底'
      : left === 0
        ? `今天 ${clock(contact.deadline, true)} 前未联系将转运营兜底`
        : `剩 ${left} 个工作日，${clock(contact.deadline)} 前未联系将转运营兜底`;
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 20px',
        borderRadius: 8,
        border: '1px solid #F3D9A4',
        background: gy.warningBg,
      }}
    >
      <span style={{ flexShrink: 0, padding: '0 8px', borderRadius: 4, background: gy.warning, color: '#FFFFFF', fontSize: 12, lineHeight: '22px' }}>
        客户请求联系 {requests.length}
      </span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>
          {first.enterpriseName} · {masked(contact.requestedBy)} 点了「请专家电话联系」
        </span>
        <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
          {contact.labels.join('、')} · {clock(contact.requestedAt)} 提出 · {due}
        </span>
      </div>
      <Button type="primary" onClick={() => onOpen(first.id)}>
        联系客户
      </Button>
    </div>
  );
}

// 工作量：后续阶段（专业审核、补件）做到时这两个数会动起来
function Stats({ rows }: { rows: Row[] }) {
  const cards = [
    { title: '我的任务', value: rows.length, note: '获授权的企业任务' },
    { title: '待专业审核', value: 0, note: '三份草稿待核对' },
    { title: '补件待核实', value: 0, note: '客户已提交回应' },
    { title: '已交付', value: rows.filter((r) => r.todo.stage === 'delivered').length, note: '三份成果可下载' },
  ];
  return (
    <div style={{ ...panel, borderColor: line, display: 'flex', padding: '23px 0' }}>
      {cards.map((c, i) => (
        <div
          key={c.title}
          style={{ flex: 1, padding: '0 28px', borderLeft: i === 0 ? 'none' : `1px solid ${line}`, display: 'flex', flexDirection: 'column' }}
        >
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>{c.title}</span>
          <span style={{ marginTop: 3, fontSize: 30, lineHeight: '44px', fontWeight: 500, color: gy.text }}>
            {String(c.value).padStart(2, '0')}
          </span>
          <span style={{ fontSize: 12, lineHeight: '19px', color: gy.tertiary }}>{c.note}</span>
        </div>
      ))}
    </div>
  );
}

const EVENT_TAGS: Record<ExpertEvent['kind'], string> = {
  submitted: '待整理',
  contact: '待联系',
  photo: '待核实',
  delivered: '已交付',
};

function Recent({ events, onOpen }: { events: ExpertEvent[]; onOpen: (id: string) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>最近处理</span>
        <span style={{ fontSize: 12, lineHeight: '19px', color: gy.tertiary }}>今天 · {clock(new Date().toISOString()).slice(0, 5)}</span>
      </div>
      <div style={{ ...panel, borderColor: line, padding: '24px 24px 16px' }}>
        {events.length === 0 ? (
          <span style={{ color: gy.tertiary }}>还没有处理记录</span>
        ) : (
          events.map((e, i) => (
            <div key={`${e.taskId}-${e.kind}`} style={{ display: 'flex', gap: 16, minHeight: i === events.length - 1 ? 30 : 48 }}>
              <span style={{ position: 'relative', width: 10, flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 6, width: 10, height: 10, borderRadius: 10, border: '2px solid #A9B1BF', boxSizing: 'border-box' }} />
                {i < events.length - 1 && (
                  <span style={{ position: 'absolute', top: 20, bottom: 4, left: 4, borderLeft: '2px solid #0505050F' }} />
                )}
              </span>
              <span style={{ width: 84, flexShrink: 0, fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>
                {sameDay(e.at) ? clock(e.at, true) : clock(e.at)}
              </span>
              <span style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 16, fontSize: 14, lineHeight: '22px', color: gy.text }}>
                {e.text}
                <GreyTag>{EVENT_TAGS[e.kind]}</GreyTag>
              </span>
              <button type="button" style={{ ...linkButton, alignSelf: 'flex-start' }} onClick={() => onOpen(e.taskId)}>
                查看任务
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
