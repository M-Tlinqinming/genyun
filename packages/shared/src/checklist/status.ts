import { z } from 'zod';
import { CHECKLIST_ITEM_KEYS, getItemDef, type ChecklistItemKey } from './items.ts';

// 客户端每项只有四种状态，没有「不确定」。界面文案见 ITEM_STATUS_LABELS。
export const ITEM_STATUSES = ['provided', 'none', 'later', 'photo_for_expert'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  provided: '已提供',
  none: '没有',
  later: '稍后补',
  photo_for_expert: '拍照给耕云看',
};

// 专家判定为「无」不需要填理由
export const expertJudgementSchema = z
  .object({
    result: z.enum(['pending', 'yes', 'no']),
    judgedBy: z.string().optional(),
    judgedAt: z.iso.datetime().optional(),
  })
  .refine((j) => j.result === 'pending' || (j.judgedBy && j.judgedAt), {
    message: '专家判定需记录判定人和时间',
  });
export type ExpertJudgement = z.infer<typeof expertJudgementSchema>;

export const itemStateSchema = z
  .object({
    status: z.enum(ITEM_STATUSES),
    fileIds: z.array(z.string()).default([]),
    confirmedBy: z.string().optional(),
    confirmedAt: z.iso.datetime().optional(),
    // 客户点了「请专家电话联系」
    callRequested: z.boolean().default(false),
    expertJudgement: expertJudgementSchema.optional(),
  })
  .refine(
    (s) =>
      !(s.status === 'none' || (s.status === 'provided' && s.fileIds.length === 0)) ||
      (s.confirmedBy && s.confirmedAt),
    { message: '直接填写或选择「没有」时需记录确认人和时间' },
  );
export type ItemState = z.infer<typeof itemStateSchema>;

export const checklistStateSchema = z.partialRecord(z.enum(CHECKLIST_ITEM_KEYS), itemStateSchema);
export type ChecklistState = z.infer<typeof checklistStateSchema>;

// 某项能否设为某状态；不能时返回给客户看的原因
export function statusNotAllowedReason(
  key: ChecklistItemKey,
  status: ItemStatus,
): string | null {
  const def = getItemDef(key);
  if (def.requirement === 'system' && status !== 'provided') {
    return `${def.label}由耕云生成，只需确认`;
  }
  if (status === 'later' && def.requirement === 'start') {
    return `${def.label}是开始编制必需的资料，不能稍后补`;
  }
  if (status === 'none' && !def.allowNone) {
    return `${def.label}每家企业都需要提供`;
  }
  if (status === 'photo_for_expert' && !def.allowPhoto) {
    return `${def.label}不需要拍照判断，请直接提供`;
  }
  return null;
}
