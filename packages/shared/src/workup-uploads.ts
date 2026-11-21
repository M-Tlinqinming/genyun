// 资料核对里专家代客户上传（S03）和专家上传的三张图：上传位置、接受的文件、传上以后写进专家那份的哪里。
// 页面上「您代传」的意思是这个文件不在客户快照里。
import type { UploadRule } from './files.ts';
import { CUSTOMER_DRAWING_KEYS, CUSTOMER_DRAWINGS, EXPERT_DRAWING_KEYS, EXPERT_DRAWINGS, type DrawingFileKey } from './workup-drawings.ts';
import { emptyResourcesExtra } from './workup-resources.ts';
import { productionStepView, resourcesStepView } from './workup-steps.ts';
import type { WorkupData, WorkupSnapshot } from './workup.ts';

export type UploadTarget =
  | { kind: 'drawing'; key: DrawingFileKey }
  | { kind: 'msds'; rowId: string }
  | { kind: 'label'; rowId: string }
  | { kind: 'firstAid' };

export const UPLOAD_RULE_OF_TARGET: Record<UploadTarget['kind'], UploadRule> = {
  drawing: 'image_or_pdf',
  msds: 'material',
  label: 'image_or_pdf',
  firstAid: 'image_or_pdf',
};

// 每次上传记一条（处理记录「代客户上传了紧急疏散示意图」用）
export interface ExpertUpload {
  fileId: string;
  target: string;
  name: string;
  by: string;
  byName: string;
  at: string;
}

const ROW_ID = /^[\w-]{1,40}$/;

/** target 写成 drawing:<图纸>、msds:<物料行>、label:<物料行>、firstAid */
export function parseUploadTarget(raw: string | undefined): UploadTarget | null {
  const [kind, arg] = (raw ?? '').split(':', 2) as [string, string | undefined];
  if (kind === 'firstAid' && arg === undefined) return { kind };
  if (kind === 'drawing' && ([...CUSTOMER_DRAWING_KEYS, ...EXPERT_DRAWING_KEYS] as string[]).includes(arg ?? '')) {
    return { kind, key: arg as DrawingFileKey };
  }
  if ((kind === 'msds' || kind === 'label') && arg && ROW_ID.test(arg)) return { kind, rowId: arg };
  return null;
}

const put = (list: readonly string[], fileId: string, replace?: string) => [...list.filter((id) => id !== replace), fileId];

/**
 * 把传上的文件写进专家那份（第 3、4 步没保存过的，从叠好的内容开始写，和整步保存一样）；物料行不在了返回 null。
 * 写第 3 步时老整理层的设备、物料改动一起并进来
 */
export function withUploadedFile(
  snapshot: WorkupSnapshot,
  data: WorkupData,
  target: UploadTarget,
  fileId: string,
  replace?: string,
): WorkupData | null {
  if (target.kind === 'label') {
    const step = productionStepView(snapshot, data);
    const row = step.materials.find((m) => m.id === target.rowId);
    if (!row) return null;
    row.labelPhotoFileIds = put(row.labelPhotoFileIds, fileId, replace);
    const production = data.production ? { ...data.production, equipment: {}, materials: {} } : undefined;
    return { ...data, ...(production ? { production } : {}), profile: { ...data.profile, productionStep: { step } } };
  }
  if (target.kind === 'drawing' && (EXPERT_DRAWING_KEYS as string[]).includes(target.key)) {
    const extra = structuredClone(data.resourcesExtra ?? emptyResourcesExtra());
    const key = target.key as (typeof EXPERT_DRAWING_KEYS)[number];
    extra.drawings[key] = put(extra.drawings[key] ?? [], fileId, replace);
    return { ...data, resourcesExtra: extra };
  }
  const step = resourcesStepView(snapshot, data);
  if (target.kind === 'drawing') {
    const key = target.key as (typeof CUSTOMER_DRAWING_KEYS)[number];
    step.drawings[key] = put(step.drawings[key], fileId, replace);
  } else if (target.kind === 'firstAid') {
    step.firstAidKit.photoFileIds = put(step.firstAidKit.photoFileIds, fileId, replace);
  } else {
    if (!productionStepView(snapshot, data).materials.some((m) => m.id === target.rowId)) return null;
    const prev = step.msds[target.rowId];
    step.msds[target.rowId] = { fileIds: put(prev?.fileIds ?? [], fileId, replace), later: false };
  }
  return { ...data, profile: { ...data.profile, resourcesStep: { step } } };
}

/** 处理记录里的说法：「紧急疏散示意图」「物料的 MSDS」…；byExpert = 专家自己的图（不是代客户传） */
export function uploadTargetLabel(raw: string): { text: string; byExpert: boolean } {
  const t = parseUploadTarget(raw);
  if (!t) return { text: '文件', byExpert: false };
  if (t.kind === 'drawing') {
    const expert = (EXPERT_DRAWING_KEYS as string[]).includes(t.key);
    const text = expert
      ? EXPERT_DRAWINGS[t.key as keyof typeof EXPERT_DRAWINGS]
      : CUSTOMER_DRAWINGS[t.key as keyof typeof CUSTOMER_DRAWINGS];
    return { text, byExpert: expert };
  }
  if (t.kind === 'msds') return { text: '物料的 MSDS', byExpert: false };
  if (t.kind === 'label') return { text: '物料的包装标签照片', byExpert: false };
  return { text: '急救药箱照片', byExpert: false };
}
