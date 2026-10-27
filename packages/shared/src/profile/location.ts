// 行政区位（旧仓库 E2）。属地应急机构、消防、疾控、医院由耕云知识库按地址带出，
// 不是客户字段；客户只补充相邻企业。
import { z } from 'zod';
import { addressSchema } from './basic.ts';

export const neighbourSchema = z.object({
  name: z.string().trim().min(1, '请填写企业名称'),
  contact: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

export const locationSchema = z.object({
  siteAddress: addressSchema,
  // listed = 已列出；none = 没有相邻企业；unknown = 不清楚
  neighbours: z.discriminatedUnion('answer', [
    z.object({ answer: z.literal('listed'), items: z.array(neighbourSchema).min(1) }),
    z.object({ answer: z.literal('none') }),
    z.object({ answer: z.literal('unknown') }),
  ]).optional(),
});
export type Location = z.infer<typeof locationSchema>;
