import type { IntakeFileSlot, IntakeView } from '@genyun/shared';
import { clock, dayLabel } from '../prepare/intakeText';

// 提交确认弹窗和已提交页上的资料清单、随状态变的文字。都是纯函数，单元测试在 materialRows.test.ts

/** 资料清单的一行：左边文件名，右边说明；warn = 说明用警告色（说明了没有疏散图） */
export interface MaterialRow {
  key: string;
  name: string;
  note: string;
  warn: boolean;
  /** 能下载的文件；说明了没有疏散图的那一行没有 */
  fileId: string | null;
}

const SLOT_ORDER: IntakeFileSlot[] = ['data_sheet', 'site_plan', 'evacuation_map', 'other'];
const SLOT_NOTE: Record<Exclude<IntakeFileSlot, 'data_sheet'>, string> = {
  site_plan: '总平面布置图',
  evacuation_map: '紧急疏散示意图',
  other: '其他图纸与照片',
};

const sheetNote = (sheets: number | null) => (sheets === null ? '资料表格' : `${sheets} 张表 · 必填已齐`);

interface Entry {
  slot: IntakeFileSlot;
  fileId: string;
  name: string;
}

function rows(entries: Entry[], sheets: number | null, noEvacuationMap: boolean, noMapNote: string): MaterialRow[] {
  const sorted = [...entries].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const out: MaterialRow[] = sorted.map((e) => ({
    key: e.fileId,
    name: e.name,
    note: e.slot === 'data_sheet' ? sheetNote(sheets) : SLOT_NOTE[e.slot],
    warn: false,
    fileId: e.fileId,
  }));
  if (noEvacuationMap && !entries.some((e) => e.slot === 'evacuation_map')) {
    // 排在紧急疏散示意图该在的位置：总平面布置图后面
    const at = out.findIndex((_, i) => SLOT_ORDER.indexOf(sorted[i]!.slot) > SLOT_ORDER.indexOf('evacuation_map'));
    const row: MaterialRow = { key: 'no-evacuation-map', name: '紧急疏散示意图', note: noMapNote, warn: true, fileId: null };
    out.splice(at === -1 ? out.length : at, 0, row);
  }
  return out;
}

/** 提交确认弹窗：当前要交给专家的资料 */
export function currentRows(v: IntakeView): MaterialRow[] {
  const entries: Entry[] = [];
  if (v.dataSheet) entries.push({ slot: 'data_sheet', fileId: v.dataSheet.file.fileId, name: v.dataSheet.file.originalName });
  if (v.sitePlan) entries.push({ slot: 'site_plan', fileId: v.sitePlan.fileId, name: v.sitePlan.originalName });
  for (const f of [...v.evacuationMaps, ...v.others]) entries.push({ slot: f.slot, fileId: f.fileId, name: f.originalName });
  return rows(entries, v.dataSheet?.sheets.length ?? null, v.noEvacuationMap, '已说明没有这张图');
}

/** 已提交页「本次提交的资料」：取自提交快照 */
export function submittedRows(v: IntakeView): MaterialRow[] {
  const s = v.submission;
  if (!s) return [];
  const entries = s.files.map((f) => ({ slot: f.slot, fileId: f.fileId, name: f.originalName }));
  const sheet = s.files.find((f) => f.slot === 'data_sheet');
  const sheets = sheet && v.dataSheet?.file.fileId === sheet.fileId ? v.dataSheet.sheets.length : null;
  return rows(entries, sheets, s.noEvacuationMap, '您说明没有这张图，客服会联系您补上');
}

/** 提交确认弹窗底下的提示 */
export function submitHint(v: IntakeView): string {
  return v.withdrawnAt
    ? '这次提交后不能再撤回。完成后会通知您。'
    : '提交后，专家开始核对之前可以撤回一次；专家开始核对后不能再改。完成后会通知您。';
}

/** 删除任务弹窗的正文 */
export function deleteBody(enterpriseName: string, v: IntakeView): string {
  const tail = v.withdrawnAt ? '已经撤回了，不扣编制次数。' : '还没提交，不扣编制次数。';
  return `${enterpriseName}的这次任务，连同已传的表格、图纸和照片会一起删掉，删了找不回来。${tail}`;
}

/** 「11 月 16 日 10:40」 */
export function when(iso: string, now = new Date()): string {
  return `${dayLabel(iso, now)} ${clock(iso)}`;
}

/** 「本次提交的资料」卡片的副标题；withdraw = 放不放「撤回修改」 */
export function materialsIntro(v: IntakeView): { text: string; withdraw: boolean } {
  if (v.canWithdraw) return { text: '发现填错了？专家开始核对之前可以撤回一次，改好再提交。', withdraw: true };
  if (v.expertStarted) return { text: '专家已经开始核对，不能再修改。发现填错了，请联系客服。', withdraw: false };
  if (v.withdrawnAt) return { text: '已经撤回过一次，不能再撤回。发现填错了，请联系客服。', withdraw: false };
  return { text: '发现填错了，请联系客服。', withdraw: false };
}
