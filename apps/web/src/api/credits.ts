import type { OrgCredits } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './request';

// 组织管理员看自己组织的编制次数（工作台底部那一条、组织管理「年度服务」页签）。普通成员不调
export const orgCreditsKey = (orgId: string) => ['orgs', orgId, 'credits'] as const;

export function useOrgCredits(orgId: string, enabled = true) {
  return useQuery({
    queryKey: orgCreditsKey(orgId),
    queryFn: () => request<OrgCredits>(`/orgs/${orgId}/credits`),
    enabled,
  });
}
