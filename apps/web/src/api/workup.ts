import type {
  AgencyDistrict,
  BasicStepWorkupSave,
  CustomerDrawing,
  FactSave,
  OrganizationStepWorkupSave,
  StepsDoneSave,
  FiguresSave, ProductionSave, RiskSave, ScopeSave, WorkupData, WorkupSnapshot } from '@genyun/shared';
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
  // 知识库里的属地应急机构（企业事实里的属地机构按它算）
  agencyDistricts: AgencyDistrict[];
  // intake = 客户下载资料表格、上传后读表建的任务；legacy = 客户逐项填写的老任务
  flow: 'intake' | 'legacy';
  // 客户这次提交时上传的文件（资料表格、营业执照、图纸照片），按上传先后
  intakeFiles: WorkupIntakeFile[];
}

export interface WorkupIntakeFile {
  fileId: string;
  name: string;
  contentType: string;
  slot: string;
  uploadedAt: string;
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

// 图件：改画法（null 恢复自动排版）或采用图
export function useSaveFigures(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FiguresSave) =>
      request<Workup>(`/tasks/${taskId}/workup/figures`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (saved) => client.setQueryData(workupKey(taskId), saved),
  });
}

// 图件 · 客户图纸：任务里的图纸文件与页数（第一次打开时后台要逐份读页数，稍慢）；选页取自整理数据
export function useDrawings(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['tasks', taskId, 'drawings'] as const,
    queryFn: () => request<{ drawings: CustomerDrawing[] }>(`/tasks/${taskId}/drawings`),
    enabled,
  });
}

// 每页缩略图与高清图（第一次看时后台现转，复杂的 CAD 图要几十秒）
export const drawingPageUrl = (taskId: string, fileId: string, page: number, size: 'thumb' | 'full') =>
  `/api/tasks/${taskId}/drawings/${fileId}/pages/${page}/${size}`;

// 在页面里显示的短时效链接（PDF、图片）
export function inlineUrl(fileId: string) {
  return request<{ url: string }>(`/files/${fileId}/download-url?inline=1`);
}

// 资料核对向导：第 1、2 步整步保存；只记走到第几步（第 3–5 步还用原来的整理页时用）
function useStepSave<T>(taskId: string, path: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => request<Workup>(`/tasks/${taskId}/workup/steps/${path}`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (saved) => client.setQueryData(workupKey(taskId), saved),
  });
}

export const useSaveBasicStep = (taskId: string) => useStepSave<BasicStepWorkupSave>(taskId, 'basic');
export const useSaveOrganizationStep = (taskId: string) => useStepSave<OrganizationStepWorkupSave>(taskId, 'organization');
export const useSaveStepsDone = (taskId: string) => useStepSave<StepsDoneSave>(taskId, 'done');
