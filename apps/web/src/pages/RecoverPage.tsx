import { LeftOutlined, MailOutlined } from '@ant-design/icons';
import {
  newPasswordSchema,
  RECOVERY_CODE_TTL_MINUTES,
  RECOVERY_RESEND_SECONDS,
  recoverySendSchema,
} from '@genyun/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Divider, Form, Input, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { authApi } from '../auth/api';
import { useSession } from '../auth/session';
import { AuthShell } from '../components/AuthShell';
import { gy } from '../theme/tokens';
import { homeOf } from './LoginPage';

interface ResetForm {
  code: string;
  password: string;
  confirm: string;
}

// 只显示邮箱前两位，例如 wa****@example.cn
function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 2)}****@${domain}`;
}

// A03 账号恢复｜邮箱验证码重设密码。两步：确认邮箱 → 验证并设置新密码
export function RecoverPage() {
  const session = useSession();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [email, setEmail] = useState<string>();
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  const send = useMutation({
    mutationFn: (to: string) => authApi.sendRecoveryCode({ email: to }),
    onSuccess: (_, to) => {
      setEmail(to);
      setSentAt(Date.now());
      setNow(Date.now());
    },
  });
  const reset = useMutation({
    mutationFn: (values: ResetForm) => authApi.resetPassword({ email: email!, code: values.code, password: values.password }),
    onSuccess: (user) => {
      client.setQueryData(['session'], user);
      navigate(homeOf(user), { replace: true });
    },
  });

  // 重新发送的倒计时
  const wait = Math.max(0, RECOVERY_RESEND_SECONDS - Math.floor((now - sentAt) / 1000));
  useEffect(() => {
    if (!email || wait === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [email, wait]);

  if (session.data && !reset.isSuccess) return <Navigate to={homeOf(session.data)} replace />;

  const step = email ? 2 : 1;

  return (
    <AuthShell>
      <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: gy.secondary, fontSize: 14 }}>
        <LeftOutlined style={{ fontSize: 12 }} />
        返回登录
      </Link>

      <Typography.Title level={2} style={{ fontSize: 22, lineHeight: '34px', fontWeight: 500, margin: '20px 0 0' }}>
        重设密码
      </Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }} aria-live="polite">
        {email
          ? `如果 ${maskEmail(email)} 是耕云账号，验证码已发到这个邮箱，${RECOVERY_CODE_TTL_MINUTES} 分钟内有效。`
          : '输入登录邮箱，我们会发一个 6 位验证码。'}
      </Typography.Text>

      <Steps step={step} />

      {step === 1 ? (
        <Form<{ email: string }>
          layout="vertical"
          requiredMark={false}
          onFinish={(v) => send.mutate(v.email.trim())}
        >
          <Form.Item
            label="登录邮箱"
            name="email"
            rules={[{ validator: (_, v) => check(recoverySendSchema.shape.email, v) }]}
            style={{ marginBottom: 20 }}
          >
            <Input size="large" prefix={<MailOutlined />} placeholder="请输入登录邮箱" autoComplete="email" autoFocus />
          </Form.Item>
          {send.error && <Alert type="error" showIcon title={send.error.message} style={{ marginBottom: 16 }} />}
          <Button type="primary" size="large" htmlType="submit" block loading={send.isPending}>
            发送验证码
          </Button>
        </Form>
      ) : (
        <Form<ResetForm>
          layout="vertical"
          requiredMark={(label, { required }) => (
            <>
              {label}
              {required && <span style={{ marginLeft: 4 }}>*</span>}
            </>
          )}
          onFinish={(v) => reset.mutate(v)}
        >
          <Form.Item
            label="验证码"
            name="code"
            required
            rules={[{ validator: (_, v: string | undefined) => (v && /^\d{6}$/.test(v) ? Promise.resolve() : Promise.reject(new Error('请输入 6 位验证码'))) }]}
            extra={
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, lineHeight: '20px', marginTop: 8 }}>
                <span style={{ color: gy.secondary }}>没收到？请检查垃圾邮件</span>
                {wait > 0 ? (
                  <span style={{ color: gy.tertiary }}>{wait} 秒后可重新发送</span>
                ) : (
                  <Button type="link" size="small" style={{ padding: 0, height: 20, fontSize: 12 }} loading={send.isPending} onClick={() => send.mutate(email!)}>
                    重新发送
                  </Button>
                )}
              </span>
            }
            style={{ marginBottom: 20 }}
          >
            <Input.OTP
              length={6}
              size="large"
              autoFocus
              autoComplete="one-time-code"
              formatter={(v) => v.replace(/\D/g, '')}
              aria-label="6 位验证码"
              styles={{ root: { width: '100%', gap: 8 }, input: { flex: 1, height: 44, fontSize: 20 } }}
            />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="password"
            required
            rules={[{ validator: (_, v) => check(newPasswordSchema, v) }]}
            style={{ marginBottom: 20 }}
          >
            <Input.Password size="large" placeholder="至少 8 位，含字母和数字" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="再次输入"
            name="confirm"
            required
            dependencies={['password']}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_, v) =>
                  !v
                    ? Promise.reject(new Error('请再次输入新密码'))
                    : v === getFieldValue('password')
                      ? Promise.resolve()
                      : Promise.reject(new Error('两次输入的密码不一样')),
              }),
            ]}
            style={{ marginBottom: 20 }}
          >
            <Input.Password size="large" placeholder="再次输入新密码" autoComplete="new-password" />
          </Form.Item>
          {(reset.error || send.error) && (
            <Alert type="error" showIcon title={(reset.error ?? send.error)!.message} style={{ marginBottom: 16 }} />
          )}
          <Button type="primary" size="large" htmlType="submit" block loading={reset.isPending}>
            重设并登录
          </Button>
        </Form>
      )}

      <Divider style={{ margin: '20px 0' }} />
      <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: '20px', display: 'block' }}>
        邮箱已无法使用？客户请联系本机构管理员，耕云员工请联系运营管理员更换登录邮箱。
      </Typography.Text>
    </AuthShell>
  );
}

function Steps({ step }: { step: 1 | 2 }) {
  const dot = (n: number, label: string) => {
    const done = step > n;
    const active = step === n;
    const color = done ? gy.success : active ? gy.primary : gy.tertiary;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }} aria-current={active ? 'step' : undefined}>
        <span
          style={{
            width: 20,
            height: 20,
            boxSizing: 'border-box',
            borderRadius: 10,
            border: active ? 'none' : `1px solid ${color}`,
            background: active ? gy.primary : 'transparent',
            color: active ? '#fff' : color,
            fontSize: 12,
            lineHeight: active ? '20px' : '18px',
            textAlign: 'center',
          }}
        >
          {n}
        </span>
        <span style={{ fontSize: 12, lineHeight: '20px', color }}>{label}</span>
      </span>
    );
  };
  return (
    <ol
      aria-label="重设密码步骤"
      style={{ display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', padding: 0, margin: '20px 0 20px' }}
    >
      <li>{dot(1, '确认邮箱')}</li>
      <li aria-hidden style={{ flex: 1, height: 1, background: step > 1 ? gy.success : gy.split }} />
      <li>{dot(2, '验证并设置新密码')}</li>
    </ol>
  );
}

function check(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } }, value: unknown) {
  const r = schema.safeParse(value ?? '');
  return r.success ? Promise.resolve() : Promise.reject(new Error(r.error?.issues[0]?.message));
}
