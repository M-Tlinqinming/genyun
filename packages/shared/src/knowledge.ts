// 知识库（M3 第 5 项，Paper 16 页 I07 属地应急机构、I07B 工艺模板；节假日设计稿没有，按同一套样式做）。
// 只有运营维护；改动只影响之后生成的文档和之后选用模板的客户，已生成、已交付的不变。
import { z } from 'zod';
import type { AgencyDistrict } from './plan/agencies.ts';
import type { HolidayKind } from './workdays.ts';
import { PROCESS_STEP_MAX } from './profile/process-flow.ts';

export const KNOWLEDGE_TABS = ['agencies', 'templates', 'holidays'] as const;
export type KnowledgeTab = (typeof KNOWLEDGE_TABS)[number];
export const KNOWLEDGE_TAB_LABELS: Record<KnowledgeTab, string> = {
  agencies: '属地应急机构',
  templates: '工艺模板',
  holidays: '节假日',
};

// ---------- 属地应急机构 ----------

// 生成文档用到的三类：应急管理局、镇街应急办（含园区）、消防救援大队
export const AGENCY_CATEGORIES = ['emergency', 'street', 'fire'] as const;
export type AgencyCategory = (typeof AGENCY_CATEGORIES)[number];
export const AGENCY_CATEGORY_LABELS: Record<AgencyCategory, string> = {
  emergency: '应急管理',
  street: '街道 / 园区',
  fire: '消防',
};

const name = (label: string, max = 60) => z.string().trim().min(1, `请填写${label}`).max(max, `${label}最多 ${max} 个字`);
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}最多 ${max} 个字`)
    .optional()
    .transform((v) => v || undefined);
const words = z
  .array(z.string().trim().min(1).max(20, '每个词最多 20 个字'))
  .max(20, '最多 20 个')
  .default([])
  .transform((list) => [...new Set(list)]);

// 电话：座机、手机或几个号码（用顿号分开），只允许数字、横线、空格、括号、顿号
export const agencyPhoneSchema = z
  .string()
  .trim()
  .max(40, '电话最多 40 个字符')
  .regex(/^[0-9\-－ ()（）、,，转]*$/, '电话只填数字和横线，例如 0752-3271385')
  .optional()
  .transform((v) => v || undefined);

export const agencyRegionInputSchema = z.object({
  province: name('省份', 20),
  city: name('城市', 20),
  name: name('区县', 30),
  // 地址里出现这些词就算这个区县（如「仲恺」）
  aliases: words.refine((list) => list.length > 0, '请至少填一个地址里会出现的叫法，例如「仲恺」'),
  // 区县级上级预案名称（不带书名号）
  plan: optionalText(80, '上级预案名称'),
});
export type AgencyRegionInput = z.infer<typeof agencyRegionInputSchema>;

export const agencyInputSchema = z
  .object({
    regionId: z.uuid('请选择行政区'),
    category: z.enum(AGENCY_CATEGORIES, { error: '请选择类别' }),
    name: name('机构名称', 60),
    phone: agencyPhoneSchema,
    // 镇街应急办：地址里认的镇街名（如「陈江街道」）和别的叫法（如村名）
    area: optionalText(30, '适用镇街'),
    aliases: words,
    // 镇街级上级预案名称
    plan: optionalText(80, '上级预案名称'),
    note: optionalText(100, '备注'),
  })
  .superRefine((v, ctx) => {
    if (v.category === 'street' && !v.area) ctx.addIssue({ code: 'custom', path: ['area'], message: '请填写适用的镇街，例如「陈江街道」' });
  });
export type AgencyInput = z.infer<typeof agencyInputSchema>;

export interface KnowledgeAgency {
  id: string;
  regionId: string;
  category: AgencyCategory;
  name: string;
  phone: string | null;
  area: string | null;
  aliases: string[];
  plan: string | null;
  note: string | null;
  disabled: boolean;
  verifiedAt: string | null;
  verifiedByName: string | null;
}

export interface KnowledgeRegion {
  id: string;
  province: string;
  city: string;
  name: string;
  aliases: string[];
  plan: string | null;
  agencies: KnowledgeAgency[];
}

export interface KnowledgeAgenciesView {
  regions: KnowledgeRegion[];
}

const stem = (s: string) => s.replace(/(省|市|自治区|特别行政区)$/, '');

// 客户组织所在地区在知识库里有没有属地机构（开通弹窗据此提醒「编制前需要补齐」）：
// 有一个区县，它的省（地区里写了省才比）和市出现在地区文字里，并且至少有一条没停用的机构
export function regionHasLocalAgencies(region: string | null | undefined, regions: readonly KnowledgeRegion[]): boolean {
  if (!region) return false;
  return regions.some(
    (r) =>
      (!region.includes('省') || region.includes(stem(r.province))) &&
      region.includes(stem(r.city)) &&
      r.agencies.some((a) => !a.disabled),
  );
}

// 知识库里的区县和机构 → 生成文档用的属地机构表（plan/agencies.ts 的 localAgenciesOf 用）。
// 停用的机构不用；同一区县有几个应急管理局 / 消防大队时用排在最前的一个；没有区县时返回 null（调用方改用内置数据）
export function agencyDistrictsOf(regions: readonly KnowledgeRegion[]): AgencyDistrict[] | null {
  if (regions.length === 0) return null;
  const contact = (a: KnowledgeAgency) => ({ name: a.name, ...(a.phone ? { phone: a.phone } : {}) });
  return regions.map((r) => {
    const active = r.agencies.filter((a) => !a.disabled);
    const bureau = active.find((a) => a.category === 'emergency');
    const fire = active.find((a) => a.category === 'fire');
    return {
      province: r.province,
      city: r.city,
      name: r.name,
      aliases: [...r.aliases],
      ...(r.plan ? { plan: r.plan } : {}),
      ...(bureau ? { bureau: contact(bureau) } : {}),
      ...(fire ? { fire: contact(fire) } : {}),
      towns: active
        .filter((a) => a.category === 'street' && a.area)
        .map((a) => ({
          area: a.area!,
          office: a.name,
          ...(a.phone ? { phone: a.phone } : {}),
          ...(a.aliases.length ? { aliases: [...a.aliases] } : {}),
          ...(a.plan ? { plan: a.plan } : {}),
        })),
    };
  });
}

// ---------- 节假日 ----------

export const holidayInputSchema = z.object({
  date: z.iso.date('请选择日期'),
  kind: z.enum(['holiday', 'workday'], { error: '请选择放假还是调休上班' }),
  name: name('节日名称', 20),
});
export type HolidayInput = z.infer<typeof holidayInputSchema>;

export interface KnowledgeHoliday {
  date: string;
  kind: HolidayKind;
  name: string;
  updatedAt: string;
  updatedByName: string | null;
}

export interface KnowledgeHolidaysView {
  holidays: KnowledgeHoliday[];
}

// ---------- 工艺模板 ----------

// 运营维护的一道工序：常见物料、风险提示只给注安师参考，客户选模板时只带出工序和设备
export const templateStepSchema = z.object({
  name: name('工序名称', 20),
  equipment: z.array(z.string().trim().min(1).max(50)).max(10, '每道工序最多 10 种设备').default([]),
  materials: z.array(z.string().trim().min(1).max(50)).max(10, '每道工序最多 10 种物料').default([]),
  risks: z.array(z.string().trim().min(1).max(20)).max(10, '每道工序最多 10 条风险提示').default([]),
});
export type TemplateStep = z.infer<typeof templateStepSchema>;

export const templateContentSchema = z.object({
  label: name('模板名称', 30),
  industry: optionalText(30, '所属行业'),
  // 经营范围里出现这些词就推荐这个模板
  keywords: words,
  steps: z.array(templateStepSchema).max(PROCESS_STEP_MAX, `工序最多 ${PROCESS_STEP_MAX} 道`).default([]),
});
export type TemplateContent = z.infer<typeof templateContentSchema>;

// 发布前要求至少一道工序
export const templatePublishSchema = templateContentSchema.refine((v) => v.steps.length > 0, { path: ['steps'], message: '至少要有一道工序才能发布' });

export type TemplateState = 'draft' | 'published' | 'disabled';
export const TEMPLATE_STATE_LABELS: Record<TemplateState, string> = { draft: '草稿', published: '已发布', disabled: '已停用' };

export interface KnowledgeTemplate {
  id: string;
  state: TemplateState;
  // 已发布的版本号（从 1 起），从未发布为 0
  version: number;
  // 客户现在看到的内容（从未发布时为 null）
  published: TemplateContent | null;
  // 未发布的修改（没有为 null）
  draft: TemplateContent | null;
  // 选用过这个模板的企业数
  usedBy: number;
  updatedAt: string;
  updatedByName: string | null;
}

export interface KnowledgeTemplatesView {
  templates: KnowledgeTemplate[];
}
