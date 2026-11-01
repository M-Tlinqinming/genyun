// 反馈受理（M3 第 6 项，Paper 16 页「反馈受理」，客户提交弹窗参考 20 页「产品与服务反馈」线框）。
// 客户自愿提交对平台或成果的意见；运营受理、写处理结果、关闭。与编制交付分开：
// 不改任务状态、不触发重新生成、不改已交付版本。前后端共用。
import { z } from 'zod';

// new = 待受理；processing = 处理中（运营已受理或已转给注安师）；closed = 已关闭（已回复客户）
export const FEEDBACK_STATUSES = ['new', 'processing', 'closed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = { new: '待受理', processing: '处理中', closed: '已关闭' };
// 客户看到的说法
export const FEEDBACK_CUSTOMER_STATUS_LABELS: Record<FeedbackStatus, string> = { new: '等待耕云受理', processing: '耕云处理中', closed: '已处理' };

// 反馈类型由运营判断（客户只写意见）；从成果文档页提交的默认「成果内容」，其余默认「平台使用」
export const FEEDBACK_CATEGORIES = ['platform', 'content', 'account', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  platform: '平台使用',
  content: '成果内容',
  account: '账号与服务',
  other: '其他',
};

// 从哪里提交的：成果文档（交付详情页「反馈文稿问题」）、顶栏「意见反馈」
export const FEEDBACK_SOURCES = ['delivery', 'general'] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
export const FEEDBACK_SOURCE_LABELS: Record<FeedbackSource, string> = { delivery: '从成果文档页提交', general: '从顶栏「意见反馈」提交' };

export const FEEDBACK_CONTENT_MAX = 1000;
export const FEEDBACK_REPLY_MAX = 1000;
export const FEEDBACK_NOTE_MAX = 500;
export const FEEDBACK_FILES_MAX = 5;

// 客户提交：只需要写意见；可附截图或文件（先走普通上传拿到文件 ID）；可关联任务和交付版本
export const feedbackCreateSchema = z
  .object({
    content: z.string().trim().min(1, '请写下您的意见').max(FEEDBACK_CONTENT_MAX, `意见最多 ${FEEDBACK_CONTENT_MAX} 个字`),
    fileIds: z.array(z.uuid('附件不正确')).max(FEEDBACK_FILES_MAX, `最多附 ${FEEDBACK_FILES_MAX} 个文件`).default([]),
    taskId: z.uuid('任务不正确').optional(),
    deliveryVersion: z.number().int().min(1).optional(),
    source: z.enum(FEEDBACK_SOURCES).default('general'),
  })
  .refine((v) => v.deliveryVersion === undefined || v.taskId !== undefined, { message: '交付版本要和任务一起提交', path: ['deliveryVersion'] });
export type FeedbackCreateInput = z.input<typeof feedbackCreateSchema>;

// 运营处理：accept = 受理，稍后回复；forward = 转给原任务的注安师（只限成果内容、有负责注安师的任务）；
// save = 处理中保存类型、回复草稿、内部备注；close = 回复并关闭（回复必填，客户在站内提醒里看到）
export const FEEDBACK_ACTIONS = ['accept', 'forward', 'save', 'close'] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];
export const feedbackActionSchema = z
  .object({
    action: z.enum(FEEDBACK_ACTIONS),
    category: z.enum(FEEDBACK_CATEGORIES).optional(),
    reply: z.string().trim().max(FEEDBACK_REPLY_MAX, `回复最多 ${FEEDBACK_REPLY_MAX} 个字`).optional(),
    internalNote: z.string().trim().max(FEEDBACK_NOTE_MAX, `内部备注最多 ${FEEDBACK_NOTE_MAX} 个字`).optional(),
  })
  .refine((v) => v.action !== 'close' || Boolean(v.reply), { message: '请先写给客户的回复', path: ['reply'] });
export type FeedbackActionInput = z.input<typeof feedbackActionSchema>;

// 列表标题：意见的第一行，太长截断
export function feedbackTitle(content: string, max = 24): string {
  const line = content.trim().split(/\r?\n/)[0]!.trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export interface FeedbackFile {
  id: string;
  name: string;
}

// 客户看到的反馈（不含内部备注、处理人）
export interface CustomerFeedback {
  id: string;
  title: string;
  content: string;
  status: FeedbackStatus;
  source: FeedbackSource;
  createdAt: string;
  createdByName: string;
  enterpriseName: string | null;
  taskId: string | null;
  taskNumber: string | null;
  deliveryVersion: number | null;
  files: FeedbackFile[];
  acceptedAt: string | null;
  // 关闭时写给客户的回复
  reply: string | null;
  closedAt: string | null;
}

// 运营看到的反馈
export interface OperatorFeedback extends Omit<CustomerFeedback, 'reply'> {
  orgId: string;
  orgName: string;
  category: FeedbackCategory;
  // 处理中也可以先写回复草稿，关闭时发给客户
  reply: string | null;
  internalNote: string | null;
  handlerName: string | null;
  // 关联任务现在的负责注安师（转给注安师用）；没有关联任务或还没分派为空
  taskExpertName: string | null;
  forwardedToName: string | null;
  forwardedAt: string | null;
  closedByName: string | null;
}

export interface OperatorFeedbackView {
  items: OperatorFeedback[];
  counts: Record<FeedbackStatus, number>;
}

// 运营列表排序：待受理在前，其次处理中，已关闭最后；同一状态里新的在前
export function compareFeedback(a: { status: FeedbackStatus; createdAt: string }, b: { status: FeedbackStatus; createdAt: string }): number {
  const rank = FEEDBACK_STATUSES.indexOf(a.status) - FEEDBACK_STATUSES.indexOf(b.status);
  return rank !== 0 ? rank : b.createdAt.localeCompare(a.createdAt);
}
