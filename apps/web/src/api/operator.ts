import type {
  AdminInvitationInput,
  InvitationState,
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
