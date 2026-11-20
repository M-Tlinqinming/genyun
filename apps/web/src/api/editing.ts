import type { DraftKind, EditBlock, EditDocumentView, PendingView, RewriteResult, SectionView } from '@genyun/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { request } from './request';

// 正文编辑（M2 第 11 项）：按节读、按节保存；保存带 saveId，结果不明时先查这次保存有没有成功再重试

export const editDocumentKey = (taskId: string, kind: DraftKind) => ['tasks', taskId, 'drafts', kind, 'edit'] as const;
export const sectionKey = (taskId: string, kind: DraftKind, sectionId: string) => ['tasks', taskId, 'drafts', kind, 'sections', sectionId] as const;

export const pendingKey = (taskId: string, kind: DraftKind) => ['tasks', taskId, 'drafts', kind, 'pending'] as const;

const base = (taskId: string, kind: DraftKind) => `/tasks/${taskId}/drafts/${kind}`;
const sectionUrl = (taskId: string, kind: DraftKind, sectionId: string) => `${base(taskId, kind)}/sections/${encodeURIComponent(sectionId)}`;

export function useEditDocument(taskId: string, kind: DraftKind) {
  return useQuery({ queryKey: editDocumentKey(taskId, kind), queryFn: () => request<EditDocumentView>(`${base(taskId, kind)}/edit`) });
}

export function useSection(taskId: string, kind: DraftKind, sectionId: string | null) {
  return useQuery({
    queryKey: sectionKey(taskId, kind, sectionId ?? ''),
    queryFn: () => request<SectionView>(sectionUrl(taskId, kind, sectionId!)),
    enabled: sectionId !== null,
    // 编辑中的内容在页面里；不在切回窗口时覆盖
    refetchOnWindowFocus: false,
  });
}

/** 一章里的各节（只读显示用），和 useSection 共用缓存 */
export function useSections(taskId: string, kind: DraftKind, sectionIds: string[]) {
  return useQueries({
    queries: sectionIds.map((id) => ({
      queryKey: sectionKey(taskId, kind, id),
      queryFn: () => request<SectionView>(sectionUrl(taskId, kind, id)),
      refetchOnWindowFocus: false,
    })),
  });
}

/** 待补充清单和每章的待补充数 */
export function usePending(taskId: string, kind: DraftKind) {
  return useQuery({ queryKey: pendingKey(taskId, kind), queryFn: () => request<PendingView>(`${base(taskId, kind)}/pending`) });
}

export interface SaveSectionInput {
  saveId: string;
  // 打开编辑页时的那一批草稿；之后重新生成过，后台拒绝（409，提示刷新）
  batchId: string;
  baseRev: number;
  blocks: EditBlock[];
  // 修改说明，选填（可以是空字符串）
  note: string;
  // 这次修改采用了「帮我改写这段」的 AI 文字时带上提示词版本，记进修改记录
  aiPromptVersion?: string;
}

export function saveSection(taskId: string, kind: DraftKind, sectionId: string, input: SaveSectionInput) {
  return request<SectionView & { version: number }>(`${base(taskId, kind)}/sections/${encodeURIComponent(sectionId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function saveStatus(taskId: string, kind: DraftKind, saveId: string, batchId: string) {
  return request<{ saved: false } | { saved: true; section: SectionView & { version: number } }>(`${base(taskId, kind)}/saves/${saveId}?batch=${batchId}`);
}

export function rewriteParagraph(taskId: string, kind: DraftKind, sectionId: string, text: string) {
  return request<RewriteResult>(`${base(taskId, kind)}/sections/${encodeURIComponent(sectionId)}/rewrite`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// 这一份现在的 Word（生成稿加上已保存的修改）
export async function downloadCurrentWord(taskId: string, kind: DraftKind) {
  const res = await fetch(`/api${base(taskId, kind)}/word`, { credentials: 'include' });
  if (!res.ok) throw new Error('word');
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name ? decodeURIComponent(name) : '文稿.docx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
