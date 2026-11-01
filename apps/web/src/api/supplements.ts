import type {
  CustomerSupplement,
  FactSupplement,
  SupplementAdopt,
  SupplementCreate,
  SupplementResponseInput,
} from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generationKey } from './generation';
import { request } from './request';
import { taskKey } from './tasks';
import { workupKey } from './workup';

// 事实补件（M2 第 13 项，Paper 15 页 R00a、R00b、R00c）
export const supplementsKey = (taskId: string) => ['tasks', taskId, 'supplements'] as const;
export const supplementRequestsKey = (taskId: string) => ['tasks', taskId, 'supplement-requests'] as const;

// 专家：各轮补件，最近的在前
export function useSupplements(taskId: string) {
  return useQuery({
    queryKey: supplementsKey(taskId),
    queryFn: () => request<FactSupplement[]>(`/tasks/${taskId}/supplements`),
  });
}

function useExpertMutation<T>(taskId: string, fn: (input: T) => Promise<FactSupplement[]>, refreshFacts = false) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (list) => {
      client.setQueryData(supplementsKey(taskId), list);
      void client.invalidateQueries({ queryKey: ['expert', 'tasks'] });
      if (refreshFacts) {
        // 采用后企业事实变了，确认采用资料页会按新事实标出变化
        void client.invalidateQueries({ queryKey: workupKey(taskId) });
        void client.invalidateQueries({ queryKey: generationKey(taskId) });
      }
    },
  });
}

export function useCreateSupplement(taskId: string) {
  return useExpertMutation(taskId, (input: SupplementCreate) =>
    request<FactSupplement[]>(`/tasks/${taskId}/supplements`, { method: 'POST', body: JSON.stringify(input) }),
  );
}

export function useAdoptSupplement(taskId: string) {
  return useExpertMutation(
    taskId,
    ({ id, ...input }: SupplementAdopt & { id: string }) =>
      request<FactSupplement[]>(`/tasks/${taskId}/supplements/${id}/adopt`, { method: 'POST', body: JSON.stringify(input) }),
    true,
  );
}

export function useReturnSupplement(taskId: string) {
  return useExpertMutation(taskId, ({ id, message }: { id: string; message: string }) =>
    request<FactSupplement[]>(`/tasks/${taskId}/supplements/${id}/return`, { method: 'POST', body: JSON.stringify({ message }) }),
  );
}

// 客户：只看到要确认什么和自己的回应
export function useCustomerSupplements(taskId: string) {
  return useQuery({
    queryKey: supplementRequestsKey(taskId),
    queryFn: () => request<CustomerSupplement[]>(`/tasks/${taskId}/supplement-requests`),
  });
}

export function useRespondSupplement(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: SupplementResponseInput & { id: string }) =>
      request<CustomerSupplement[]>(`/tasks/${taskId}/supplement-requests/${id}/response`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (list) => {
      client.setQueryData(supplementRequestsKey(taskId), list);
      void client.invalidateQueries({ queryKey: taskKey(taskId) });
    },
  });
}
