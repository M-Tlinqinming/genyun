import type { Workspace } from '@genyun/shared';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { NAVIGATION } from './layouts/navigation';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';
import { LoginPage } from './pages/LoginPage';
import { PendingPage } from './pages/PendingPage';
import { EnterpriseCreatePage } from './pages/customer/EnterpriseCreatePage';
import { EnterpriseDetailPage } from './pages/customer/EnterpriseDetailPage';
import { EnterpriseListPage } from './pages/customer/EnterpriseListPage';

const EYEBROW: Record<Workspace, string> = {
  customer: '客户工作台',
  expert: '耕云内部 / 专业处理',
  operator: '耕云运营',
};

// 已做好的页面；菜单项下可以有子页面
const PAGES: Partial<Record<string, RouteObject[]>> = {
  '/customer/enterprises': [
    { index: true, element: <EnterpriseListPage /> },
    { path: 'new', element: <EnterpriseCreatePage /> },
    { path: ':enterpriseId', element: <EnterpriseDetailPage /> },
  ],
};

// 先为每个菜单项生成占位路由，页面按里程碑逐个替换
function workspaceRoutes(workspace: Workspace): RouteObject {
  const items = NAVIGATION[workspace].groups.flatMap((g) => g.items);
  const base = `/${workspace}`;
  return {
    path: base,
    element: <WorkspaceLayout workspace={workspace} />,
    children: items.map((item): RouteObject => {
      if (item.path === base) return { index: true, element: <PendingPage eyebrow={EYEBROW[workspace]} title={item.label} /> };
      const path = item.path.slice(base.length + 1);
      const pages = PAGES[item.path];
      return pages
        ? { path, children: pages }
        : { path, element: <PendingPage eyebrow={EYEBROW[workspace]} title={item.label} /> };
    }),
  };
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  workspaceRoutes('customer'),
  workspaceRoutes('expert'),
  workspaceRoutes('operator'),
  { path: '*', element: <Navigate to="/login" replace /> },
]);
