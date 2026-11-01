import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { loginSchema, workspaceOf, type LoginInput } from '@genyun/shared';
import { Alert, Button, Divider, Form, Input, Typography } from 'antd';
import { Link, Navigate, useNavigate } from 'react-router';
import { AccountShell, accountCard } from '../components/AccountShell';
import { useLogin, useSession, WORKSPACE_HOME } from '../auth/session';
import type { SessionUser } from '../auth/api';

export function homeOf(user: SessionUser): string {
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
    <AccountShell>
      <section style={accountCard}>
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
    </AccountShell>
  );
}

// 用共享的校验规则（与后端同一份）检查单个字段
function fieldError(field: keyof LoginInput, value: unknown): Promise<void> {
  const result = loginSchema.shape[field].safeParse(value ?? '');
  return result.success ? Promise.resolve() : Promise.reject(new Error(result.error.issues[0]?.message));
}
