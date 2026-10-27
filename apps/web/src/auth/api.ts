import type { LoginInput, Role } from '@genyun/shared';
import { request } from '../api/request';

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

export { ApiError } from '../api/request';

export const authApi = {
  me: () => request<SessionUser>('/auth/me'),
  login: (input: LoginInput) => request<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};
