import type { LoginInput, Role } from '@genyun/shared';

export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  memberships: Membership[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, body?.message ?? '请求失败，请稍后重试');
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const authApi = {
  me: () => request<SessionUser>('/auth/me'),
  login: (input: LoginInput) => request<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};
