// 成果发布（M2 第 15 项，15 页 R03、R04、R04a、R04b）：审核结论有效时，负责专家把三份当前稿定稿存档，
// 形成一次交付（内部按 1、2、3 编号；界面、通知、文件名、Word 属性都不显示编号，交付了的写交付日期）。
// 发布带页面生成的 publishId：同一次发布重发（超时、断网后）只算一次；结果不确定时先按 publishId 查询，再决定要不要重试。
import { z } from 'zod';
import { DRAFT_KIND_KEYS, type DraftKind } from './generation.ts';
import { chinaToday } from './task.ts';

/** publishing = 正在发布；done = 已形成交付版本；failed = 没有形成交付，可以重新发布 */
export type PublishStatus = 'publishing' | 'done' | 'failed';

export interface PublishAttempt {
  publishId: string;
  status: PublishStatus;
  /** 这次发布要形成的交付版本号（V1 = 1） */
  version: number;
  /** 没有成功时给专家看的原因 */
  error: string | null;
  byName: string;
  startedAt: string;
  publishedAt: string | null;
}

export interface DeliveryVersion {
  version: number;
  publishedAt: string;
  byName: string;
  /** 三份定稿的文件名 */
  files: { kind: DraftKind; name: string }[];
}

export interface PublishDocView {
  kind: DraftKind;
  /** 发布后的文件名（例：惠阳飞宇电器有限公司应急预案.docx） */
  name: string;
  /** 当前稿的修订次数 */
  version: number;
  /** 当前稿是什么时候定下的 */
  savedAt: string | null;
}

export interface PublishView {
  batchId: string;
  enterpriseName: string;
  taskNumber: string;
  docs: PublishDocView[];
  /** 审核结论（有效时才能发布）；没有确认过为 null */
  review: { byName: string; at: string; valid: boolean } | null;
  /** 当前账号是负责专家（运营只能看） */
  editable: boolean;
  /** 现在能不能发布；不能时 blocker 写原因 */
  canPublish: boolean;
  blocker: string | null;
  /** 下次发布形成的交付版本号 */
  nextVersion: number;
  /**
   * 查询时带了 publishId：就是那一次发布（后台没收到过为 null）；
   * 没带：这批文稿最近的一次发布
   */
  attempt: PublishAttempt | null;
  /** 这个任务已形成的交付版本，新的在前 */
  deliveries: DeliveryVersion[];
}

export const publishRequestSchema = z.object({
  publishId: z.uuid(),
  /** 页面看到的这批草稿；之后重新生成过就拒绝 */
  batchId: z.uuid(),
  /** 页面看到的三份修订次数，与审核结论对应的不一致就拒绝 */
  versions: z.object(Object.fromEntries(DRAFT_KIND_KEYS.map((k) => [k, z.number().int().min(0)])) as Record<DraftKind, z.ZodNumber>),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

/** Word 文件属性里写的 AI 标识（TECH-PLAN 4.1：正文不加可见说明，只写在元数据里） */
export const AI_ASSISTED_NOTE = 'AI 辅助起草、注册安全工程师审核';

// 交付不对外显示版本号：需要区分第几次交付时写交付日期（北京时间）
const ymd = (at: string | Date) => chinaToday(new Date(at)).split('-').map(Number) as [number, number, number];
/** 例：11 月 20 日交付 */
export const deliveredOnLabel = (at: string | Date) => {
  const [, m, d] = ymd(at);
  return `${m} 月 ${d} 日交付`;
};
/** Word 属性里的交付日期，例：2026 年 11 月 20 日 */
export const deliveryDateText = (at: string | Date) => {
  const [y, m, d] = ymd(at);
  return `${y} 年 ${m} 月 ${d} 日`;
};

/** 发布中断（服务重启等）多久以后按失败处理、可以重新发布 */
export const PUBLISH_STALE_MS = 5 * 60_000;

// ---- 客户成果文档（M2 第 16 项，11 页 C06；15 页 R05、R06） ----

/** 每份成果给客户看的一句话说明 */
export const DELIVERY_DOC_SUMMARY: Record<DraftKind, string> = {
  plan: '综合预案、专项预案、现场处置方案与附件',
  risk: '企业风险辨识、分析与评估',
  resource: '企业应急人员、物资与资源情况',
};

export interface DeliveredFile {
  kind: DraftKind;
  /** 文件名（例：惠阳飞宇电器有限公司应急预案.docx） */
  name: string;
  fileId: string;
  sizeBytes: number;
}

export interface DeliveredVersion {
  version: number;
  publishedAt: string;
  /** 三份 Word，按应急预案、风险评估报告、应急资源调查报告排 */
  files: DeliveredFile[];
}

/** 一个任务的成果：已形成的交付版本，新的在前 */
export interface TaskDeliveries {
  taskId: string;
  taskNumber: string;
  taskName: string;
  enterpriseId: string;
  enterpriseName: string;
  versions: DeliveredVersion[];
  /**
   * 成果先锁住（次数用完或年度服务到期，任务等次数）时不为空：客户角色不能下载。
   * reason 按查看时的情况算：当天没有有效合同是 expired，否则是 credits。
   * adminNames：本组织在职的组织管理员名字，用「、」连起来（没有时是「组织管理员」）
   */
  lock: { reason: 'credits' | 'expired'; adminNames: string } | null;
}

/** 整套下载的压缩包名，括号里是交付日期（北京时间），例：某某有限公司编制成果（2026-11-20）.zip */
export const deliveryBundleName = (enterpriseName: string, deliveredAt: string | Date) =>
  `${safeFileName(enterpriseName)}编制成果（${chinaToday(new Date(deliveredAt))}）.zip`;

/** 拼进文件名的文字：去掉路径和系统不允许的字符（/\:*?"<>| 与控制字符），连续的点换成下划线，避免跳出目录 */
export const safeFileName = (text: string) =>
  text
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.{2,}/g, '_')
    .trim() || '未命名';
