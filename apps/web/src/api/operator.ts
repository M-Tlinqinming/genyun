import type { OrgOpenDraft, OrgRegisterInput, OrgServiceState, ServiceScopeKind } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from './request';

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

export interface OperatorOrgDetail extends OperatorOrg {
  contractFile: ContractFile | null;
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
      request<OperatorOrg & { invitation: { email: string; expiresAt: string; mailSent: boolean; mailSimulated: boolean } }>(
        `/operator/organizations/${id}/open`,
        { method: 'POST', body: JSON.stringify(draft) },
      ),
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
  const res = await fetch(`/api/operator/organizations/${orgId}/contract-file`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new ApiError(res.status, typeof body?.message === 'string' ? body.message : '上传失败，请重新上传', body);
  }
  return body as unknown as ContractFile;
}
