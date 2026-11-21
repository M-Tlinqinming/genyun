// 资料核对第 4 步里客户表格没有、只有专家填的项（Paper 13 页 E2-4、S05）：
// 外部应急联系方式的派出所、专职消防队和各行的值守时间，厂区四邻，专家上传的三张图。
// 存在任务的 WorkupData.resourcesExtra，和第 4 步的专家那份一起保存。
import { z } from 'zod';
import { EXPERT_DRAWING_KEYS, type ExpertDrawingKey } from './workup-drawings.ts';

const text = (max: number, label: string) => z.string().trim().max(max, `${label}最多 ${max} 个字`).optional();
const fileIds = z.array(z.uuid()).max(20, '每处最多 20 个文件').default([]);

export const DEFAULT_DUTY_HOURS = '24 小时';

const contactSchema = z.object({ name: text(50, '单位名称'), phone: text(30, '电话'), hours: text(20, '值守时间') });
export type ExtraContact = z.infer<typeof contactSchema>;

// 应急管理局、消防救援大队、街道办事处的单位和电话在属地部门（agency.*），就近医院在第 4 步资料里；这里只记它们的值守时间
export const HOURS_ROWS = ['emergencyBureau', 'fireDept', 'streetOffice', 'hospital'] as const;
export type HoursRow = (typeof HOURS_ROWS)[number];

export const QUARTERS = { east: '东', south: '南', west: '西', north: '北' } as const;
export type Quarter = keyof typeof QUARTERS;
export const QUARTER_KEYS = Object.keys(QUARTERS) as Quarter[];

export const resourcesExtraSchema = z
  .object({
    police: contactSchema.optional(),
    // none = 附近没有专职消防队，预案里不写这一行
    brigade: contactSchema.extend({ none: z.boolean().default(false) }).optional(),
    hours: z.partialRecord(z.enum(HOURS_ROWS), z.string().trim().max(20, '值守时间最多 20 个字')).default({}),
    quarters: z
      .object({ east: text(50, '东邻'), south: text(50, '南邻'), west: text(50, '西邻'), north: text(50, '北邻') })
      .prefault({}),
    drawings: z.object(Object.fromEntries(EXPERT_DRAWING_KEYS.map((k) => [k, fileIds])) as Record<ExpertDrawingKey, typeof fileIds>).prefault({}),
  })
  .prefault({});
export type ResourcesExtra = z.infer<typeof resourcesExtraSchema>;

export const emptyResourcesExtra = (): ResourcesExtra => resourcesExtraSchema.parse({});

/**
 * 外部联系电话的检查：座机（区号 3–4 位加 7–8 位，可带「-」）、11 位手机号、3–5 位特服号（110、12350）都算对。
 * 空着不报错
 */
export function contactPhoneError(phone: string | undefined): string | null {
  const v = (phone ?? '').replace(/[\s（）()]/g, '');
  if (!v) return null;
  if (/^0\d{2,3}-?\d{7,8}$/.test(v) || /^1\d{10}$/.test(v) || /^\d{3,5}$/.test(v)) return null;
  return '号码位数不对';
}

/** 四邻写成一句：「公司东临××，南临××。」，没填的方向不写；全空返回空串 */
export function quartersSentence(q: Partial<Record<Quarter, string>> | undefined): string {
  const parts = QUARTER_KEYS.filter((k) => q?.[k]?.trim()).map((k) => `${QUARTERS[k]}临${q![k]!.trim()}`);
  return parts.length ? `公司${parts.join('，')}。` : '';
}

/** 电话后面的值守时间：24 小时不写，其余写「（8 小时）」 */
export function hoursSuffix(hours: string | undefined): string {
  const h = hours?.trim();
  return h && h !== DEFAULT_DUTY_HOURS && h !== '24小时' ? `（${h}）` : '';
}
