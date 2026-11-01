import type { PublishRequest, PublishView } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './request';

// 成果发布（M2 第 15 项）：发布页的数据、发布、按 publishId 查询那一次发布的结果

export const publicationKey = (taskId: string) => ['tasks', taskId, 'publication'] as const;

// 正在发布时每两秒问一次进度
export function usePublication(taskId: string) {
  return useQuery({
    queryKey: publicationKey(taskId),
    queryFn: () => request<PublishView>(`/tasks/${taskId}/publication`),
    refetchInterval: (q) => (q.state.data?.attempt?.status === 'publishing' ? 2000 : false),
  });
}

/** 查询某一次发布：后台没收到过时 attempt 为 null */
export function queryPublication(taskId: string, publishId: string) {
  return request<PublishView>(`/tasks/${taskId}/publication?publishId=${encodeURIComponent(publishId)}`);
}

/** 发布要出三份 Word 再存档，最多等一分钟；超时按「结果暂未确认」处理，先查询再决定要不要重试 */
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
