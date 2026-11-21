import {
  CUSTOMER_ROLE_DUTIES,
  CUSTOMER_ROLE_LABELS,
  CUSTOMER_ROLES,
  memberInviteSchema,
  orgProfileSchema,
  chinaToday,
  CREDIT_ENTRY_TYPE_LABELS,
  customerCreditEntryText,
  formatCreditDelta,
  type ContractState,
  type CustomerRole,
  type OrgEnterpriseAssignment,
  type OrgManagementView,
  type OrgMember,
  type OrgCredits,
  type OrgMemberInvitation,
  type OrgProfileInput,
} from '@genyun/shared';
import { App, Button, Checkbox, Form, Input, Modal, Radio } from 'antd';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useOrgCredits } from '../../api/credits';
import {
  useChangeMemberRole,
  useInviteMember,
  useOrgManagement,
  useRemoveMember,
  useResendMemberInvitation,
  useRevokeMemberInvitation,
  useSetEnterpriseMembers,
  useSetMemberEnterprises,
  useUpdateOrgProfile,
} from '../../api/orgMembers';
import { ApiError } from '../../api/request';
import { ContactLink } from '../../components/ContactLink';
import { StatusTag, type StatusTone } from '../../components/StatusTag';
import { linkButton, Loading, Notice, panel, requiredAfter } from '../../components/ui';
import { useWorkspace } from '../../layouts/workspace';
import { gy, stage, type, weight } from '../../theme/tokens';

// 组织管理（Paper 11 页）：仅组织管理员可见。四个标签：组织资料、成员与权限、企业分配、年度服务（?tab= 记住当前标签）。
// 成员只能访问分配给自己的企业；组织管理员访问全部企业。邀请走邮件，7 天有效

type Tab = 'profile' | 'members' | 'enterprises' | 'service';
const TABS: Tab[] = ['profile', 'members', 'enterprises', 'service'];

const body: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };
const muted: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.secondary };
const small: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.secondary };
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const MEMBER_COLS = { role: 120, access: 200, state: 120, action: 160 } as const;
const ENTERPRISE_COLS = { members: 320, changed: 120, action: 96 } as const;

// 北京时间「09.27」「09.18 09:05」
function china(iso: string) {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}`, time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}` };
}
const dotted = (day: string) => day.replaceAll('-', '.');

function Tag({ tone, children }: { tone: { color: string; bg: string }; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-block', padding: '0 8px', borderRadius: 4, fontSize: 13, lineHeight: '20px', color: tone.color, background: tone.bg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Avatar({ name, self, pending }: { name: string; self?: boolean; pending?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        flexShrink: 0,
        textAlign: 'center',
        fontSize: 14,
        lineHeight: pending ? '30px' : '32px',
        boxSizing: 'border-box',
        border: pending ? `1px dashed ${gy.border}` : 'none',
        background: pending ? 'transparent' : self ? gy.selected : gy.neutralBg,
        color: pending ? gy.tertiary : self ? gy.primary : gy.secondary,
      }}
    >
      {pending ? '?' : name.slice(0, 1)}
    </span>
  );
}

function TableCard({ label, head, children }: { label: string; head: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} style={{ ...panel }}>
      <div
        role="presentation"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: 48,
          padding: '0 24px',
          background: gy.canvas,
          borderBottom: `1px solid ${gy.split}`,
          borderRadius: '8px 8px 0 0',
          ...body,
          fontWeight: 500,
        }}
      >
        {head}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </section>
  );
}

function Row({ children, last, height }: { children: ReactNode; last: boolean; height: number }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 16, height, padding: '0 24px', borderBottom: last ? 'none' : `1px solid ${gy.split}` }}>
      {children}
    </li>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <span style={{ width: MEMBER_COLS.action, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16 }}>{children}</span>;
}

function InfoBox({ title, text, action }: { title: string; text: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderRadius: 8, background: gy.selected }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...body, fontWeight: 500 }}>{title}</span>
        <span style={muted}>{text}</span>
      </div>
      {action}
    </div>
  );
}

// —— 成员与权限 ——

function accessLabel(m: OrgMember, view: OrgManagementView): ReactNode {
  if (m.role === 'customer_admin') return `全部企业（${view.enterprises.length}）`;
  const names = view.enterprises.filter((e) => m.enterpriseIds.includes(e.id)).map((e) => e.name);
  return names.length > 0 ? names.join('、') : <span style={{ color: gy.secondary }}>尚未分配</span>;
}

function invitationNote(i: OrgMemberInvitation): string {
  if (i.state === 'expired') return `${china(i.createdAt).date} 邀请 · 已过期`;
  const days = Math.max(1, Math.ceil((Date.parse(i.expiresAt) - Date.now()) / 86_400_000));
  return `${china(i.createdAt).date} 邀请 · ${days} 天内有效`;
}

function MembersTab({
  view,
  onAssign,
  onRole,
  onRemove,
  onResend,
  onRevoke,
  busyInvitation,
}: {
  view: OrgManagementView;
  onAssign: (m: OrgMember) => void;
  onRole: (m: OrgMember) => void;
  onRemove: (m: OrgMember) => void;
  onResend: (i: OrgMemberInvitation) => void;
  onRevoke: (i: OrgMemberInvitation) => void;
  busyInvitation: string | null;
}) {
  const total = view.members.length + view.invitations.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <TableCard
        label="组织成员"
        head={
          <>
            <span style={{ flex: '1 1 0', minWidth: 0 }}>成员</span>
            <span style={{ width: MEMBER_COLS.role, flexShrink: 0 }}>角色</span>
            <span style={{ width: MEMBER_COLS.access, flexShrink: 0 }}>可访问企业</span>
            <span style={{ width: MEMBER_COLS.state, flexShrink: 0 }}>状态</span>
            <span style={{ width: MEMBER_COLS.action, flexShrink: 0 }}>操作</span>
          </>
        }
      >
        {view.members.map((m, idx) => {
          const access = accessLabel(m, view);
          return (
            <Row key={m.id} last={idx === total - 1} height={72}>
              <span style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={m.name} self={m.self} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ ...body, fontWeight: 500, ...ellipsis }}>
                    {m.name}
                    {m.self ? ' · 您' : ''}
                  </span>
                  <span style={{ ...small, ...ellipsis }}>{m.email}</span>
                </span>
              </span>
              <span style={{ ...body, width: MEMBER_COLS.role, flexShrink: 0 }}>{CUSTOMER_ROLE_LABELS[m.role]}</span>
              <span style={{ ...body, width: MEMBER_COLS.access, flexShrink: 0, ...ellipsis }} title={typeof access === 'string' ? access : undefined}>
                {access}
              </span>
              <span style={{ width: MEMBER_COLS.state, flexShrink: 0 }}>
                <Tag tone={stage.done}>已加入</Tag>
              </span>
              <Actions>
                {m.self ? (
                  <span style={{ ...body, color: gy.tertiary }} aria-label="不能修改自己">
                    —
                  </span>
                ) : (
                  <>
                    {m.role === 'customer_member' && (
                      <button type="button" style={linkButton} onClick={() => onAssign(m)} aria-label={`调整${m.name}可访问的企业`}>
                        调整企业
                      </button>
                    )}
                    <button type="button" style={linkButton} onClick={() => onRole(m)} aria-label={`修改${m.name}的角色`}>
                      改角色
                    </button>
                    <button type="button" style={linkButton} onClick={() => onRemove(m)} aria-label={`移除${m.name}`}>
                      移除
                    </button>
                  </>
                )}
              </Actions>
            </Row>
          );
        })}
        {view.invitations.map((i, idx) => {
          const busy = busyInvitation === i.id;
          return (
            <Row key={i.id} last={view.members.length + idx === total - 1} height={72}>
              <span style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={i.name} pending />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ ...body, fontWeight: 500, ...ellipsis }}>{i.email}</span>
                  <span style={{ ...small, ...ellipsis }} title={i.name}>
                    {invitationNote(i)}
                  </span>
                </span>
              </span>
              <span style={{ ...body, width: MEMBER_COLS.role, flexShrink: 0 }}>{CUSTOMER_ROLE_LABELS[i.role]}</span>
              <span style={{ ...muted, width: MEMBER_COLS.access, flexShrink: 0 }}>{i.role === 'customer_admin' ? '全部企业' : '加入后分配'}</span>
              <span style={{ width: MEMBER_COLS.state, flexShrink: 0 }}>
                <Tag tone={i.state === 'expired' ? stage.action : stage.progress}>{i.state === 'expired' ? '邀请已过期' : '待接受邀请'}</Tag>
              </span>
              <Actions>
                <button type="button" style={{ ...linkButton, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={() => onResend(i)} aria-label={`重新发送给${i.email}的邀请`}>
                  重新发送
                </button>
                <button type="button" style={linkButton} onClick={() => onRevoke(i)} aria-label={`撤销给${i.email}的邀请`}>
                  撤销
                </button>
              </Actions>
            </Row>
          );
        })}
      </TableCard>
      <div style={{ display: 'flex', gap: 16 }}>
        {CUSTOMER_ROLES.map((r) => (
          <section key={r} aria-label={CUSTOMER_ROLE_LABELS[r]} style={{ ...panel, flex: '1 1 0', minWidth: 0, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...body, fontWeight: 500 }}>{CUSTOMER_ROLE_LABELS[r]}</span>
            <span style={muted}>{CUSTOMER_ROLE_DUTIES[r]}</span>
          </section>
        ))}
      </div>
      <p style={{ ...small, margin: 0 }}>移除成员后，其上传记录与操作记录仍保留。移除前请先把负责的企业分配给其他成员。</p>
    </div>
  );
}

// —— 企业分配 ——

function EnterprisesTab({ view, onAdjust }: { view: OrgManagementView; onAdjust: (e: OrgEnterpriseAssignment) => void }) {
  const names = new Map(view.members.map((m) => [m.id, m.name]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <TableCard
        label="企业分配"
        head={
          <>
            <span style={{ flex: '1 1 0', minWidth: 0 }}>企业</span>
            <span style={{ width: ENTERPRISE_COLS.members, flexShrink: 0 }}>负责成员</span>
            <span style={{ width: ENTERPRISE_COLS.changed, flexShrink: 0 }}>最近调整</span>
            <span style={{ width: ENTERPRISE_COLS.action, flexShrink: 0 }}>操作</span>
          </>
        }
      >
        {view.enterprises.length === 0 && <li style={{ ...muted, padding: '32px 24px', textAlign: 'center' }}>还没有企业。在「企业」里新建企业后，可以在这里分配给成员。</li>}
        {view.enterprises.map((e, idx) => {
          const people = e.memberIds.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
          const changed = e.membersChangedAt ? china(e.membersChangedAt) : null;
          return (
            <Row key={e.id} last={idx === view.enterprises.length - 1} height={64}>
              <span style={{ ...body, flex: '1 1 0', minWidth: 0, ...ellipsis }}>{e.name}</span>
              <span style={{ width: ENTERPRISE_COLS.members, flexShrink: 0, display: 'flex', gap: 6, overflow: 'hidden' }}>
                {people.length === 0 ? (
                  <span style={muted}>未分配</span>
                ) : (
                  people.map((n) => (
                    <span key={n} style={{ padding: '0 8px', borderRadius: 4, background: gy.neutralBg, fontSize: 13, lineHeight: '22px', color: gy.text, whiteSpace: 'nowrap' }}>
                      {n}
                    </span>
                  ))
                )}
              </span>
              <span style={{ ...small, width: ENTERPRISE_COLS.changed, flexShrink: 0 }}>{changed ? `${changed.date} ${changed.time}` : '—'}</span>
              <span style={{ width: ENTERPRISE_COLS.action, flexShrink: 0 }}>
                <button type="button" style={linkButton} onClick={() => onAdjust(e)} aria-label={`调整${e.name}的负责成员`}>
                  调整
                </button>
              </span>
            </Row>
          );
        })}
      </TableCard>
      <InfoBox title="分配只决定谁能看到这家企业" text="调整后立即生效；企业资料、任务与历史记录都保留。组织管理员始终可以看到全部企业。" />
    </div>
  );
}

// —— 年度服务 ——

const CONTRACT_TAGS: Record<ContractState, { label: string; tone: StatusTone }> = {
  active: { label: '有效', tone: 'done' },
  expiring: { label: '快到期', tone: 'action' },
  expired: { label: '已到期', tone: 'error' },
  upcoming: { label: '未开始', tone: 'progress' },
  none: { label: '未开通', tone: 'progress' },
};
const RECORDS_FIRST = 10;

// C08 年度服务：服务状态、编制次数（用量和次数记录）、服务内容三张卡片
function ServiceTab({ view, orgId }: { view: OrgManagementView; orgId: string }) {
  const s = view.service;
  const tag = CONTRACT_TAGS[s.state];
  const credits = useOrgCredits(orgId);
  const tail =
    s.state === 'expired' && s.endsAt
      ? ` · 已于 ${dotted(s.endsAt)} 到期`
      : s.state === 'upcoming'
        ? ' · 还没开始'
        : s.daysLeft === 0
          ? ' · 今天到期'
          : s.daysLeft !== null
            ? ` · 还有 ${s.daysLeft} 天到期`
            : '';
  const period = s.state !== 'none' && s.startsAt && s.endsAt ? `服务期 ${dotted(s.startsAt)} — ${dotted(s.endsAt)}${tail}` : '服务期尚未登记，请联系耕云';
  const rows: [string, string][] = [
    ['开放业务', '生产安全事故应急预案编制'],
    ['每次交付', '应急预案、风险评估报告、应急资源调查报告，共三份 Word'],
    ['办理方式', '准备资料 → 专家编制 → 已交付'],
    ['本年已办理', `${s.enterprises} 家企业 · 已交付 ${s.delivered} · 办理中 ${s.inProgress}`],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section aria-label="年度服务" style={{ ...panel, display: 'flex', alignItems: 'center', gap: 20, padding: 24 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>年度服务</h2>
            <StatusTag tone={tag.tone}>{tag.label}</StatusTag>
          </div>
          <span style={muted}>{period}</span>
        </div>
        <ContactLink
          title="联系耕云续约"
          hint="续约或开通年度服务，请直接联系耕云。"
          trigger={(open) => (
            <Button onClick={open} style={{ borderColor: gy.border }}>
              续约
            </Button>
          )}
        />
      </section>
      <section aria-label="编制次数" style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}>
        <h2 style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>编制次数</h2>
        {credits.isPending ? (
          <Loading rows={3} card={false} />
        ) : credits.isError ? (
          <span style={muted}>编制次数暂时读不出来：{credits.error.message}</span>
        ) : credits.data.validUntil ? (
          <CreditUsage credits={credits.data} />
        ) : (
          <NoCredits state={s.state} startsAt={s.startsAt} awaiting={credits.data.awaitingTasks.length} />
        )}
      </section>
      <section aria-label="服务内容" style={{ ...panel, display: 'flex', flexDirection: 'column', padding: '8px 24px' }}>
        {rows.map(([label, value], i) => (
          <div key={label} style={{ display: 'flex', gap: 16, padding: '14px 0', borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${gy.split}` }}>
            <span style={{ ...muted, width: 140, flexShrink: 0 }}>{label}</span>
            <span style={body}>{value}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function CreditUsage({ credits: c }: { credits: OrgCredits }) {
  const [all, setAll] = useState(false);
  const [y, m, d] = c.validUntil!.split('-').map(Number);
  const topUp = c.entries.some((e) => e.type === 'top_up');
  const gift = c.remaining.gift;
  const note = [
    `剩余里：${gift > 0 ? `耕云赠送 ${gift} 次、` : ''}${topUp ? '合同购买和加购' : '合同购买'} ${c.remaining.purchase} 次`,
    ...(gift > 0 ? ['先用赠送的'] : []),
    '专家交付成果才算 1 次，之后重新打开再交付不再算',
  ].join(' · ');
  const shown = all ? c.entries : c.entries.slice(0, RECORDS_FIRST);
  const cols = { date: 120, kind: 120, delta: 80 } as const;
  const line: CSSProperties = { display: 'flex', alignItems: 'center', gap: 16, borderBottom: `1px solid ${gy.split}` };
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px', borderRadius: 8, border: `1px solid ${gy.split}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>剩余 {c.remaining.total} 次</span>
            <span style={muted}>
              共 {c.granted} 次，已用 {c.used} 次
            </span>
          </div>
          <span style={muted}>
            有效期至 {y} 年 {m} 月 {d} 日
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="已用次数"
          aria-valuemin={0}
          aria-valuemax={c.granted}
          aria-valuenow={c.used}
          style={{ height: 8, borderRadius: 4, background: gy.neutralBg, overflow: 'hidden' }}
        >
          <div style={{ width: `${c.granted > 0 ? Math.min(100, (c.used / c.granted) * 100) : 0}%`, height: '100%', borderRadius: 4, background: gy.primary }} />
        </div>
        <span style={{ ...type.caption, color: gy.tertiary }}>{note}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...body, fontWeight: weight.strong, paddingBottom: 8 }}>次数记录</span>
        <div style={{ ...line, borderTop: `1px solid ${gy.split}`, padding: '10px 0', ...type.caption, color: gy.secondary }}>
          <span style={{ width: cols.date, flexShrink: 0 }}>日期</span>
          <span style={{ width: cols.kind, flexShrink: 0 }}>类型</span>
          <span style={{ flex: 1, minWidth: 0 }}>说明</span>
          <span style={{ width: cols.delta, flexShrink: 0, textAlign: 'right' }}>次数</span>
        </div>
        {c.entries.length === 0 ? (
          <span style={{ ...muted, padding: '12px 0' }}>还没有次数记录。</span>
        ) : (
          shown.map((e) => (
            <div key={e.id} data-testid="credit-entry" style={{ ...line, padding: '12px 0', ...body }}>
              <span style={{ width: cols.date, flexShrink: 0 }}>{dotted(chinaToday(new Date(e.createdAt)))}</span>
              <span style={{ width: cols.kind, flexShrink: 0 }}>{CREDIT_ENTRY_TYPE_LABELS[e.type]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{customerCreditEntryText(e)}</span>
              <span style={{ width: cols.delta, flexShrink: 0, textAlign: 'right' }}>{formatCreditDelta(e.delta)}</span>
            </div>
          ))
        )}
        {!all && c.entries.length > RECORDS_FIRST && (
          <button type="button" style={{ ...linkButton, alignSelf: 'flex-start', marginTop: 12 }} onClick={() => setAll(true)}>
            查看全部 {c.entries.length} 条
          </button>
        )}
      </div>
    </>
  );
}

// 没有生效合同时，次数那张卡片只写一句
function NoCredits({ state, startsAt, awaiting }: { state: ContractState; startsAt: string | null; awaiting: number }) {
  if (state === 'upcoming' && startsAt) return <span style={muted}>合同 {dotted(startsAt)} 起生效，到时这里会显示编制次数。</span>;
  if (state === 'expired')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={muted}>年度服务已到期，次数随合同失效。</span>
        {awaiting > 0 && (
          <span style={{ ...muted, display: 'flex', gap: 8 }}>
            有 {awaiting} 份成果等续约后下载
            <Link to="/customer/documents" style={{ color: gy.primary }}>
              查看
            </Link>
          </span>
        )}
      </div>
    );
  return <span style={muted}>耕云登记合同后，这里会显示编制次数。</span>;
}

// —— 组织资料 ——

function ProfileTab({ view, orgId }: { view: OrgManagementView; orgId: string }) {
  const [form] = Form.useForm<OrgProfileInput>();
  const update = useUpdateOrgProfile(orgId);
  const { message } = App.useApp();
  const initial = useMemo(
    () => ({ contactName: view.org.contactName ?? '', contactPhone: view.org.contactPhone ?? '', contactEmail: view.org.contactEmail ?? '' }),
    [view.org],
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    form.setFieldsValue(initial);
    setDirty(false);
  }, [form, initial]);
  const save = async () => {
    const values = await form.validateFields();
    const parsed = orgProfileSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      form.setFields([{ name: issue.path[0] as 'contactName', errors: [issue.message] }]);
      return;
    }
    try {
      await update.mutateAsync(values);
      message.success('组织资料已保存');
      setDirty(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有保存成功，请再试一次');
    }
  };
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <section aria-label="组织资料" style={{ ...panel, flex: '1 1 0', minWidth: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text, margin: 0 }}>组织信息</h2>
        <Form form={form} layout="vertical" requiredMark={requiredAfter} initialValues={initial} onValuesChange={() => setDirty(true)}>
          <Form.Item label="组织名称" extra={<span style={small}>开通时由耕云登记，如需变更请联系耕云。</span>}>
            <Input value={view.org.name} readOnly aria-readonly />
          </Form.Item>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item label="服务联系人" name="contactName" required rules={[{ required: true, whitespace: true, message: '请填写服务联系人' }]} style={{ flex: 1 }}>
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item label="联系电话" name="contactPhone" required rules={[{ required: true, whitespace: true, message: '请填写联系电话' }]} style={{ flex: 1 }}>
              <Input maxLength={30} />
            </Form.Item>
          </div>
          <Form.Item label="联系邮箱" name="contactEmail" extra={<span style={small}>用于耕云联系组织，与个人登录账号分开管理。</span>} style={{ marginBottom: 0 }}>
            <Input maxLength={100} />
          </Form.Item>
        </Form>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 16, borderTop: `1px solid ${gy.split}` }}>
          <Button type="primary" onClick={() => void save()} loading={update.isPending}>
            保存
          </Button>
          <span style={small}>{dirty ? '有未保存的更改' : '没有未保存的更改'}</span>
        </div>
      </section>
      <section aria-label="个人信息在哪改" style={{ ...panel, width: 340, flexShrink: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text, margin: 0 }}>个人信息在哪改？</h2>
        <span style={muted}>您的姓名、登录邮箱和密码，请点右上角头像进入「个人账户」修改。</span>
      </section>
    </div>
  );
}

// —— 弹窗 ——

function InviteModal({ open, orgId, onClose }: { open: boolean; orgId: string; onClose: () => void }) {
  const [form] = Form.useForm<{ name: string; email: string; role: CustomerRole }>();
  const invite = useInviteMember(orgId);
  const { message } = App.useApp();
  const submit = async () => {
    const values = await form.validateFields();
    const parsed = memberInviteSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      form.setFields([{ name: issue.path[0] as 'name', errors: [issue.message] }]);
      return;
    }
    try {
      const sent = await invite.mutateAsync(parsed.data);
      message.success(sent.simulated ? `邀请已放进模拟发件箱（${sent.email}）` : `邀请邮件已发给 ${sent.email}`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.body?.field === 'email') form.setFields([{ name: 'email', errors: [err.message] }]);
      else message.error(err instanceof Error ? err.message : '邀请没有发出，请再试一次');
    }
  };
  return (
    <Modal
      open={open}
      title="邀请成员"
      okText="发送邀请"
      cancelText="取消"
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={invite.isPending}
      afterClose={() => form.resetFields()}
      destroyOnHidden
      width={520}
    >
      <p style={{ ...muted, margin: '0 0 16px' }}>对方会收到邀请邮件，7 天内设置密码即可加入。成员加入后，再给他分配可访问的企业。</p>
      <Form form={form} layout="vertical" requiredMark={requiredAfter} initialValues={{ role: 'customer_member' }}>
        <Form.Item label="姓名" name="name" rules={[{ required: true, whitespace: true, message: '请填写姓名' }]}>
          <Input maxLength={50} placeholder="例如：王工" />
        </Form.Item>
        <Form.Item label="邮箱" name="email" rules={[{ required: true, whitespace: true, message: '请填写邮箱' }]}>
          <Input placeholder="name@example.com" />
        </Form.Item>
        <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]} extra="成员只访问分配给自己的企业；组织管理员访问全部企业并管理组织。">
          <Radio.Group options={CUSTOMER_ROLES.map((r) => ({ value: r, label: CUSTOMER_ROLE_LABELS[r] }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function PickModal({
  open,
  title,
  intro,
  options,
  initial,
  empty,
  saving,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  intro: string;
  options: { value: string; label: string }[];
  initial: string[];
  empty: string;
  saving: boolean;
  onSave: (ids: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[] | null>(null);
  const value = picked ?? initial;
  return (
    <Modal
      open={open}
      title={title}
      okText="保存"
      cancelText="取消"
      onOk={() => void onSave(value)}
      onCancel={onClose}
      afterClose={() => setPicked(null)}
      confirmLoading={saving}
      width={520}
    >
      <p style={{ ...muted, margin: '0 0 16px' }}>{intro}</p>
      {options.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>{empty}</p>
      ) : (
        <Checkbox.Group value={value} onChange={(v) => setPicked(v as string[])} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 360, overflowY: 'auto' }}>
          {options.map((o) => (
            <Checkbox key={o.value} value={o.value}>
              {o.label}
            </Checkbox>
          ))}
        </Checkbox.Group>
      )}
    </Modal>
  );
}

function RoleModal({ member, orgId, onClose }: { member: OrgMember | null; orgId: string; onClose: () => void }) {
  const [role, setRole] = useState<CustomerRole | null>(null);
  const change = useChangeMemberRole(orgId);
  const { message } = App.useApp();
  const current = role ?? member?.role ?? 'customer_member';
  const submit = async () => {
    if (!member) return;
    if (current === member.role) return onClose();
    try {
      await change.mutateAsync({ userId: member.id, role: current });
      message.success(`${member.name}已改为${CUSTOMER_ROLE_LABELS[current]}`);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有改成，请再试一次');
    }
  };
  return (
    <Modal
      open={member !== null}
      title={member ? `修改 ${member.name} 的角色` : ''}
      okText="保存"
      cancelText="取消"
      onOk={() => void submit()}
      onCancel={onClose}
      afterClose={() => setRole(null)}
      confirmLoading={change.isPending}
      width={520}
    >
      {member && (
        <>
          <p style={{ ...muted, margin: '0 0 16px' }}>{member.email}</p>
          <Radio.Group value={current} onChange={(e) => setRole(e.target.value as CustomerRole)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="角色">
            {CUSTOMER_ROLES.map((r) => (
              <Radio key={r} value={r}>
                <span style={body}>{CUSTOMER_ROLE_LABELS[r]}</span>
                <span style={{ ...small, display: 'block' }}>{CUSTOMER_ROLE_DUTIES[r]}</span>
              </Radio>
            ))}
          </Radio.Group>
        </>
      )}
    </Modal>
  );
}

const TAB_LABELS: Record<Tab, string> = { profile: '组织资料', members: '成员与权限', enterprises: '企业分配', service: '年度服务' };

export function OrganizationPage() {
  const { orgId } = useWorkspace();
  const view = useOrgManagement(orgId);
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'members';
  const { message, modal } = App.useApp();
  const resend = useResendMemberInvitation(orgId);
  const revoke = useRevokeMemberInvitation(orgId);
  const remove = useRemoveMember(orgId);
  const setMemberEnterprises = useSetMemberEnterprises(orgId);
  const setEnterpriseMembers = useSetEnterpriseMembers(orgId);
  const [inviting, setInviting] = useState(false);
  const [roleOf, setRoleOf] = useState<OrgMember | null>(null);
  const [assignOf, setAssignOf] = useState<OrgMember | null>(null);
  const [membersOf, setMembersOf] = useState<OrgEnterpriseAssignment | null>(null);

  const fail = (err: unknown, fallback: string) => message.error(err instanceof Error ? err.message : fallback);

  const askRemove = (m: OrgMember) => {
    const data = view.data!;
    const alone = data.enterprises.filter((e) => e.memberIds.length === 1 && e.memberIds[0] === m.id).map((e) => e.name);
    modal.confirm({
      title: `移除 ${m.name}？`,
      content: (
        <>
          移除后{m.name}不能再登录本组织，已登录的地方会退出；上传记录与操作记录仍保留。
          {alone.length > 0 && <div style={{ marginTop: 8, color: gy.warning }}>以下企业只有{m.name}负责，移除后没有负责成员（组织管理员仍能看到）：{alone.join('、')}。</div>}
        </>
      ),
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await remove.mutateAsync(m.id);
          message.success(`已移除${m.name}`);
        } catch (err) {
          fail(err, '没有移除成功，请再试一次');
        }
      },
    });
  };
  const doResend = async (i: OrgMemberInvitation) => {
    try {
      const sent = await resend.mutateAsync(i.id);
      message.success(sent.simulated ? `邀请已重新放进模拟发件箱（${sent.email}）` : `已重新发送邀请邮件给 ${sent.email}，旧链接作废`);
    } catch (err) {
      fail(err, '没有发出，请再试一次');
    }
  };
  const askRevoke = (i: OrgMemberInvitation) =>
    modal.confirm({
      title: `撤销给 ${i.email} 的邀请？`,
      content: '撤销后邀请邮件里的链接立即失效。以后可以重新邀请。',
      okText: '撤销',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await revoke.mutateAsync(i.id);
          message.success('邀请已撤销');
        } catch (err) {
          fail(err, '没有撤销成功，请再试一次');
        }
      },
    });

  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ ...type.pageTitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>组织管理</h1>
        <span style={muted}>组织资料、成员、企业分配和年度服务都在这里。</span>
      </div>
      {tab === 'members' && view.data && (
        <Button type="primary" onClick={() => setInviting(true)} style={{ flexShrink: 0 }}>
          + 邀请成员
        </Button>
      )}
    </div>
  );

  let content: ReactNode;
  if (view.isPending) content = <Loading rows={5} />;
  else if (view.isError)
    content = <Notice tone="warning" title="组织管理暂时打不开" text={view.error.message} action={<Button onClick={() => void view.refetch()}>重新加载</Button>} />;
  else {
    const data = view.data;
    content = (
      <>
        <div role="tablist" aria-label="组织管理" style={{ display: 'flex', gap: 32, borderBottom: `1px solid ${gy.split}` }}>
          {TABS.map((t) => {
            const active = t === tab;
            const count = t === 'members' ? ` ${data.members.length + data.invitations.length}` : '';
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setParams(t === 'members' ? {} : { tab: t }, { replace: true })}
                style={{
                  ...body,
                  color: active ? gy.primary : gy.text,
                  padding: '0 0 10px',
                  marginBottom: -1,
                  border: 'none',
                  borderBottom: `2px solid ${active ? gy.primary : 'transparent'}`,
                  background: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {TAB_LABELS[t]}
                {count}
              </button>
            );
          })}
        </div>
        {tab === 'profile' && <ProfileTab view={data} orgId={orgId} />}
        {tab === 'members' && (
          <MembersTab
            view={data}
            onAssign={setAssignOf}
            onRole={setRoleOf}
            onRemove={askRemove}
            onResend={(i) => void doResend(i)}
            onRevoke={askRevoke}
            busyInvitation={resend.isPending ? (resend.variables ?? null) : null}
          />
        )}
        {tab === 'enterprises' && <EnterprisesTab view={data} onAdjust={setMembersOf} />}
        {tab === 'service' && <ServiceTab view={data} orgId={orgId} />}
        <InviteModal open={inviting} orgId={orgId} onClose={() => setInviting(false)} />
        <RoleModal member={roleOf} orgId={orgId} onClose={() => setRoleOf(null)} />
        <PickModal
          open={assignOf !== null}
          title={assignOf ? `调整 ${assignOf.name} 可访问的企业` : ''}
          intro="勾选的企业，这位成员可以查看和办理；取消勾选后立即看不到，企业资料与历史记录都保留。"
          options={data.enterprises.map((e) => ({ value: e.id, label: e.name }))}
          initial={assignOf?.enterpriseIds ?? []}
          empty="还没有企业。先在「企业」里新建企业。"
          saving={setMemberEnterprises.isPending}
          onClose={() => setAssignOf(null)}
          onSave={async (enterpriseIds) => {
            if (!assignOf) return;
            try {
              await setMemberEnterprises.mutateAsync({ userId: assignOf.id, enterpriseIds });
              message.success(`已调整${assignOf.name}可访问的企业`);
              setAssignOf(null);
            } catch (err) {
              fail(err, '没有保存成功，请再试一次');
            }
          }}
        />
        <PickModal
          open={membersOf !== null}
          title={membersOf ? `调整 ${membersOf.name} 的负责成员` : ''}
          intro="勾选的成员可以查看和办理这家企业，并收到这家企业任务的站内通知。组织管理员始终可以看到全部企业，勾选只表示由他负责。"
          options={data.members.map((m) => ({ value: m.id, label: `${m.name}（${CUSTOMER_ROLE_LABELS[m.role]} · ${m.email}）` }))}
          initial={membersOf?.memberIds ?? []}
          empty="还没有成员。先在「成员与权限」里邀请成员。"
          saving={setEnterpriseMembers.isPending}
          onClose={() => setMembersOf(null)}
          onSave={async (userIds) => {
            if (!membersOf) return;
            try {
              await setEnterpriseMembers.mutateAsync({ enterpriseId: membersOf.id, userIds });
              message.success(`已调整${membersOf.name}的负责成员`);
              setMembersOf(null);
            } catch (err) {
              fail(err, '没有保存成功，请再试一次');
            }
          }}
        />
      </>
    );
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{header}{content}</div>;
}
