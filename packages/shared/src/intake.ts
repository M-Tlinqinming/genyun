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
  /**
   * 放不进资料的值：超长、电话里有汉字、数字栏写了字等。原样记下，不悄悄丢掉，
   * 专家核对时再看（K11 决定怎么显示）。label 是给人看的字段名，text 是格子里的原文
   */
  unplaced: IntakeUnplacedValue[];
  /** ISO 时间 */
  parsedAt: string;
}

/** 一个放不进资料的值：在哪张表哪一格、是什么字段、格子里的原文 */
export interface IntakeUnplacedValue {
  sheet: string;
  cell: string;
  label: string;
  text: string;
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
  /** 给客户看的那句提示，如「没填。大概数就行，可以看租赁合同。」 */
  note: string;
  /** 旧版模板和新版对不上的一项（如旧版「是否出租厂房」选了「不清楚」），旧版提示里要数出来 */
  mismatch?: boolean;
}

/**
 * 一项选填没填。按格算的带行和格子（提示「没填。」）；按列算的（如建筑的结构类型）
 * 只数已填的行里有几行没填，count 是行数，unitWord 是量词，显示成「2 栋没填。」「5 台设备没填。」
 */
export interface IntakeOptionalItem {
  field: string;
  label: string;
  sheet: string;
  row?: number;
  cell?: string;
  count?: number;
  unitWord?: string;
  /** 给客户看的提示；不写就按「没填。」（按列算的是「2 栋没填。」）显示 */
  note?: string;
}

/**
 * 必填核查结果。missing 是缺的必填，表格里的按工作表、行、列排，缺的两张图排在最后；
 * missing 为空 = 必填齐了。optional 是选填没填的，不影响提交
 */
export interface IntakeRequiredCheck {
  missing: IntakeMissingItem[];
  optional: IntakeOptionalItem[];
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

/** 准备资料页上的一份文件（GET /api/tasks/:taskId/intake） */
export interface IntakeFileView {
  /** task_intake_files 的 id，删除时用 */
  id: string;
  fileId: string;
  slot: IntakeFileSlot;
  originalName: string;
  sizeBytes: number;
  contentType: string;
  /** ISO 时间 */
  uploadedAt: string;
  uploadedByExpert: boolean;
}

/** 当前的资料表格：读成了（read），还是不是模板 / 像是别家企业的、没有读取 */
export interface IntakeSheetView {
  file: IntakeFileView;
  status: 'read' | 'not_template' | 'other_enterprise';
  templateVersion: string | null;
  /** 旧版模板（读不到版本号） */
  oldTemplate: boolean;
  /** 读到的各张表和每张表缺几项；没读取时为空 */
  sheets: { name: string; missing: number }[];
}

/** 表格像是别家企业的：按当前用户算好的跳转目标 */
export interface IntakeOtherEnterprise {
  enterpriseId: string;
  enterpriseName: string;
  /** 当前用户看不看得到那家企业；看不到不放按钮 */
  visible: boolean;
  /** 那家企业在办的任务（看得到时才给） */
  openTaskId: string | null;
}

/** 这家企业以前提交过的资料表格（U1b）：同一企业其他任务里最近一次没撤回的提交 */
export interface IntakePreviousSheet {
  fileId: string;
  originalName: string;
  /** ISO 时间 */
  submittedAt: string;
}

/** 当前有效（没撤回）的那次提交：已提交页的资料卡片、进度第 1 步用 */
export interface IntakeSubmissionView {
  /** ISO 时间 */
  submittedAt: string;
  /** 提交人的姓名（人已经不在组织里也照样显示） */
  submittedByName: string;
  /** 这次交给专家的文件，取自提交快照 */
  files: IntakeSubmittedFile[];
  /** 提交时说明了「这张图我们没有」（紧急疏散示意图） */
  noEvacuationMap: boolean;
}

export interface IntakeView {
  taskId: string;
  /** 能不能上传、删除（组织管理员或分配到这家企业的成员，且任务还在准备资料） */
  canEdit: boolean;
  dataSheet: IntakeSheetView | null;
  sitePlan: IntakeFileView | null;
  evacuationMaps: IntakeFileView[];
  others: IntakeFileView[];
  /** 读到表格后才有；没读到为 null */
  requiredCheck: IntakeRequiredCheck | null;
  warnings: IntakeWarning[];
  noEvacuationMap: boolean;
  otherEnterprise: IntakeOtherEnterprise | null;
  previousSheet: IntakePreviousSheet | null;
  /** ISO 时间，「已自动保存 HH:MM」 */
  updatedAt: string;
  /** 当前有效的提交；还没提交或已撤回为 null */
  submission: IntakeSubmissionView | null;
  /** 撤回过的话是那次撤回的时间（ISO），否则 null。一个任务只能撤回一次 */
  withdrawnAt: string | null;
  /** 现在能不能撤回：有编辑权限、已提交、没撤回过、专家还没开始核对 */
  canWithdraw: boolean;
  /** 专家已开始核对（负责专家第一次打开资料核对时复制了快照） */
  expertStarted: boolean;
}

/** 提交给专家（POST /api/tasks/:taskId/intake/submit）：requestId 每次打开确认弹窗生成一个，失败重试时沿用 */
export interface IntakeSubmitRequest {
  requestId: string;
}
