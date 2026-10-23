import { describe, expect, it } from 'vitest';
import { loginSchema } from './auth.ts';
import { workspaceOf } from './roles.ts';

describe('workspaceOf', () => {
  it('maps each role to its workspace', () => {
    expect(workspaceOf('customer_admin')).toBe('customer');
    expect(workspaceOf('customer_member')).toBe('customer');
    expect(workspaceOf('expert')).toBe('expert');
    expect(workspaceOf('operator')).toBe('operator');
  });
});

describe('loginSchema', () => {
  it('rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'abc', password: 'x' }).success).toBe(false);
  });
  it('accepts a valid login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.cn', password: 'x' }).success).toBe(true);
  });
});
