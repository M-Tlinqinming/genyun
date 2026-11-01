import {
  adminInvitationSchema,
  chinaToday,
  contractState,
  CONTRACT_REMIND_DAYS,
  INVITATION_TTL_DAYS,
  maskPhone,
  OPERATOR_TASK_STAGES,
  ORG_SERVICE_STATES,
  serviceScopeLabel,
  type AdminInvitationInput,
  type OperatorTaskStage,
  type OrgServiceState,
} from '@genyun/shared';
import { App, Button, Form, Input, Modal, Tabs, Typography } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  useInviteAdmin,
  useOperatorOrg,
  type OperatorOrgDetail,
  type OrgInvitation,
  type SentInvitation,
} from '../../api/operator';
import { ApiError } from '../../api/request';
import { inlineUrl } from '../../api/workup';
import { linkButton, Loading, Notice, panel, requiredAfter } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';
import { OpenOrgModal } from './OpenOrgModal';
import { RegisterOrgModal } from './RegisterOrgModal';

type Tone = { color: string; bg: string };
type TabKey = 'overview' | 'people' | 'service' | 'invitations' | 'log';

const STATE_TONE: Record<OrgServiceState, Tone> = { active: stage.done, pending: stage.action, expired: stage.progress };
const TASK_TONE: Record<OperatorTaskStage, Tone> = {
  preparing: stage.progress,
  unassigned: stage.action,
  drafting: stage.progress,
  delivered: stage.done,
};

// 2026-01-01 → 2026.01.01 / 01.01
const fullDate = (iso: string) => chinaToday(new Date(iso)).replaceAll('-', '.');
const dotted = (date: string) => date.replaceAll('-', '.');
const monthDay = (iso: string) => fullDate(iso).slice(5);

const small: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary };
const body: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };
const cardTitle: CSSProperties = { fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text, margin: 0 };

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        flexShrink: 0,
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

// 左栏卡片：标题行带分隔线，右侧是文字链接
function ListCard({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ ...panel, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 24px',
          borderBottom: `1px solid ${gy.split}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <h2 style={cardTitle}>{title}</h2>
          {note && <span style={small}>{note}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// 右栏卡片：标题和内容在同一块里，间距 12
function SideCard({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={cardTitle}>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function OrgProfileCard({ org, onEdit }: { org: OperatorOrgDetail; onEdit: () => void }) {
  const fields: [string, string][] = [
    ['组织全称', org.name],
    ['统一社会信用代码', org.socialCreditCode ?? '—'],
    ['所在地区', org.region ?? '—'],
    ['合作确认', `${fullDate(org.createdAt)} · ${org.registeredByName ?? '耕云运营'}登记`],
    ['主联系人', [org.contactName, org.contactPhone && maskPhone(org.contactPhone)].filter(Boolean).join(' · ') || '—'],
    ['联系邮箱', org.contactEmail ?? '—'],
  ];
  return (
    <ListCard
      title="组织资料"
      action={
        <button type="button" style={linkButton} onClick={onEdit}>
          编辑
        </button>
      }
    >
      <dl style={{ display: 'flex', flexWrap: 'wrap', rowGap: 12, padding: '12px 24px 20px', margin: 0 }}>
        {fields.map(([k, v]) => (
          <div key={k} style={{ width: '50%', display: 'flex', flexDirection: 'column', paddingRight: 16, boxSizing: 'border-box' }}>
            <dt style={small}>{k}</dt>
            <dd style={{ ...body, margin: 0 }}>{v}</dd>
          </div>
        ))}
        {org.note && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
            <dt style={small}>备注</dt>
            <dd style={{ ...body, margin: 0, whiteSpace: 'pre-wrap' }}>{org.note}</dd>
          </div>
        )}
      </dl>
    </ListCard>
  );
}

function Avatar({ name, kind }: { name: string; kind: 'admin' | 'member' | 'invited' }) {
  const look: CSSProperties =
    kind === 'admin'
      ? { background: gy.selected, color: gy.primary }
      : kind === 'member'
        ? { background: gy.neutralBg, color: gy.secondary }
        : { border: `1px dashed ${gy.border}`, color: gy.tertiary };
  return (
    <span
      aria-hidden
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: 16,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        ...look,
      }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

const INVITE_STATE: Record<OrgInvitation['state'], { label: string; tone: Tone }> = {
  valid: { label: '邀请中', tone: stage.action },
  expired: { label: '邀请已过期', tone: stage.progress },
  accepted: { label: '已接受', tone: stage.done },
  revoked: { label: '已作废', tone: stage.progress },
};

// 联系人与成员：已加入的成员在前，后面是还没接受的邀请（过期的也列出来，提醒客户管理员重发）
function PeopleCard({ org, limit, onAll }: { org: OperatorOrgDetail; limit?: number; onAll?: () => void }) {
  const joined = new Set(org.members.map((m) => m.email.toLowerCase()));
  const pending = org.invitations.filter(
    (i) => (i.state === 'valid' || i.state === 'expired') && !joined.has(i.email.toLowerCase()),
  );
  // 同一个邮箱只列最新一封
  const seen = new Set<string>();
  const invites = pending.filter((i) => !seen.has(i.email) && (seen.add(i.email), true));
  const rows: ReactNode[] = [
    ...org.members.map((m) => {
      const admin = m.role === 'customer_admin';
      const primary = org.contactEmail?.toLowerCase() === m.email.toLowerCase();
      return (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <Avatar name={m.name} kind={admin ? 'admin' : 'member'} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={body}>{m.name}</span>
            <span style={small}>
              {m.email} · {monthDay(m.createdAt)} 加入
            </span>
          </div>
          <Pill tone={admin ? { color: gy.primary, bg: gy.selected } : stage.progress}>
            {admin ? (primary ? '管理员 · 主联系人' : '管理员') : '成员'}
          </Pill>
        </div>
      );
    }),
    ...invites.map((i) => (
      <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
        <Avatar name={i.name || i.email} kind="invited" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ ...body, color: gy.secondary }}>{i.email}</span>
          <span style={small}>
            {i.invitedByName} {monthDay(i.createdAt)} 邀请 ·{' '}
            {i.state === 'valid' ? `尚未接受，${monthDay(i.expiresAt)} 前有效` : '链接已过期'}
          </span>
        </div>
        <Pill tone={INVITE_STATE[i.state].tone}>{INVITE_STATE[i.state].label}</Pill>
      </div>
    )),
  ];
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <ListCard
      title="联系人与成员"
      note="成员由客户管理员自行邀请和管理"
      action={
        onAll &&
        rows.length > shown.length && (
          <button type="button" style={linkButton} onClick={onAll}>
            全部 {rows.length} 人
          </button>
        )
      }
    >
      {rows.length === 0 ? (
        <p style={{ ...small, padding: '16px 24px', margin: 0 }}>还没有成员。首位管理员接受邀请后会出现在这里。</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '4px 24px' }}>
          {shown.map((row, n) => (
            <li key={n} style={n < shown.length - 1 ? { borderBottom: `1px solid ${gy.split}` } : undefined}>
              {row}
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

function EnterprisesCard({ org }: { org: OperatorOrgDetail }) {
  return (
    <ListCard
      title="企业与任务"
      note="只读 · 处理请进入任务中心"
      action={
        <Link to="/operator/tasks" style={{ ...body, color: gy.primary }}>
          在任务中心查看
        </Link>
      }
    >
      {org.enterprises.length === 0 ? (
        <p style={{ ...small, padding: '16px 24px', margin: 0 }}>客户还没有添加企业。</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '4px 24px' }}>
          {org.enterprises.map((e, n) => (
            <li
              key={e.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: n < org.enterprises.length - 1 ? `1px solid ${gy.split}` : undefined,
              }}
            >
              <Typography.Text ellipsis={{ tooltip: e.name }} style={{ ...body, flex: 1, minWidth: 0 }}>
                {e.name}
              </Typography.Text>
              <span style={{ ...body, color: gy.secondary, width: 120, flexShrink: 0 }}>{e.task?.number ?? '—'}</span>
              <span style={{ width: 110, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                {e.task ? (
                  <Pill tone={TASK_TONE[e.task.stage]}>{OPERATOR_TASK_STAGES[e.task.stage]}</Pill>
                ) : (
                  <span style={small}>还没有任务</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

// 年度服务：有效期、剩余天数和进度条
function ServiceCard({ org, onRecords }: { org: OperatorOrgDetail; onRecords?: () => void }) {
  const tag = <Pill tone={STATE_TONE[org.state]}>{ORG_SERVICE_STATES[org.state]}</Pill>;
  if (org.state === 'pending' || !org.contractStartsAt || !org.contractEndsAt) {
    return (
      <SideCard title="年度服务" extra={tag}>
        <p style={{ ...small, margin: 0 }}>开通时登记合同和有效期。</p>
      </SideCard>
    );
  }
  const c = contractState(org);
  const total = Date.parse(org.contractEndsAt) - Date.parse(org.contractStartsAt);
  const passed = Date.parse(chinaToday()) - Date.parse(org.contractStartsAt);
  const ratio = total > 0 ? Math.min(1, Math.max(0, passed / total)) : 1;
  const note =
    c.state === 'upcoming'
      ? `${dotted(org.contractStartsAt)} 起生效`
      : c.state === 'expired'
        ? '已到期，客户不能新建任务'
        : `剩余 ${c.daysLeft} 天 · 到期前 ${CONTRACT_REMIND_DAYS} 天提醒客户管理员`;
  return (
    <SideCard title="年度服务" extra={tag}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.text, whiteSpace: 'nowrap' }}>
          {dotted(org.contractStartsAt)} – {dotted(org.contractEndsAt)}
        </span>
        <span style={{ ...small, color: c.state === 'expiring' ? gy.warning : gy.secondary }}>{note}</span>
      </div>
      <div
        role="progressbar"
        aria-label="服务期已过"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, borderRadius: 3, background: gy.neutralBg }}
      >
        <div style={{ height: 6, borderRadius: 3, background: gy.primary, width: `${Math.round(ratio * 100)}%` }} />
      </div>
      {onRecords && (
        <div style={{ paddingTop: 4 }}>
          <button type="button" style={linkButton} onClick={onRecords}>
            查看合同
          </button>
        </div>
      )}
    </SideCard>
  );
}

function ContractCard({ org }: { org: OperatorOrgDetail }) {
  const { message } = App.useApp();
  const file = org.contractFile;
  // 先开一个空白页，拿到签名链接后再跳转，避免浏览器拦截弹窗
  const preview = async () => {
    if (!file) return;
    const win = window.open('', '_blank');
    try {
      const { url } = await inlineUrl(file.id);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      message.error(err instanceof Error ? err.message : '预览失败，请重试');
    }
  };
  const rows: [string, ReactNode][] = [
    ['合同编号', org.contract?.number ?? '—'],
    ['服务范围', org.contract ? serviceScopeLabel(org.contract.scopeKind, org.contract.scopeEnterprises) : '—'],
    [
      '合同有效期',
      org.contractStartsAt && org.contractEndsAt ? `${dotted(org.contractStartsAt)} – ${dotted(org.contractEndsAt)}` : '—',
    ],
    [
      '合同原件',
      file ? (
        <button type="button" style={linkButton} onClick={() => void preview()}>
          {file.originalName}
        </button>
      ) : (
        '—'
      ),
    ],
    ['上传', file ? `${fullDate(file.createdAt)} · ${file.uploadedByName}` : '—'],
  ];
  return (
    <ListCard title="合同">
      <Pairs rows={rows} padding="12px 24px 20px" />
    </ListCard>
  );
}

function Pairs({ rows, padding }: { rows: [string, ReactNode][]; padding?: string }) {
  return (
    <dl style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <dt style={{ ...body, color: gy.secondary, flexShrink: 0 }}>{k}</dt>
          <dd style={{ ...body, margin: 0, textAlign: 'right', minWidth: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function adminState(org: OperatorOrgDetail) {
  const admin = org.members.find((m) => m.role === 'customer_admin') ?? null;
  const adminInvites = org.invitations.filter((i) => i.role === 'customer_admin');
  // 开通时发的那封（最早一封）是谁发的，就是谁开通的
  const opener = adminInvites.at(-1)?.invitedByName ?? null;
  const latest = adminInvites[0] ?? null;
  return { admin, latest, opener };
}

function InvitationCard({
  org,
  onOpen,
  onResend,
  onReplace,
  resending,
}: {
  org: OperatorOrgDetail;
  onOpen: () => void;
  onResend: () => void;
  onReplace: () => void;
  resending: boolean;
}) {
  const { admin, latest, opener } = adminState(org);
  const waiting = org.invitations.filter((i) => i.state === 'valid').length;
  if (!org.activatedAt) {
    return (
      <SideCard title="开通与邀请">
        <p style={{ ...small, margin: 0 }}>合同签好、款到账后开通，系统会给首位管理员发邀请。</p>
        <div>
          <Button type="primary" onClick={onOpen}>
            开通
          </Button>
        </div>
      </SideCard>
    );
  }
  const adminText = admin
    ? `${admin.name} · ${monthDay(admin.createdAt)} 已接受`
    : latest
      ? `${latest.name} · ${
          latest.state === 'valid' ? `邀请中，${monthDay(latest.expiresAt)} 前有效` : latest.state === 'expired' ? '邀请已过期' : '邀请已作废'
        }`
      : '—';
  return (
    <SideCard title="开通与邀请">
      <Pairs
        rows={[
          ['组织开通', [fullDate(org.activatedAt), opener].filter(Boolean).join(' · ')],
          ['首位管理员', <span style={latest?.state === 'expired' && !admin ? { color: gy.warning } : undefined}>{adminText}</span>],
          ['待接受邀请', `${waiting} 个`],
        ]}
      />
      <div style={{ borderRadius: 6, padding: '8px 12px', background: gy.selected, ...small }}>
        耕云只负责开通组织和邀请首位管理员；之后的成员由客户管理员邀请。
      </div>
      {!admin && (
        <div style={{ display: 'flex', gap: 8 }}>
          {latest && (
            <Button type={latest.state === 'valid' ? 'default' : 'primary'} loading={resending} onClick={onResend}>
              重新发送邀请
            </Button>
          )}
          <Button onClick={onReplace}>更换管理员</Button>
        </div>
      )}
    </SideCard>
  );
}

interface LogEntry {
  at: string;
  text: string;
}

// 操作记录由现有数据推出（登记、开通、邀请、接受、作废），没有单独的动态表
function logOf(org: OperatorOrgDetail): LogEntry[] {
  const out: LogEntry[] = [{ at: org.createdAt, text: `${org.registeredByName ?? '耕云运营'}登记客户组织` }];
  if (org.activatedAt) out.push({ at: org.activatedAt, text: '组织开通，合同有效期生效' });
  const memberName = new Map(org.members.map((m) => [m.email.toLowerCase(), m.name]));
  for (const i of org.invitations) {
    const role = i.role === 'customer_admin' ? '首位管理员' : '成员';
    out.push({ at: i.createdAt, text: `${i.invitedByName}邀请 ${i.email} 作为${role}加入` });
    if (i.acceptedAt) {
      const who = memberName.get(i.email.toLowerCase()) ?? i.name;
      out.push({ at: i.acceptedAt, text: `${who}接受邀请，成为${i.role === 'customer_admin' ? '管理员' : '成员'}` });
    }
    if (i.revokedAt) out.push({ at: i.revokedAt, text: `发给 ${i.email} 的旧邀请作废` });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function LogList({ entries }: { entries: LogEntry[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e, n) => (
        <li key={n} style={{ display: 'flex', gap: 12, fontSize: 13, lineHeight: '20px' }}>
          <time dateTime={e.at} style={{ width: 44, flexShrink: 0, color: gy.secondary }}>
            {monthDay(e.at)}
          </time>
          <span style={{ color: gy.text }}>{e.text}</span>
        </li>
      ))}
    </ol>
  );
}

function ReplaceAdminModal({
  org,
  onClose,
  onSent,
}: {
  org: OperatorOrgDetail;
  onClose: () => void;
  onSent: (r: SentInvitation) => void;
}) {
  const invite = useInviteAdmin(org.id);
  const { message } = App.useApp();
  const [form] = Form.useForm<AdminInvitationInput>();
  const field = (key: keyof AdminInvitationInput) => ({
    validator: (_: unknown, value: string | undefined) => {
      const r = adminInvitationSchema.shape[key].safeParse(value ?? '');
      return r.success ? Promise.resolve() : Promise.reject(new Error(r.error.issues[0]?.message));
    },
  });
  const submit = (values: AdminInvitationInput) =>
    invite.mutate(values, {
      onSuccess: (r) => {
        onSent(r);
        onClose();
      },
      // 邮箱已有耕云账号：显示在邮箱字段下面
      onError: (err) => {
        if (err instanceof ApiError && err.body?.field === 'email') form.setFields([{ name: 'email', errors: [err.message] }]);
        else message.error(err.message);
      },
    });
  return (
    <Modal
      open
      title="更换首位管理员"
      width={520}
      onCancel={onClose}
      okText="发送邀请"
      cancelText="取消"
      confirmLoading={invite.isPending}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <p style={{ ...small, fontSize: 14, lineHeight: '22px', margin: '0 0 20px' }}>
        之前发出的邀请链接会作废，系统给新的首位管理员发一封邀请，{INVITATION_TTL_DAYS} 天内有效。
      </p>
      <Form<AdminInvitationInput>
        form={form}
        layout="vertical"
        requiredMark={requiredAfter}
        className="gy-form-explain-gap"
        onFinish={submit}
        initialValues={{ name: '', phone: '', email: '' }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="name" label="姓名" required rules={[field('name')]} style={{ flex: 1, minWidth: 0, marginBottom: 20 }}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="phone" label="手机号" required rules={[field('phone')]} style={{ flex: 1, minWidth: 0, marginBottom: 20 }}>
            <Input maxLength={30} />
          </Form.Item>
        </div>
        <Form.Item name="email" label="邮箱" required rules={[field('email')]} style={{ marginBottom: 0 }}>
          <Input maxLength={100} placeholder="邀请发到这个邮箱" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// I03 客户组织详情（Paper 16 页）：组织资料、联系人与成员、企业与任务（只读）、年度服务、开通与邀请、操作记录
export function OrganizationDetailPage() {
  const { orgId = '' } = useParams();
  const detail = useOperatorOrg(orgId);
  const invite = useInviteAdmin(orgId);
  const { message, modal } = App.useApp();
  const [tab, setTab] = useState<TabKey>('overview');
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [replacing, setReplacing] = useState(false);

  if (detail.isPending) return <Loading rows={8} />;
  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <Notice
        tone="warning"
        title={missing ? '找不到这个客户组织' : '组织详情没有加载出来'}
        text={missing ? '可能链接不完整。请回到客户组织列表重新打开。' : detail.error.message}
        action={
          missing ? (
            <Link to="/operator/organizations">回到客户组织</Link>
          ) : (
            <Button onClick={() => void detail.refetch()}>重新加载</Button>
          )
        }
      />
    );
  }
  const org = detail.data;

  const sent = (r: SentInvitation) => {
    const simulated = r.mailSimulated ? '（预览环境未真实发送邮件）' : '';
    if (r.mailSent) message.success(`邀请已发到 ${r.email}，旧链接已作废${simulated}`);
    else message.warning('新邀请已记下，但邮件没发出去。请稍后再点「重新发送邀请」');
  };
  const resend = () => {
    const latest = adminState(org).latest;
    if (!latest) return;
    modal.confirm({
      title: `重新发送邀请给 ${latest.name}？`,
      content: `新邀请发到 ${latest.email}，之前的链接会作废。`,
      okText: '重新发送',
      cancelText: '取消',
      onOk: () =>
        invite
          .mutateAsync({ name: latest.name, phone: latest.phone ?? '', email: latest.email })
          .then(sent)
          .catch((err: Error) => message.error(err.message)),
    });
  };

  const active = org.state !== 'pending';
  const subtitle = [
    ORG_SERVICE_STATES[org.state],
    org.region,
    org.activatedAt ? `${fullDate(org.activatedAt)} 开通` : `${monthDay(org.createdAt)} 登记`,
    active ? `${org.enterprises.length} 家企业、${org.members.length} 名成员` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const log = logOf(org);

  const invitationCard = (
    <InvitationCard
      org={org}
      onOpen={() => setOpening(true)}
      onResend={resend}
      onReplace={() => setReplacing(true)}
      resending={invite.isPending}
    />
  );
  const overview = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <OrgProfileCard org={org} onEdit={() => setEditing(true)} />
        <PeopleCard org={org} limit={5} onAll={() => setTab('people')} />
        <EnterprisesCard org={org} />
      </div>
      <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <ServiceCard org={org} onRecords={active ? () => setTab('service') : undefined} />
        {invitationCard}
        <SideCard
          title="操作记录"
          extra={
            log.length > 3 && (
              <button type="button" style={linkButton} onClick={() => setTab('log')}>
                全部
              </button>
            )
          }
        >
          <LogList entries={log.slice(0, 3)} />
        </SideCard>
      </div>
    </div>
  );

  const narrow = (children: ReactNode) => (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 24 }}>{children}</div>
  );

  const inviteHistory = (
    <ListCard title="邀请记录" note="每次重发或更换管理员，旧链接都会作废">
      {org.invitations.length === 0 ? (
        <p style={{ ...small, padding: '16px 24px', margin: 0 }}>还没有发过邀请。</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '4px 24px' }}>
          {org.invitations.map((i, n) => (
            <li
              key={i.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 0',
                borderBottom: n < org.invitations.length - 1 ? `1px solid ${gy.split}` : undefined,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={body}>
                  {i.name} · {i.email}
                </span>
                <span style={small}>
                  {i.role === 'customer_admin' ? '首位管理员' : '成员'} · {i.invitedByName} {monthDay(i.createdAt)} 发出 ·{' '}
                  {monthDay(i.expiresAt)} 前有效
                </span>
              </div>
              <Pill tone={INVITE_STATE[i.state].tone}>{INVITE_STATE[i.state].label}</Pill>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );

  const content: Record<TabKey, ReactNode> = {
    overview,
    people: narrow(<PeopleCard org={org} />),
    service: narrow(
      <>
        <ServiceCard org={org} />
        {active && <ContractCard org={org} />}
      </>,
    ),
    invitations: narrow(
      <>
        {invitationCard}
        {inviteHistory}
      </>,
    ),
    log: narrow(
      <SideCard title="操作记录">
        <LogList entries={log} />
      </SideCard>,
    ),
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <nav aria-label="位置" style={small}>
            耕云运营 / <Link to="/operator/organizations" style={{ color: gy.secondary }}>客户组织</Link> / {org.name}
          </nav>
          <Typography.Title level={1} style={{ fontSize: 28, lineHeight: '40px', fontWeight: 500, margin: 0 }}>
            {org.name}
          </Typography.Title>
          <span style={{ ...body, color: gy.secondary }}>{subtitle}</span>
        </div>
        <Button onClick={() => setEditing(true)}>编辑组织资料</Button>
      </div>
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabBarGutter={32}
        tabBarStyle={{ marginBottom: 24 }}
        items={(
          [
            ['overview', '概览'],
            ['people', '联系人与成员'],
            ['service', '年度服务'],
            ['invitations', '开通与邀请'],
            ['log', '操作记录'],
          ] as const
        ).map(([key, label]) => ({ key, label, children: content[key] }))}
      />
      <RegisterOrgModal orgId={org.id} open={editing} onClose={() => setEditing(false)} />
      {opening && <OpenOrgModal orgId={org.id} onClose={() => setOpening(false)} />}
      {replacing && <ReplaceAdminModal org={org} onClose={() => setReplacing(false)} onSent={sent} />}
    </>
  );
}
