import type { CustomerRole, MemberInviteInput, MemberInviteResult, OrgManagementView, OrgProfileInput } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enterpriseKeys, orgTasksKey } from './enterprises';
import { request } from './request';

// 组织管理（机构管理员）：成员、邀请、企业分配、组织资料、年度服务
export const orgManagementKey = (orgId: string) => ['orgs', orgId, 'management'] as const;

export function useOrgManagement(orgId: string) {
  return useQuery({
    queryKey: orgManagementKey(orgId),
    queryFn: () => request<OrgManagementView>(`/orgs/${orgId}/management`),
  });
}

function useManagementMutation<T, R>(orgId: string, fn: (input: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      // 大多数操作直接返回最新的组织管理视图
      if (data && typeof data === 'object' && 'members' in data) client.setQueryData(orgManagementKey(orgId), data);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: orgManagementKey(orgId) });
      // 企业列表里的「负责成员」跟着变
      void client.invalidateQueries({ queryKey: enterpriseKeys.list(orgId) });
      void client.invalidateQueries({ queryKey: orgTasksKey(orgId) });
    },
  });
}

const base = (orgId: string) => `/orgs/${orgId}/management`;
const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });

export function useInviteMember(orgId: string) {
  return useManagementMutation(orgId, (input: MemberInviteInput) =>
    request<MemberInviteResult>(`${base(orgId)}/invitations`, { method: 'POST', body: JSON.stringify(input) }),
  );
}

export function useResendMemberInvitation(orgId: string) {
  return useManagementMutation(orgId, (id: string) =>
    request<MemberInviteResult>(`${base(orgId)}/invitations/${id}/resend`, { method: 'POST' }),
  );
}

export function useRevokeMemberInvitation(orgId: string) {
  return useManagementMutation(orgId, (id: string) =>
    request<OrgManagementView>(`${base(orgId)}/invitations/${id}/revoke`, { method: 'POST' }),
  );
}

export function useRemoveMember(orgId: string) {
  return useManagementMutation(orgId, (userId: string) =>
    request<OrgManagementView>(`${base(orgId)}/members/${userId}/remove`, { method: 'POST' }),
  );
}

export function useChangeMemberRole(orgId: string) {
  return useManagementMutation(orgId, ({ userId, role }: { userId: string; role: CustomerRole }) =>
    request<OrgManagementView>(`${base(orgId)}/members/${userId}/role`, put({ role })),
  );
}

export function useSetMemberEnterprises(orgId: string) {
  return useManagementMutation(orgId, ({ userId, enterpriseIds }: { userId: string; enterpriseIds: string[] }) =>
    request<OrgManagementView>(`${base(orgId)}/members/${userId}/enterprises`, put({ enterpriseIds })),
  );
}

export function useSetEnterpriseMembers(orgId: string) {
  return useManagementMutation(orgId, ({ enterpriseId, userIds }: { enterpriseId: string; userIds: string[] }) =>
    request<OrgManagementView>(`${base(orgId)}/enterprises/${enterpriseId}/members`, put({ userIds })),
  );
}

export function useUpdateOrgProfile(orgId: string) {
  return useManagementMutation(orgId, (input: OrgProfileInput) => request<OrgManagementView>(`${base(orgId)}/profile`, put(input)));
}
