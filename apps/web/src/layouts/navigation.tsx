import {
  AppstoreOutlined,
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  MailOutlined,
  FileTextOutlined,
  MessageOutlined,
  ProfileOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Role, Workspace } from '@genyun/shared';
import type { ReactNode } from 'react';

export interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  // 设计稿里专业人员可见但不可用的入口（置灰）
  disabled?: boolean;
  // 平时不在菜单里，只有打开这个页面时才出现并高亮（模拟发件箱：只在预览环境有用）
  onlyWhenActive?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  // 只有这些角色看得到整组；不写表示本工作区所有角色可见
  roles?: Role[];
}

export interface WorkspaceNav {
  headerTitle: string;
  groups: NavGroup[];
  showContact: boolean;
  // 内部工作区在机构选择框里显示的名字；客户工作区显示组织本身的名字
  orgLabel?: string;
}

// 菜单结构来自 Paper 11 / 14 / 16 页的侧栏
export const NAVIGATION: Record<Workspace, WorkspaceNav> = {
  customer: {
    headerTitle: '客户工作台',
    showContact: true,
    groups: [
      {
        label: '客户工作空间',
        items: [
          { path: '/customer', label: '工作台', icon: <AppstoreOutlined /> },
          { path: '/customer/enterprises', label: '企业', icon: <BankOutlined /> },
          { path: '/customer/tasks', label: '业务任务', icon: <ProfileOutlined /> },
          { path: '/customer/documents', label: '成果文档', icon: <FileTextOutlined /> },
        ],
      },
      {
        label: '机构管理',
        roles: ['customer_admin'],
        items: [{ path: '/customer/organization', label: '组织管理', icon: <TeamOutlined /> }],
      },
    ],
  },
  expert: {
    headerTitle: '耕云内部工作台',
    showContact: false,
    orgLabel: '耕云专业处理',
    groups: [
      {
        label: '专业工作空间',
        items: [
          { path: '/expert', label: '任务中心', icon: <ProfileOutlined /> },
          { path: '/expert/organizations', label: '客户组织', icon: <BankOutlined />, disabled: true },
          { path: '/expert/accounts', label: '内部账号', icon: <UserOutlined />, disabled: true },
        ],
      },
    ],
  },
  operator: {
    headerTitle: '耕云内部工作台',
    showContact: false,
    orgLabel: '耕云运营',
    groups: [
      {
        label: '运营工作空间',
        items: [
          { path: '/operator', label: '运营概览', icon: <AppstoreOutlined /> },
          { path: '/operator/organizations', label: '客户组织', icon: <BankOutlined /> },
          { path: '/operator/tasks', label: '任务中心', icon: <ProfileOutlined /> },
          { path: '/operator/accounts', label: '内部账号', icon: <UserOutlined /> },
          { path: '/operator/audit-logs', label: '操作日志', icon: <AuditOutlined /> },
          { path: '/operator/knowledge', label: '知识库', icon: <BookOutlined /> },
          { path: '/operator/feedback', label: '反馈受理', icon: <MessageOutlined /> },
          { path: '/operator/mail-outbox', label: '模拟发件箱', icon: <MailOutlined />, onlyWhenActive: true },
        ],
      },
    ],
  },
};
