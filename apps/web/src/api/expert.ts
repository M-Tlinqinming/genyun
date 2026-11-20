import type { ExpertAcceptingInput, ExpertCenterData } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';

export const expertTaskKeys = { list: ['expert', 'tasks'] as const };

// 专家任务中心：分给自己的任务（已排好序）、四格统计、接单状态
export function useExpertTasks() {
  return useQuery({ queryKey: expertTaskKeys.list, queryFn: () => request<ExpertCenterData>('/expert/tasks') });
}

// 暂停 / 恢复接单
export function useSetAccepting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ExpertAcceptingInput) =>
      request<ExpertAcceptingInput>('/expert/accepting', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (res) => {
      client.setQueryData<ExpertCenterData>(expertTaskKeys.list, (old) => (old ? { ...old, acceptingOrders: res.acceptingOrders } : old));
    },
  });
}
