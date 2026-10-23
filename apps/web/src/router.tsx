import type { Workspace } from '@genyun/shared';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { NAVIGATION } from './layouts/navigation';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';
import { LoginPage } from './pages/LoginPage';
import { PendingPage } from './pages/PendingPage';

const EYEBROW: Record<Workspace, string> = {
  customer: '客户工作台',
  expert: '耕云内部 / 专业处理',
  operator: '耕云运营',
};

// 先为每个菜单项生成占位路由，页面按里程碑逐个替换
function workspaceRoutes(workspace: Workspace): RouteObject {
  const items = NAVIGATION[workspace].groups.flatMap((g) => g.items);
  const base = `/${workspace}`;
  return {
    path: base,
    element: <WorkspaceLayout workspace={workspace} />,
    children: items.map((item) => ({
      ...(item.path === base ? { index: true } : { path: item.path.slice(base.length + 1) }),
      element: <PendingPage eyebrow={EYEBROW[workspace]} title={item.label} />,
    })),
  };
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  workspaceRoutes('customer'),
  workspaceRoutes('expert'),
  workspaceRoutes('operator'),
  { path: '*', element: <Navigate to="/login" replace /> },
]);
