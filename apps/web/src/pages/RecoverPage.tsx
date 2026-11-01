import { LeftOutlined, MailOutlined } from '@ant-design/icons';
import {
  newPasswordSchema,
  RECOVERY_CODE_MAX_ATTEMPTS,
  RECOVERY_CODE_TTL_MINUTES,
  RECOVERY_RESEND_SECONDS,
  recoverySendSchema,
} from '@genyun/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Divider, Form, Input, Typography } from 'antd';
import type { OTPRef } from 'antd/es/input/OTP';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError, authApi } from '../auth/api';
import { useSession } from '../auth/session';
import { AccountShell, accountCard } from '../components/AccountShell';
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

// 发送接口返回的 429 分两种：resend = 60 秒内重复发送，上一封仍然有效，照常进入第 2 步并按剩余秒数倒计时；
// hourly = 一小时内发太多次，留在第 1 步提示。返回 null 表示不是 resend
function resendWait(err: unknown): number | null {
  if (err instanceof ApiError && err.status === 429 && err.body?.reason === 'resend') {
    const s = Number(err.body.retryAfter);
    return Number.isFinite(s) && s > 0 ? Math.ceil(s) : RECOVERY_RESEND_SECONDS;
  }
  return null;
}

// A03 账号恢复｜邮箱验证码重设密码。两步：确认邮箱 → 验证并设置新密码
export function RecoverPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<ResetForm>();
  const otp = useRef<OTPRef>(null);
  // 登录页已经填好的邮箱带过来
  // 「换个邮箱」回到第 1 步时，输入框里保留刚才的邮箱
  const [prefill, setPrefill] = useState((location.state as { email?: string } | null)?.email);
  const [email, setEmail] = useState<string>();
  // 什么时候可以重新发送
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  // 第 2 步说明文字的替换（如「验证码刚刚发过…」），以及读屏播报
  const [notice, setNotice] = useState<string>();
  const [announce, setAnnounce] = useState('');
  // 当前这个验证码错了几次（前端计数，和服务端的上限一致）
  const [failures, setFailures] = useState(0);
  const remaining = RECOVERY_CODE_MAX_ATTEMPTS - failures;

  // 清空验证码格子、清掉错误，焦点回到第 1 格（格子换 key 重新挂载后再聚焦）
  const [clearTick, setClearTick] = useState(0);
  const clearCode = () => setClearTick((n) => n + 1);
  useEffect(() => {
    if (clearTick === 0) return;
    form.resetFields(['code']);
    otp.current?.nativeElement.querySelector('input')?.focus();
  }, [clearTick, form]);

  const enterStep2 = (to: string, waitSeconds: number, note?: string) => {
    const again = !!email;
    setEmail(to);
    setResendAt(Date.now() + waitSeconds * 1000);
    setNow(Date.now());
    setNotice(note);
    setFailures(0);
    reset.reset();
    if (again) {
      clearCode();
      setAnnounce(note ?? '新验证码已发送，旧的已作废');
    }
  };

  const send = useMutation({
    mutationFn: (to: string) => authApi.sendRecoveryCode({ email: to }),
    onSuccess: (_, to) => enterStep2(to, RECOVERY_RESEND_SECONDS),
    onError: (err, to) => {
      const wait = resendWait(err);
      if (wait !== null) enterStep2(to, wait, err.message);
    },
  });
  const reset = useMutation({
    mutationFn: (values: ResetForm) => authApi.resetPassword({ email: email!, code: values.code, password: values.password }),
    onSuccess: (user) => {
      client.setQueryData(['session'], user);
      message.success('密码已重设');
      navigate(homeOf(user), { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 400) {
        setFailures((n) => n + 1);
        clearCode();
      }
    },
  });

  // 重新发送的倒计时
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (!email || wait === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [email, wait]);

  // 组件库给每个验证码格子的读屏名称是英文，换成「验证码第 N 位」
  useEffect(() => {
    otp.current?.nativeElement
      .querySelectorAll('input')
      .forEach((el, i) => el.setAttribute('aria-label', `验证码第 ${i + 1} 位`));
  });

  if (session.data && !reset.isSuccess) return <Navigate to={homeOf(session.data)} replace />;

  const step = email ? 2 : 1;
  // 每小时上限的 429 等其他发送错误（resend 已经进了第 2 步，不算错误）
  const sendError = send.error && resendWait(send.error) === null ? send.error.message : null;
  const exhausted = remaining <= 0;
  const codeFailed = reset.error instanceof ApiError && reset.error.status === 400;
  const resetError = !reset.error
    ? null
    : !codeFailed
      ? reset.error.message
      : exhausted
        ? '这个验证码已失效，请点「重新发送」获取新的验证码'
        : `${reset.error.message}。还可以再试 ${remaining} 次`;

  return (
    // A03 的卡片比登录页高，设计稿把它顶边放在页头下 60px（登录页是 108px）
    <AccountShell cardTop={60}>
      <section style={accountCard}>
      <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: gy.secondary, fontSize: 14 }}>
        <LeftOutlined style={{ fontSize: 12 }} />
        返回登录
      </Link>

      <Typography.Title level={2} style={{ fontSize: 22, lineHeight: '34px', fontWeight: 500, margin: '20px 0 0' }}>
        重设密码
      </Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
        {email ? (
          <>
            {notice
              ? `${notice}。`
              : `如果 ${maskEmail(email)} 是耕云账号，验证码已发到这个邮箱，${RECOVERY_CODE_TTL_MINUTES} 分钟内有效。`}
            <Button
              type="link"
              style={{ padding: 0, height: 'auto', marginLeft: 4, verticalAlign: 'baseline' }}
              onClick={() => {
                setPrefill(email);
                setEmail(undefined);
                setNotice(undefined);
                setAnnounce('');
                send.reset();
                reset.reset();
                form.resetFields();
              }}
            >
              换个邮箱
            </Button>
          </>
        ) : (
          '输入登录邮箱，我们会发一个 6 位验证码。'
        )}
      </Typography.Text>
      {/* 读屏播报：重新发送成功等 */}
      <span aria-live="polite" style={srOnly}>
        {announce}
      </span>

      <Steps step={step} />

      {step === 1 ? (
        // 两步的表单各给一个 key：不然 React 会复用同一个表单组件，第 2 步拿不到 form 实例
        <Form<{ email: string }>
          key="send"
          className="gy-form-gap"
          layout="vertical"
          requiredMark={false}
          initialValues={{ email: prefill }}
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
          {sendError && <Alert type="error" showIcon title={sendError} style={{ marginBottom: 16 }} />}
          <Button type="primary" size="large" htmlType="submit" block loading={send.isPending}>
            发送验证码
          </Button>
        </Form>
      ) : (
        <Form<ResetForm>
          key="reset"
          form={form}
          className="gy-form-gap"
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
              // 组件库的格子不跟着表单值清空，换 key 重新挂载
              key={clearTick}
              ref={otp}
              length={6}
              size="large"
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              formatter={(v) => v.replace(/\D/g, '')}
              role="group"
              aria-label="验证码"
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
          {(resetError || sendError) && <Alert type="error" showIcon title={resetError ?? sendError} style={{ marginBottom: 16 }} />}
          {/* 平时一直可点，空着点会逐项提示；这个验证码错满 5 次后才禁用，先重新获取 */}
          <Button type="primary" size="large" htmlType="submit" block loading={reset.isPending} disabled={exhausted}>
            重设并登录
          </Button>
        </Form>
      )}

      <Divider style={{ margin: '20px 0' }} />
      <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: '20px', display: 'block' }}>
        邮箱已无法使用？请联系机构管理员或耕云更换登录邮箱。
      </Typography.Text>
      </section>
    </AccountShell>
  );
}

// 只给读屏软件看的文字
const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

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
