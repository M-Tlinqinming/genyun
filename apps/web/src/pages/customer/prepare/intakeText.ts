import type { IntakeOptionalItem, IntakeView } from '@genyun/shared';

// 准备资料页上随状态变的文字：标题、副标题、底部提示、日期。都是纯函数，单元测试在 intakeText.test.ts

const parts = (iso: string) => {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
};

/** 北京时间 HH:MM */
export function clock(iso: string): string {
  const p = parts(iso);
  return `${p.hour}:${p.minute}`;
}

/** 「M 月 D 日」，不是今年的前面加「YYYY 年 」 */
export function dayLabel(iso: string, now = new Date()): string {
  const p = parts(iso);
  const n = parts(now.toISOString());
  return `${p.year === n.year ? '' : `${p.year} 年 `}${p.month} 月 ${p.day} 日`;
}

/** 「今天 10:24」「11 月 16 日 10:24」「2025 年 11 月 16 日 10:24」 */
export function stamp(iso: string, now = new Date()): string {
  const p = parts(iso);
  const n = parts(now.toISOString());
  const today = p.year === n.year && p.month === n.month && p.day === n.day;
  return `${today ? '今天' : dayLabel(iso, now)} ${p.hour}:${p.minute}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 页面处在哪一步：表格读到了（read），或者还没有读得了的表格（四种） */
export type IntakePhase = 'template' | 'previous' | 'not_template' | 'other_enterprise' | 'read';

export function phaseOf(v: IntakeView): IntakePhase {
  if (v.dataSheet?.status === 'read' && v.requiredCheck) return 'read';
  if (v.dataSheet?.status === 'not_template') return 'not_template';
  if (v.dataSheet?.status === 'other_enterprise') return 'other_enterprise';
  if (!v.dataSheet && v.previousSheet) return 'previous';
  return 'template';
}

const isDrawing = (field: string) => field.startsWith('drawing.');

/** 还缺几张必填图（总平面布置图；紧急疏散示意图没传也没说明没有） */
export function missingDrawings(v: IntakeView): number {
  if (v.requiredCheck) return v.requiredCheck.missing.filter((m) => isDrawing(m.field)).length;
  return (v.sitePlan ? 0 : 1) + (v.evacuationMaps.length > 0 || v.noEvacuationMap ? 0 : 1);
}

/** 读到表格以后：回表格改的项、直接传的图 */
export function missingSplit(v: IntakeView) {
  const missing = v.requiredCheck?.missing ?? [];
  return { sheet: missing.filter((m) => !isDrawing(m.field)), drawings: missing.filter((m) => isDrawing(m.field)) };
}

export function headline(v: IntakeView): { title: string; subtitle: string } {
  const base = '资料表格和 2 张必填图传齐就能提交。选填没填的不用管，专家会补。';
  switch (phaseOf(v)) {
    case 'template':
      return { title: '先下载资料模板，填好后传上来', subtitle: base };
    case 'previous':
      return { title: '可以在上次提交的表上改，再传上来', subtitle: base };
    case 'not_template':
      return { title: '这份文件读不了，请用资料模板重新上传', subtitle: base };
    case 'other_enterprise':
      return { title: '请确认是不是传错了企业', subtitle: base };
    case 'read': {
      const { sheet, drawings } = missingSplit(v);
      const n = sheet.length + drawings.length;
      const optional = v.requiredCheck?.optional.length ?? 0;
      if (n === 0) {
        return {
          title: '必填都齐了，可以提交',
          subtitle: `表格里的必填都填了，2 张必填图也处理好了。${
            optional > 0 ? `下面 ${optional} 项选填没填，可以不填，专家编制时会补。` : ''
          }`,
        };
      }
      const pieces = [
        sheet.length > 0 ? `${sheet.length} 项回表格改好后重新上传` : '',
        drawings.length > 0 ? `${drawings.length} 张图直接在这里传` : '',
      ].filter(Boolean);
      return {
        title: `表格已读取，还差 ${n} 项必填`,
        subtitle: `${pieces.join('，')}。选填没填的不用管，专家会补。`,
      };
    }
  }
}

/** 底部操作栏按钮左边那句（「填不上？联系客服」由页面接在后面） */
export function footerNote(v: IntakeView): string {
  if (phaseOf(v) === 'read') {
    const n = v.requiredCheck?.missing.length ?? 0;
    return n === 0 ? '必填已齐，提交后专家开始核对' : `还差 ${n} 项必填，补齐后可以提交`;
  }
  const d = missingDrawings(v);
  return d === 0 ? '还差资料表格，传齐后可以提交' : `还差资料表格和 ${d} 张必填图，传齐后可以提交`;
}

/** 选填的名字：提示里「年用量」写成「物料年用量」，免得看不懂 */
const optionalShortLabel = (item: IntakeOptionalItem) => (item.label === '年用量' ? '物料年用量' : item.label);

/** 「另有 7 项选填没填（如规格型号、物料年用量），可以不填，专家编制时会补。」没有选填缺项时返回 null */
export function optionalSummary(items: IntakeOptionalItem[]): string | null {
  if (items.length === 0) return null;
  const examples = items.slice(0, 2).map(optionalShortLabel).join('、');
  return `另有 ${items.length} 项选填没填（如${examples}），可以不填，专家编制时会补。`;
}

/** 一项选填：「没填。」或「2 栋没填。」 */
export function optionalNote(item: IntakeOptionalItem): string {
  return item.count ? `${item.count} ${item.unitWord ?? '处'}没填。` : '没填。';
}

/** 展开列表里的一项：「建筑与场所：结构类型（2 栋没填）」 */
export function optionalLine(item: IntakeOptionalItem): string {
  return `${item.sheet}：${item.label}${item.count ? `（${item.count} ${item.unitWord ?? '处'}没填）` : ''}`;
}

/** 企业简称：去掉「有限公司」这类后缀，如「示例电子有限公司」→「示例电子」 */
export function shortName(name: string): string {
  const short = name.replace(/(股份有限公司|有限责任公司|有限公司|公司)$/, '');
  return short || name;
}
