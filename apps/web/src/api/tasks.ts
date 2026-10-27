import type {
  BusinessType,
  ContractPeriod,
  StartMethod,
  TaskCreateInput,
  TaskStatus,
  TaskUpdateInput,
} from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enterpriseKeys, orgTasksKey } from './enterprises';
import { request } from './request';

export interface Task {
  id: string;
  orgId: string;
  enterpriseId: string;
  enterpriseName: string;
  number: string;
  businessType: BusinessType;
  name: string;
  startMethod: StartMethod | null;
  status: TaskStatus;
  assignedExpertId: string | null;
  assignedExpertName: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  closedAt: string | null;
}

export interface Organization extends ContractPeriod {
  id: string;
  name: string;
}

// 重复创建时后台随 409 返回的已有任务
export interface ExistingTask {
  id: string;
  number: string;
  name: string;
}

export const taskKey = (id: string) => ['tasks', id] as const;

export function useTask(id: string) {
  return useQuery({
    queryKey: taskKey(id),
    queryFn: () => request<Task>(`/tasks/${id}`),
  });
}

export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: ['orgs', orgId],
    queryFn: () => request<Organization>(`/orgs/${orgId}`),
  });
}

export function useCreateTask(enterpriseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskCreateInput) =>
      request<Task>(`/enterprises/${enterpriseId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (created) => {
      client.setQueryData(taskKey(created.id), created);
      void client.invalidateQueries({ queryKey: orgTasksKey(created.orgId) });
      void client.invalidateQueries({
        queryKey: enterpriseKeys.list(created.orgId),
      });
    },
  });
}

export function useUpdateTask(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskUpdateInput) =>
      request<Task>(`/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (updated) => {
      client.setQueryData(taskKey(id), updated);
      void client.invalidateQueries({ queryKey: orgTasksKey(updated.orgId) });
    },
  });
}
