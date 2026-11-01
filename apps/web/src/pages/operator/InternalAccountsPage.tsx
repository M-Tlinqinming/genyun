import { SearchOutlined } from '@ant-design/icons';
import {
  chinaToday,
  INTERNAL_ROLE_DUTIES,
  INTERNAL_ROLE_LABELS,
  INTERNAL_ROLE_SCOPES,
  INTERNAL_ROLES,
  internalInviteSchema,
  type InternalAccount,
  type InternalInvitation,
  type InternalRole,
} from '@genyun/shared';
import { App, Button, Form, Input, Modal, Radio, Select } from 'antd';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  useChangeRole,
  useDisableAccount,
  useEnableAccount,
  useInternalAccounts,
  useInviteInternal,
  useResendInternalInvitation,
} from '../../api/accounts';
import { ApiError } from '../../api/request';
import { PageHeader } from '../../components/PageHeader';
import { linkButton, Loading, Notice, panel, requiredAfter } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';

// 内部账号与权限（Paper 16 页 I06）：耕云员工（运营管理员、注安师）的账号、角色和可见范围。
// 邀请走邮件；停用后不能登录、已登录的地方退出、不出现在分派名单。不能停用自己

type RoleFilter = 'all' | InternalRole;
type StateFilter = 'all' | 'active' | 'disabled' | 'invited';

const body: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };
const muted: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.secondary };
const small: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary };
const COLS = { member: 260, role: 140, open: 110, state: 110, login: 120, action: 120 } as const;

// 「今天 08:42」「10.21 17:30」（北京时间）
function loginLabel(iso: string | null): string {
  if (!iso) return '从未登录';
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
  return chinaToday(new Date(iso)) === chinaToday() ? `今天 ${time}` : `${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${time}`;
}

function Tag({ tone, children }: { tone: { color: string; bg: string }; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-block', padding: '0 8px', borderRadius: 4, fontSize: 12, lineHeight: '22px', color: tone.color, background: tone.bg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Avatar({ name, self, off }: { name: string; self?: boolean; off?: boolean }) {
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
        lineHeight: '32px',
        background: self ? gy.selected : '#F2F4F7',
        color: self ? gy.primary : off ? '#A0A6B1' : gy.secondary,
      }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

function Row({ children, last }: { children: ReactNode; last: boolean }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', height: 64, padding: '0 24px', borderBottom: last ? 'none' : `1px solid ${gy.split}` }}>
      {children}
    </li>
  );
}

function Member({ name, email, self, off }: { name: string; email: string; self?: boolean; off?: boolean }) {
  const color = off ? gy.tertiary : undefined;
  return (
    <span style={{ width: COLS.member, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, paddingRight: 12 }}>
      <Avatar name={name} self={self} off={off} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ ...body, color: color ?? gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
          {self ? '（我）' : ''}
        </span>
        <span style={{ ...small, color: color ?? gy.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
      </span>
    </span>
  );
}

function AccountRow({
  account: a,
  last,
  onEdit,
  onDisable,
  onEnable,
}: {
  account: InternalAccount;
  last: boolean;
  onEdit: () => void;
  onDisable: () => void;
  onEnable: () => void;
}) {
  const off = a.disabledAt !== null;
  const dim = off ? gy.tertiary : undefined;
  return (
    <Row last={last}>
      <Member name={a.name} email={a.email} self={a.self} off={off} />
      <span style={{ ...body, color: dim ?? gy.text, width: COLS.role, flexShrink: 0 }}>{INTERNAL_ROLE_LABELS[a.role]}</span>
      <span style={{ ...muted, color: dim ?? gy.secondary, flex: '1 1 0', minWidth: 0 }}>
        {off ? '已停用，不能登录' : INTERNAL_ROLE_SCOPES[a.role]}
      </span>
      <span style={{ ...body, width: COLS.open, flexShrink: 0, color: dim ?? (a.role === 'operator' || a.openTasks === 0 ? gy.secondary : gy.text) }}>
        {a.role === 'operator' ? '—' : a.openTasks}
      </span>
      <span style={{ width: COLS.state, flexShrink: 0 }}>
        {off ? <Tag tone={{ color: gy.secondary, bg: gy.neutralBg }}>已停用</Tag> : <Tag tone={stage.done}>正常</Tag>}
      </span>
      <span style={{ ...muted, color: dim ?? gy.secondary, width: COLS.login, flexShrink: 0 }}>{loginLabel(a.lastLoginAt)}</span>
      <span style={{ width: COLS.action, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        {a.self ? (
          <span style={{ ...body, color: gy.tertiary }} aria-label="不能修改自己的账号">
            —
          </span>
        ) : off ? (
          <button type="button" style={linkButton} onClick={onEnable} aria-label={`恢复${a.name}的账号`}>
            恢复
          </button>
        ) : (
          <>
            <button type="button" style={linkButton} onClick={onEdit} aria-label={`编辑${a.name}的角色`}>
              编辑
            </button>
            <span style={{ ...body, color: gy.primary }} aria-hidden>
              ·
            </span>
            <button type="button" style={linkButton} onClick={onDisable} aria-label={`停用${a.name}的账号`}>
              停用
            </button>
          </>
        )}
      </span>
    </Row>
  );
}

function InvitationRow({ invitation: i, last, onResend, sending }: { invitation: InternalInvitation; last: boolean; onResend: () => void; sending: boolean }) {
  const expired = i.state === 'expired';
  return (
    <Row last={last}>
      <Member name={i.name} email={i.email} />
      <span style={{ ...body, width: COLS.role, flexShrink: 0 }}>{INTERNAL_ROLE_LABELS[i.role]}</span>
      <span style={{ ...muted, flex: '1 1 0', minWidth: 0 }}>
        {expired ? '邀请已过期，对方还没有加入' : `${i.invitedByName}已发邀请邮件，等对方设置密码加入`}
      </span>
      <span style={{ ...muted, width: COLS.open, flexShrink: 0 }}>—</span>
      <span style={{ width: COLS.state, flexShrink: 0 }}>
        <Tag tone={expired ? stage.action : stage.progress}>{expired ? '邀请已过期' : '待接受'}</Tag>
      </span>
      <span style={{ ...muted, width: COLS.login, flexShrink: 0 }}>从未登录</span>
      <span style={{ width: COLS.action, flexShrink: 0 }}>
        <button type="button" style={{ ...linkButton, opacity: sending ? 0.5 : 1 }} disabled={sending} onClick={onResend} aria-label={`重新发送给${i.email}的邀请`}>
          重新发送
        </button>
      </span>
    </Row>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ name: string; email: string; role: InternalRole }>();
  const invite = useInviteInternal();
  const { message } = App.useApp();
  const submit = async () => {
    const values = await form.validateFields();
    const parsed = internalInviteSchema.safeParse(values);
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
      title="邀请内部成员"
      okText="发送邀请"
      cancelText="取消"
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={invite.isPending}
      afterClose={() => form.resetFields()}
      destroyOnHidden
      width={520}
    >
      <p style={{ ...muted, margin: '0 0 16px' }}>对方会收到邀请邮件，7 天内设置密码即可加入耕云内部工作台。</p>
      <Form form={form} layout="vertical" requiredMark={requiredAfter} initialValues={{ role: 'expert' }}>
        <Form.Item label="姓名" name="name" rules={[{ required: true, whitespace: true, message: '请填写姓名' }]}>
          <Input maxLength={50} placeholder="例如：孙工" />
        </Form.Item>
        <Form.Item label="邮箱" name="email" rules={[{ required: true, whitespace: true, message: '请填写邮箱' }]}>
          <Input placeholder="name@genyun.net.cn" />
        </Form.Item>
        <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]} extra="注安师只看到分配给本人的任务；运营管理员看到全部客户组织。">
          <Radio.Group options={INTERNAL_ROLES.map((r) => ({ value: r, label: INTERNAL_ROLE_LABELS[r] }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function RoleModal({ account, onClose }: { account: InternalAccount | null; onClose: () => void }) {
  const [role, setRole] = useState<InternalRole | null>(null);
  const change = useChangeRole();
  const { message } = App.useApp();
  const current = role ?? account?.role ?? 'expert';
  const busy = account !== null && account.openTasks > 0;
  const submit = async () => {
    if (!account) return;
    if (current === account.role) return onClose();
    try {
      await change.mutateAsync({ id: account.id, role: current });
      message.success(`${account.name}已改为${INTERNAL_ROLE_LABELS[current]}`);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有改成，请再试一次');
    }
  };
  return (
    <Modal
      open={account !== null}
      title={account ? `编辑 ${account.name}` : ''}
      okText="保存"
      cancelText="取消"
      onOk={() => void submit()}
      onCancel={onClose}
      afterClose={() => setRole(null)}
      confirmLoading={change.isPending}
      okButtonProps={{ disabled: busy }}
      width={520}
    >
      {account && (
        <>
          <p style={{ ...muted, margin: '0 0 16px' }}>{account.email}</p>
          <div style={{ ...body, marginBottom: 8 }} id="role-label">
            角色
          </div>
          <Radio.Group
            aria-labelledby="role-label"
            value={current}
            disabled={busy}
            onChange={(e) => setRole(e.target.value as InternalRole)}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {INTERNAL_ROLES.map((r) => (
              <Radio key={r} value={r}>
                <span style={body}>{INTERNAL_ROLE_LABELS[r]}</span>
                <span style={{ ...small, display: 'block' }}>可见范围：{INTERNAL_ROLE_SCOPES[r]}</span>
              </Radio>
            ))}
          </Radio.Group>
          {busy && (
            <p style={{ ...small, color: gy.warning, margin: '16px 0 0' }}>
              {account.name}还有 {account.openTasks} 个在办任务，请先在<Link to="/operator/tasks">任务中心</Link>改派给其他注安师，再改角色。
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

export function InternalAccountsPage() {
  const view = useInternalAccounts();
  const disable = useDisableAccount();
  const enable = useEnableAccount();
  const resend = useResendInternalInvitation();
  const { message, modal } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<InternalAccount | null>(null);

  const accounts = useMemo(() => view.data?.accounts ?? [], [view.data]);
  const invitations = useMemo(() => view.data?.invitations ?? [], [view.data]);
  const k = keyword.trim().toLowerCase();
  const match = (x: { name: string; email: string; role: InternalRole }) =>
    (!k || x.name.toLowerCase().includes(k) || x.email.toLowerCase().includes(k)) && (roleFilter === 'all' || x.role === roleFilter);
  const shownAccounts = accounts.filter(
    (a) => match(a) && (stateFilter === 'all' || (stateFilter === 'active' ? !a.disabledAt : stateFilter === 'disabled' ? a.disabledAt : false)),
  );
  const shownInvitations = invitations.filter((i) => match(i) && (stateFilter === 'all' || stateFilter === 'invited'));
  const total = shownAccounts.length + shownInvitations.length;

  const askDisable = (a: InternalAccount) => {
    if (a.openTasks > 0) {
      modal.warning({
        title: `${a.name}还有 ${a.openTasks} 个在办任务`,
        content: '停用前请先在任务中心把这些任务改派给其他注安师，不然客户的任务没人跟进。',
        okText: '知道了',
      });
      return;
    }
    modal.confirm({
      title: `停用 ${a.name} 的账号？`,
      content: '停用后不能登录，已经登录的地方会立即退出，也不会再被分派任务。以后可以恢复。',
      okText: '停用',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await disable.mutateAsync(a.id);
          message.success(`${a.name}的账号已停用`);
        } catch (err) {
          message.error(err instanceof Error ? err.message : '没有停用成功，请再试一次');
        }
      },
    });
  };
  const askEnable = (a: InternalAccount) =>
    modal.confirm({
      title: `恢复 ${a.name} 的账号？`,
      content: '恢复后可以用原来的密码登录。',
      okText: '恢复',
      cancelText: '取消',
      onOk: async () => {
        try {
          await enable.mutateAsync(a.id);
          message.success(`${a.name}的账号已恢复`);
        } catch (err) {
          message.error(err instanceof Error ? err.message : '没有恢复成功，请再试一次');
        }
      },
    });
  const doResend = async (i: InternalInvitation) => {
    try {
      const sent = await resend.mutateAsync(i.id);
      message.success(sent.simulated ? `邀请已重新放进模拟发件箱（${sent.email}）` : `已重新发送邀请邮件给 ${sent.email}，旧链接作废`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有发出，请再试一次');
    }
  };

  const header = (
    <PageHeader
      eyebrow="耕云运营 / 内部账号"
      title="内部账号与权限"
      description="耕云员工的账号、角色和可见客户范围。注安师只看到分配给自己的任务。"
      extra={
        <Button type="primary" onClick={() => setInviting(true)}>
          邀请内部成员
        </Button>
      }
    />
  );
  if (view.isPending) {
    return (
      <>
        {header}
        <Loading rows={6} />
      </>
    );
  }
  if (view.isError) {
    return (
      <>
        {header}
        <Notice tone="warning" title="内部账号暂时打不开" text={view.error.message} action={<Button onClick={() => void view.refetch()}>重新加载</Button>} />
      </>
    );
  }

  const th: CSSProperties = { ...body, fontWeight: 500, flexShrink: 0 };
  return (
    <>
      {header}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: -8 }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {(['operator', 'expert'] as const).map((r) => {
            const people = accounts.filter((a) => a.role === r);
            const off = people.filter((a) => a.disabledAt).length;
            return (
              <section key={r} aria-label={INTERNAL_ROLE_LABELS[r]} style={{ ...panel, flex: '1 1 0', minWidth: 0, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text, margin: 0 }}>{INTERNAL_ROLE_LABELS[r]}</h2>
                  <span style={small}>
                    {people.length} 人{off > 0 ? ` · ${off} 人已停用` : ''}
                  </span>
                </div>
                <p style={{ ...muted, margin: 0 }}>{INTERNAL_ROLE_DUTIES[r]}</p>
              </section>
            );
          })}
        </div>

        <section aria-label="内部成员" style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px' }}>
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: '#8B929F' }} />}
              placeholder="姓名 / 邮箱"
              aria-label="按姓名或邮箱查找"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 360 }}
            />
            <Select<RoleFilter>
              aria-label="角色"
              value={roleFilter}
              onChange={setRoleFilter}
              style={{ width: 160 }}
              options={[{ value: 'all', label: '全部角色' }, ...INTERNAL_ROLES.map((r) => ({ value: r, label: INTERNAL_ROLE_LABELS[r] }))]}
            />
            <Select<StateFilter>
              aria-label="状态"
              value={stateFilter}
              onChange={setStateFilter}
              style={{ width: 160 }}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'active', label: '正常' },
                { value: 'disabled', label: '已停用' },
                { value: 'invited', label: '已邀请未加入' },
              ]}
            />
          </div>
          <div
            role="presentation"
            style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 24px', background: '#FAFAFB', borderTop: `1px solid ${gy.split}`, borderBottom: `1px solid ${gy.split}` }}
          >
            <span style={{ ...th, width: COLS.member }}>成员</span>
            <span style={{ ...th, width: COLS.role }}>角色</span>
            <span style={{ ...th, flex: '1 1 0', flexShrink: 1 }}>可见范围</span>
            <span style={{ ...th, width: COLS.open }}>在办任务</span>
            <span style={{ ...th, width: COLS.state }}>状态</span>
            <span style={{ ...th, width: COLS.login }}>最近登录</span>
            <span style={{ ...th, width: COLS.action }}>操作</span>
          </div>
          {total === 0 ? (
            <p style={{ ...muted, margin: 0, padding: '32px 24px', textAlign: 'center' }}>没有符合条件的成员。</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {shownAccounts.map((a, i) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  last={i === total - 1}
                  onEdit={() => setEditing(a)}
                  onDisable={() => askDisable(a)}
                  onEnable={() => askEnable(a)}
                />
              ))}
              {shownInvitations.map((inv, i) => (
                <InvitationRow
                  key={inv.id}
                  invitation={inv}
                  last={shownAccounts.length + i === total - 1}
                  sending={resend.isPending && resend.variables === inv.id}
                  onResend={() => void doResend(inv)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
      <InviteModal open={inviting} onClose={() => setInviting(false)} />
      <RoleModal account={editing} onClose={() => setEditing(null)} />
    </>
  );
}
