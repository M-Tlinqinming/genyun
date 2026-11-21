import { customerTaskTab, formatTaskDay, formatTaskDayTime, type OrgCredits } from '@genyun/shared';
import { Button, Result } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOrgCredits } from '../../api/credits';
import { useOrgTasks, type TaskSummary } from '../../api/enterprises';
import { ContactLink } from '../../components/ContactLink';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { Loading, panel } from '../../components/ui';
import { useWorkspace } from '../../layouts/workspace';
import { gy, type, weight } from '../../theme/tokens';
import { byUpdated, ContractNotice, CREATE_BLOCKED, CreateTaskButton, TaskActionButton, useContract } from './tasks/shared';

const MAX_TODO = 5;
const MAX_CARD = 3;

// C01 工作台｜先看要自己处理的（准备资料、被锁住的成果），再看正在办理和最近交付。
// 组织管理员看得到编制次数（剩 3 次以内、用完了各有提示）；普通成员只在成果被锁住时提示找管理员。
// 年度服务已到期时换成 S01 的样子：不能新建任务，在办任务和历史成果各一张卡片
export function WorkbenchPage() {
  const { orgId, role } = useWorkspace();
  const isAdmin = role === 'customer_admin';
  const tasks = useOrgTasks(orgId);
  const contract = useContract(orgId);
  const credits = useOrgCredits(orgId, isAdmin);
  const expired = contract.state === 'expired';
  const now = new Date();

  const list = tasks.data ?? [];
  const todo = list.filter((t) => t.view.needsAction).sort(byUpdated);
  const working = list.filter((t) => customerTaskTab(t.view) === 'expert').sort(byUpdated);
  // 最近交付：管理员被锁住的在「待我处理」里，成员被锁住的也放这里
  const delivered = list
    .filter((t) => customerTaskTab(t.view) === 'delivered')
    .sort((a, b) => (b.delivery?.publishedAt ?? b.updatedOn).localeCompare(a.delivery?.publishedAt ?? a.updatedOn));
  const lockedForMember = isAdmin ? [] : list.filter((t) => t.view.key === 'delivered_locked');
  // 有生效合同才显示次数；到期时没有生效合同
  const c = isAdmin && !expired && credits.data?.validUntil ? credits.data : null;
  const exhausted = c !== null && c.remaining.total <= 0;

  return (
    <>
      <PageHeader
        title="工作台"
        description="先把没交齐的资料交上，再看正在办理的任务。"
        extra={expired ? undefined : <CreateTaskButton canCreate={contract.canCreate} explain="inline" />}
      />

      {tasks.isPending ? (
        <Loading rows={6} />
      ) : tasks.isError ? (
        <Result status="error" title="任务加载失败" subTitle={tasks.error.message} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {expired ? (
            <ExpiredNotice />
          ) : (
            contract.state !== null && contract.state !== 'active' && <ContractNotice state={contract.state} daysLeft={contract.daysLeft} endsAt={contract.endsAt} />
          )}
          {exhausted && <ExhaustedBlock awaiting={c.awaitingTasks.length} />}
          {lockedForMember.length > 0 && <MemberLockBlock locked={lockedForMember} />}
          {expired && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Button disabled size="large" style={{ fontSize: 14 }}>
                新建任务
              </Button>
              <span style={{ ...type.body, color: gy.secondary }}>{CREATE_BLOCKED}</span>
            </div>
          )}

          {(!expired || todo.length > 0) && <TodoCard todo={todo} now={now} />}

          {expired ? (
            <ExpiredCards working={working} delivered={delivered.filter((t) => t.view.key === 'delivered')} />
          ) : (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <SideCard
                label="正在办理"
                aside={<span style={{ ...type.caption, color: gy.tertiary }}>{working.length} 项</span>}
                rows={working}
                empty="现在没有正在办理的任务"
                more={{ to: '/customer/tasks?tab=expert', text: '查看全部' }}
                line={(t) => `${t.number} · ${t.view.key === 'expert_working' ? '专家正在编制，不需要您操作' : t.view.nextStep}`}
              />
              <SideCard
                label="最近交付"
                aside={
                  <Link to="/customer/documents" style={{ ...type.body, color: gy.primary }}>
                    全部成果文档
                  </Link>
                }
                rows={delivered}
                empty="还没有交付的成果"
                line={(t) =>
                  t.view.key === 'delivered_locked'
                    ? `${t.number} · ${t.view.label}`
                    : `${t.number} · ${formatTaskDay(new Date(t.delivery?.publishedAt ?? t.updatedOn), now)}${(t.delivery?.version ?? 1) > 1 ? '更新' : '交付'}，三份 Word 可下载`
                }
              />
            </div>
          )}

          {c && !exhausted && <CreditStrip credits={c} />}
        </div>
      )}
    </>
  );
}

// 「有效期至 2026 年 12 月 31 日」
export function validUntilText(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return `有效期至 ${y} 年 ${m} 月 ${d} 日`;
}

const row: CSSProperties = { display: 'flex', alignItems: 'center', padding: '14px 24px', borderTop: `1px solid ${gy.split}` };
const strong14: CSSProperties = { ...type.body, fontWeight: weight.strong, color: gy.text };
const small: CSSProperties = { ...type.caption, color: gy.tertiary };

function TodoCard({ todo, now }: { todo: TaskSummary[]; now: Date }) {
  return (
    <section aria-label="待我处理" style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>
            待我处理
            {todo.length > 0 && <span style={{ ...type.body, fontWeight: weight.strong, color: gy.warning }}>{todo.length}</span>}
          </h2>
          <span style={{ ...type.body, color: gy.secondary }}>资料交齐并提交后，就不用您再操作了。</span>
        </div>
        <Link to="/customer/tasks?tab=todo" style={{ ...type.body, color: gy.primary }}>
          查看全部任务
        </Link>
      </div>
      {todo.length === 0 ? (
        <div style={{ ...row, padding: '20px 24px', ...type.body, color: gy.secondary }}>暂时没有需要您处理的事项。有新任务时，点右上角「新建任务」。</div>
      ) : (
        todo.slice(0, MAX_TODO).map((t) => (
          <div key={t.id} data-testid={`todo-${t.number}`} style={row}>
            <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', paddingRight: 16, minWidth: 0 }}>
              <span style={strong14}>{t.enterpriseName}</span>
              <span style={small}>{t.number}</span>
            </div>
            <div style={{ width: 200, flexShrink: 0, display: 'flex' }}>
              <StatusTag tone={t.view.tone}>{t.view.label}</StatusTag>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingRight: 16 }}>
              <span style={{ ...type.body, color: gy.text }}>{t.view.nextStep}</span>
              {t.view.detail && <span style={small}>{t.view.detail}</span>}
            </div>
            <span style={{ width: 140, flexShrink: 0, ...type.body, color: gy.secondary }}>{formatTaskDayTime(new Date(t.updatedOn), now)}</span>
            <TaskActionButton task={t} place="workbench" />
          </div>
        ))
      )}
      {todo.length > MAX_TODO && (
        <div style={{ ...row, ...type.body, color: gy.secondary }}>
          还有 {todo.length - MAX_TODO} 项待处理，<Link to="/customer/tasks?tab=todo">在任务里查看全部</Link>
        </div>
      )}
    </section>
  );
}

function SideCard({
  label,
  aside,
  rows,
  empty,
  more,
  line,
}: {
  label: string;
  aside: ReactNode;
  rows: TaskSummary[];
  empty: string;
  more?: { to: string; text: string };
  line: (t: TaskSummary) => ReactNode;
}) {
  return (
    <section aria-label={label} style={{ ...panel, flex: '1 1 0', minWidth: 0, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <h2 style={{ margin: 0, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{label}</h2>
        {aside}
      </div>
      {rows.length === 0 ? (
        <span style={{ ...type.body, color: gy.secondary }}>{empty}</span>
      ) : (
        rows.slice(0, MAX_CARD).map((t) => (
          <div key={t.id} data-testid={`card-${t.number}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={strong14}>{t.enterpriseName}</span>
                {t.view.key === 'delivered_locked' ? <StatusTag tone="done">已交付</StatusTag> : <StatusTag tone={t.view.tone}>{t.view.label}</StatusTag>}
              </div>
              <span style={small}>{line(t)}</span>
            </div>
            <TaskActionButton task={t} place="workbench" width="auto" />
          </div>
        ))
      )}
      {more && rows.length > MAX_CARD && (
        <Link to={more.to} style={{ ...type.body, color: gy.primary, alignSelf: 'flex-start' }}>
          {more.text}
        </Link>
      )}
    </section>
  );
}

const renewButton = (primary: boolean) => (
  <ContactLink
    title="联系耕云续约"
    hint="续约或开通年度服务，请直接联系耕云。"
    trigger={(open) => (
      <Button type={primary ? 'primary' : 'default'} onClick={open} style={{ flexShrink: 0, ...(primary ? {} : { borderColor: gy.border }) }}>
        联系耕云续约
      </Button>
    )}
  />
);

// 编制次数（剩 1 次以上）：底部一条；剩 1–3 次换琥珀色描边，加「联系耕云续约」
function CreditStrip({ credits: c }: { credits: OrgCredits }) {
  const low = c.remaining.total <= 3;
  return (
    <section
      aria-label="编制次数"
      style={{ ...panel, display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px', ...(low ? { borderColor: gy.warning } : {}) }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
        <span style={{ ...type.body, color: gy.secondary }}>编制次数</span>
        <span style={{ ...type.title, fontWeight: weight.strong, color: low ? gy.warning : gy.text }}>剩余 {c.remaining.total} 次</span>
      </div>
      <span aria-hidden style={{ width: 1, height: 20, flexShrink: 0, background: gy.split }} />
      <span style={{ flex: '1 1 0', minWidth: 0, ...type.body, color: low ? gy.secondary : gy.tertiary }}>
        共 {c.granted} 次，已用 {c.used} 次 · {low ? '用完后还能照常提交，新成果要等续约才能下载' : '专家交付成果才算 1 次，之后重新打开再交付不再算'} ·{' '}
        {validUntilText(c.validUntil!)}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <Link to="/customer/organization?tab=service" style={{ ...type.body, color: gy.primary }}>
          查看用量
        </Link>
        {low && renewButton(false)}
      </div>
    </section>
  );
}

// 琥珀色提醒块（次数用完 / 成员的成果被锁住）
function WarnBlock({ label, title, body, actions }: { label: string; title: string; body: string; actions: ReactNode }) {
  return (
    <section
      role="status"
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        padding: '20px 24px',
        borderRadius: 8,
        border: `1px solid ${gy.warning}`,
        background: gy.warningBg,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.warning }}>{title}</span>
        <span style={{ ...type.body, color: gy.text }}>{body}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>{actions}</div>
    </section>
  );
}

function ExhaustedBlock({ awaiting }: { awaiting: number }) {
  return (
    <WarnBlock
      label="编制次数已经用完"
      title={awaiting > 0 ? `编制次数已经用完 · 有 ${awaiting} 份成果等续约后下载` : '编制次数已经用完'}
      body="新任务可以照常新建和提交，专家照常编制。新编制好的成果先锁住，续约后自动放开，每份算 1 次。"
      actions={
        <>
          {awaiting > 0 && (
            <Link to="/customer/documents" style={{ ...type.body, color: gy.primary }}>
              查看被锁住的成果
            </Link>
          )}
          {renewButton(true)}
        </>
      }
    />
  );
}

function MemberLockBlock({ locked }: { locked: TaskSummary[] }) {
  const one = locked.length === 1;
  return (
    <WarnBlock
      label="成果暂时还不能下载"
      title={`有 ${locked.length} 份成果已经编制好 · 暂时还不能下载`}
      body={`需要贵组织管理员处理后才能下载。请联系${locked[0]!.adminNames ?? '组织管理员'}，处理好后会自动放开，不用重新提交资料。`}
      actions={
        <Link to={one ? `/customer/documents/${locked[0]!.id}` : '/customer/documents'} style={{ ...type.body, color: gy.primary }}>
          {one ? '查看这份成果' : '查看这些成果'}
        </Link>
      }
    />
  );
}

// S01：年度服务已到期
function ExpiredNotice() {
  return (
    <section
      role="status"
      aria-label="年度服务提醒"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 16px 12px 24px', borderRadius: 8, background: gy.warningBg }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={strong14}>年度服务已到期</span>
        <span style={{ ...type.body, color: gy.secondary }}>新任务暂不可创建。在办任务按服务约定处理，历史成果仍可下载。</span>
      </div>
      {renewButton(true)}
    </section>
  );
}

function ExpiredCards({ working, delivered }: { working: TaskSummary[]; delivered: TaskSummary[] }) {
  const navigate = useNavigate();
  const card = (
    label: string,
    rows: TaskSummary[],
    status: string,
    note: string,
    action: string,
    to: (t: TaskSummary) => string,
    more: string,
  ) => {
    const t = rows[0];
    if (!t) return null;
    return (
      <section aria-label={label} style={{ ...panel, width: 544, flexShrink: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{label}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{t.enterpriseName}</span>
          <span style={{ ...type.body, color: gy.secondary }}>
            {t.number} · {status}
          </span>
          <span style={{ ...type.body, color: gy.secondary }}>{note}</span>
        </div>
        <Button style={{ alignSelf: 'flex-start', borderColor: gy.border }} onClick={() => navigate(to(t))}>
          {action}
        </Button>
        {rows.length > 1 && (
          <Link to={more} style={{ ...type.body, color: gy.primary, alignSelf: 'flex-start' }}>
            还有 {rows.length - 1} 个，查看全部
          </Link>
        )}
      </section>
    );
  };
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {card(
        '正在办理的任务',
        working,
        '专家编制中',
        '当前处理安排以该任务的服务约定为准，可查看进度或联系耕云。',
        '查看处理进度',
        (t) => `/customer/tasks/${t.id}`,
        '/customer/tasks?tab=expert',
      )}
      {card(
        '已交付的历史成果',
        delivered,
        '已交付',
        '服务到期不影响已交付成果的下载。',
        '查看三份成果',
        (t) => `/customer/documents/${t.id}`,
        '/customer/documents',
      )}
    </div>
  );
}
