import type { Workspace } from '@genyun/shared';
import { createBrowserRouter, Navigate, useParams, type RouteObject } from 'react-router';
import { NAVIGATION } from './layouts/navigation';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';
import { AccountPage, AccountLayout } from './pages/AccountPage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { RecoverPage } from './pages/RecoverPage';
import { PendingPage } from './pages/PendingPage';
import { DeliveryPage } from './pages/customer/documents/DeliveryPage';
import { DocumentsPage } from './pages/customer/documents/DocumentsPage';
import { EnterpriseCreatePage } from './pages/customer/EnterpriseCreatePage';
import { EnterpriseDetailPage } from './pages/customer/EnterpriseDetailPage';
import { EnterpriseListPage } from './pages/customer/EnterpriseListPage';
import { MyFeedbackPage } from './pages/customer/MyFeedbackPage';
import { OrganizationPage } from './pages/customer/OrganizationPage';
import { TaskListPage } from './pages/customer/TaskListPage';
import { TaskNewPage } from './pages/customer/TaskNewPage';
import { TaskPreparePage } from './pages/customer/prepare/TaskPreparePage';
import { TaskPage } from './pages/customer/TaskPage';
import { WorkbenchPage } from './pages/customer/WorkbenchPage';
import { ExpertTaskPage } from './pages/expert/ExpertTaskPage';
import { TaskCenterPage } from './pages/expert/TaskCenterPage';
import { AuditLogPage } from './pages/operator/AuditLogPage';
import { FeedbackPage } from './pages/operator/FeedbackPage';
import { InternalAccountsPage } from './pages/operator/InternalAccountsPage';
import { KnowledgePage } from './pages/operator/knowledge/KnowledgePage';
import { OperatorOverviewPage } from './pages/operator/OperatorOverviewPage';
import { OperatorTaskPage } from './pages/operator/OperatorTaskPage';
import { MailOutboxPage } from './pages/operator/MailOutboxPage';
import { GiftCampaignsPage } from './pages/operator/GiftCampaignsPage';
import { OrganizationDetailPage } from './pages/operator/OrganizationDetailPage';
import { OperatorTaskCenterPage } from './pages/operator/OperatorTaskCenterPage';
import { OrganizationListPage } from './pages/operator/OrganizationListPage';

const EYEBROW: Record<Workspace, string> = {
  customer: '客户工作台',
  expert: '耕云专家',
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
  // 全部记录（操作日志）：从运营概览「最近操作」进入，菜单高亮运营概览
  operator: [{ path: 'audit-logs', element: <AuditLogPage /> }],
};

// 旧地址（取消的填写向导、在线阅读）：收藏过的链接跳到现在对应的页面
function Moved({ to }: { to: (taskId: string) => string }) {
  const { taskId } = useParams();
  return <Navigate to={to(taskId!)} replace />;
}

function MovedEnterprise() {
  const { enterpriseId } = useParams();
  return <Navigate to={`/customer/tasks/new?enterpriseId=${enterpriseId}`} replace />;
}

// 已做好的页面；菜单项下可以有子页面
const PAGES: Partial<Record<string, RouteObject[]>> = {
  '/customer/enterprises': [
    { index: true, element: <EnterpriseListPage /> },
    { path: 'new', element: <EnterpriseCreatePage /> },
    { path: ':enterpriseId', element: <EnterpriseDetailPage /> },
    // 旧的「为这家企业建任务」地址：跳到新建任务页并带上这家企业
    { path: ':enterpriseId/tasks/new', element: <MovedEnterprise /> },
  ],
  // 组织管理（仅组织管理员，侧栏只对组织管理员显示）；?tab= 切换组织资料、成员与权限、企业分配、年度服务
  '/customer/organization': [{ index: true, element: <OrganizationPage /> }],
  // 我的反馈（?id= 定位到某一条；平时不在菜单里）
  '/customer/feedback': [{ index: true, element: <MyFeedbackPage /> }],
  // 反馈受理（?id= 打开某一条）
  '/operator/feedback': [{ index: true, element: <FeedbackPage /> }],
  '/operator/accounts': [{ index: true, element: <InternalAccountsPage /> }],
  // 知识库：?tab= 切换页签（现在只有属地应急机构）
  '/operator/knowledge': [{ index: true, element: <KnowledgePage /> }],
  '/operator/organizations': [
    { index: true, element: <OrganizationListPage /> },
    // 赠送活动统计要排在 :orgId 前面
    { path: 'gift-campaigns', element: <GiftCampaignsPage /> },
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
    { path: 'new', element: <TaskNewPage /> },
    { path: ':taskId', element: <TaskPage /> },
    { path: ':taskId/start', element: <Moved to={(id) => `/customer/tasks/${id}`} /> },
    { path: ':taskId/fill/:step', element: <Moved to={(id) => `/customer/tasks/${id}`} /> },
  ],
  // 成果文档：列表 → 某任务的交付详情（客户只看最新一次交付）
  '/customer/documents': [
    { index: true, element: <DocumentsPage /> },
    { path: ':taskId', element: <DeliveryPage /> },
    { path: ':taskId/read/:kind', element: <Moved to={(id) => `/customer/documents/${id}`} /> },
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

// 组件展示页只在本机开发时有，正式构建时整段连同页面代码一起去掉（所以预览环境的 Caddyfile 不用加 /dev）
const DEV_ROUTES: RouteObject[] = import.meta.env.DEV
  ? [{ path: '/dev/ui', lazy: async () => ({ Component: (await import('./pages/dev/UiShowcasePage')).UiShowcasePage }) }]
  : [];

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/recover', element: <RecoverPage /> },
  // 个人账户不属于某个工作区，套用登录人第一个身份所在工作区的框架（顶层路由要和 deploy/preview/Caddyfile 对上）
  { path: '/account', element: <AccountLayout />, children: [{ index: true, element: <AccountPage /> }] },
  // 邮件里的邀请链接，不用登录
  { path: '/invite/:token', element: <InvitePage /> },
  // 准备资料是向导，不带侧栏，所以不放在客户工作空间里（页面自己检查登录）
  { path: '/customer/tasks/:taskId/prepare', element: <TaskPreparePage /> },
  workspaceRoutes('customer'),
  workspaceRoutes('expert'),
  workspaceRoutes('operator'),
  ...DEV_ROUTES,
  // 不存在的地址：登录页会把已登录的人送回自己的工作台
  { path: '*', element: <Navigate to="/login" replace /> },
]);
