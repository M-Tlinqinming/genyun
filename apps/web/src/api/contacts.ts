import type { ContactAnswer, ContactCreate, ContactQuestion, ContactRecord } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';
import { taskCheckKey } from './tasks';
import { workupKey } from './workup';

export const contactsKey = (taskId: string) => ['tasks', taskId, 'contacts'] as const;
export const requestsKey = (taskId: string) => ['tasks', taskId, 'requests'] as const;

// 联系记录（专家「处理记录」）：客户看不到
export function useContacts(taskId: string) {
  return useQuery({
    queryKey: contactsKey(taskId),
    queryFn: () => request<ContactRecord[]>(`/tasks/${taskId}/contacts`),
  });
}

// 专家联系客户：电话问清会回填企业事实、把请求联系的资料项变为已补，所以一并刷新
export function useCreateContact(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactCreate) =>
      request<ContactRecord[]>(`/tasks/${taskId}/contacts`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (records) => {
      client.setQueryData(contactsKey(taskId), records);
      void client.invalidateQueries({ queryKey: workupKey(taskId) });
      void client.invalidateQueries({ queryKey: taskCheckKey(taskId) });
      void client.invalidateQueries({ queryKey: ['expert', 'tasks'] });
    },
  });
}

// 客户看到的补充请求：只有问题和自己的回答
export interface CustomerRequest {
  id: string;
  questions: Pick<ContactQuestion, 'id' | 'label' | 'question' | 'answer' | 'fileIds'>[];
  createdAt: string;
  createdByName: string;
  answeredAt: string | null;
  answeredByName: string | null;
  files: { id: string; name: string }[];
}

export function useCustomerRequests(taskId: string) {
  return useQuery({
    queryKey: requestsKey(taskId),
    queryFn: () => request<CustomerRequest[]>(`/tasks/${taskId}/requests`),
  });
}

export function useAnswerRequest(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, ...input }: ContactAnswer & { contactId: string }) =>
      request<CustomerRequest[]>(`/tasks/${taskId}/requests/${contactId}/answer`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (list) => client.setQueryData(requestsKey(taskId), list),
  });
}
