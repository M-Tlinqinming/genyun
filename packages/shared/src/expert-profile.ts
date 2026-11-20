// 专家资料（13 页 E3「我的资料」、12 页 S09/S10 客户选专家）：客户看到的卡片 + 只给耕云审核看的实名和证书。

/** 系统头像，专家从中选一个，不上传照片（图在 docs/review-2026-11-15/avatars/gy1–gy8.svg） */
export const EXPERT_AVATARS = ['gy1', 'gy2', 'gy3', 'gy4', 'gy5', 'gy6', 'gy7', 'gy8'] as const;
export type ExpertAvatar = (typeof EXPERT_AVATARS)[number];

export const EXPERT_INTRO_MAX = 50;
export const EXPERT_BIO_MAX = 500;

/** 审核状态：待审核、已上架、未通过、已下架（如证书过期自动下架） */
export const EXPERT_REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'delisted'] as const;
export type ExpertReviewStatus = (typeof EXPERT_REVIEW_STATUSES)[number];
export const EXPERT_REVIEW_STATUS_LABELS: Record<ExpertReviewStatus, string> = {
  pending: '待审核',
  approved: '已上架',
  rejected: '未通过',
  delisted: '已下架',
};

/** 一本资质证书。照片只给审核看；客户只看到证书名称，证书号中间打码 */
export interface ExpertCertificate {
  name: string;
  number: string;
  /** 有效期至，YYYY-MM 或 YYYY-MM-DD */
  expiresOn: string;
  /** 证书照片（文件种类 expert_certificate）；还没传为 null */
  fileId: string | null;
}
