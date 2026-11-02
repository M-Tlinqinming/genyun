import type { CustomerFeedback, FeedbackActionInput, FeedbackCreateInput, OperatorFeedback, OperatorFeedbackView } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operatorOverviewKey } from './operatorOverview';
import { request } from './request';

// 反馈受理：客户提交、查看自己的反馈；运营列表、受理、转给注安师、回复并关闭

const customerKey = (orgId: string) => ['feedback', 'customer', orgId] as const;
const operatorKey = ['feedback', 'operator'] as const;

export function useMyFeedback(orgId: string) {
  return useQuery({
    queryKey: customerKey(orgId),
    queryFn: () => request<CustomerFeedback[]>(`/orgs/${orgId}/feedback`),
  });
}

export function useSubmitFeedback(orgId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: FeedbackCreateInput) => request<CustomerFeedback>(`/orgs/${orgId}/feedback`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: customerKey(orgId) }),
  });
}

export function useOperatorFeedback() {
  return useQuery({
    queryKey: operatorKey,
    queryFn: () => request<OperatorFeedbackView>('/operator/feedback'),
  });
}

export function useFeedbackAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: FeedbackActionInput & { id: string }) =>
      request<OperatorFeedback>(`/operator/feedback/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    // 处理完刷新列表，以及概览和侧栏角标里的「待受理反馈」
    onSettled: () => {
      void client.invalidateQueries({ queryKey: operatorKey });
      void client.invalidateQueries({ queryKey: operatorOverviewKey });
    },
  });
}
