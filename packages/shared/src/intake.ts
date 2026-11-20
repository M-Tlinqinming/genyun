// 新流程「准备资料」（12 页 U1–U3b、13 页 E1/E3）：客户下载资料模板、填好整份上传（资料表格），
// 再传总平面布置图、紧急疏散示意图和其他图纸照片。系统读表格、核查必填，必填齐了才能提交给专家。
// 模板各页的读取位置和 20 项必填见 apps/api/content/intake/README.md。
import type { EnterpriseProfile } from './profile/basic-step.ts';
import type { WorkupSnapshot } from './workup.ts';

/** 当前的资料模板版本，写在「填写说明」页 B2 */
export const INTAKE_TEMPLATE_VERSION = '2026.11';

/** 必填一共 20 项：表格里 18 项，另外两张图 */
export const INTAKE_REQUIRED_COUNT = 20;

/** 上传位置：资料表格、总平面布置图、紧急疏散示意图、其他图纸与照片 */
export const INTAKE_FILE_SLOTS = ['data_sheet', 'site_plan', 'evacuation_map', 'other'] as const;
export type IntakeFileSlot = (typeof INTAKE_FILE_SLOTS)[number];
export const INTAKE_FILE_SLOT_LABELS: Record<IntakeFileSlot, string> = {
  data_sheet: '资料表格',
  site_plan: '总平面布置图',
  evacuation_map: '紧急疏散示意图',
  other: '其他图纸与照片',
};

/** 谁传的：客户自己，或专家替客户传（客服拿到资料后由专家代传） */
export const INTAKE_UPLOADER_SIDES = ['customer', 'expert'] as const;
export type IntakeUploaderSide = (typeof INTAKE_UPLOADER_SIDES)[number];

/** 表格里的一个格子：工作表名 + 格子（如「企业信息」B3），行号便于提示「第几行」 */
export interface IntakeCellRef {
  sheet: string;
  cell: string;
  row: number;
}

/**
 * 读表格的结果。identity / profile 与专家整理快照（WorkupSnapshot）同形，
 * 专家开始核对时可以直接拿来做快照。sources 记每个字段读自哪个格子（键是字段路径，如 "identity.name"、
 * "profile.basic.address"），可选，用于专家核对时回指表格。
 */
export interface IntakeParseResult {
  /** 读到的模板版本（填写说明 B2）；读不到为 null */
  templateVersion: string | null;
  identity: WorkupSnapshot['identity'];
  profile: EnterpriseProfile;
  sources?: Record<string, IntakeCellRef>;
  /** ISO 时间 */
  parsedAt: string;
}

/**
 * 一项缺的必填。表格里的项带工作表、行、格子；两张图没有格子，sheet / row / cell 为 null。
 * field 是稳定的键（如 "enterprise.name"、"drawing.site_plan"），label 是给客户看的原话（如「企业名称」）。
 */
export interface IntakeMissingItem {
  field: string;
  label: string;
  sheet: string | null;
  row: number | null;
  cell: string | null;
}

/** 必填核查结果：缺了哪几项。missing 为空 = 必填齐了（还要看两张图） */
export interface IntakeRequiredCheck {
  missing: IntakeMissingItem[];
  /** ISO 时间 */
  checkedAt: string;
}

/**
 * 上传后的提示（12 页 U1c、U1d、U2d、U2e）：
 * not_template = 不是耕云的资料模板，不读取，请重新上传；
 * other_enterprise = 表里的企业像是同组织的另一家企业，拦住请确认；
 * old_template = 用的是旧版模板；
 * enterprise_renamed = 表格里的企业名称和档案不一样，已按表格改好。
 */
export const INTAKE_WARNING_KINDS = ['not_template', 'other_enterprise', 'old_template', 'enterprise_renamed'] as const;
export type IntakeWarningKind = (typeof INTAKE_WARNING_KINDS)[number];

export interface IntakeWarning {
  kind: IntakeWarningKind;
  /** other_enterprise：表里像是哪家（同组织的企业） */
  matchedEnterpriseId?: string;
  matchedEnterpriseName?: string;
  /** old_template：表里读到的版本 */
  templateVersion?: string | null;
  /** enterprise_renamed：改名前后 */
  previousName?: string;
  newName?: string;
}

/** 提交时记下的一份文件 */
export interface IntakeSubmittedFile {
  fileId: string;
  slot: IntakeFileSlot;
  originalName: string;
}

/** 提交快照：这次交给专家的文件和读表结果；撤回后重新提交另记一行 */
export interface IntakeSubmissionSnapshot {
  files: IntakeSubmittedFile[];
  parse: IntakeParseResult | null;
  templateVersion: string | null;
  /** 客户说明「这张图我们没有」（紧急疏散示意图） */
  noEvacuationMap: boolean;
  /** 客户选的专家；为空 = 由耕云安排 */
  preferredExpertId: string | null;
}
