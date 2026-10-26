// 三类账户。界面上只显示 label，代码里用 key。
export const ROLES = {
  customer_admin: { label: '机构管理员', workspace: 'customer' },
  customer_member: { label: '机构成员', workspace: 'customer' },
  expert: { label: '专业人员', workspace: 'expert' },
  operator: { label: '运营管理员', workspace: 'operator' },
} as const;

export type Role = keyof typeof ROLES;
export type Workspace = (typeof ROLES)[Role]['workspace'];

export const WORKSPACE_LABELS: Record<Workspace, string> = {
  customer: '客户工作空间',
  expert: '专业工作空间',
  operator: '运营工作空间',
};

export function workspaceOf(role: Role): Workspace {
  return ROLES[role].workspace;
}
