// 行政区位（旧仓库 E2）。属地应急机构、消防、疾控、医院由耕云知识库按地址带出，
// 不是客户字段；客户只补充相邻企业。
import { z } from 'zod';
import { addressSchema, YES_NO_UNKNOWN } from './basic.ts';

export const neighbourSchema = z.object({
  name: z.string().trim().min(1, '请填写企业名称'),
  contact: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

// 救援协议、互助协议：有没有签，签了写对象名称
const agreementSchema = z.object({ answer: z.enum(YES_NO_UNKNOWN), parties: z.string().trim().optional() });

export const locationSchema = z.object({
  siteAddress: addressSchema,
  // 一照多址：其他生产经营地址（id 供人员、设备等标所在厂址，见 addresses.ts）
  otherAddresses: z.array(z.object({ id: z.string(), address: z.string() })).optional(),
  // 位于工业园区 / 物业管理的园区：园区管理方与值班电话，信息报告、应急支援时先报园区并联动
  park: z.object({ answer: z.enum(YES_NO_UNKNOWN), manager: z.string().trim().optional(), dutyPhone: z.string().trim().optional() }).optional(),
  // 与医院、消防或专业救援队伍签订的救援协议
  rescueAgreement: agreementSchema.optional(),
  // 与相邻企业签订的应急互助协议
  mutualAid: agreementSchema.optional(),
  // listed = 已列出；none = 没有相邻企业；unknown = 不清楚
  neighbours: z.discriminatedUnion('answer', [
    z.object({ answer: z.literal('listed'), items: z.array(neighbourSchema).min(1) }),
    z.object({ answer: z.literal('none') }),
    z.object({ answer: z.literal('unknown') }),
  ]).optional(),
});
export type Location = z.infer<typeof locationSchema>;
