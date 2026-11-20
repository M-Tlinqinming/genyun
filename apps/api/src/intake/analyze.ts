// 传上来一份资料表格后的判断，按 k5 说明的顺序：不是模板 → 别家企业 → 改名 → 旧版。
// 纯函数，不碰数据库；接口按返回结果去存文件、改企业名称、写读表结果。
import { normalizeEnterpriseName, type IntakeParseResult, type IntakeWarning } from '@genyun/shared';
import { checkSheet, type SheetCheck } from './check.ts';
import { buildParseResult } from './profile.ts';
import { loadWorkbook, readWorkbook, UnreadableWorkbookError } from './read.ts';
import { checkZip } from './zip-guard.ts';

export interface EnterpriseRef {
  id: string;
  name: string;
}

export type SheetAnalysis =
  | { kind: 'not_template'; warnings: IntakeWarning[] }
  | { kind: 'other_enterprise'; target: EnterpriseRef; warnings: IntakeWarning[] }
  | {
      kind: 'read';
      parse: IntakeParseResult;
      sheet: SheetCheck;
      /** 表里的企业名称和任务的企业不一样（规范化后也不一样），且不是空的：按表格改名 */
      rename: { previousName: string; newName: string } | null;
      warnings: IntakeWarning[];
    };

// 打不开的表格：接口直接 400，不存文件（文字是我拟的）
export const UNREADABLE_MESSAGE = '这份表格打不开。请确认是用 Excel 或 WPS 保存的 .xlsx 文件，再传一次。';
export const TOO_LARGE_MESSAGE = '这份表格打不开：里面的内容异常地大。请用下载的资料模板重新填好再传。';

export class SheetRejectedError extends Error {}

export async function analyzeSheet(
  buf: Buffer,
  ctx: { enterprise: EnterpriseRef; others: EnterpriseRef[]; now?: Date },
): Promise<SheetAnalysis> {
  const zip = checkZip(buf);
  if (!zip.ok) throw new SheetRejectedError(zip.reason === 'too_large' ? TOO_LARGE_MESSAGE : UNREADABLE_MESSAGE);
  let wb;
  try {
    wb = await loadWorkbook(buf);
  } catch (e) {
    if (e instanceof UnreadableWorkbookError) throw new SheetRejectedError(UNREADABLE_MESSAGE);
    throw e;
  }
  const out = readWorkbook(wb);
  if (out.kind === 'not_template') return { kind: 'not_template', warnings: [{ kind: 'not_template' }] };

  const read = out.read;
  const name = read.fields.name?.text ?? '';
  const key = name ? normalizeEnterpriseName(name) : '';
  if (key && key !== normalizeEnterpriseName(ctx.enterprise.name)) {
    const target = ctx.others.find((e) => e.id !== ctx.enterprise.id && normalizeEnterpriseName(e.name) === key);
    if (target) {
      return {
        kind: 'other_enterprise',
        target,
        warnings: [{ kind: 'other_enterprise', matchedEnterpriseId: target.id, matchedEnterpriseName: target.name }],
      };
    }
  }

  const parse = buildParseResult(read, ctx.now);
  // 表里没填企业名称：沿用任务的企业名称，不改名（缺项里会有「企业名称」）
  if (!parse.identity.name) parse.identity.name = ctx.enterprise.name;
  const warnings: IntakeWarning[] = [];
  const rename = key && key !== normalizeEnterpriseName(ctx.enterprise.name) ? { previousName: ctx.enterprise.name, newName: name } : null;
  if (rename) warnings.push({ kind: 'enterprise_renamed', ...rename });
  if (read.layout.old) warnings.push({ kind: 'old_template', templateVersion: null });
  return { kind: 'read', parse, sheet: checkSheet(read), rename, warnings };
}
