// 分派负责专家（Paper 16 页 I04 任务中心「待分派」、分配专业人员弹窗）。前后端共用。
import { z } from 'zod';

export const ASSIGNMENT_NOTE_MAX = 200;

// currentExpertId：运营打开弹窗时看到的负责专家（第一次分派为 null）。
// 提交时任务已被别人分派或改派过，就拒绝，避免两位运营同时操作互相覆盖
export const assignExpertSchema = z.object({
  expertId: z.uuid('请选择专业人员'),
  currentExpertId: z.uuid().nullable(),
  note: z
    .string()
    .trim()
    .max(ASSIGNMENT_NOTE_MAX, `说明最多 ${ASSIGNMENT_NOTE_MAX} 个字`)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type AssignExpertInput = z.input<typeof assignExpertSchema>;

// 运营任务中心的页签：待分派 = 客户已提交、还没有负责专家、任务没结束
export type OperatorTaskView = 'unassigned' | 'all';

export function needsAssignment(t: {
  status: 'preparing' | 'submitted';
  assignedExpertId: string | null;
  closedAt: string | Date | null;
}): boolean {
  return t.status === 'submitted' && t.assignedExpertId === null && t.closedAt === null;
}

// 只有已提交、没结束的任务能分派或改派：资料准备中的还轮不到专家，已交付的不再换人
export function assignmentBlockedReason(t: {
  status: 'preparing' | 'submitted';
  closedAt: string | Date | null;
}): string | null {
  if (t.closedAt) return '任务已结束，不能再分派';
  if (t.status !== 'submitted') return '客户还没提交资料，提交后才能分派专家';
  return null;
}

// 弹窗里每位专业人员下面的一行：「在办 3 个 · 正在处理该客户的另外 3 家企业」
export function expertLoadLine(e: { openTasks: number; sameOrgEnterprises: number }): string {
  const parts = [`在办 ${e.openTasks} 个`];
  if (e.sameOrgEnterprises > 0) parts.push(`正在处理该客户的另外 ${e.sameOrgEnterprises} 家企业`);
  return parts.join(' · ');
}
