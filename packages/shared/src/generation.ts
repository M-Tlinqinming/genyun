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
export const generationConfirmSchema = z.object({ version: z.number().int().min(1) });
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
  drafts: DraftProgress[];
}

// 还在排队或生成中的份
export const draftActive = (d: Pick<DraftProgress, 'status'>) => d.status === 'queued' || d.status === 'running';
