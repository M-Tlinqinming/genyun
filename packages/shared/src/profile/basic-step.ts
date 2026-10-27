// 企业自填第 1 步「企业基本信息」（Paper 12 页 S01）。
// 企业身份四项存在企业档案上（与 P01 共用），其余存在企业资料里，下一年度的任务可直接复用。
import { z } from 'zod';
import { enterpriseInputSchema } from '../enterprise.ts';
import { basicInfoSchema } from './basic.ts';
import { INDUSTRY_NAMES } from './industries.ts';

export const basicStepSchema = basicInfoSchema
  .omit({ companyName: true, socialCreditCode: true, legalRepresentative: true, registeredAddress: true })
  .extend({
    industry: z
      .string()
      .refine((v) => v in INDUSTRY_NAMES, '请从列表中选择所属行业')
      .optional(),
    // 设计稿为一行地址；属地机构匹配（M3 知识库）再按需拆成省市区
    siteAddress: z.string().trim().max(200).optional(),
  });
export type BasicStep = z.infer<typeof basicStepSchema>;
export type BasicStepField = keyof BasicStep;

// 「企业基本情况」开始编制只要求这几项（资料清单 basic_info 的 startPart）
export const BASIC_INFO_START_FIELDS = ['contactPerson', 'contactPhone', 'employeeCount', 'mainProducts'] as const;

export function basicInfoStartReady(basic: BasicStep): boolean {
  return BASIC_INFO_START_FIELDS.every((f) => {
    const v = basic[f];
    return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '');
  });
}

// 字段的值从哪里来，界面上显示小标签；客户改过就去掉
export const FIELD_SOURCES = {
  license: '来自营业执照',
  account: '当前账号',
  legal_rep: '同法定代表人',
} as const;
export type FieldSource = keyof typeof FIELD_SOURCES;

// 营业执照能识别的字段（企业身份四项 + 执照上的其他信息）
export const LICENSE_FIELDS = [
  'name',
  'socialCreditCode',
  'legalRepresentative',
  'registeredAddress',
  'companyType',
  'registeredCapital',
  'registrationAuthority',
  'businessScope',
] as const;
export type LicenseField = (typeof LICENSE_FIELDS)[number];
export type RecognizedLicense = Partial<Record<LicenseField, string>>;

const identityKeys = Object.keys(enterpriseInputSchema.shape) as (keyof typeof enterpriseInputSchema.shape)[];
const basicKeys = Object.keys(basicStepSchema.shape) as BasicStepField[];
export const BASIC_STEP_FIELDS = [...identityKeys, ...basicKeys] as const;
export type BasicStepAnyField = (typeof BASIC_STEP_FIELDS)[number];

// 第 1 步保存的内容。version 是读取时拿到的版本，别人在这之后改过就拒绝，避免互相覆盖
export const basicStepSaveSchema = z.object({
  version: z.number().int().min(1),
  identity: enterpriseInputSchema,
  basic: basicStepSchema,
  // 客户点了「稍后补」的字段
  later: z.array(z.enum(basicKeys as [BasicStepField, ...BasicStepField[]])).default([]),
  sources: z
    .partialRecord(
      z.enum(BASIC_STEP_FIELDS as unknown as [string, ...string[]]),
      z.enum(Object.keys(FIELD_SOURCES) as [FieldSource]),
    )
    .default({}),
});
export type BasicStepSave = z.infer<typeof basicStepSaveSchema>;

// 存在企业资料里的第 1 步内容（身份四项在企业档案的列上）
export interface BasicStepStored {
  basic: BasicStep;
  later: BasicStepField[];
  sources: Partial<Record<BasicStepAnyField, FieldSource>>;
  licenseFileId?: string;
}

// 企业资料按自填步骤分块存放；后续步骤（6b 起）在这里加各自的块
export interface EnterpriseProfile {
  basicStep?: BasicStepStored;
}
