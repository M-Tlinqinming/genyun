import { deliveryBundleName, type TaskDeliveries } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError, NETWORK_TROUBLE, request, SERVER_TROUBLE } from './request';

// 客户成果文档（M2 第 16 项，11 页 C06；15 页 R05、R06）：已交付的三份 Word 列出、下载（客户只看最新一次交付）

export const orgDeliveriesKey = (orgId: string) => ['orgs', orgId, 'deliveries'] as const;
export const taskDeliveriesKey = (taskId: string) => ['tasks', taskId, 'deliveries'] as const;

export function useOrgDeliveries(orgId: string) {
  return useQuery({
    queryKey: orgDeliveriesKey(orgId),
    queryFn: () => request<TaskDeliveries[]>(`/orgs/${orgId}/deliveries`),
  });
}

export function useTaskDeliveries(taskId: string) {
  return useQuery({
    queryKey: taskDeliveriesKey(taskId),
    queryFn: () => request<TaskDeliveries>(`/tasks/${taskId}/deliveries`),
  });
}

// 让浏览器把这个地址当下载处理（附件下载不会离开当前页面）
function save(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 下载一份 Word：先取 5 分钟有效的下载链接。取不到（断网、没权限）时抛 ApiError，页面提示重试 */
export async function downloadWord(fileId: string, name: string) {
  const { url } = await request<{ url: string }>(`/files/${fileId}/download-url`);
  save(url, name);
}

/** 下载整套：同一交付版本的三份 Word 打成一个压缩包 */
export async function downloadBundle(taskId: string, version: number, enterpriseName: string, publishedAt: string) {
  let res: Response;
  try {
    res = await fetch(`/api/tasks/${taskId}/deliveries/${version}/bundle`, { credentials: 'include' });
  } catch {
    throw new ApiError(0, NETWORK_TROUBLE);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new ApiError(res.status, res.status < 500 && typeof body?.message === 'string' ? body.message : SERVER_TROUBLE);
  }
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    throw new ApiError(0, NETWORK_TROUBLE);
  }
  const href = URL.createObjectURL(blob);
  save(href, deliveryBundleName(enterpriseName, publishedAt));
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
