// Word 校对与审核结论（M2 第 12 项，14 页 E18-05、E18-06）。
// 三份草稿逐份核对：核对时记下这份的修订次数（version），之后再保存修订，这份就回到待核对。
// 三份都核对过（且都还对应当前稿）才能确认审核结论；结论同样记下三份的 version，任何一份再改就失效。
import { z } from 'zod';
import { DRAFT_KIND_KEYS, type DraftKind } from './generation.ts';

export interface DraftCheck {
  byName: string;
  at: string;
  /** 核对时这份的修订次数 */
  version: number;
}

export interface DraftCheckView {
  kind: DraftKind;
  /** 当前稿的修订次数（没改过为 0） */
  version: number;
  /** 当前稿是什么时候定下的：最后一次保存修订的时间，没改过为生成完成的时间 */
  savedAt: string | null;
  check: DraftCheck | null;
}

export interface ReviewConclusion {
  note: string;
  byName: string;
  at: string;
  versions: Record<DraftKind, number>;
}

export interface ReviewView {
  batchId: string;
  docs: DraftCheckView[];
  review: ReviewConclusion | null;
  /** 负责专家能核对、能确认结论；运营只能看 */
  editable: boolean;
}

/** 这份的核对还对应当前稿 */
export const checkValid = (d: Pick<DraftCheckView, 'version' | 'check'>) => d.check !== null && d.check.version === d.version;

/** 核对过、但之后又保存了修订 */
export const checkStale = (d: Pick<DraftCheckView, 'version' | 'check'>) => d.check !== null && d.check.version !== d.version;

export const checkedCount = (docs: Pick<DraftCheckView, 'version' | 'check'>[]) => docs.filter(checkValid).length;

/** 审核结论还对应三份当前稿 */
export function reviewValid(view: Pick<ReviewView, 'docs' | 'review'>): boolean {
  const r = view.review;
  return r !== null && view.docs.every((d) => checkValid(d) && r.versions[d.kind] === d.version);
}

/** 核对完一份后接着打开哪一份：按顺序找下一份还没核对的，都核对过了返回 null */
export function nextToCheck(docs: Pick<DraftCheckView, 'kind' | 'version' | 'check'>[], after: DraftKind): DraftKind | null {
  const start = DRAFT_KIND_KEYS.indexOf(after);
  for (let i = 1; i <= DRAFT_KIND_KEYS.length; i++) {
    const k = DRAFT_KIND_KEYS[(start + i) % DRAFT_KIND_KEYS.length]!;
    const d = docs.find((x) => x.kind === k);
    if (d && !checkValid(d)) return k;
  }
  return null;
}

export const REVIEW_NOTE_DEFAULT = '我已核对本次三份文稿，企业名称、联系人等关键信息一致，内容与 Word 版式符合本次交付要求。';
export const REVIEW_NOTE_MAX = 500;

/** 核对一份：带上页面看到的修订次数，别人刚保存过（次数变了）就拒绝 */
export const checkRequestSchema = z.object({ version: z.number().int().min(0) });

const versionsSchema = z.object(Object.fromEntries(DRAFT_KIND_KEYS.map((k) => [k, z.number().int().min(0)])) as Record<DraftKind, z.ZodNumber>);

export const reviewRequestSchema = z.object({
  note: z.string().trim().min(1, '请填写审核结论').max(REVIEW_NOTE_MAX, `审核结论不超过 ${REVIEW_NOTE_MAX} 字`),
  /** 页面看到的三份修订次数，与当前不一致就拒绝 */
  versions: versionsSchema,
});
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

/**
 * 校对页的 PDF：ready = 可以看；converting = 改过正文后正在重新排版；failed = 转换失败，可以重试；
 * unavailable = 服务器没装转换工具，只能下载 Word 核对
 */
export type PreviewStatus = 'ready' | 'converting' | 'failed' | 'unavailable';

export interface PreviewView {
  status: PreviewStatus;
  version: number;
  error: string | null;
}
