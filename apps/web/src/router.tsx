import type { Workspace } from '@genyun/shared';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { NAVIGATION } from './layouts/navigation';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';
import { AccountPage, AccountLayout } from './pages/AccountPage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { RecoverPage } from './pages/RecoverPage';
import { PendingPage } from './pages/PendingPage';
import { DeliveryPage } from './pages/customer/documents/DeliveryPage';
import { DeliveryReaderPage } from './pages/customer/documents/DeliveryReaderPage';
import { DocumentsPage } from './pages/customer/documents/DocumentsPage';
import { EnterpriseCreatePage } from './pages/customer/EnterpriseCreatePage';
import { EnterpriseDetailPage } from './pages/customer/EnterpriseDetailPage';
import { EnterpriseListPage } from './pages/customer/EnterpriseListPage';
import { OrganizationPage } from './pages/customer/OrganizationPage';
import { SelfFillPage } from './pages/customer/fill/SelfFillPage';
import { StartMethodPage } from './pages/customer/StartMethodPage';
import { TaskCreatePage } from './pages/customer/TaskCreatePage';
import { TaskListPage } from './pages/customer/TaskListPage';
import { TaskPage } from './pages/customer/TaskPage';
import { WorkbenchPage } from './pages/customer/WorkbenchPage';
import { ExpertTaskPage } from './pages/expert/ExpertTaskPage';
import { TaskCenterPage } from './pages/expert/TaskCenterPage';
import { AuditLogPage } from './pages/operator/AuditLogPage';
import { InternalAccountsPage } from './pages/operator/InternalAccountsPage';
import { KnowledgePage } from './pages/operator/knowledge/KnowledgePage';
import { OperatorOverviewPage } from './pages/operator/OperatorOverviewPage';
import { OperatorTaskPage } from './pages/operator/OperatorTaskPage';
import { MailOutboxPage } from './pages/operator/MailOutboxPage';
import { OrganizationDetailPage } from './pages/operator/OrganizationDetailPage';
import { OperatorTaskCenterPage } from './pages/operator/OperatorTaskCenterPage';
import { OrganizationListPage } from './pages/operator/OrganizationListPage';

const EYEBROW: Record<Workspace, string> = {
  customer: '客户工作台',
  expert: '耕云内部 / 专业处理',
  operator: '耕云运营',
};

// 已做好的工作区首页
const HOME: Partial<Record<Workspace, RouteObject['element']>> = {
  customer: <WorkbenchPage />,
  expert: <TaskCenterPage />,
  operator: <OperatorOverviewPage />,
};

// 不在菜单里的页面（从列表点进去）
const EXTRA: Partial<Record<Workspace, RouteObject[]>> = {
  expert: [{ path: 'tasks/:taskId', element: <ExpertTaskPage /> }],
};

// 已做好的页面；菜单项下可以有子页面
const PAGES: Partial<Record<string, RouteObject[]>> = {
  '/customer/enterprises': [
    { index: true, element: <EnterpriseListPage /> },
    { path: 'new', element: <EnterpriseCreatePage /> },
    { path: ':enterpriseId', element: <EnterpriseDetailPage /> },
    { path: ':enterpriseId/tasks/new', element: <TaskCreatePage /> },
  ],
  // 组织管理（仅机构管理员，侧栏只对机构管理员显示）；?tab= 切换组织资料、成员与权限、企业分配、年度服务
  '/customer/organization': [{ index: true, element: <OrganizationPage /> }],
  '/operator/audit-logs': [{ index: true, element: <AuditLogPage /> }],
  '/operator/accounts': [{ index: true, element: <InternalAccountsPage /> }],
  // 知识库：?tab= 切换属地应急机构、工艺模板、节假日
  '/operator/knowledge': [{ index: true, element: <KnowledgePage /> }],
  '/operator/organizations': [
    { index: true, element: <OrganizationListPage /> },
    { path: ':orgId', element: <OrganizationDetailPage /> },
  ],
  // 任务中心（列表、分派，?task= 打开某个任务）；任务正文只读查看在 /operator/tasks/<任务>
  '/operator/tasks': [
    { index: true, element: <OperatorTaskCenterPage /> },
    { path: ':taskId', element: <OperatorTaskPage /> },
  ],
  // 模拟发件箱只在预览环境有用，平时不在菜单里（navigation.tsx 的 onlyWhenActive）
  '/operator/mail-outbox': [{ index: true, element: <MailOutboxPage /> }],
  '/customer/tasks': [
    { index: true, element: <TaskListPage /> },
    { path: ':taskId', element: <TaskPage /> },
  ],
  // 成果文档：列表 → 某任务的交付详情（?v= 版本）→ 在线阅读
  '/customer/documents': [
    { index: true, element: <DocumentsPage /> },
    { path: ':taskId', element: <DeliveryPage /> },
    { path: ':taskId/read/:kind', element: <DeliveryReaderPage /> },
  ],
};

// 先为每个菜单项生成占位路由，页面按里程碑逐个替换
function workspaceRoutes(workspace: Workspace): RouteObject {
  const items = NAVIGATION[workspace].groups.flatMap((g) => g.items);
  const base = `/${workspace}`;
  return {
    path: base,
    element: <WorkspaceLayout workspace={workspace} />,
    children: [
      ...items.map((item): RouteObject => {
        if (item.path === base) {
          return { index: true, element: HOME[workspace] ?? <PendingPage eyebrow={EYEBROW[workspace]} title={item.label} /> };
        }
        const path = item.path.slice(base.length + 1);
        const pages = PAGES[item.path];
        return pages
          ? { path, children: pages }
          : { path, element: <PendingPage eyebrow={EYEBROW[workspace]} title={item.label} /> };
      }),
      ...(EXTRA[workspace] ?? []),
    ],
  };
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/recover', element: <RecoverPage /> },
  // 个人账户不属于某个工作区，套用登录人第一个身份所在工作区的框架（顶层路由要和 deploy/preview/Caddyfile 对上）
  { path: '/account', element: <AccountLayout />, children: [{ index: true, element: <AccountPage /> }] },
  // 邮件里的邀请链接，不用登录
  { path: '/invite/:token', element: <InvitePage /> },
  // 选择开始方式是全屏页，不在工作区框架里
  { path: '/customer/tasks/:taskId/start', element: <StartMethodPage /> },
  { path: '/customer/tasks/:taskId/fill/:step', element: <SelfFillPage /> },
  workspaceRoutes('customer'),
  workspaceRoutes('expert'),
  workspaceRoutes('operator'),
  { path: '*', element: <Navigate to="/login" replace /> },
]);
