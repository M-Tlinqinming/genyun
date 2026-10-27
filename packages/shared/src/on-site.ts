// 预约耕云上门（Paper 12 页「S05 · 预约上门弹窗」）：客户只留联系方式和需要帮忙的内容，
// 运营在 M3 的上门工单里处理；报价、排期、现场交接全部线下，线上不处理。
import { z } from 'zod';

export const CALL_TIMES = { weekday_morning: '工作日上午', weekday_afternoon: '工作日下午', anytime: '随时' } as const;
export type CallTime = keyof typeof CALL_TIMES;

// new = 新工单；handed_over = 已转交公司；closed = 已关闭
export const ON_SITE_STATUSES = ['new', 'handed_over', 'closed'] as const;
export type OnSiteStatus = (typeof ON_SITE_STATUSES)[number];

export const onSiteRequestSchema = z.object({
  contactName: z.string().trim().min(1, '请填写联系人').max(50, '联系人最多 50 个字'),
  contactPhone: z
    .string()
    .trim()
    .min(1, '请填写联系电话')
    .max(30, '电话最多 30 位')
    .regex(/^[\d\s\-+()（）]+$/, '电话只能填数字、空格和短横线'),
  callTime: z.enum(Object.keys(CALL_TIMES) as [CallTime, ...CallTime[]]).optional(),
  // 需要帮忙整理的内容，默认带出待补的项，客户可删减
  helpItems: z.array(z.string().trim().min(1).max(100)).max(50, '最多 50 项').default([]),
  note: z.string().trim().max(500, '备注最多 500 个字').optional(),
});
export type OnSiteRequestInput = z.infer<typeof onSiteRequestSchema>;
