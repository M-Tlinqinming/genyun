import { accountNameSchema, changePasswordSchema, ROLES, workspaceOf } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Modal, Spin } from 'antd';
import dayjs from 'dayjs';
import { useState, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { accountApi, type SessionUser } from '../auth/api';
import { useSession } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { WorkspaceLayout } from '../layouts/WorkspaceLayout';
import { gy } from '../theme/tokens';

const ACCOUNT_KEY = ['account'];

// /account 不属于某个工作区：套用登录人第一个身份所在工作区的框架
export function AccountShell() {
  const session = useSession();
  if (session.isPending) return <Spin fullscreen />;
  const first = session.data?.memberships[0];
  if (!first) return <Navigate to="/login" replace />;
  return <WorkspaceLayout workspace={workspaceOf(first.role)} />;
}

const SECTIONS = [
  { id: 'profile', label: '基本资料' },
  { id: 'security', label: '登录与安全' },
] as const;

// A04 个人账户｜资料与安全。只改登录人自己的账号；手机号属于企业人员资料，不在这里（见 DESIGN-DIFF）
export function AccountPage() {
  const session = useSession();
  const account = useQuery({ queryKey: ACCOUNT_KEY, queryFn: accountApi.get });
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const user = session.data;
  const isCustomerAdmin = user?.memberships.some((m) => m.role === 'customer_admin');

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <PageHeader
        eyebrow="个人账户"
        title="个人账户"
        description={isCustomerAdmin ? '只影响您自己的登录。机构资料与成员请到「组织管理」。' : '只影响您自己的登录。'}
      />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginTop: -8 }}>
        <nav aria-label="个人账户" style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'sticky', top: 88 }}>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                jump(s.id);
              }}
              aria-current={active === s.id ? 'true' : undefined}
              style={{
                padding: '8px 12px',
                borderLeft: `2px solid ${active === s.id ? gy.primary : gy.split}`,
                color: active === s.id ? gy.primary : gy.text,
                fontSize: 14,
                lineHeight: '22px',
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {account.isPending || !user ? (
            <Spin style={{ padding: 64 }} />
          ) : account.error ? (
            <Alert type="error" showIcon title={account.error.message} />
          ) : (
            <>
              <ProfileCard name={account.data.name} email={account.data.email} user={user} />
              <SecurityCard passwordChangedAt={account.data.passwordChangedAt} otherSessions={account.data.otherSessions} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Card({ id, title, extra, children }: { id: string; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      style={{ background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, scrollMarginTop: 88 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: `1px solid ${gy.split}`,
          minHeight: 57,
          boxSizing: 'border-box',
        }}
      >
        <h2 id={`${id}-title`} style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>
          {title}
        </h2>
        {extra}
      </header>
      <dl style={{ margin: 0, padding: '8px 24px' }}>{children}</dl>
    </section>
  );
}

function Row({ label, children, aside, last, top }: { label: string; children: ReactNode; aside?: ReactNode; last?: boolean; top?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: top ? 'flex-start' : 'center',
        gap: 16,
        padding: '12px 0',
        borderBottom: last ? undefined : `1px solid ${gy.split}`,
        minHeight: 46,
        boxSizing: 'border-box',
      }}
    >
      <dt style={{ width: 160, flexShrink: 0, color: gy.secondary, fontSize: 14, lineHeight: '22px', marginRight: -16 }}>{label}</dt>
      <dd style={{ flex: 1, minWidth: 0, margin: 0, color: gy.text, fontSize: 14, lineHeight: '22px' }}>{children}</dd>
      {aside}
    </div>
  );
}

const hint = { color: gy.tertiary, fontSize: 12, lineHeight: '20px' } as const;

function ProfileCard({ name, email, user }: { name: string; email: string; user: SessionUser }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<{ name: string }>();
  // 耕云员工（专业人员、运营管理员）没有机构管理员可找
  const isStaff = user.memberships.every((m) => !m.role.startsWith('customer'));
  const rename = useMutation({
    mutationFn: accountApi.rename,
    onSuccess: (view) => {
      client.setQueryData(ACCOUNT_KEY, view);
      // 侧栏、顶栏的姓名同步更新
      client.setQueryData<SessionUser | null>(['session'], (s) => (s ? { ...s, name: view.name } : s));
      setEditing(false);
      message.success('姓名已更新');
    },
  });

  return (
    <Card
      id="profile"
      title="基本资料"
      extra={
        editing ? null : (
          <Button
            type="link"
            style={{ padding: 0, height: 22 }}
            onClick={() => {
              form.setFieldsValue({ name });
              rename.reset();
              setEditing(true);
            }}
          >
            编辑
          </Button>
        )
      }
    >
      <Row label="姓名">
        {editing ? (
          <Form form={form} layout="inline" onFinish={(v) => rename.mutate({ name: v.name })} style={{ rowGap: 8 }}>
            <Form.Item
              name="name"
              rules={[{ validator: (_, v) => schemaCheck(accountNameSchema.shape.name, v) }]}
              style={{ marginInlineEnd: 8 }}
              validateStatus={rename.error ? 'error' : undefined}
              help={rename.error?.message}
            >
              <Input aria-label="姓名" autoFocus maxLength={40} style={{ width: 240 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={rename.isPending} style={{ marginInlineEnd: 8 }}>
              保存
            </Button>
            <Button onClick={() => setEditing(false)}>取消</Button>
          </Form>
        ) : (
          name
        )}
      </Row>
      <Row label="登录邮箱" aside={<span style={hint}>{isStaff ? '如需更换，请联系耕云' : '如需更换，请联系机构管理员或耕云'}</span>}>
        {email}
      </Row>
      <Row label="所属机构与身份" last top={user.memberships.length > 1} aside={<span style={hint}>{isStaff ? '身份由耕云调整' : '身份由机构管理员调整'}</span>}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {user.memberships.map((m) => (
            <span key={m.orgId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {m.orgName}
              <span style={{ background: gy.selected, color: gy.primary, borderRadius: 4, padding: '0 8px', fontSize: 12, lineHeight: '22px' }}>
                {ROLES[m.role].label}
              </span>
            </span>
          ))}
        </span>
      </Row>
    </Card>
  );
}

function SecurityCard({ passwordChangedAt, otherSessions }: { passwordChangedAt: string | null; otherSessions: number }) {
  const client = useQueryClient();
  const { message, modal } = App.useApp();
  const [changing, setChanging] = useState(false);
  const signOut = useMutation({
    mutationFn: accountApi.signOutOthers,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ACCOUNT_KEY });
      message.success('已退出其他设备上的登录');
    },
  });

  return (
    <Card id="security" title="登录与安全">
      <Row
        label="密码"
        aside={
          <Button onClick={() => setChanging(true)} style={{ flexShrink: 0 }}>
            修改密码
          </Button>
        }
      >
        {passwordChangedAt ? `上次修改 ${dayjs(passwordChangedAt).format('YYYY.MM.DD')}` : '还没有修改过'}
      </Row>
      <Row label="登录设备" last top>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <span>{otherSessions > 0 ? `除这台设备外，还有 ${otherSessions} 处登录中` : '只有这台设备登录中'}</span>
          {otherSessions > 0 && (
            <Button
              type="link"
              style={{ padding: 0, height: 22 }}
              loading={signOut.isPending}
              onClick={() =>
                modal.confirm({
                  title: '退出其他设备上的登录？',
                  content: '其他设备需要重新登录，这台设备不受影响。',
                  okText: '退出其他设备',
                  cancelText: '取消',
                  // 失败时关掉确认框，错误显示在下面
                  onOk: () => signOut.mutateAsync().catch(() => undefined),
                })
              }
            >
              退出其他设备
            </Button>
          )}
          {signOut.error && <Alert type="error" showIcon title={signOut.error.message} />}
        </span>
      </Row>
      <ChangePasswordModal
        open={changing}
        onClose={() => setChanging(false)}
        onDone={() => {
          setChanging(false);
          void client.invalidateQueries({ queryKey: ACCOUNT_KEY });
          message.success('密码已修改，其他设备上的登录已退出');
        }}
      />
    </Card>
  );
}

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

function ChangePasswordModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm<PasswordForm>();
  const change = useMutation({
    mutationFn: accountApi.changePassword,
    onSuccess: onDone,
    onError: (err) => {
      // 当前密码不对：提示挂在「当前密码」下面，焦点回到这个框
      if (err.message === '当前密码不正确') {
        form.setFields([{ name: 'currentPassword', errors: [err.message] }]);
        form.focusField('currentPassword');
      }
    },
  });
  const otherError = change.error && change.error.message !== '当前密码不正确' ? change.error.message : null;

  return (
    <Modal
      title="修改密码"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="确认修改"
      confirmLoading={change.isPending}
      destroyOnHidden
      afterOpenChange={(o) => {
        if (!o) {
          form.resetFields();
          change.reset();
        }
      }}
    >
      <Form<PasswordForm>
        form={form}
        className="gy-form-gap"
        layout="vertical"
        requiredMark={false}
        onFinish={(v) => change.mutate({ currentPassword: v.currentPassword, newPassword: v.newPassword })}
        style={{ marginTop: 16 }}
      >
        <Form.Item label="当前密码" name="currentPassword" rules={[{ validator: (_, v) => schemaCheck(changePasswordSchema.shape.currentPassword, v) }]}>
          <Input.Password autoComplete="current-password" autoFocus />
        </Form.Item>
        <Form.Item label="新密码" name="newPassword" rules={[{ validator: (_, v) => schemaCheck(changePasswordSchema.shape.newPassword, v) }]}>
          <Input.Password autoComplete="new-password" placeholder="至少 8 位，含字母和数字" />
        </Form.Item>
        <Form.Item
          label="再次输入"
          name="confirm"
          dependencies={['newPassword']}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                !v
                  ? Promise.reject(new Error('请再次输入新密码'))
                  : v === getFieldValue('newPassword')
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一样')),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder="再次输入新密码" />
        </Form.Item>
        <p style={{ color: gy.secondary, fontSize: 12, lineHeight: '20px', margin: 0 }}>修改后，其他设备上的登录会退出，这台设备保持登录。</p>
        {otherError && <Alert type="error" showIcon title={otherError} style={{ marginTop: 16 }} />}
        {/* 弹窗按钮在表单外面，放一个隐藏的提交按钮，输入框里按回车就能提交 */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </Form>
    </Modal>
  );
}

function schemaCheck(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } }, value: unknown) {
  const r = schema.safeParse(value ?? '');
  return r.success ? Promise.resolve() : Promise.reject(new Error(r.error?.issues[0]?.message));
}
