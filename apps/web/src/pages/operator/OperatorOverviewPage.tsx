import {
  AUDIT_ACTION_LABELS,
  breakdownLine,
  chinaToday,
  OVERVIEW_TODO_KINDS,
  waitedLabel,
  type OperatorOverview,
  type OverviewActivity,
  type OverviewService,
  type OverviewTodo,
  type OverviewTodoKind,
} from '@genyun/shared';
import { Button } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { useOperatorOverview } from '../../api/operatorOverview';
import { PageHeader } from '../../components/PageHeader';
import { Loading, Notice, panel } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';

// 运营概览（Paper 16 页 I01）：四个统计、今天先处理、客户年度服务、最近操作。数字都来自真实数据：
// 客户组织（服务状态）、任务中心（待分派、超时兜底、上门工单）、成果发布、反馈受理、操作日志

const body: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };
const muted: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.secondary };
const small: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary };
const cardTitle: CSSProperties = { fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text };
const cardHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 24px',
  borderBottom: `1px solid ${gy.split}`,
};
const link: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.primary };

const TODO_TONE: Record<OverviewTodoKind, { color: string; bg: string }> = {
  org_pending: stage.action,
  invitation: stage.progress,
  unassigned: stage.action,
  overdue: stage.error,
  on_site: stage.action,
  feedback: stage.action,
};

// 设计稿的数字写成两位（03、04）
const two = (n: number) => String(n).padStart(2, '0');
const dotted = (date: string) => date.replaceAll('-', '.');

// 北京时间的「HH:mm」和「MM.DD」
function beijing(iso: string) {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return { time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`, day: `${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}` };
}

function Tag({ tone, children }: { tone: { color: string; bg: string }; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-block', padding: '0 8px', borderRadius: 4, fontSize: 12, lineHeight: '22px', color: tone.color, background: tone.bg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Stat({ label, value, note, tone, last }: { label: string; value: number; note: string; tone?: string; last?: boolean }) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '0 28px',
        borderRight: last ? 'none' : `1px solid ${gy.split}`,
      }}
    >
      <span style={muted}>{label}</span>
      <span style={{ fontSize: 28, lineHeight: '40px', fontWeight: 500, color: tone ?? gy.text, fontVariantNumeric: 'tabular-nums' }}>{two(value)}</span>
      <span style={small}>{note}</span>
    </div>
  );
}

function Stats({ data: d }: { data: OperatorOverview }) {
  const pendingFeedback = d.feedback.new + d.feedback.processing;
  return (
    <section aria-label="运营统计" style={{ ...panel, display: 'flex', padding: '24px 0' }}>
      <Stat label="客户组织" value={d.orgs.total} note={breakdownLine([['服务中', d.orgs.active], ['待开通', d.orgs.pending], ['已到期', d.orgs.expired]], '还没有客户组织')} />
      <Stat
        label="在办任务"
        value={d.tasks.open}
        note={breakdownLine([['资料准备', d.tasks.preparing], ['编制中', d.tasks.drafting], ['待分派', d.tasks.unassigned]], '没有在办的任务')}
      />
      <Stat label="本月交付" value={d.deliveries.thisMonth} note={d.deliveries.thisMonth > 0 ? '三份成果已发布' : '本月还没有发布成果'} />
      <Stat
        label="待跟进反馈"
        value={pendingFeedback}
        tone={pendingFeedback > 0 ? stage.action.color : undefined}
        note="与编制交付分开处理"
        last
      />
    </section>
  );
}

const COLS = { kind: 120, target: 300, waited: 120, action: 136 } as const;

function TodoRow({ todo: t, last, now }: { todo: OverviewTodo; last: boolean; now: Date }) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 72,
        padding: '0 24px',
        borderBottom: last ? 'none' : `1px solid ${gy.split}`,
      }}
    >
      <span style={{ width: COLS.kind, flexShrink: 0 }}>
        <Tag tone={TODO_TONE[t.kind]}>{OVERVIEW_TODO_KINDS[t.kind]}</Tag>
      </span>
      <span style={{ width: COLS.target, flexShrink: 0, minWidth: 0, display: 'flex', flexDirection: 'column', paddingRight: 16 }}>
        <span style={{ ...body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
        <span style={{ ...small, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subtitle}</span>
      </span>
      <span style={{ ...muted, flex: '1 1 0', minWidth: 0, paddingRight: 16 }}>{t.note}</span>
      <span style={{ ...muted, width: COLS.waited, flexShrink: 0 }}>{waitedLabel(t.since, now)}</span>
      <span style={{ width: COLS.action, flexShrink: 0 }}>
        <Link to={t.link} style={link} aria-label={`${t.action}：${t.title}`}>
          {t.action}
        </Link>
      </span>
    </li>
  );
}

function Todos({ todos }: { todos: OverviewTodo[] }) {
  const now = new Date();
  const th: CSSProperties = { ...body, fontWeight: 500, flexShrink: 0 };
  return (
    <section aria-label="今天先处理" style={{ ...panel, overflow: 'hidden' }}>
      <div style={cardHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ ...cardTitle, margin: 0 }}>今天先处理</h2>
          <span style={small}>{todos.length > 0 ? `${todos.length} 项 · 等待最久的在前` : '没有待处理的事'}</span>
        </div>
        <Link to="/operator/audit-logs" style={link}>
          查看全部操作记录
        </Link>
      </div>
      {todos.length === 0 ? (
        <p style={{ ...muted, margin: 0, padding: '32px 24px', textAlign: 'center' }}>
          待开通的组织、未接受的邀请、待分派和超时的任务、新上门工单、待受理的反馈都处理完了。
        </p>
      ) : (
        <>
          <div role="presentation" style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 24px', background: '#FAFAFB', borderBottom: `1px solid ${gy.split}` }}>
            <span style={{ ...th, width: COLS.kind }}>类型</span>
            <span style={{ ...th, width: COLS.target }}>对象</span>
            <span style={{ ...th, flex: '1 1 0', flexShrink: 1 }}>说明</span>
            <span style={{ ...th, width: COLS.waited }}>已等待</span>
            <span style={{ ...th, width: COLS.action }}>操作</span>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 72 * 6, overflowY: 'auto' }}>
            {todos.map((t, i) => (
              <TodoRow key={`${t.kind}-${t.id}`} todo={t} last={i === todos.length - 1} now={now} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ServiceRow({ service: s, last }: { service: OverviewService; last: boolean }) {
  const period = s.startsAt && s.endsAt ? `${dotted(s.startsAt)} – ${dotted(s.endsAt)}` : '开通时填写服务期';
  return (
    <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: last ? 'none' : `1px solid ${gy.split}` }}>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Link to={`/operator/organizations/${s.orgId}`} style={{ ...body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.name}
        </Link>
        <span style={small}>
          {period} · {s.enterprises > 0 ? `${s.enterprises} 家企业` : '尚未建档'}
        </span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ ...small, color: s.daysLeft !== null && s.daysLeft <= 30 ? gy.warning : gy.secondary }}>
          {s.state === 'pending' ? '开通后生效' : s.daysLeft !== null ? `剩余 ${s.daysLeft} 天` : '—'}
        </span>
        <Tag tone={s.state === 'active' ? stage.done : stage.action}>{s.state === 'active' ? '服务中' : '待开通'}</Tag>
      </span>
    </li>
  );
}

function ActivityRow({ entry: e, today }: { entry: OverviewActivity; today: string }) {
  const t = beijing(e.at);
  const sameDay = chinaToday(new Date(e.at)) === today;
  return (
    <li style={{ display: 'flex', gap: 12 }}>
      <span style={{ ...muted, width: 44, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{sameDay ? t.time : t.day}</span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={body}>
          {AUDIT_ACTION_LABELS[e.action] ?? '其他操作'}
          {e.target ? `：${e.target}` : ''}
        </span>
        <span style={small}>{e.actorName ?? '已删除的账号'}</span>
      </span>
    </li>
  );
}

export function OperatorOverviewPage() {
  const overview = useOperatorOverview();
  const header = (
    <PageHeader
      eyebrow="耕云运营 / 运营概览"
      title="运营概览"
      description="今天需要你跟进的开通、分派、反馈、超时兜底与上门工单。"
      extra={
        <Button onClick={() => void overview.refetch()} loading={overview.isFetching && !overview.isPending}>
          刷新
        </Button>
      }
    />
  );
  if (overview.isPending) {
    return (
      <>
        {header}
        <Loading rows={8} />
      </>
    );
  }
  if (overview.isError) {
    return (
      <>
        {header}
        <Notice
          tone="warning"
          title="运营概览暂时打不开"
          text={overview.error.message}
          action={<Button onClick={() => void overview.refetch()}>重新加载</Button>}
        />
      </>
    );
  }
  const d = overview.data;
  const today = chinaToday();
  return (
    <>
      {header}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: -8 }}>
        <Stats data={d} />
        <Todos todos={d.todos} />
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <section aria-label="客户年度服务" style={{ ...panel, flex: '1 1 0', minWidth: 0 }}>
            <div style={cardHead}>
              <h2 style={{ ...cardTitle, margin: 0 }}>客户年度服务</h2>
              <Link to="/operator/organizations" style={link}>
                客户组织
              </Link>
            </div>
            {d.services.length === 0 ? (
              <p style={{ ...muted, margin: 0, padding: '24px' }}>还没有服务中或待开通的客户组织。</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: '8px 24px' }}>
                {d.services.map((s, i) => (
                  <ServiceRow key={s.orgId} service={s} last={i === d.services.length - 1} />
                ))}
              </ul>
            )}
          </section>
          <section aria-label="最近操作" style={{ ...panel, flex: '1 1 0', minWidth: 0 }}>
            <div style={cardHead}>
              <h2 style={{ ...cardTitle, margin: 0 }}>最近操作</h2>
              <span style={small}>今天 · {dotted(today).slice(5)}</span>
            </div>
            {d.recent.length === 0 ? (
              <p style={{ ...muted, margin: 0, padding: '24px' }}>还没有操作记录。</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {d.recent.map((e) => (
                  <ActivityRow key={e.id} entry={e} today={today} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
