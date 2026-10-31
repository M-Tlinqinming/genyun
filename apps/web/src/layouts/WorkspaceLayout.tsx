import { LogoutOutlined, QuestionCircleOutlined, UserOutlined } from '@ant-design/icons';
import { ROLES, type Workspace } from '@genyun/shared';
import { Avatar, Button, Divider, Dropdown, Layout, Menu, Select, Spin, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { ContactLink } from '../components/ContactLink';
import { Logo } from '../components/Logo';
import { membershipsIn, useLogout, useSession } from '../auth/session';
import { gy, layout } from '../theme/tokens';
import { NAVIGATION } from './navigation';
import { NotificationBell } from './NotificationBell';
import type { WorkspaceContext } from './workspace';

// 三端共用的框架：顶栏 64 + 侧栏 224。只有该工作区的成员才能进入。
export function WorkspaceLayout({ workspace }: { workspace: Workspace }) {
  const session = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [orgId, setOrgId] = useState<string>();

  if (session.isPending) return <Spin fullscreen />;
  if (!session.data) return <Navigate to="/login" replace />;

  const memberships = membershipsIn(session.data, workspace);
  if (memberships.length === 0) return <Navigate to="/login" replace />;

  const current = memberships.find((m) => m.orgId === orgId) ?? memberships[0]!;
  const nav = NAVIGATION[workspace];
  const user = session.data;
  const initial = user.name.slice(0, 1);

  const menuItems: ItemType[] = nav.groups
    .filter((g) => !g.roles || g.roles.includes(current.role))
    .map((g) => ({
      type: 'group',
      key: g.label,
      label: g.label,
      children: g.items.map((item) => ({
        key: item.path,
        icon: item.icon,
        label: item.label,
        disabled: item.disabled,
      })),
    }));

  // 当前路径落在哪个菜单项下（取最长匹配，避免「工作台」吞掉所有子路径）
  const selectedKey = nav.groups
    .flatMap((g) => g.items.map((i) => i.path))
    .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        width={layout.sider}
        style={{
          borderRight: `1px solid ${gy.frameLine}`,
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ padding: '26px 24px 0' }}>
            <Logo />
          </div>
          <div style={{ padding: '30px 16px 0 16px' }}>
            <Select
              value={current.orgId}
              onChange={setOrgId}
              options={memberships.map((m) => ({ value: m.orgId, label: nav.orgLabel ?? m.orgName }))}
              style={{ width: 191 }}
              aria-label="当前机构"
            />
          </div>
          <Menu
            className="gy-sider-menu"
            mode="inline"
            selectedKeys={selectedKey ? [selectedKey] : []}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ borderInlineEnd: 'none', marginTop: 16, flex: 1, overflow: 'auto' }}
          />
          <div style={{ padding: '0 16px 20px' }}>
            <Divider style={{ margin: '0 0 16px' }} />
            <Dropdown
              trigger={['click']}
              placement="topLeft"
              menu={{
                items: [
                  { key: 'account', icon: <UserOutlined />, label: '个人账户' },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
                ],
                onClick: ({ key }) => {
                  if (key === 'logout') logout.mutate(undefined, { onSuccess: () => navigate('/login') });
                },
              }}
            >
              <button
                type="button"
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                }}
              >
                <Avatar size={32} style={{ background: gy.selected, color: gy.primary }}>
                  {initial}
                </Avatar>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography.Text>{user.name}</Typography.Text>
                  <Typography.Text style={{ fontSize: 12, color: gy.tertiary }}>
                    {ROLES[current.role].label}
                  </Typography.Text>
                </span>
              </button>
            </Dropdown>
          </div>
        </div>
      </Layout.Sider>

      <Layout>
        <Layout.Header
          style={{
            borderBottom: `1px solid ${gy.frameLine}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Typography.Text type="secondary">{nav.headerTitle}</Typography.Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {nav.showContact && (
              <ContactLink
                trigger={(open) => (
                  <Button type="text" icon={<QuestionCircleOutlined />} style={{ color: gy.secondary, padding: 0 }} onClick={open}>
                    联系耕云
                  </Button>
                )}
              />
            )}
            <NotificationBell />
            <Avatar size={28} style={{ background: '#F2F4F7', color: gy.text }}>
              {initial}
            </Avatar>
          </div>
        </Layout.Header>
        <Layout.Content>
          <div className="gy-content" style={{ maxWidth: layout.content + 64 }}>
            <Outlet context={{ orgId: current.orgId, role: current.role } satisfies WorkspaceContext} />
          </div>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
