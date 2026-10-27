// 应急组织（旧仓库 E3）。TECH-PLAN 3.5：默认 3 组，可加警戒疏散、医疗救护、自定义，2–6 组；
// 副总指挥 0–2 人；24 小时值班电话默认总指挥手机；编制小组可添加非应急组成员。
import { z } from 'zod';

export const personSchema = z.object({
  // 供应急物资「保管人」等处引用
  id: z.string().min(1),
  name: z.string().trim().min(1, '请填写姓名'),
  position: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});
export type Person = z.infer<typeof personSchema>;

export const PRESET_GROUPS = {
  rescue: '抢险救灾组',
  logistics: '综合保障组',
  communication: '通讯联络组',
  evacuation: '警戒疏散组',
  medical: '医疗救护组',
} as const;
export type PresetGroupKey = keyof typeof PRESET_GROUPS;

export const DEFAULT_GROUP_KEYS: PresetGroupKey[] = ['rescue', 'logistics', 'communication'];

export const groupSchema = z.object({
  // 预置组用 preset key；自定义组为 custom，并填写 name
  kind: z.union([z.enum(Object.keys(PRESET_GROUPS) as [PresetGroupKey, ...PresetGroupKey[]]), z.literal('custom')]),
  name: z.string().trim().min(1, '请填写小组名称'),
  leader: personSchema.optional(),
  members: z.array(personSchema).default([]),
});
export type EmergencyGroup = z.infer<typeof groupSchema>;

export const compilationMemberSchema = z.object({
  name: z.string().trim().min(1, '请填写姓名'),
  title: z.string().trim().optional(),
  duty: z.string().trim().optional(),
});

export const organizationSchema = z.object({
  commander: personSchema.optional(),
  deputies: z.array(personSchema).max(2, '副总指挥最多 2 人').default([]),
  hasEmergencyOffice: z.boolean().default(false),
  groups: z
    .array(groupSchema)
    .min(2, '至少设 2 个应急小组')
    .max(6, '最多设 6 个应急小组'),
  // 不填时取总指挥手机，见 dutyPhoneOf
  dutyPhone: z.string().trim().optional(),
  compilationTeam: z
    .object({
      leader: compilationMemberSchema.optional(),
      members: z.array(compilationMemberSchema).default([]),
    })
    .optional(),
});
export type Organization = z.infer<typeof organizationSchema>;

export function defaultGroups(): EmergencyGroup[] {
  return DEFAULT_GROUP_KEYS.map((kind) => ({ kind, name: PRESET_GROUPS[kind], members: [] }));
}

export function dutyPhoneOf(org: Organization): string | undefined {
  return org.dutyPhone || org.commander?.phone;
}
