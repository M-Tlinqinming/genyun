import type {
  BusinessType,
  CallTime,
  ChecklistItemKey,
  ChecklistItemUpdate,
  ChecklistState,
  ContractPeriod,
  OnSiteRequestInput,
  OnSiteStatus,
  Review,
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

// 企业自填第 5 步「核对」（另带预约上门的默认联系人、合同有效期、最近一次上门需求）
export interface OnSiteRequest {
  id: string;
  contactName: string;
  contactPhone: string;
  callTime: CallTime | null;
  helpItems: string[];
  note: string | null;
  status: OnSiteStatus;
  createdAt: string;
}

export interface TaskReview {
  review: Review;
  contact: { name: string; phone: string };
  contract: { startsAt: string | null; endsAt: string | null };
  onSiteRequest: OnSiteRequest | null;
}

export const taskReviewKey = (id: string) => ['tasks', id, 'review'] as const;

// 每次进入都重新读，前几步刚改过的内容马上反映出来
export function useTaskReview(id: string) {
  return useQuery({
    queryKey: taskReviewKey(id),
    queryFn: () => request<TaskReview>(`/tasks/${id}/review`),
    gcTime: 0,
  });
}

export function useRequestOnSite(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OnSiteRequestInput) =>
      request<OnSiteRequest>(`/tasks/${taskId}/on-site-requests`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (created) => {
      client.setQueryData<TaskReview>(taskReviewKey(taskId), (old) => old && { ...old, onSiteRequest: created });
    },
  });
}

// 资料检查页（12 页 P05）：各项状态、挂的文件名、确认人姓名；页面用 checkOverview() 按类别汇总
export interface TaskCheck {
  items: ChecklistState;
  fileNames: Record<string, string>;
  userNames: Record<string, string>;
}

export const taskCheckKey = (id: string) => ['tasks', id, 'check'] as const;

export function useTaskCheck(id: string) {
  return useQuery({
    queryKey: taskCheckKey(id),
    queryFn: () => request<TaskCheck>(`/tasks/${id}/check`),
  });
}

export function updateChecklistItem(taskId: string, key: ChecklistItemKey, input: ChecklistItemUpdate) {
  return request(`/tasks/${taskId}/checklist/${key}`, { method: 'PUT', body: JSON.stringify(input) });
}
