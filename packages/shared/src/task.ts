// 编制任务（Paper 12 页 P02、S00）。界面只显示 label，代码里用 key。
import { z } from 'zod';
import { ITEM_STATUSES } from './checklist/status.ts';

// 本期只开放应急预案编制
export const BUSINESS_TYPES = { emergency_plan: '生产安全事故应急预案编制' } as const;
export type BusinessType = keyof typeof BUSINESS_TYPES;

// M1 只有客户侧两种状态，专家处理阶段的状态在 M2 补充
export const TASK_STATUSES = { preparing: '资料准备中', submitted: '已提交' } as const;
export type TaskStatus = keyof typeof TASK_STATUSES;

export const START_METHODS = { self_fill: '按提示填写', upload: '上传已有资料' } as const;
export type StartMethod = keyof typeof START_METHODS;

export const taskCreateSchema = z.object({
  businessType: z.enum(Object.keys(BUSINESS_TYPES) as [BusinessType]).default('emergency_plan'),
  name: z.string().trim().min(1, '请填写任务名称').max(100, '任务名称不超过 100 字'),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = z
  .object({
    name: taskCreateSchema.shape.name,
    startMethod: z.enum(Object.keys(START_METHODS) as [StartMethod]),
  })
  .partial();
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

// 客户修改一项资料的状态；确认人和时间由后台记录
export const checklistItemUpdateSchema = z.object({
  status: z.enum(ITEM_STATUSES),
  callRequested: z.boolean().default(false),
  // 「由我确认」时直接填写的实际情况，如「2 人」
  note: z.string().trim().max(500, '说明最多 500 个字').optional(),
});
export type ChecklistItemUpdate = z.infer<typeof checklistItemUpdateSchema>;

// 把已上传的文件挂到资料项上
export const checklistFileLinkSchema = z.object({ fileId: z.uuid('请选择文件') });

// 全平台按年流水：GY-2026-001；超过 999 自然变长
export function formatTaskNumber(year: number, seq: number): string {
  return `GY-${year}-${String(seq).padStart(3, '0')}`;
}

// 业务日期一律按北京时间，返回 YYYY-MM-DD
export function chinaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

export interface ContractPeriod {
  contractStartsAt: string | null;
  contractEndsAt: string | null;
}

// 合同有效期内才能新建任务（起止日都算在内）；已交付成果不受影响
export function isContractActive(c: ContractPeriod, today: string = chinaToday()): boolean {
  return (
    c.contractStartsAt !== null &&
    c.contractEndsAt !== null &&
    c.contractStartsAt <= today &&
    today <= c.contractEndsAt
  );
}
