import { ArrowLeftOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { loginSchema, workspaceOf, type LoginInput } from '@genyun/shared';
import { Alert, Button, Divider, Form, Input, Typography } from 'antd';
import { Link, Navigate, useNavigate } from 'react-router';
import { Logo, LogoMark } from '../components/Logo';
import { useLogin, useSession, WORKSPACE_HOME } from '../auth/session';
import { gy } from '../theme/tokens';
import type { SessionUser } from '../auth/api';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? '/';

function homeOf(user: SessionUser): string {
  const first = user.memberships[0];
  return first ? WORKSPACE_HOME[workspaceOf(first.role)] : '/login';
}

// A01 登录｜受邀账户进入
export function LoginPage() {
  const session = useSession();
  const login = useLogin();
  const navigate = useNavigate();

  if (session.data) return <Navigate to={homeOf(session.data)} replace />;

  const onFinish = (values: LoginInput) => {
    login.mutate(values, { onSuccess: (user) => navigate(homeOf(user), { replace: true }) });
  };

  return (
    <div style={{ minHeight: '100vh', background: gy.canvas }}>
      <header
        style={{
          height: 92,
          background: gy.surface,
          borderBottom: `1px solid ${gy.frameLine}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 80px 0 64px',
        }}
      >
        <Logo />
        <a href={SITE_URL} style={{ color: gy.text, display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <ArrowLeftOutlined style={{ fontSize: 14 }} />
          返回官网
        </a>
      </header>

      <main
        style={{
          maxWidth: 1056,
          margin: '0 auto',
          padding: '108px 0 64px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 48,
        }}
      >
        <section style={{ paddingTop: 32, width: 368 }}>
          <LogoMark width={120} height={48} />
          <Typography.Title level={1} style={{ fontSize: 36, lineHeight: '54px', fontWeight: 500, margin: '17px 0 0' }}>
            把专业的事，
            <br />
            交给同一个工作空间。
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 16, lineHeight: '30px', marginTop: 20 }}>
            围绕企业资料、编制任务和成果交付，延续每一次有据可查的协作。
          </Typography.Paragraph>
          <Divider style={{ width: 80, minWidth: 80, margin: '32px 0' }} />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            通过邀请开通账户，进入获授权的工作空间。
          </Typography.Text>
        </section>

        <section
          style={{
            width: 456,
            boxSizing: 'border-box',
            background: gy.surface,
            border: `1px solid ${gy.split}`,
            borderRadius: 12,
            padding: '35px 36px 35px',
          }}
        >
          <Typography.Title level={2} style={{ fontSize: 24, lineHeight: '35px', fontWeight: 500, margin: 0 }}>
            登录耕云
          </Typography.Title>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 7 }}>
            欢迎回来，继续您的工作。
          </Typography.Text>

          <Form<LoginInput>
            layout="vertical"
            requiredMark={false}
            onFinish={onFinish}
            style={{ marginTop: 28 }}
          >
            <Form.Item
              label="邮箱"
              name="email"
              rules={[{ validator: (_, v) => fieldError('email', v) }]}
              style={{ marginBottom: 24 }}
            >
              <Input size="large" prefix={<MailOutlined />} placeholder="请输入邮箱" autoComplete="email" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ validator: (_, v) => fieldError('password', v) }]}
              style={{ marginBottom: 14 }}
            >
              <Input.Password size="large" prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <div style={{ textAlign: 'right', marginBottom: 26 }}>
              <Link to="/recover" style={{ fontSize: 14 }}>
                忘记密码
              </Link>
            </div>
            {login.error && (
              <Alert type="error" showIcon title={login.error.message} style={{ marginBottom: 16 }} />
            )}
            <Button type="primary" size="large" htmlType="submit" block loading={login.isPending}>
              登 录
            </Button>
          </Form>

          <Divider style={{ margin: '24px 0' }} />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            尚未收到邀请？请联系机构管理员或耕云。
          </Typography.Text>
        </section>
      </main>
    </div>
  );
}

// 用共享的校验规则（与后端同一份）检查单个字段
function fieldError(field: keyof LoginInput, value: unknown): Promise<void> {
  const result = loginSchema.shape[field].safeParse(value ?? '');
  return result.success ? Promise.resolve() : Promise.reject(new Error(result.error.issues[0]?.message));
}
