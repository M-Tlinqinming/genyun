import type { SessionUser } from './auth.service.ts';

// 权限规则集中在这里，接口只调用这些函数，不自己判断。

export function isOperator(user: SessionUser): boolean {
  return user.memberships.some((m) => m.role === 'operator');
}

export function isExpert(user: SessionUser): boolean {
  return user.memberships.some((m) => m.role === 'expert');
}

// 本组织的客户账号（管理员或成员）
function isCustomerOf(user: SessionUser, orgId: string): boolean {
  return user.memberships.some(
    (m) => m.orgId === orgId && (m.role === 'customer_admin' || m.role === 'customer_member'),
  );
}

// 客户组织的资料（含企业、任务列表）：本组织成员、运营管理员可以看。
// 专业人员不能直接浏览组织（只能通过分配给自己的任务看到相关内容）。
export function canViewOrganization(user: SessionUser, orgId: string): boolean {
  return isOperator(user) || isCustomerOf(user, orgId);
}

// 建企业、建任务、填资料：只有本组织的客户账号。运营不替客户建档。
// 成员只管理分配给自己的企业，在 M3 组织管理页做；目前成员与管理员相同。
export function canEditOrganizationData(user: SessionUser, orgId: string): boolean {
  return isCustomerOf(user, orgId);
}

// 单个任务：本组织客户、运营管理员，以及被分派为负责专家的专业人员
export function canViewTask(user: SessionUser, task: { orgId: string; assignedExpertId: string | null }): boolean {
  if (canViewOrganization(user, task.orgId)) return true;
  return task.assignedExpertId === user.id && user.memberships.some((m) => m.role === 'expert');
}

// 上传的文件：合同原件只有运营能看；客户资料由本组织客户、运营查看，
// 专业人员只能看分派给自己的任务里用到的文件
export function canViewFile(
  user: SessionUser,
  file: { orgId: string; kind: 'customer_material' | 'contract' | 'draft' | 'delivery' },
  usedInMyAssignedTask: boolean,
): boolean {
  if (file.kind === 'contract') return isOperator(user);
  // 生成的草稿发布前客户看不到，只有负责专家和运营
  if (file.kind === 'draft') return isOperator(user) || (usedInMyAssignedTask && user.memberships.some((m) => m.role === 'expert'));
  // 其余（客户资料、发布后的交付 Word）：本组织客户、运营；负责专家通过任务看到
  if (canViewOrganization(user, file.orgId)) return true;
  return usedInMyAssignedTask && user.memberships.some((m) => m.role === 'expert');
}

// 运营任务中心：看全部任务、分派和改派负责专家。只有运营；专业人员不能自己领任务或转给别人
export function canAssignTasks(user: SessionUser): boolean {
  return isOperator(user);
}

// 超时兜底（提醒注安师、致电客户、内部备注）：只有运营；内部备注和运营记录客户、注安师都看不到
export function canHandleOverdue(user: SessionUser): boolean {
  return isOperator(user);
}

// 上门工单（列表、转交、关闭、内部备注）：只有运营；客户只看到「已收到上门需求」
export function canHandleOnSiteOrders(user: SessionUser): boolean {
  return isOperator(user);
}

// 专家处理的内容（专业整理、生成的草稿、正文编辑）：负责专家和运营能看，客户和其他专家看不到
export function canViewTaskWork(user: SessionUser, task: { assignedExpertId: string | null }): boolean {
  return isOperator(user) || (task.assignedExpertId === user.id && isExpert(user));
}

// 改正文、请 AI 改写：只有负责专家；运营只看（M3 改派后由新的负责专家接手）
export function canEditTaskWork(user: SessionUser, task: { assignedExpertId: string | null }): boolean {
  return task.assignedExpertId === user.id && isExpert(user);
}

// 客户组织的登记、开通、合同原件：只有运营。客户、专业人员一律不行
export function canManageOrganizations(user: SessionUser): boolean {
  return isOperator(user);
}

// 发布成果（形成交付版本）：只有负责这个任务的注安师。运营、其他注安师、客户一律不行
export function canPublishTask(user: SessionUser, task: { assignedExpertId: string | null }): boolean {
  return task.assignedExpertId === user.id && isExpert(user);
}

// 运营概览（今天先处理、统计）：只有运营。客户、注安师一律不行
export function canViewOperatorOverview(user: SessionUser): boolean {
  return isOperator(user);
}

// 内部账号（邀请注安师 / 运营、停用、恢复、改角色）：只有运营；不能停用自己、不能改自己的角色
export function canManageInternalAccounts(user: SessionUser): boolean {
  return isOperator(user);
}
