import type { InternalAccountsView, InternalInviteInput, InternalRole } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operatorOverviewKey } from './operatorOverview';
import { request } from './request';

const accountsKey = ['operator', 'accounts'] as const;

export interface SentInternalInvitation {
  email: string;
  expiresAt: string;
  // 预览环境用模拟发件箱，邮件没有真正发出
  simulated: boolean;
}

// 内部账号与权限：耕云员工（运营管理员、注安师）的账号和待接受的邀请
export function useInternalAccounts() {
  return useQuery({ queryKey: accountsKey, queryFn: () => request<InternalAccountsView>('/operator/accounts') });
}

function useAccountsMutation<T, R>(fn: (input: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: accountsKey });
      // 概览里的「邀请未接受」、任务中心的注安师名单跟着变
      void client.invalidateQueries({ queryKey: operatorOverviewKey });
      void client.invalidateQueries({ queryKey: ['operator', 'tasks'] });
    },
  });
}

export function useInviteInternal() {
  return useAccountsMutation((input: InternalInviteInput) =>
    request<SentInternalInvitation>('/operator/accounts/invitations', { method: 'POST', body: JSON.stringify(input) }),
  );
}

export function useResendInternalInvitation() {
  return useAccountsMutation((id: string) =>
    request<SentInternalInvitation>(`/operator/accounts/invitations/${id}/resend`, { method: 'POST' }),
  );
}

export function useDisableAccount() {
  return useAccountsMutation((id: string) => request<InternalAccountsView>(`/operator/accounts/${id}/disable`, { method: 'POST' }));
}

export function useEnableAccount() {
  return useAccountsMutation((id: string) => request<InternalAccountsView>(`/operator/accounts/${id}/enable`, { method: 'POST' }));
}

export function useChangeRole() {
  return useAccountsMutation(({ id, role }: { id: string; role: InternalRole }) =>
    request<InternalAccountsView>(`/operator/accounts/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  );
}
