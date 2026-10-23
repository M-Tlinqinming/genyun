import { workspaceOf, type Workspace } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, authApi, type Membership, type SessionUser } from './api';

const SESSION_KEY = ['session'];

export function useSession() {
  return useQuery<SessionUser | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => client.setQueryData(SESSION_KEY, user),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      client.clear();
      client.setQueryData(SESSION_KEY, null);
    },
  });
}

export const WORKSPACE_HOME: Record<Workspace, string> = {
  customer: '/customer',
  expert: '/expert',
  operator: '/operator',
};

export function membershipsIn(user: SessionUser, workspace: Workspace): Membership[] {
  return user.memberships.filter((m) => workspaceOf(m.role) === workspace);
}
