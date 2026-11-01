import type {
  AccountNameInput,
  AccountView,
  ChangePasswordInput,
  LoginInput,
  RecoveryResetInput,
  RecoverySendInput,
  Role,
} from '@genyun/shared';
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
  sendRecoveryCode: (input: RecoverySendInput) =>
    request<void>('/auth/recover/send', { method: 'POST', body: JSON.stringify(input) }),
  resetPassword: (input: RecoveryResetInput) =>
    request<SessionUser>('/auth/recover/reset', { method: 'POST', body: JSON.stringify(input) }),
};

export const accountApi = {
  get: () => request<AccountView>('/account'),
  rename: (input: AccountNameInput) => request<AccountView>('/account', { method: 'PATCH', body: JSON.stringify(input) }),
  changePassword: (input: ChangePasswordInput) =>
    request<void>('/account/password', { method: 'POST', body: JSON.stringify(input) }),
  signOutOthers: () => request<void>('/account/sign-out-others', { method: 'POST' }),
};
