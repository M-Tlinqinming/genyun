// 企业档案（Paper 12 页 P01）：只有企业名称必填，其余可以先跳过，在资料检查阶段补充。
import { z } from 'zod';
import { SOCIAL_CREDIT_CODE } from './profile/basic.ts';

// 空字符串当作「没填」，存为 null
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const enterpriseInputSchema = z.object({
  name: z.string().trim().min(1, '请填写企业名称').max(100, '企业名称不超过 100 字'),
  socialCreditCode: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || SOCIAL_CREDIT_CODE.test(v), '统一社会信用代码应为 18 位数字或字母'),
  registeredAddress: optionalText(200),
  legalRepresentative: optionalText(50),
});
export type EnterpriseInput = z.infer<typeof enterpriseInputSchema>;

// 修改时只传要改的字段
export const enterpriseUpdateSchema = enterpriseInputSchema.partial();
export type EnterpriseUpdate = z.infer<typeof enterpriseUpdateSchema>;
