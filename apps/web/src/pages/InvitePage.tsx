import { acceptInvitationSchema, passwordChecks, passwordProblem, ROLES, type AcceptInvitationInput } from '@genyun/shared';
import { Alert, Button, Checkbox, Form, Input } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAcceptInvitation, useInvitation, useRequestResend, type InvitationView } from '../api/invitations';
import { ApiError } from '../api/request';
import { AccountShell, accountCard } from '../components/AccountShell';
import { Loading, requiredAfter } from '../components/ui';
import { gy } from '../theme/tokens';
import { homeOf } from './LoginPage';

// 卡片：A02 圆角 10、内边距 36、各块间距 20
const card: CSSProperties = { ...accountCard, borderRadius: 10, padding: 36, display: 'flex', flexDirection: 'column', gap: 20 };
const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const text12: CSSProperties = { fontSize: 12, lineHeight: '20px' };

// MM.DD HH:mm（北京时间）
function shortTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('month')}.${p('day')} ${p('hour')}:${p('minute')}`;
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h1 style={{ margin: 0, fontSize: 22, lineHeight: '34px', fontWeight: 500, color: gy.text }}>{title}</h1>
      <div style={{ ...text14, color: gy.secondary }}>{children}</div>
    </div>
  );
}

// 两端对齐的信息行：有效期内是浅蓝底，失效后是浅灰底带边框
function InfoBox({ rows, muted = false }: { rows: [string, string][]; muted?: boolean }) {
  return (
    <dl
      style={{
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 16px',
        borderRadius: 6,
        background: muted ? '#FAFAFB' : gy.selected,
        border: muted ? `1px solid ${gy.split}` : undefined,
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, ...text14 }}>
          <dt style={{ color: gy.secondary }}>{label}</dt>
          <dd style={{ margin: 0, color: gy.text, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ClockBadge() {
  return (
    <div
      aria-hidden
      style={{ width: 48, height: 48, borderRadius: 24, background: gy.warningBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="none" stroke={gy.warning} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M12 7V12L15 14" fill="none" stroke={gy.warning} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// A02 接受邀请：邮件链接打开，设姓名和密码后直接进入工作空间；过期、已使用、已作废、找不到各有说明
export function InvitePage() {
  const { token = '' } = useParams();
  const invitation = useInvitation(token);

  let content: ReactNode;
  if (invitation.isPending) content = <Loading />;
  else if (invitation.error) content = <Unavailable notFound={invitation.error instanceof ApiError && invitation.error.status === 404} />;
  else {
    const inv = invitation.data;
    content =
      inv.state === 'valid' ? (
        <AcceptForm token={token} inv={inv} />
      ) : inv.state === 'expired' ? (
        <Expired token={token} inv={inv} />
      ) : (
        <Used inv={inv} />
      );
  }
  const form = invitation.data?.state === 'valid';
  return (
    <AccountShell cardTop={form ? 60 : 108}>
      <section style={card}>{content}</section>
    </AccountShell>
  );
}

function AcceptForm({ token, inv }: { token: string; inv: InvitationView }) {
  const accept = useAcceptInvitation(token);
  const navigate = useNavigate();
  const [form] = Form.useForm<AcceptInvitationInput>();
  const password = Form.useWatch('password', form) ?? '';

  const onFinish = (values: AcceptInvitationInput) => {
    accept.mutate(values, { onSuccess: (user) => navigate(homeOf(user), { replace: true }) });
  };

  return (
    <>
      <Heading title={`加入${inv.orgName}`}>{inv.inviterName}邀请您加入耕云工作空间。</Heading>
      <InfoBox
        rows={[
          ['身份', ROLES[inv.role].label],
          ['可见企业', inv.role === 'customer_admin' ? '全部企业' : '由管理员分配'],
          ['邀请有效期', `至 ${shortTime(inv.expiresAt)}`],
        ]}
      />
      <Form<AcceptInvitationInput>
        form={form}
        layout="vertical"
        requiredMark={requiredAfter}
        initialValues={{ name: inv.name ?? '', password: '', agreed: false }}
        onFinish={onFinish}
        className="gy-form-explain-gap"
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <Form.Item label="邮箱" htmlFor="invite-email" style={{ marginBottom: 0 }}>
          <Input id="invite-email" size="large" value={inv.email} disabled />
        </Form.Item>
        <Form.Item name="name" label="姓名" required rules={[{ validator: (_, v) => check('name', v) }]} style={{ marginBottom: 0 }}>
          <Input size="large" placeholder="请输入真实姓名" autoComplete="name" maxLength={50} />
        </Form.Item>
        <Form.Item label="设置密码" htmlFor="invite-password" required style={{ marginBottom: 0 }}>
          <Form.Item
            name="password"
            noStyle
            rules={[{ validator: (_, v: string) => (passwordProblem(v ?? '', inv.email) ? Promise.reject(new Error(passwordProblem(v ?? '', inv.email)!)) : Promise.resolve()) }]}
          >
            <Input.Password id="invite-password" size="large" placeholder="设置登录密码" autoComplete="new-password" />
          </Form.Item>
          <ul aria-label="密码要求" style={{ display: 'flex', gap: 16, margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
            {passwordChecks(password, inv.email).map((c) => (
              <li key={c.label} style={{ ...text12, color: c.ok ? gy.success : gy.tertiary }}>
                {c.ok ? `✓ ${c.label}` : c.label}
              </li>
            ))}
          </ul>
        </Form.Item>
        <Form.Item name="agreed" valuePropName="checked" rules={[{ validator: (_, v) => check('agreed', v) }]} style={{ marginBottom: 0 }}>
          <Checkbox style={{ ...text12, color: gy.secondary }}>我已阅读并同意《服务协议》和《隐私政策》</Checkbox>
        </Form.Item>
        {accept.error && <Alert type="error" showIcon title={accept.error.message} />}
        <Button type="primary" size="large" htmlType="submit" block loading={accept.isPending}>
          接受邀请并进入
        </Button>
      </Form>
      <div style={{ height: 1, background: gy.split }} />
      <div style={{ ...text12, color: gy.secondary }}>不认识这个机构？忽略这封邀请即可，链接过期后会自动失效。</div>
    </>
  );
}

function Expired({ token, inv }: { token: string; inv: InvitationView }) {
  const resend = useRequestResend(token);
  return (
    <>
      <ClockBadge />
      <Heading title="邀请链接已过期">
        这封邀请已于 {shortTime(inv.expiresAt)} 失效。可以请邀请人重新发送，新邀请会发到同一个邮箱。
      </Heading>
      <InfoBox
        muted
        rows={[
          ['机构', inv.orgName],
          ['邀请人', inv.inviterName],
          ['受邀邮箱', inv.email],
        ]}
      />
      {resend.isSuccess ? (
        <Alert type="success" showIcon title={`已通知${inv.inviterName}。重新发送后，新邀请会发到 ${inv.email}`} />
      ) : (
        <>
          {resend.error && <Alert type="error" showIcon title={resend.error.message} />}
          <Button type="primary" size="large" block loading={resend.isPending} onClick={() => resend.mutate()}>
            请{inv.inviterName}重新发送
          </Button>
        </>
      )}
      <Button size="large" block href="/login">
        已有账号，去登录
      </Button>
    </>
  );
}

// 已使用、已作废（10 页 A02 设计注释）
function Used({ inv }: { inv: InvitationView }) {
  const accepted = inv.state === 'accepted';
  return (
    <>
      <Heading title={accepted ? '邀请已使用' : '邀请已作废'}>
        {accepted
          ? `这封邀请已经用过了。请用 ${inv.email} 登录。`
          : `这封邀请已被撤销，不能再用来注册。如需加入${inv.orgName}，请联系机构管理员。`}
      </Heading>
      <Button type="primary" size="large" block href="/login">
        去登录
      </Button>
    </>
  );
}

function Unavailable({ notFound }: { notFound: boolean }) {
  return (
    <>
      <Heading title={notFound ? '找不到这封邀请' : '暂时打不开这封邀请'}>
        {notFound ? '请检查链接是否完整复制。如果还是打不开，请联系邀请人重新发送。' : '请刷新页面重试。'}
      </Heading>
      <Button type="primary" size="large" block href="/login">
        去登录
      </Button>
    </>
  );
}

// 用共享的校验规则（与后端同一份）检查单个字段
function check(field: 'name' | 'agreed', value: unknown): Promise<void> {
  const result = acceptInvitationSchema.shape[field].safeParse(value);
  return result.success ? Promise.resolve() : Promise.reject(new Error(result.error.issues[0]?.message));
}
