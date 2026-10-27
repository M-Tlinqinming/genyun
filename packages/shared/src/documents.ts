// 企业资料库（Paper 11 页 C03 企业资料、12 页 P03B 从企业资料中选用；TECH-PLAN 3.4.2）
import { z } from 'zod';
import { CATEGORIES, type Category } from './checklist/items.ts';

// 分类为空时界面显示「待整理」
export function documentCategoryLabel(category: Category | null): string {
  return category ? CATEGORIES[category] : '待整理';
}

// 任务从资料库选用：确认后任务关联的资料就是这份清单（每份资料一个版本）
export const taskDocumentSelectionSchema = z.object({
  selections: z
    .array(z.object({ documentId: z.uuid(), versionId: z.uuid() }))
    .max(200, '一次最多选用 200 份资料')
    .refine((s) => new Set(s.map((x) => x.documentId)).size === s.length, '同一份资料只能选一个版本'),
});
export type TaskDocumentSelection = z.infer<typeof taskDocumentSelectionSchema>;
