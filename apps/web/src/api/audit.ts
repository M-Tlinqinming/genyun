import type { AuditAction, AuditLogPage } from '@genyun/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { request } from './request';

// 运营查看操作日志（只读）
export function useAuditLogs(page: number, action: AuditAction | undefined) {
  return useQuery({
    queryKey: ['operator', 'audit-logs', page, action ?? 'all'],
    queryFn: () => {
      const q = new URLSearchParams({ page: String(page) });
      if (action) q.set('action', action);
      return request<AuditLogPage>(`/operator/audit-logs?${q}`);
    },
    // 翻页、换筛选时先留着上一页，不闪空表
    placeholderData: keepPreviousData,
  });
}
