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

// 合同到期前这么多天开始提醒续约（CLAUDE.md：到期前 30 天提醒）
export const CONTRACT_REMIND_DAYS = 30;

// none = 还没登记合同；upcoming = 还没到开始日；expiring = 30 天内到期；expired = 已过期
export type ContractState = 'none' | 'upcoming' | 'active' | 'expiring' | 'expired';

export function contractState(c: ContractPeriod, today: string = chinaToday()): { state: ContractState; daysLeft: number | null } {
  if (c.contractStartsAt === null || c.contractEndsAt === null) return { state: 'none', daysLeft: null };
  if (today < c.contractStartsAt) return { state: 'upcoming', daysLeft: null };
  const daysLeft = (Date.parse(c.contractEndsAt) - Date.parse(today)) / 86_400_000;
  if (daysLeft < 0) return { state: 'expired', daysLeft };
  return { state: daysLeft <= CONTRACT_REMIND_DAYS ? 'expiring' : 'active', daysLeft };
}

// 任务列表里每个任务的进展（后台按资料清单算好）：还缺的必需资料、提交后还没补的项
export interface TaskProgressFacts {
  status: TaskStatus;
  startMethod: StartMethod | null;
  closedAt: string | null;
  missing: string[];
  remaining: number;
  // 专家发起、等客户回应的事实补件标题（M2 第 13 项）；没有为 null
  supplement?: string | null;
}

// mine = 待我处理；gengyun = 耕云处理中；delivered = 已交付
export type TaskBucket = 'mine' | 'gengyun' | 'delivered';
export const TASK_BUCKETS: Record<TaskBucket, string> = { mine: '待我处理', gengyun: '耕云处理中', delivered: '已交付' };

export const TASK_STAGES = ['资料准备', '耕云编制', '专家审核', '成果交付'] as const;

export interface TaskTodo {
  bucket: TaskBucket;
  // 当前在第几个阶段（0–3）和一句阶段说明
  stage: number;
  stageText: string;
  next: string;
  action: string;
}

// 工作台和业务任务列表共用：任务归在哪一栏、下一步做什么、按钮叫什么。
// M1 只有资料准备与已提交；专家补件请求（M2）来了以后也算待我处理
export function taskTodo(t: TaskProgressFacts): TaskTodo {
  if (t.closedAt !== null) {
    return { bucket: 'delivered', stage: 3, stageText: '成果交付', next: '成果已发布，可查看和下载', action: '查看成果' };
  }
  if (t.status === 'submitted' && t.supplement) {
    return { bucket: 'mine', stage: 2, stageText: '专家审核 · 等待您回应', next: t.supplement, action: '去回应' };
  }
  if (t.status === 'submitted') {
    return {
      bucket: 'gengyun',
      stage: 1,
      stageText: '耕云编制 · 申请已提交',
      next: t.remaining > 0 ? `耕云整理中 · 还有 ${t.remaining} 项可稍后补` : '耕云整理资料并生成初稿',
      action: '查看进度',
    };
  }
  if (t.startMethod === null) {
    return { bucket: 'mine', stage: 0, stageText: '资料准备 · 尚未开始', next: '选择开始方式', action: '开始准备' };
  }
  if (t.missing.length > 0) {
    const more = t.missing.length > 1 ? ` 等 ${t.missing.length} 项` : '';
    return { bucket: 'mine', stage: 0, stageText: '资料准备 · 尚未提交', next: `补充${t.missing[0]}${more}`, action: '继续准备' };
  }
  return { bucket: 'mine', stage: 0, stageText: '资料准备 · 尚未提交', next: '必需资料已齐，可以提交生成申请', action: '去提交' };
}
