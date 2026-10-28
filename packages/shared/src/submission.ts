// 提交生成申请（Paper 13 页 F01–F08）：确认资料版本、防重复提交、提交后的待补清单。前后端共用。
import { z } from 'zod';
import { CHECKLIST_ITEMS, type ChecklistItemKey } from './checklist/items.ts';
import { itemCheckState } from './checklist/overview.ts';
import type { ChecklistState } from './checklist/status.ts';

// 任务用的某份资料的某个版本
export interface DocumentVersionRef {
  documentId: string;
  versionId: string;
}

// 本次提交用到的文件。资料库里的带版本；拍照给耕云看的照片等不进资料库，没有版本
export interface SubmittedDocument {
  fileId: string;
  name: string;
  version: number | null;
}

// 由客户自己确认的事项（直接填写、没有、请专家电话联系、业务问题），确认框里逐条列出
export interface SubmittedAnswer {
  label: string;
  answer: string;
}

// 客户在确认框里看到的内容与提交时要一致：任务选用的资料版本 + 各项资料的处理情况。
// 两边各算一次，对不上说明确认之后资料被改过（如换了图纸版本），这次不提交，请客户重新检查
export function submissionFingerprint(documents: DocumentVersionRef[], items: ChecklistState): string {
  const docs = documents.map((d) => `${d.documentId}:${d.versionId}`).sort();
  const states = CHECKLIST_ITEMS.flatMap((def) => {
    const s = items[def.key];
    if (!s) return [];
    return [[def.key, s.status, s.callRequested ? 1 : 0, s.note ?? '', [...s.fileIds].sort().join(',')].join(':')];
  });
  return fnv1a([...docs, '|', ...states].join(';'));
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// 提交时还没给的项（可稍后补、待专家电话联系）：提交后进待补清单，客户仍可以补；
// 其余已处理的项随提交锁定
export function pendingAfterSubmit(items: ChecklistState): ChecklistItemKey[] {
  return CHECKLIST_ITEMS.filter((def) => {
    const state = itemCheckState(def.requirement, items[def.key]);
    return state === 'later' || state === 'call';
  }).map((def) => def.key);
}

// 待补清单的进度：提交时待补的项，现在补了几项
export function supplementProgress(pendingKeys: readonly ChecklistItemKey[], items: ChecklistState) {
  const done = pendingKeys.filter((key) => {
    const def = CHECKLIST_ITEMS.find((d) => d.key === key)!;
    return itemCheckState(def.requirement, items[key]) === 'done';
  });
  return { done: done.length, total: pendingKeys.length, doneKeys: done };
}

// 提交请求：requestId 由页面在打开确认框时生成，同一次提交重发多少遍都只记一次
export const submitRequestSchema = z.object({
  requestId: z.uuid('提交编号无效，请刷新页面后重试'),
  fingerprint: z.string().min(1),
  // 确认框里显示的资料版本，用来告诉客户具体哪份资料变了
  documents: z.array(z.object({ documentId: z.uuid(), versionId: z.uuid() })),
});
export type SubmitRequest = z.infer<typeof submitRequestSchema>;

// 确认框之后资料又有变化时，说给客户听的变化（13 页 F07）
export function describeDocumentChanges(
  confirmed: DocumentVersionRef[],
  current: (DocumentVersionRef & { name: string; version: number })[],
  versionOf: (versionId: string) => number | undefined,
): string[] {
  const changes: string[] = [];
  const before = new Map(confirmed.map((d) => [d.documentId, d.versionId]));
  for (const d of current) {
    const old = before.get(d.documentId);
    if (old === undefined) changes.push(`新增了${d.name}`);
    else if (old !== d.versionId) {
      const from = versionOf(old);
      changes.push(from ? `${d.name}由 V${from} 改为 V${d.version}` : `${d.name}改为 V${d.version}`);
    }
    before.delete(d.documentId);
  }
  if (before.size > 0) changes.push(`移除了 ${before.size} 份资料`);
  return changes;
}
