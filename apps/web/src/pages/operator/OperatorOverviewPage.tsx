import {
  actorLine,
  breakdownLine,
  chinaToday,
  OVERVIEW_TODO_KINDS,
  waitedLabel,
  type OperatorOverview,
  type OverviewActivity,
  type OverviewTodo,
  type OverviewTodoKind,
  type RenewalBar,
  type RenewalRow,
} from '@genyun/shared';
import { Button } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { useOperatorOverview } from '../../api/operatorOverview';
import { PageHeader } from '../../components/PageHeader';
import { Loading, Notice, panel } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';

// 运营概览（Paper 16 页 I01）：四个统计、今天先处理、续约与次数、最近操作。数字都来自真实数据：
// 客户组织（服务状态）、任务中心（任务分组）、成果交付、反馈受理、操作日志

const body: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };
const muted: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.secondary };
const small: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary };
const cardTitle: CSSProperties = { fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text, margin: 0 };
const cardHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 24px',
  borderBottom: `1px solid ${gy.split}`,
};
const link: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.primary };
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const TODO_TONE: Record<OverviewTodoKind, { color: string; bg: string }> = {
  org_pending: stage.action,
  invitation: stage.progress,
  feedback: stage.action,
  // 次数用完（画板没画）：警示色
  credits_out: stage.action,
};

// 北京时间的「HH:mm」和「MM.DD」
function beijing(iso: string) {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return { time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`, day: `${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}` };
}

function Tag({ tone, children }: { tone: { color: string; bg: string }; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0 8px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: '22px',
        color: tone.color,
        background: tone.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Stat({ label, value, note, warn, last }: { label: string; value: number; note: string; warn?: boolean; last?: boolean }) {
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
      <span
        style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600, color: warn ? stage.action.color : gy.text, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </span>
      <span style={small}>{note}</span>
    </div>
  );
}

const deliveryNote = (n: number) => (n === 0 ? '本月还没有交付成果' : n === 1 ? '三份 Word 已交付给客户' : '每个任务三份 Word，已交付给客户');

function Stats({ data: d }: { data: OperatorOverview }) {
  const pendingFeedback = d.feedback.new + d.feedback.processing;
  return (
    <section aria-label="运营统计" style={{ ...panel, display: 'flex', padding: '24px 0' }}>
      <Stat
        label="客户组织"
        value={d.orgs.total}
        note={breakdownLine(
          [
            ['服务中', d.orgs.active],
            ['待开通', d.orgs.pending],
            ['已到期', d.orgs.expired],
          ],
          '还没有客户组织',
        )}
      />
      <Stat
        label="在办任务"
        value={d.tasks.open}
        note={
          d.tasks.open === 0
            ? '没有在办的任务'
            : breakdownLine(
                [
                  ['待分配专家', d.tasks.toAssign],
                  ['等客户补资料', d.tasks.awaiting],
                ],
                '没有要您处理的任务',
              )
        }
      />
      <Stat label="本月交付" value={d.deliveries.thisMonth} note={deliveryNote(d.deliveries.thisMonth)} />
      <Stat
        label="待跟进反馈"
        value={pendingFeedback}
        warn={pendingFeedback > 0}
        note={pendingFeedback > 0 ? '不影响已交付的成果' : '没有待跟进的反馈'}
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
        <span style={{ ...body, ...ellipsis }}>{t.title}</span>
        <span style={{ ...small, ...ellipsis }}>{t.subtitle}</span>
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={cardTitle}>今天先处理</h2>
          {todos.length > 0 && <span style={small}>{todos.length} 项 · 等待最久的在前</span>}
        </div>
      </div>
      {todos.length === 0 ? (
        <p style={{ ...muted, margin: 0, padding: '32px 24px', textAlign: 'center' }}>
          待开通的组织、未接受的邀请、待受理的反馈、次数用完的组织都处理完了。
        </p>
      ) : (
        <>
          <div
            role="presentation"
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 44,
              padding: '0 24px',
              background: gy.subtleBg,
              borderBottom: `1px solid ${gy.split}`,
            }}
          >
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

// 续约与次数的一个进度块：上面左标签、右值，下面 6 高的进度条
function Bar({ bar: b, label }: { bar: RenewalBar; label: string }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ ...small, ...ellipsis }}>{b.label}</span>
        <span
          style={{
            ...small,
            flexShrink: 0,
            color: b.warn ? stage.action.color : b.muted ? gy.secondary : gy.text,
            fontWeight: b.warn ? 600 : 400,
          }}
        >
          {b.value}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} ${b.label}`}
        aria-valuenow={b.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ display: 'flex', height: 6, borderRadius: 100, background: gy.neutralBg }}
      >
        <div style={{ width: `${b.percent}%`, height: 6, borderRadius: 100, background: b.warn ? stage.action.color : gy.primary }} />
      </div>
    </div>
  );
}

function RenewalItem({ row: r, last }: { row: RenewalRow; last: boolean }) {
  return (
    <li
      data-org={r.orgId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: '14px 0',
        borderBottom: last ? 'none' : `1px solid ${gy.split}`,
      }}
    >
      <span style={{ width: 176, flexShrink: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ ...body, ...ellipsis }}>{r.name}</span>
        <span style={{ ...small, color: r.subWarn ? stage.action.color : gy.secondary }}>{r.sub}</span>
      </span>
      <Bar bar={r.contract} label={r.name} />
      <Bar bar={r.credits} label={r.name} />
      <span style={{ width: 72, flexShrink: 0, textAlign: 'right' }}>
        <Link to={r.action.link} style={link} aria-label={`${r.action.text}：${r.name}`}>
          {r.action.text}
        </Link>
      </span>
    </li>
  );
}

function Renewals({ rows }: { rows: RenewalRow[] }) {
  return (
    <section aria-label="续约与次数" style={{ ...panel, flex: '2 1 0', minWidth: 0 }}>
      <div style={cardHead}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <h2 style={cardTitle}>续约与次数</h2>
          <span style={small}>30 天内到期或剩 3 次以内标黄，排在前面</span>
        </div>
        <Link to="/operator/organizations" style={{ ...link, flexShrink: 0 }}>
          客户组织
        </Link>
      </div>
      {rows.length === 0 ? (
        <p style={{ ...muted, margin: 0, padding: '24px' }}>还没有客户组织</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '8px 24px' }}>
          {rows.map((r, i) => (
            <RenewalItem key={r.orgId} row={r} last={i === rows.length - 1} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({ entry: e, today }: { entry: OverviewActivity; today: string }) {
  const t = beijing(e.at);
  const sameDay = chinaToday(new Date(e.at)) === today;
  return (
    <li style={{ display: 'flex', gap: 12 }}>
      <span style={{ ...muted, width: 44, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{sameDay ? t.time : t.day}</span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={body}>{e.sentence}</span>
        <span style={small}>{actorLine(e.actorIdentity, e.actorName)}</span>
      </span>
    </li>
  );
}

export function OperatorOverviewPage() {
  const overview = useOperatorOverview();
  const header = (
    <PageHeader
      title="运营概览"
      description="开通、邀请、专家审核和反馈在这里跟进；任务在任务中心处理。"
      actions={
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
          <Renewals rows={d.renewals} />
          <section aria-label="最近操作" style={{ ...panel, flex: '1 1 0', minWidth: 0 }}>
            <div style={cardHead}>
              <h2 style={cardTitle}>最近操作</h2>
              <Link to="/operator/audit-logs" style={link}>
                全部记录
              </Link>
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
