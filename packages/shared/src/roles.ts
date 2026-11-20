// 三类账户。界面上只显示 label，代码里用 key。
export const ROLES = {
  customer_admin: { label: '组织管理员', workspace: 'customer' },
  customer_member: { label: '组织成员', workspace: 'customer' },
  expert: { label: '专家', workspace: 'expert' },
  operator: { label: '运营管理员', workspace: 'operator' },
} as const;

export type Role = keyof typeof ROLES;
export type Workspace = (typeof ROLES)[Role]['workspace'];

export function workspaceOf(role: Role): Workspace {
  return ROLES[role].workspace;
}
