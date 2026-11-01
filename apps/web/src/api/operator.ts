import type {
  AdminInvitationInput,
  AssignExpertInput,
  BusinessType,
  InvitationState,
  OperatorNote,
  OperatorTaskStage,
  OrgOpenDraft,
  OrgRegisterInput,
  OrgServiceState,
  Role,
  ServiceScopeKind,
} from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';

// 运营看到的客户组织（Paper 16 页 I02）
export interface OperatorOrg {
  id: string;
  name: string;
  region: string | null;
  socialCreditCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  note: string | null;
  contractStartsAt: string | null;
  contractEndsAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  registeredByName: string | null;
  state: OrgServiceState;
  contract: { number: string; scopeKind: ServiceScopeKind; scopeEnterprises: number | null } | null;
}

export interface OperatorOrgRow extends OperatorOrg {
  enterprises: number;
  members: number;
  openTasks: number;
}

export interface ContractFile {
  id: string;
  originalName: string;
  sizeBytes: number;
  createdAt: string;
  uploadedByName: string;
}

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface OrgInvitation {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedByName: string;
  state: InvitationState;
}

export interface OrgEnterpriseTask {
  id: string;
  name: string;
  task: { id: string; number: string; stage: OperatorTaskStage } | null;
}

// 组织详情（Paper 16 页 I03）：合同原件、成员、邀请记录（新的在前）、企业与当前任务
export interface OperatorOrgDetail extends OperatorOrg {
  contractFile: ContractFile | null;
  members: OrgMember[];
  invitations: OrgInvitation[];
  enterprises: OrgEnterpriseTask[];
}

export interface SentInvitation {
  email: string;
  expiresAt: string;
  mailSent: boolean;
  mailSimulated: boolean;
  // 模拟发件箱开放（预览环境）：提示里可以说「可在模拟发件箱查看」
  mailInOutbox: boolean;
}

export const operatorOrgKeys = {
  list: ['operator', 'organizations'] as const,
  detail: (id: string) => ['operator', 'organizations', id] as const,
};

export function useOperatorOrgs() {
  return useQuery({ queryKey: operatorOrgKeys.list, queryFn: () => request<OperatorOrgRow[]>('/operator/organizations') });
}

export function useOperatorOrg(id: string | null) {
  return useQuery({
    queryKey: operatorOrgKeys.detail(id ?? ''),
    queryFn: () => request<OperatorOrgDetail>(`/operator/organizations/${id}`),
    enabled: id !== null,
  });
}

export function useSaveOrg(id: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OrgRegisterInput) =>
      request<OperatorOrg>(id ? `/operator/organizations/${id}` : '/operator/organizations', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: operatorOrgKeys.list });
      void client.invalidateQueries({ queryKey: operatorOrgKeys.detail(saved.id) });
    },
  });
}

export function useOpenOrg(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: OrgOpenDraft) =>
      request<OperatorOrg & { invitation: SentInvitation }>(
        `/operator/organizations/${id}/open`,
        { method: 'POST', body: JSON.stringify(draft) },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: operatorOrgKeys.list });
      void client.invalidateQueries({ queryKey: operatorOrgKeys.detail(id) });
    },
  });
}

// 重发首位管理员邀请，或换一个人：旧链接作废，按这里填的人重新发一封
export function useInviteAdmin(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminInvitationInput) =>
      request<SentInvitation>(`/operator/organizations/${id}/admin-invitation`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: operatorOrgKeys.list });
      void client.invalidateQueries({ queryKey: operatorOrgKeys.detail(id) });
    },
  });
}

// 上传已签合同原件（只收 PDF，20 MB 以内）
export async function uploadContractFile(orgId: string, file: File): Promise<ContractFile> {
  const form = new FormData();
  form.append('file', file);
  // 走 request：服务出错、断网时提示和其他请求一样
  return request<ContractFile>(`/operator/organizations/${orgId}/contract-file`, { method: 'POST', body: form });
}

// 运营任务中心（Paper 16 页 I04）：全部客户任务，待分派由 needsAssignment 筛出
export interface OperatorTask {
  id: string;
  number: string;
  name: string;
  businessType: BusinessType;
  orgId: string;
  orgName: string;
  orgRegion: string | null;
  enterpriseId: string;
  enterpriseName: string;
  status: 'preparing' | 'submitted';
  createdAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  assignedExpertId: string | null;
  assignedExpertName: string | null;
  stage: OperatorTaskStage;
  needsAssignment: boolean;
  assignBlockedReason: string | null;
}

export interface OperatorTaskDetail extends OperatorTask {
  contactCount: number;
  workupStartedAt: string | null;
}

// 超时兜底：客户请电话联系后 2 个工作日没联系上
export interface OverdueTask extends OperatorTask {
  request: { requestedAt: string; requestedBy: string; labels: string[]; deadline: string };
  reason: string;
  contacts: { method: 'request' | 'phone'; result: 'clarified' | 'later' | 'unreachable' | null; createdAt: string; createdByName: string }[];
}

export interface AssignableExpert {
  id: string;
  name: string;
  email: string;
  openTasks: number;
  sameOrgEnterprises: number;
  current: boolean;
}

export const operatorTaskKeys = {
  list: ['operator', 'tasks'] as const,
  detail: (id: string) => ['operator', 'tasks', id] as const,
  experts: (id: string) => ['operator', 'tasks', id, 'experts'] as const,
  overdue: ['operator', 'tasks', 'overdue'] as const,
  notes: (id: string) => ['operator', 'tasks', id, 'notes'] as const,
};

export function useOverdueTasks() {
  return useQuery({ queryKey: operatorTaskKeys.overdue, queryFn: () => request<OverdueTask[]>('/operator/tasks/overdue') });
}

// 运营在任务上的记录（内部备注、提醒注安师、改派），客户和注安师看不到
export function useOperatorNotes(taskId: string) {
  return useQuery({ queryKey: operatorTaskKeys.notes(taskId), queryFn: () => request<OperatorNote[]>(`/operator/tasks/${taskId}/notes`) });
}

export function useAddOperatorNote(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      request<OperatorNote[]>(`/operator/tasks/${taskId}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: (notes) => client.setQueryData(operatorTaskKeys.notes(taskId), notes),
  });
}

export function useRemindExpert(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body?: string) =>
      request<OperatorNote[]>(`/operator/tasks/${taskId}/remind`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: (notes) => client.setQueryData(operatorTaskKeys.notes(taskId), notes),
  });
}

export function useOperatorTasks() {
  return useQuery({ queryKey: operatorTaskKeys.list, queryFn: () => request<OperatorTask[]>('/operator/tasks') });
}

export function useOperatorTask(id: string | null) {
  return useQuery({
    queryKey: operatorTaskKeys.detail(id ?? ''),
    queryFn: () => request<OperatorTaskDetail>(`/operator/tasks/${id}`),
    enabled: id !== null,
  });
}

export function useAssignableExperts(taskId: string) {
  return useQuery({
    queryKey: operatorTaskKeys.experts(taskId),
    queryFn: () => request<AssignableExpert[]>(`/operator/tasks/${taskId}/experts`),
  });
}

// 分派或改派；别人刚改过时后台返回 409，列表和详情都重新取，让运营看到最新情况再决定
export function useAssignExpert(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignExpertInput) =>
      request<OperatorTask>(`/operator/tasks/${taskId}/assign`, { method: 'POST', body: JSON.stringify(input) }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: operatorTaskKeys.list });
      void client.invalidateQueries({ queryKey: operatorTaskKeys.detail(taskId) });
      void client.invalidateQueries({ queryKey: operatorTaskKeys.experts(taskId) });
      // 改派后期限重新算、改派记一条运营记录
      void client.invalidateQueries({ queryKey: operatorTaskKeys.overdue });
      void client.invalidateQueries({ queryKey: operatorTaskKeys.notes(taskId) });
      // 组织详情「企业与任务」里的阶段跟着变
      void client.invalidateQueries({ queryKey: ['operator', 'organizations'] });
    },
  });
}
