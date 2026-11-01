import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('请输入正确的邮箱'),
  password: z.string().min(1, '请输入密码'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// 新密码：至少 8 位，含字母和数字（A03 重设密码、A04 修改密码共用）
const PASSWORD_RULE = '至少 8 位，含字母和数字';
export const newPasswordSchema = z
  .string()
  .min(8, PASSWORD_RULE)
  .max(128, '密码不超过 128 位')
  .regex(/[A-Za-z]/, PASSWORD_RULE)
  .regex(/[0-9]/, PASSWORD_RULE);

// A03 账号恢复：6 位数字验证码，10 分钟有效，错 5 次作废，用过一次作废
export const RECOVERY_CODE_TTL_MINUTES = 10;
export const RECOVERY_CODE_MAX_ATTEMPTS = 5;
// 同一邮箱两次发送之间至少隔多少秒
export const RECOVERY_RESEND_SECONDS = 60;

export const recoverySendSchema = z.object({
  email: z.email('请输入正确的邮箱'),
});
export type RecoverySendInput = z.infer<typeof recoverySendSchema>;

export const recoveryResetSchema = z.object({
  email: z.email('请输入正确的邮箱'),
  code: z.string().regex(/^\d{6}$/, '请输入 6 位验证码'),
  password: newPasswordSchema,
});
export type RecoveryResetInput = z.infer<typeof recoveryResetSchema>;

// A04 个人账户
export const accountNameSchema = z.object({
  name: z.string().trim().min(1, '请输入姓名').max(40, '姓名不超过 40 个字'),
});
export type AccountNameInput = z.infer<typeof accountNameSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码'),
  newPassword: newPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface AccountView {
  id: string;
  email: string;
  name: string;
  // 没改过密码时为 null（账号是邀请或运营建的）
  passwordChangedAt: string | null;
  // 除这台设备外，还有几个登录中的会话
  otherSessions: number;
}
