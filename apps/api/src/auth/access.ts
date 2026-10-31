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
  file: { orgId: string; kind: 'customer_material' | 'contract' | 'draft' },
  usedInMyAssignedTask: boolean,
): boolean {
  if (file.kind === 'contract') return isOperator(user);
  // 生成的草稿发布前客户看不到，只有负责专家和运营
  if (file.kind === 'draft') return isOperator(user) || (usedInMyAssignedTask && user.memberships.some((m) => m.role === 'expert'));
  if (canViewOrganization(user, file.orgId)) return true;
  return usedInMyAssignedTask && user.memberships.some((m) => m.role === 'expert');
}

// 专家处理的内容（专业整理、生成的草稿、正文编辑）：负责专家和运营能看，客户和其他专家看不到
export function canViewTaskWork(user: SessionUser, task: { assignedExpertId: string | null }): boolean {
  return isOperator(user) || (task.assignedExpertId === user.id && isExpert(user));
}

// 改正文、请 AI 改写：只有负责专家；运营只看（M3 改派后由新的负责专家接手）
export function canEditTaskWork(user: SessionUser, task: { assignedExpertId: string | null }): boolean {
  return task.assignedExpertId === user.id && isExpert(user);
}
