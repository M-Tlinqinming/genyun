import type {
  BusinessType,
  CallTime,
  ChecklistItemKey,
  ChecklistItemUpdate,
  ChecklistState,
  ContractPeriod,
  DocumentVersionRef,
  OnSiteRequestInput,
  Review,
  StartMethod,
  SubmitRequest,
  SubmittedAnswer,
  SubmittedDocument,
  TaskCreateInput,
  TaskStatus,
  TaskUpdateInput,
} from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enterpriseKeys, orgTasksKey } from './enterprises';
import { ApiError, request } from './request';

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

// 提交生成申请（13 页 F01–F08）。确认框与「查询提交结果」读同一个接口
export interface Submission {
  submittedAt: string;
  submittedByName: string;
  documents: SubmittedDocument[];
  items: ChecklistState;
  answers: SubmittedAnswer[];
  pendingKeys: ChecklistItemKey[];
}

export interface SubmissionPreview {
  documents: SubmittedDocument[];
  taskDocuments: DocumentVersionRef[];
  answers: SubmittedAnswer[];
  canSubmit: boolean;
  pendingCount: number;
  fingerprint: string;
}

export type SubmissionState = { submitted: true; submission: Submission } | { submitted: false; preview: SubmissionPreview };

export const taskSubmissionKey = (id: string) => ['tasks', id, 'submission'] as const;

export function useTaskSubmission(id: string, enabled = true) {
  return useQuery({
    queryKey: taskSubmissionKey(id),
    queryFn: () => request<SubmissionState>(`/tasks/${id}/submission`),
    enabled,
  });
}

export function fetchTaskSubmission(id: string) {
  return request<SubmissionState>(`/tasks/${id}/submission`);
}

// 提交结果分三种：成功；确定没交上（如资料已变、规则不允许），可以照提示处理；
// 不确定（断网、超时、服务器出错），可能已经交上，只能先查询，不能直接再交
export class SubmitUnknownError extends Error {}

const SUBMIT_TIMEOUT_MS = 30_000;

export async function submitTask(id: string, input: SubmitRequest): Promise<Submission> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  try {
    return await request<Submission>(`/tasks/${id}/submission`, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (err) {
    // 0 是断网或 30 秒超时中断（request 包成 ApiError(0)），和 5xx 一样算不确定
    if (err instanceof ApiError && err.status > 0 && err.status < 500) throw err;
    throw new SubmitUnknownError(err instanceof Error ? err.message : '提交结果未知');
  } finally {
    clearTimeout(timer);
  }
}
