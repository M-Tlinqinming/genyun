import type { DraftKind, HistoryEntry, PreviewView, ReviewRequest, ReviewView } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './request';

// 核对定稿：三份逐份核对、Word 预览的 PDF、审核结论、处理记录

export const reviewKey = (taskId: string) => ['tasks', taskId, 'draft-review'] as const;
export const previewKey = (taskId: string, kind: DraftKind) => ['tasks', taskId, 'drafts', kind, 'preview'] as const;

export function useReview(taskId: string) {
  return useQuery({
    queryKey: reviewKey(taskId),
    queryFn: () => request<ReviewView>(`/tasks/${taskId}/draft-review`),
  });
}

export function checkDraft(taskId: string, kind: DraftKind, version: number) {
  return request<ReviewView>(`/tasks/${taskId}/drafts/${kind}/check`, {
    method: 'PUT',
    body: JSON.stringify({ version }),
  });
}

export function concludeReview(taskId: string, input: ReviewRequest) {
  return request<ReviewView>(`/tasks/${taskId}/draft-review`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// 正在转 PDF 时每两秒问一次
export function usePreview(taskId: string, kind: DraftKind, enabled: boolean) {
  return useQuery({
    queryKey: previewKey(taskId, kind),
    queryFn: () => request<PreviewView>(`/tasks/${taskId}/drafts/${kind}/preview`),
    enabled,
    refetchInterval: (q) => (q.state.data?.status === 'converting' ? 2000 : false),
  });
}

export function retryPreview(taskId: string, kind: DraftKind) {
  return request<PreviewView>(`/tasks/${taskId}/drafts/${kind}/preview/retry`, {
    method: 'POST',
  });
}

export const previewFileUrl = (taskId: string, kind: DraftKind, version: number) => `/api/tasks/${taskId}/drafts/${kind}/preview/file?v=${version}`;

export const historyKey = (taskId: string) => ['tasks', taskId, 'history'] as const;

/** 处理记录（新的在前）；抽屉打开时才取 */
export function useHistory(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: historyKey(taskId),
    queryFn: () => request<HistoryEntry[]>(`/tasks/${taskId}/history`),
    enabled,
  });
}
