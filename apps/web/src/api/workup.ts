import type { FactSave, ProductionSave, RiskSave, ScopeSave, WorkupData, WorkupSnapshot } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';

// 原件对照（右栏）：任务里能看到的客户文件
export interface WorkupOriginal {
  fileId: string;
  name: string;
  contentType: string;
  version: number | null;
  itemKeys: string[];
  uploadedAt: string;
}

export interface Workup {
  version: number;
  snapshot: WorkupSnapshot;
  snapshotAt: string;
  data: WorkupData;
  updatedAt: string;
  updatedByName: string | null;
  originals: WorkupOriginal[];
}

export const workupKey = (taskId: string) => ['tasks', taskId, 'workup'] as const;

export function useWorkup(taskId: string) {
  return useQuery({
    queryKey: workupKey(taskId),
    queryFn: () => request<Workup>(`/tasks/${taskId}/workup`),
  });
}

// 每改一项保存一次；版本对不上（别人刚改过）由页面提示后重新读取
export function useSaveFact(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FactSave) =>
      request<Workup>(`/tasks/${taskId}/workup/facts`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (saved) => client.setQueryData(workupKey(taskId), saved),
  });
}

// 生产设备与物料：一次保存一条判断或一行修改
export function useSaveProduction(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductionSave) =>
      request<Workup>(`/tasks/${taskId}/workup/production`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (saved) => client.setQueryData(workupKey(taskId), saved),
  });
}

// 危险源辨识：一次保存一行（改过的候选或新增行）
export function useSaveRisk(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RiskSave) =>
      request<Workup>(`/tasks/${taskId}/workup/risks`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (saved) => client.setQueryData(workupKey(taskId), saved),
  });
}

// 适用范围：一次确认或改一个开关，value 为 null 撤回到系统建议
export function useSaveScope(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ScopeSave) =>
      request<Workup>(`/tasks/${taskId}/workup/scope`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (saved) => client.setQueryData(workupKey(taskId), saved),
  });
}

// 在页面里显示的短时效链接（PDF、图片）
export function inlineUrl(fileId: string) {
  return request<{ url: string }>(`/files/${fileId}/download-url?inline=1`);
}
