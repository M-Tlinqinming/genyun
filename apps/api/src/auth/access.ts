import type { SessionUser } from './auth.service.ts';

// 权限规则集中在这里，接口只调用这些函数，不自己判断。

export function isOperator(user: SessionUser): boolean {
  return user.memberships.some((m) => m.role === 'operator');
}

// 客户组织的资料：本组织成员、运营管理员可以看。
// 专业人员不能直接浏览组织（只能通过分配给自己的任务看到相关内容）。
export function canViewOrganization(user: SessionUser, orgId: string): boolean {
  if (isOperator(user)) return true;
  return user.memberships.some(
    (m) => m.orgId === orgId && (m.role === 'customer_admin' || m.role === 'customer_member'),
  );
}
