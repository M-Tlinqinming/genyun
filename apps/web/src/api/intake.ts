import type { IntakeFileSlot, IntakeUploadResult, IntakeView } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError, NETWORK_TROUBLE, SERVER_TROUBLE, request } from './request';

// 准备资料（新流程）：读当前资料、上传、删除、「这张图我们没有」

export const intakeKey = (taskId: string) => ['tasks', taskId, 'intake'] as const;

export function useIntake(taskId: string, enabled = true) {
  return useQuery({
    queryKey: intakeKey(taskId),
    queryFn: () => request<IntakeView>(`/tasks/${taskId}/intake`),
    enabled,
  });
}

/** 资料模板下载地址：登录后直接下载，文件名由后台给 */
export const INTAKE_TEMPLATE_URL = '/api/intake/template';

export function removeIntakeFile(taskId: string, id: string) {
  return request<IntakeView>(`/tasks/${taskId}/intake/files/${id}`, { method: 'DELETE' });
}

export function setNoEvacuationMap(taskId: string, value: boolean) {
  return request<IntakeView>(`/tasks/${taskId}/intake/no-evacuation-map`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

/** 提交给专家：requestId 每次打开确认弹窗生成一个，失败重试沿用，重发只记一次 */
export function submitIntake(taskId: string, requestId: string) {
  return request<IntakeView>(`/tasks/${taskId}/intake/submit`, { method: 'POST', body: JSON.stringify({ requestId }) });
}

/** 撤回提交：409 时 body.code 是 withdraw_used（撤回过了）或 expert_started（专家已开始核对） */
export function withdrawIntake(taskId: string) {
  return request<IntakeView>(`/tasks/${taskId}/intake/withdraw`, { method: 'POST' });
}

/** 删除任务：只有还没提交给专家的新流程任务 */
export function deleteTask(taskId: string) {
  return request<void>(`/tasks/${taskId}`, { method: 'DELETE' });
}

/** 上传被取消（点了「取消」），不当作出错 */
export class UploadAbortedError extends Error {}

/**
 * 用 XHR 上传一个文件，好显示进度、能取消。
 * 出错时抛 ApiError：status 0 是网络断了，4xx 带后台写好的说明（压缩包、类型、大小）
 */
export function uploadIntakeFile(
  taskId: string,
  slot: IntakeFileSlot,
  file: File,
  onProgress: (percent: number) => void,
  onSent: () => void,
): { done: Promise<IntakeUploadResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<IntakeUploadResult>((resolve, reject) => {
    xhr.open('POST', `/api/tasks/${taskId}/intake/files?slot=${slot}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.upload.onload = () => onSent();
    xhr.onerror = () => reject(new ApiError(0, NETWORK_TROUBLE));
    xhr.ontimeout = () => reject(new ApiError(0, NETWORK_TROUBLE));
    xhr.onabort = () => reject(new UploadAbortedError());
    xhr.onload = () => {
      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as unknown as IntakeUploadResult);
        return;
      }
      const message =
        xhr.status >= 500 ? SERVER_TROUBLE : typeof body?.message === 'string' ? body.message : SERVER_TROUBLE;
      reject(new ApiError(xhr.status, message, body));
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
  return { done, abort: () => xhr.abort() };
}

/** 取文件的临时链接（5 分钟有效）；inline 在浏览器里直接看（图片、PDF） */
export function fileUrl(fileId: string, inline = false) {
  return request<{ url: string }>(`/files/${fileId}/download-url${inline ? '?inline=1' : ''}`);
}

/** 查看：先同步开新窗口，免得取到链接后再开被当成弹窗拦掉 */
export async function viewFile(fileId: string) {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  try {
    const { url } = await fileUrl(fileId, true);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (err) {
    win?.close();
    throw err;
  }
}

/** 下载：链接是附件，当前页直接下载，不跳走 */
export async function downloadFile(fileId: string) {
  const { url } = await fileUrl(fileId);
  window.location.href = url;
}
