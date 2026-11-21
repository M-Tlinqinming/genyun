import type { PublishRequest, PublishView } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './request';

// 定稿并交付：交付的数据、交付、按 publishId 查询那一次交付的结果、交付后重新打开

export const publicationKey = (taskId: string) => ['tasks', taskId, 'publication'] as const;

// 正在交付时每两秒问一次进度。enabled = false 时先不问（三份初稿还没生成完）
export function usePublication(taskId: string, enabled = true) {
  return useQuery({
    queryKey: publicationKey(taskId),
    enabled,
    queryFn: () => request<PublishView>(`/tasks/${taskId}/publication`),
    refetchInterval: (q) => (q.state.data?.attempt?.status === 'publishing' ? 2000 : false),
  });
}

/** 查询某一次交付：后台没收到过时 attempt 为 null */
export function queryPublication(taskId: string, publishId: string) {
  return request<PublishView>(`/tasks/${taskId}/publication?publishId=${encodeURIComponent(publishId)}`);
}

/** 交付要出三份 Word 再存档，最多等一分钟；超时按「结果暂未确认」处理，先查询再决定要不要重试 */
export const PUBLISH_WAIT_MS = 60_000;

export async function publish(taskId: string, input: PublishRequest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLISH_WAIT_MS);
  try {
    return await request<PublishView>(`/tasks/${taskId}/publication`, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 交付后重新打开：回交付页的数据（已经重新打开过的，接口回 409 already_reopened） */
export function reopenTask(taskId: string) {
  return request<PublishView>(`/tasks/${taskId}/reopen`, { method: 'POST', body: '{}' });
}
