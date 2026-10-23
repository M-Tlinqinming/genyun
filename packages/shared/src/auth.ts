import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('请输入正确的邮箱'),
  password: z.string().min(1, '请输入密码'),
});

export type LoginInput = z.infer<typeof loginSchema>;
