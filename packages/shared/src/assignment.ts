// 分派负责注安师（Paper 16 页 I04 任务中心「待分派」、分配注安师弹窗）。前后端共用。
import { z } from 'zod';

export const ASSIGNMENT_NOTE_MAX = 200;

// 改派理由（选填），会写进发给原注安师的提醒（11-01 Martin 决定）
export const REASSIGN_REASONS = {
  leave: '请假',
  busy: '忙不过来',
  customer: '客户要求',
  other: '其他',
} as const;
export type ReassignReason = keyof typeof REASSIGN_REASONS;

// currentExpertId：运营打开弹窗时看到的负责专家（第一次分派为 null）。
// 提交时任务已被别人分派或改派过，就拒绝，避免两位运营同时操作互相覆盖
export const assignExpertSchema = z.object({
  expertId: z.uuid('请选择注安师'),
  currentExpertId: z.uuid().nullable(),
  reason: z.enum(Object.keys(REASSIGN_REASONS) as [ReassignReason, ...ReassignReason[]]).optional(),
  note: z
    .string()
    .trim()
    .max(ASSIGNMENT_NOTE_MAX, `说明最多 ${ASSIGNMENT_NOTE_MAX} 个字`)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type AssignExpertInput = z.input<typeof assignExpertSchema>;

// 运营任务中心的页签：待分派 = 客户已提交、还没有负责专家、任务没结束；超时兜底 = 客户请电话联系后 2 个工作日没联系上
export type OperatorTaskView = 'unassigned' | 'overdue' | 'all';

// 超时兜底（16 页 I04）：运营在任务上的记录。客户、注安师都看不到
export const OPERATOR_NOTE_KINDS = {
  note: '内部备注',
  remind_expert: '提醒注安师',
  reassign: '改派',
  called_customer: '已致电客户安抚',
} as const;
export type OperatorNoteKind = keyof typeof OPERATOR_NOTE_KINDS;
export const OPERATOR_NOTE_MAX = 500;

// 运营自己写的记录：内部备注（必须写内容）、「我先打给客户安抚」打完记一笔（可附一句）
export const operatorNoteSchema = z
  .object({
    kind: z.enum(['note', 'called_customer']).default('note'),
    body: z.string().trim().max(OPERATOR_NOTE_MAX, `备注最多 ${OPERATOR_NOTE_MAX} 个字`).default(''),
  })
  .refine((v) => v.kind !== 'note' || v.body.length > 0, { message: '请写备注内容', path: ['body'] });
export type OperatorNoteInput = z.input<typeof operatorNoteSchema>;
// 提醒注安师：附带的话可以不写，写了放在提醒正文第一句
export const remindExpertSchema = z.object({
  body: z.string().trim().max(ASSIGNMENT_NOTE_MAX, `最多 ${ASSIGNMENT_NOTE_MAX} 个字`).optional(),
});

export interface OperatorNote {
  id: string;
  kind: OperatorNoteKind;
  body: string;
  createdAt: string;
  createdByName: string;
}

export function needsAssignment(t: {
  status: 'preparing' | 'submitted';
  assignedExpertId: string | null;
  closedAt: string | Date | null;
}): boolean {
  return t.status === 'submitted' && t.assignedExpertId === null && t.closedAt === null;
}

// 只有已提交、没结束的任务能分派或改派：资料准备中的还轮不到注安师，已交付的不再换人
export function assignmentBlockedReason(t: {
  status: 'preparing' | 'submitted';
  closedAt: string | Date | null;
}): string | null {
  if (t.closedAt) return '任务已结束，不能再分派';
  if (t.status !== 'submitted') return '客户还没提交资料，提交后才能分派注安师';
  return null;
}

// 弹窗里每位注安师下面的一行：「在办 3 个 · 正在处理该客户的另外 3 家企业」
export function expertLoadLine(e: { openTasks: number; sameOrgEnterprises: number }): string {
  const parts = [`在办 ${e.openTasks} 个`];
  if (e.sameOrgEnterprises > 0) parts.push(`正在处理该客户的另外 ${e.sameOrgEnterprises} 家企业`);
  return parts.join(' · ');
}
