// 专家资料（13 页 E3「我的资料」、12 页 S09/S10 客户选专家）：客户看到的卡片 + 只给耕云审核看的实名和证书。

/** 系统头像，8 选 1（13 页 E3-1），不上传照片（图在 docs/review-2026-11-15/avatars/gy1–gy8.svg） */
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

/**
 * 判断能不能选、能不能派时用到的专家资料字段；没有资料行传 null。
 * reviewStatus 为 null = 耕云内部建的专家账号、没走入驻审核（如为暂停接单才建的资料行）
 */
export type ExpertAvailability = { reviewStatus: ExpertReviewStatus | null; acceptingOrders: boolean } | null;

/** 客户能选的专家（12 页 S09）：要有资料行、已上架、接单中；内部账号没审核过，客户选不到 */
export function isCustomerSelectableExpert(profile: ExpertAvailability): boolean {
  return !!profile && profile.reviewStatus === 'approved' && profile.acceptingOrders;
}

/**
 * 运营能派的专家（16 页派单）：没有资料行的算接单中，照常能派；
 * 有资料行的要接单中，并且是内部账号（审核状态为空）或已上架（待审核、未通过、已下架的都不派）。
 */
export function isOperatorAssignableExpert(profile: ExpertAvailability): boolean {
  return profile === null || (profile.acceptingOrders && (profile.reviewStatus === null || profile.reviewStatus === 'approved'));
}
