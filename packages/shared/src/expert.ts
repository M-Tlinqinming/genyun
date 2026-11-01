// 专家任务中心（Paper 14 页 I04）：任务在专家这边处在哪一步、待办是什么、客户请求联系的期限。
import type { TaskStatus } from './task.ts';

// 任务阶段（筛选用）。M2 后续各项（生成、审核、补件）做到时在这里补
export const EXPERT_STAGES = {
  customer_preparing: '客户准备资料',
  organizing: '专业整理',
  delivered: '已交付',
} as const;
export type ExpertStage = keyof typeof EXPERT_STAGES;

export interface ExpertTaskFacts {
  status: TaskStatus;
  closedAt: string | null;
  // 等专家核实的项：拍照给耕云看、请专家电话联系，专家还没判定的
  verifyCount: number;
  // 其中客户请专家电话联系的项
  contactCount: number;
}

export interface ExpertTodo {
  stage: ExpertStage;
  todo: string;
  action: string;
}

export function expertTodo(t: ExpertTaskFacts): ExpertTodo {
  if (t.closedAt !== null) return { stage: 'delivered', todo: '三份 Word 已发布', action: '查看成果' };
  if (t.status === 'preparing') return { stage: 'customer_preparing', todo: '等待客户提交生成申请', action: '查看任务' };
  if (t.contactCount > 0) return { stage: 'organizing', todo: `电话联系客户问清 ${t.contactCount} 项`, action: '联系客户' };
  if (t.verifyCount > 0) return { stage: 'organizing', todo: `核实 ${t.verifyCount} 项资料`, action: '核实资料' };
  return { stage: 'organizing', todo: '整理企业资料', action: '开始整理' };
}

// 客户请专家电话联系后，负责专家应在 2 个工作日内联系；超过由运营兜底（CLAUDE.md）
export const CONTACT_WORKING_DAYS = 2;
