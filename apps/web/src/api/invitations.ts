import type { AcceptInvitationInput, InvitationState, Role } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '../auth/api';
import { request } from './request';

// 邀请链接打开时看到的内容（Paper 10 页 A02）；不需要登录
export interface InvitationView {
  state: InvitationState;
  orgName: string;
  inviterName: string;
  role: Role;
  email: string;
  name: string | null;
  expiresAt: string;
}

const key = (token: string) => ['invitation', token] as const;

export function useInvitation(token: string) {
  return useQuery({
    queryKey: key(token),
    queryFn: () => request<InvitationView>(`/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });
}

export function useAcceptInvitation(token: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptInvitationInput) =>
      request<SessionUser>(`/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    // 接受后已登录：直接换上新会话
    onSuccess: (user) => client.setQueryData(['session'], user),
    // 链接刚失效（被抢先使用、刚过期）时刷新状态
    onError: () => void client.invalidateQueries({ queryKey: key(token) }),
  });
}

// 链接过期后请邀请人重新发送：只给邀请人发站内提醒
export function useRequestResend(token: string) {
  return useMutation({
    mutationFn: () =>
      request<{ inviterName: string }>(`/invitations/${encodeURIComponent(token)}/request-resend`, { method: 'POST' }),
  });
}
