import type { OperatorOverview } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './request';

export const operatorOverviewKey = ['operator', 'overview'] as const;

// 运营概览：四个统计、今天先处理、客户年度服务、最近操作。侧栏角标也用它（只在运营工作区取）
export function useOperatorOverview(enabled = true) {
  return useQuery({
    queryKey: operatorOverviewKey,
    queryFn: () => request<OperatorOverview>('/operator/overview'),
    enabled,
    // 侧栏角标要跟得上：一分钟取一次，切回窗口时也取
    refetchInterval: enabled ? 60_000 : false,
  });
}
