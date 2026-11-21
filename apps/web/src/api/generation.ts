import { draftActive, type DraftKind, type GenerationMaterials, type GenerationProgress } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { ApiError, request } from './request';

export const generationKey = (taskId: string) => ['tasks', taskId, 'generation'] as const;
export const materialsKey = (taskId: string) => ['tasks', taskId, 'generation', 'materials'] as const;

// 最近一批草稿的进度；还有排队或生成中的份时每 2 秒刷新一次
export function useGeneration(taskId: string) {
  return useQuery({
    queryKey: generationKey(taskId),
    queryFn: () => request<{ current: GenerationProgress | null }>(`/tasks/${taskId}/generation`),
    refetchInterval: (q) => (q.state.data?.current?.drafts.some(draftActive) ? 2000 : false),
  });
}

// 确认页左表：本次采用的资料与变化提示
export function useMaterials(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: materialsKey(taskId),
    queryFn: () => request<GenerationMaterials>(`/tasks/${taskId}/generation/materials`),
    enabled,
    refetchOnWindowFocus: true,
  });
}

// 确认采用并生成：带上整理版本和看到的资料指纹，后台再查一次
export function useConfirmGeneration(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { version: number; materials: string }) =>
      request<{ current: GenerationProgress }>(`/tasks/${taskId}/generation`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (res) => {
      client.setQueryData(generationKey(taskId), res);
      // 新一批：审核按新一批重来
      void client.invalidateQueries({ queryKey: ['tasks', taskId, 'draft-review'] });
    },
  });
}

/** 这一份已经不是失败的了（别人刚重做过、或已经生成好） */
export const isDraftNotFailed = (err: unknown) => err instanceof ApiError && err.body?.code === 'draft_not_failed';

// 只重试失败的份；带 kind 只重做这一份。这一份已经不是失败的：提示接口那句话，重取进度
export function useRetryGeneration(taskId: string) {
  const client = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: (kind?: DraftKind) =>
      request<{ current: GenerationProgress }>(`/tasks/${taskId}/generation/retry`, {
        method: 'POST',
        ...(kind ? { body: JSON.stringify({ kind }) } : {}),
      }),
    onSuccess: (res) => client.setQueryData(generationKey(taskId), res),
    onError: (err) => {
      if (!isDraftNotFailed(err)) return;
      message.info((err as ApiError).message);
      void client.invalidateQueries({ queryKey: generationKey(taskId) });
    },
  });
}
