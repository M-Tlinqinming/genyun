// 专业整理 ·「图件」· 客户图纸（M2 第 10c 项，Martin 2026-11-01 定在图件模块里选页）：
// 客户上传的总平面图、疏散图、消防设施布置图放进应急预案附件 7。PDF 常有好几页（设计说明、图纸目录、
// 给排水图……），系统判断不了哪页该放，由专家勾选；没选过的每份默认只放第 1 页，图片只有 1 页。
// 选页记在任务的专业整理里（WorkupData.figures.drawings），不写回企业资料。
import { z } from 'zod';

// 客户资料清单里的三张图纸，按附件 7 里的先后排
export const CUSTOMER_DRAWINGS = {
  site_plan: '总平面布置图',
  evacuation_plan: '紧急疏散示意图',
  fire_facility_plan: '消防设施布置图',
} as const;
export type CustomerDrawingKey = keyof typeof CUSTOMER_DRAWINGS;
export const CUSTOMER_DRAWING_KEYS = Object.keys(CUSTOMER_DRAWINGS) as CustomerDrawingKey[];

// 能转成图片放进 Word 的文件
export const DRAWING_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const isDrawingContentType = (t: string) => (DRAWING_CONTENT_TYPES as readonly string[]).includes(t);

// 一份 PDF 最多认这么多页（深同跃宿舍疏散图 22 页）
export const MAX_DRAWING_PAGES = 200;

// 专家勾选的页（从 1 起）；空数组 = 这份一页都不放
export const drawingPagesSchema = z.array(z.number().int().min(1).max(MAX_DRAWING_PAGES)).max(MAX_DRAWING_PAGES);
export const drawingsSaveSchema = z.record(z.uuid(), drawingPagesSchema).refine((r) => Object.keys(r).length <= 50, '图纸太多');
export type DrawingSelection = z.infer<typeof drawingsSaveSchema>;

// 某份图纸实际放进附件 7 的页：没选过默认第 1 页；超出页数的忽略，去重排序
export function selectedPages(selection: DrawingSelection | undefined, fileId: string, pageCount: number): number[] {
  const chosen = selection?.[fileId] ?? [1];
  return [...new Set(chosen)].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
}

// 图件页「客户图纸」一份文件
export interface CustomerDrawing {
  fileId: string;
  name: string;
  contentType: string;
  key: CustomerDrawingKey;
  // 转不出来（文件损坏、加密）时为 null，页面提示，生成时跳过
  pageCount: number | null;
  error?: string;
  selected: number[];
  // 专家改过选页
  customized: boolean;
}

// 确认生成时锁定进生成输入（PlanInput.drawings），生成应急预案时按这里取图
export interface PlanDrawingRef {
  key: CustomerDrawingKey;
  fileId: string;
  page: number;
}

export function planDrawingsOf(drawings: CustomerDrawing[]): PlanDrawingRef[] {
  return CUSTOMER_DRAWING_KEYS.flatMap((key) =>
    drawings.filter((d) => d.key === key).flatMap((d) => d.selected.map((page) => ({ key, fileId: d.fileId, page }))),
  );
}

// 一份文件挂在几项图纸上时（如「总平面图、布置图」）按附件 7 的先后归到第一项
export function drawingKeyOf(itemKeys: readonly string[]): CustomerDrawingKey | undefined {
  return CUSTOMER_DRAWING_KEYS.find((k) => itemKeys.includes(k));
}
