import type { SessionUser } from './auth.service.ts';

// 权限规则集中在这里，接口只调用这些函数，不自己判断。

export function isOperator(user: SessionUser): boolean {
  return user.memberships.some((m) => m.role === 'operator');
}

export function isExpert(user: SessionUser): boolean {
  return user.memberships.some((m) => m.role === 'expert');
}

// 本组织的客户账号（管理员或成员）
function customerMembership(user: SessionUser, orgId: string) {
  return user.memberships.find((m) => m.orgId === orgId && (m.role === 'customer_admin' || m.role === 'customer_member'));
}

function isCustomerOf(user: SessionUser, orgId: string): boolean {
  return Boolean(customerMembership(user, orgId));
}

// 本组织的机构管理员
export function isCustomerAdminOf(user: SessionUser, orgId: string): boolean {
  return customerMembership(user, orgId)?.role === 'customer_admin';
}

// 在这个组织里能看到哪些企业（M3 第 7 项）：运营、机构管理员看全部（'all'）；
// 成员只看机构管理员分配给自己的企业（企业 ID 列表，可能为空）；别的人一律 null
export function enterpriseScope(user: SessionUser, orgId: string): 'all' | string[] | null {
  if (isOperator(user)) return 'all';
  const m = customerMembership(user, orgId);
  if (!m) return null;
  return m.role === 'customer_admin' ? 'all' : (m.enterpriseIds ?? []);
}

// 客户自己能处理哪些企业（运营只看不改）
function customerEnterpriseScope(user: SessionUser, orgId: string): 'all' | string[] | null {
  const m = customerMembership(user, orgId);
  if (!m) return null;
  return m.role === 'customer_admin' ? 'all' : (m.enterpriseIds ?? []);
}

const inScope = (scope: 'all' | string[] | null, enterpriseId: string) => scope === 'all' || (scope?.includes(enterpriseId) ?? false);

// 客户组织本身（组织列表接口、合同有效期、企业 / 任务 / 成果列表的入口）：本组织客户、运营管理员可以看。
// 成员能进列表，但列表里只有分配给自己的企业（见 enterpriseScope）。
// 专业人员不能直接浏览组织（只能通过分配给自己的任务看到相关内容）。
export function canViewOrganization(user: SessionUser, orgId: string): boolean {
  return isOperator(user) || isCustomerOf(user, orgId);
}

// 组织层面的上传（先上传、再挂到资料项 / 企业资料上）：本组织客户账号。运营不替客户上传。
// 文件挂到哪家企业时再按 canEditEnterpriseData 判断
export function canEditOrganizationData(user: SessionUser, orgId: string): boolean {
  return isCustomerOf(user, orgId);
}

// 单家企业（档案、资料、任务列表）：运营、机构管理员看全部；成员只看分配给自己的
export function canViewEnterprise(user: SessionUser, ent: { orgId: string; enterpriseId: string }): boolean {
  return inScope(enterpriseScope(user, ent.orgId), ent.enterpriseId);
}

// 维护企业资料、建任务、填资料、提交申请、回应补件：本组织机构管理员，或分配到这家企业的成员。运营不替客户填
export function canEditEnterpriseData(user: SessionUser, ent: { orgId: string; enterpriseId: string }): boolean {
  return inScope(customerEnterpriseScope(user, ent.orgId), ent.enterpriseId);
}

// 新建企业（含建档前识别营业执照）：只有机构管理员。成员只处理分配给自己的企业（11 页角色说明）
export function canCreateEnterprise(user: SessionUser, orgId: string): boolean {
  return isCustomerAdminOf(user, orgId);
}

// 组织管理（成员、邀请、企业分配、组织资料、年度服务）：只有本组织机构管理员。
// 不能移除自己、不能改自己的角色，组织里至少保留一位机构管理员（接口里加锁判断）
export function canManageOrgMembers(user: SessionUser, orgId: string): boolean {
  return isCustomerAdminOf(user, orgId);
}

// 单个任务：运营管理员、本组织能看到这家企业的客户（机构管理员；分配到这家企业的成员），以及被分派为负责专家的专业人员
export function canViewTask(user: SessionUser, task: { orgId: string; enterpriseId: string; assignedExpertId: string | null }): boolean {
  if (canViewEnterprise(user, task)) return true;
  return task.assignedExpertId === user.id && isExpert(user);
}

// 上传的文件：合同原件只有运营能看；客户资料由本组织客户、运营查看，
// 专业人员只能看分派给自己的任务里用到的文件。
// 成员只看自己上传的，或挂在分配给自己的企业上的文件（linkedEnterpriseIds 由调用方查出：资料项、企业资料、补件、交付、企业档案里用到的）
export function canViewFile(
  user: SessionUser,
  file: { orgId: string; kind: 'customer_material' | 'contract' | 'draft' | 'delivery'; uploadedBy: string | null },
  ctx: { usedInMyAssignedTask: boolean; linkedEnterpriseIds: string[] },
): boolean {
  if (file.kind === 'contract') return isOperator(user);
  // 生成的草稿发布前客户看不到，只有负责专家和运营
  if (file.kind === 'draft') return isOperator(user) || (ctx.usedInMyAssignedTask && isExpert(user));
  // 其余（客户资料、发布后的交付 Word）：运营、机构管理员、相关企业的成员；负责专家通过任务看到
  const scope = enterpriseScope(user, file.orgId);
  if (scope === 'all') return true;
  if (scope && (file.uploadedBy === user.id || ctx.linkedEnterpriseIds.some((id) => scope.includes(id)))) return true;
  return ctx.usedInMyAssignedTask && isExpert(user);
}

// 看文件时要不要查它挂在哪些企业上（只有成员需要）
export function needsFileEnterprises(user: SessionUser, orgId: string): boolean {
  return Array.isArray(enterpriseScope(user, orgId));
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

// 已交付的成果（交付版本列表、在线阅读、下载整套）：能看到这家企业的客户、运营管理员，以及负责这个任务的注安师。
// 别家客户、其他注安师、没分配到这家企业的成员一律当作不存在。规则与单个任务相同
export function canViewDeliveries(user: SessionUser, task: { orgId: string; enterpriseId: string; assignedExpertId: string | null }): boolean {
  return canViewTask(user, task);
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

// 知识库（属地应急机构、工艺模板、节假日）：只有运营能看、能维护。客户选模板走只读的已发布列表
export function canManageKnowledge(user: SessionUser): boolean {
  return isOperator(user);
}
