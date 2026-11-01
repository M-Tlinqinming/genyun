// 确认采用资料并生成三份草稿（14 页 E18-01、E18-02、E18-02b）。
// 专家确认时锁定整理版本和采用的资料文件，三份草稿在后台排队各自生成；哪份失败只重试那一份。
import { z } from 'zod';

export const DRAFT_KINDS = { plan: '应急预案', risk: '风险评估报告', resource: '应急资源调查报告' } as const;
export type DraftKind = keyof typeof DRAFT_KINDS;
export const DRAFT_KIND_KEYS = Object.keys(DRAFT_KINDS) as DraftKind[];

// queued = 排队中；running = 生成中；done = 已生成；failed = 失败，可以重试
export const DRAFT_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

// 本次采用的资料：确认时任务里能看到的客户文件，来自企业资料库的带版本号
export interface LockedMaterial {
  fileId: string;
  name: string;
  version: number | null;
  itemKeys: string[];
}

// version = 专家确认时看到的整理版本；之后别人又改过就拒绝，请专家看过最新内容再确认
// materials = 专家确认时看到的资料指纹（materialsFingerprint）；资料在这之后又有变化就拒绝，留在确认页重新看
export const generationConfirmSchema = z.object({ version: z.number().int().min(1), materials: z.string().max(200).optional() });
export type GenerationConfirm = z.infer<typeof generationConfirmSchema>;

export interface DraftProgress {
  kind: DraftKind;
  status: DraftStatus;
  // 第几次生成（重试加 1）
  attempts: number;
  wordFileId: string | null;
  // 服务器没装转换工具时只有 Word
  pdfFileId: string | null;
  // 失败时给专家看的原因
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface GenerationProgress {
  id: string;
  workupVersion: number;
  snapshotAt: string;
  materials: LockedMaterial[];
  createdAt: string;
  createdByName: string;
  /** 三份里专家保存过修订的节数（重新生成前提醒） */
  editedSections: number;
  drafts: DraftProgress[];
}

// 还在排队或生成中的份
export const draftActive = (d: Pick<DraftProgress, 'status'>) => d.status === 'queued' || d.status === 'running';

// 企业自填前 4 步（与客户端自填页的步骤名一致），确认页按步列出
export const SELF_FILL_STEP_TITLES = ['企业基本信息', '人员与应急组织', '生产情况', '应急资源与图纸'] as const;

// 确认页（E18-01）左表一行：客户提交的文件，或企业自填的某一步
export interface AdoptedMaterial {
  // 文件行为文件 id，自填行为 step-1…step-4
  key: string;
  name: string;
  // 文件行：资料库的带版本号，任务里直接上传的为 null；自填行为 null
  fileId: string | null;
  version: number | null;
  // 自填行：第几步
  step: number | null;
  uploadedAt: string | null;
  // 与整理时不一致的原因；null = 与整理时一致
  change: AdoptedChange | null;
}

// added = 专家开始整理以后客户才上传的文件；newer = 企业资料库里这份已有更新的版本（任务仍用旧版）
export type AdoptedChange = { kind: 'added' } | { kind: 'newer'; version: number; uploadedAt: string };

export interface GenerationMaterials {
  rows: AdoptedMaterial[];
  // 确认时带回，后台比对资料有没有又变
  fingerprint: string;
}

// 只看会让专家重新核对的部分：有哪些文件、用的哪一版、有没有变化
export function materialsFingerprint(rows: Pick<AdoptedMaterial, 'key' | 'version' | 'change'>[]): string {
  const parts = rows
    .map((r) => `${r.key}:${r.version ?? ''}:${r.change ? (r.change.kind === 'newer' ? `n${r.change.version}` : 'a') : ''}`)
    .sort();
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${rows.length}-${h.toString(36)}`;
}
