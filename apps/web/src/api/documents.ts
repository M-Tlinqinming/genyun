import type { Category } from '@genyun/shared';
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
