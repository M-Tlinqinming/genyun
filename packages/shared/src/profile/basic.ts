// 企业信息（旧仓库 E1）。字段按 TECH-PLAN 3.5 扩展。
// 草稿友好：自动保存时只要求企业名称，其余在资料清单检查时判断。
import { z } from 'zod';

// 18 位统一社会信用代码（不含 I/O/S/V/Z）
export const SOCIAL_CREDIT_CODE = /^[0-9A-HJ-NPQRTUWXY]{18}$/;

const optionalText = z.string().trim().optional();
const count = z.coerce.number().int().min(0).optional();
const area = z.coerce.number().min(0).optional();

export const ECONOMIC_NATURES = ['全民所有制', '集体所有制', '私有制', '其它'] as const;

// 选填的「有 / 没有 / 不清楚」问题（应急广播、救援协议、集合点、园区等），不清楚的等专家联系时再问
export const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'] as const;
export type YesNoUnknown = (typeof YES_NO_UNKNOWN)[number];
export const YES_NO_UNKNOWN_LABELS: Record<YesNoUnknown, string> = { yes: '有', no: '没有', unknown: '不清楚' };

export const addressSchema = z.object({
  province: z.string().default(''),
  city: z.string().default(''),
  district: z.string().default(''),
  detail: z.string().default(''),
});
export type Address = z.infer<typeof addressSchema>;

export const basicInfoSchema = z.object({
  // 营业执照可识别带出
  companyName: z.string().trim().min(1, '请填写企业名称').max(100),
  socialCreditCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(SOCIAL_CREDIT_CODE, '统一社会信用代码应为 18 位数字或字母')
    .optional()
    .or(z.literal('')),
  legalRepresentative: optionalText,
  companyType: optionalText,
  registrationAuthority: optionalText,
  registeredCapital: optionalText,
  registeredAddress: addressSchema.optional(),
  businessScope: optionalText,

  // 企业基本情况（开始编制必需：联系人与电话、职工人数、主要产品）
  contactPerson: optionalText,
  contactPhone: optionalText,
  employeeCount: count,
  mainProducts: z.string().trim().max(500).optional(),
  responsiblePerson: optionalText,
  technicalManagementCount: count,
  safetyManagementCount: count,
  postalCode: z
    .string()
    .regex(/^\d{6}$/, '邮政编码应为 6 位数字')
    .optional()
    .or(z.literal('')),
  // 传真、网址、销售额等可填「无」，所以只做文本
  fax: optionalText,
  website: optionalText,
  email: z.email('邮箱格式不正确').optional().or(z.literal('')),
  economicNature: z.enum(ECONOMIC_NATURES).optional(),
  fixedAssets: optionalText,
  lastYearRevenue: optionalText,
  landAreaM2: area,
  // 总建筑面积由建（构）筑物一览合计，见 production.ts totalFloorArea
});
export type BasicInfo = z.infer<typeof basicInfoSchema>;
