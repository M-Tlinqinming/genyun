import type { Category, TaskDocumentSelection, TaskStatus } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './request';

// 任务关联的企业原始资料（资料库里某一份资料的某个版本）
export interface TaskDocument {
  documentId: string;
  versionId: string;
  name: string;
  // 为空表示待整理
  category: Category | null;
  version: number;
  fileId: string;
  contentType: string;
  sizeBytes: number;
  linkedAt: string;
  // 资料库里这份资料的最新版本；比 version 新时提示，不自动替换
  latestVersion: number;
}

export const taskDocumentsKey = (taskId: string) => ['tasks', taskId, 'documents'] as const;

export function useTaskDocuments(taskId: string) {
  return useQuery({
    queryKey: taskDocumentsKey(taskId),
    queryFn: () => request<TaskDocument[]>(`/tasks/${taskId}/documents`),
  });
}

export function addTaskDocument(taskId: string, fileId: string) {
  return request<TaskDocument[]>(`/tasks/${taskId}/documents`, { method: 'POST', body: JSON.stringify({ fileId }) });
}

// 从企业资料中选用：确认后任务关联的就是这些资料与版本
export function selectTaskDocuments(taskId: string, input: TaskDocumentSelection) {
  return request<TaskDocument[]>(`/tasks/${taskId}/documents`, { method: 'PUT', body: JSON.stringify(input) });
}

export function removeTaskDocument(taskId: string, documentId: string) {
  return request<TaskDocument[]>(`/tasks/${taskId}/documents/${documentId}`, { method: 'DELETE' });
}

// 预览 / 下载：取 5 分钟有效的链接后在新窗口打开。先同步开窗口，避免取链接后再开被浏览器当成弹窗拦截
export async function openFile(fileId: string) {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  try {
    const { url } = await request<{ url: string }>(`/files/${fileId}/download-url`);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (err) {
    win?.close();
    throw err;
  }
}

// ---- 企业资料库（11 页 C03 企业资料） ----

export interface DocumentVersion {
  versionId: string;
  version: number;
  fileId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface EnterpriseDocument {
  id: string;
  name: string;
  category: Category | null;
  updatedAt: string;
  latest: DocumentVersion;
  versionCount: number;
}

export interface DocumentDetail {
  id: string;
  name: string;
  category: Category | null;
  versions: (DocumentVersion & { tasks: { taskId: string; number: string; name: string; status: TaskStatus }[] })[];
}

export const enterpriseDocumentsKey = (enterpriseId: string) => ['enterprises', enterpriseId, 'documents'] as const;
export const documentDetailKey = (enterpriseId: string, documentId: string) =>
  [...enterpriseDocumentsKey(enterpriseId), documentId] as const;

export function useEnterpriseDocuments(enterpriseId: string, enabled = true) {
  return useQuery({
    queryKey: enterpriseDocumentsKey(enterpriseId),
    queryFn: () => request<EnterpriseDocument[]>(`/enterprises/${enterpriseId}/documents`),
    enabled,
  });
}

export function useDocumentDetail(enterpriseId: string, documentId: string | null) {
  return useQuery({
    queryKey: documentDetailKey(enterpriseId, documentId ?? ''),
    queryFn: () => request<DocumentDetail>(`/enterprises/${enterpriseId}/documents/${documentId}`),
    enabled: documentId !== null,
  });
}

export function uploadEnterpriseDocument(enterpriseId: string, fileId: string) {
  return request<EnterpriseDocument[]>(`/enterprises/${enterpriseId}/documents`, {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
}

export function addDocumentVersion(enterpriseId: string, documentId: string, fileId: string) {
  return request<DocumentDetail>(`/enterprises/${enterpriseId}/documents/${documentId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 「09.20 09:55」
export function shortDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}
