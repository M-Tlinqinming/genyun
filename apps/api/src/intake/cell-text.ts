// 取单元格文字：读表和必填检查都只走这里，保证同一格在哪儿读出来都一样。
import type { Cell, CellValue } from 'exceljs';

// 数字不用科学计数法；先按 15 位有效数字收一下，去掉 Excel 浮点误差（如 12.300000000000001）
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  const rounded = Number(n.toPrecision(15));
  return rounded.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

// 日期一律写成 YYYY-MM-DD。exceljs 按 UTC 给出日期
export function formatDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function valueText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'object') {
    // 富文本：几段拼起来
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((t) => t.text ?? '').join('');
    // 超链接：取显示的文字（文字本身也可能是富文本）
    if ('hyperlink' in value && 'text' in value) return valueText(value.text as CellValue);
    // 公式、共享公式：取算好的结果
    if ('formula' in value || 'sharedFormula' in value) return valueText((value as { result?: CellValue }).result);
    // #N/A 等错误值当空格
    if ('error' in value) return '';
  }
  return '';
}

/** 单元格文字，去掉首尾空白。合并单元格只有左上角那格有字，其余算空 */
export function cellText(cell: Cell): string {
  if (cell.isMerged && cell.master !== cell) return '';
  return valueText(cell.value).trim();
}

/** 全角字母、数字、标点转半角，全角空格转半角空格 */
export function toHalfWidth(s: string): string {
  return s.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

/** 比较字段名、表头用：去掉「*」和所有空白，全角半角统一 */
export function normalizeLabel(s: string): string {
  return toHalfWidth(s).replace(/[*\s]/g, '');
}
