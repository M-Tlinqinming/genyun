// 生成应急预案的输入：客户资料（新资料格式）+ 注册安全工程师的判断与补充 + 属地机构。
// 专家的部分由 M2 第 4–8 项逐步接上页面；还没有时用系统建议或通用写法，不编造企业事实。
import type { BasicInfo } from '../profile/basic.ts';
import type { PlanFigures } from '../workup-figures.ts';
import type { Location } from '../profile/location.ts';
import type { Organization } from '../profile/organization.ts';
import type { Production } from '../profile/production.ts';
import type { SiteType } from '../profile/production-step.ts';
import type { ScopeKey } from './catalog.ts';
import type { LocalAgencies } from './agencies.ts';

/** 危险源辨识的一行（LEC 法，M2 第 7 项由专家取值） */
export interface Hazard {
  workplace: string;
  factor: string;
  /** 所在厂址 id（一照多址时，见 profile/addresses.ts） */
  addressId?: string;
  l?: number;
  e?: number;
  c?: number;
}

export const RISK_LEVELS = ['稍有危险', '一般危险', '显著危险', '高度危险', '极其危险'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** D = L × E × C；缺一项就算不出 */
export function riskScore(h: Pick<Hazard, 'l' | 'e' | 'c'>): number | undefined {
  if (h.l === undefined || h.e === undefined || h.c === undefined) return undefined;
  return Math.round(h.l * h.e * h.c * 100) / 100;
}

// 阈值：≤20 稍有，≤70 一般，≤160 显著，≤320 高度，其余极其危险
export function riskLevel(d: number | undefined): RiskLevel | undefined {
  if (d === undefined) return undefined;
  if (d <= 20) return '稍有危险';
  if (d <= 70) return '一般危险';
  if (d <= 160) return '显著危险';
  if (d <= 320) return '高度危险';
  return '极其危险';
}

/** 专家补充的企业事实（M2 第 4 项「企业事实」），都可以不填 */
export interface ExpertFacts {
  /** 企业简称，预案编号用（如 FY → FY2026） */
  shortName?: string;
  establishedDate?: string;
  /** 隶属关系 / 上级主管单位 */
  superior?: string;
  /** 周边环境与重大危险源情况 */
  surroundings?: string;
  hospital?: { name: string; distanceKm?: number; route?: string };
  /** 四级响应的判定条件，按本企业场景写；不填用通用写法 */
  responseGrading?: Partial<Record<'level1' | 'level2' | 'level3' | 'level4', string>>;
  training?: { budget?: string; department?: string };
  /** 建筑结构与耐火等级（耐火等级是专家判断），按建筑名称对应 */
  buildings?: Record<string, { structure?: string; fireRating?: string }>;
}

export interface ExpertInput {
  /** 判定为危险化学品的物料名称；没判定前由系统按名称建议 */
  hazardousMaterials?: string[];
  hazards?: Hazard[];
  /** 专家改过的适用范围开关；没改的用系统建议 */
  scope?: Partial<Record<ScopeKey, boolean>>;
  facts?: ExpertFacts;
  /** 专家微调后的图件画法；没有时按自动排版 */
  figures?: PlanFigures;
}

export interface PlanInput {
  basic: BasicInfo;
  location: Location;
  organization: Organization;
  production: Production;
  /** 自填第 3 步的场所与两个业务问题 */
  business: { sites: SiteType[]; leasesPremises?: boolean; ownVehicles?: boolean };
  expert: ExpertInput;
  /** 按地址从耕云知识库带出 */
  agencies: LocalAgencies;
  /** 颁布日期 YYYY-MM-DD，封面、批准发布令、预案编号共用 */
  issuedOn: string;
}
