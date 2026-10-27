import type { EnterpriseInput, EnterpriseUpdate, TaskStatus } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';

export interface Enterprise {
  id: string;
  orgId: string;
  name: string;
  socialCreditCode: string | null;
  registeredAddress: string | null;
  legalRepresentative: string | null;
  createdAt: string;
  updatedAt: string;
}

// 企业页只用到任务的这些字段；完整任务详情在任务页取
export interface TaskSummary {
  id: string;
  enterpriseId: string;
  number: string;
  name: string;
  status: TaskStatus;
  createdAt: string;
  closedAt: string | null;
}

export const enterpriseKeys = {
  list: (orgId: string) => ['orgs', orgId, 'enterprises'] as const,
  detail: (id: string) => ['enterprises', id] as const,
};
export const orgTasksKey = (orgId: string) => ['orgs', orgId, 'tasks'] as const;

export function useEnterprises(orgId: string) {
  return useQuery({
    queryKey: enterpriseKeys.list(orgId),
    queryFn: () => request<Enterprise[]>(`/orgs/${orgId}/enterprises`),
  });
}

export function useEnterprise(id: string) {
  return useQuery({
    queryKey: enterpriseKeys.detail(id),
    queryFn: () => request<Enterprise>(`/enterprises/${id}`),
  });
}

export function useOrgTasks(orgId: string) {
  return useQuery({
    queryKey: orgTasksKey(orgId),
    queryFn: () => request<TaskSummary[]>(`/orgs/${orgId}/tasks`),
  });
}

export function useCreateEnterprise(orgId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EnterpriseInput) =>
      request<Enterprise>(`/orgs/${orgId}/enterprises`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (created) => {
      client.setQueryData(enterpriseKeys.detail(created.id), created);
      void client.invalidateQueries({ queryKey: enterpriseKeys.list(orgId) });
    },
  });
}

export function useUpdateEnterprise(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EnterpriseUpdate) =>
      request<Enterprise>(`/enterprises/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: (updated) => {
      client.setQueryData(enterpriseKeys.detail(id), updated);
      void client.invalidateQueries({ queryKey: enterpriseKeys.list(updated.orgId) });
    },
  });
}

// 没结束的任务（closedAt 为空）才算「在办」
export function openTasksOf(tasks: TaskSummary[] | undefined, enterpriseId: string): TaskSummary[] {
  return (tasks ?? []).filter((t) => t.enterpriseId === enterpriseId && t.closedAt === null);
}
