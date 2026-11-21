import { App, Segmented } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { downloadFile, useIntake } from '../../../../api/intake';
import type { Workup } from '../../../../api/workup';
import { source as sourceColor, gy, type, weight } from '../../../../theme/tokens';
import { caption, dayOf, link14 } from './parts';

// 对照客户原表（13 页 S01）：第 2、3、4 步切到这里，按客户上传的样子只读显示这一步用到的格子。
// 格子来自读表时记下的来源（字段路径 → 工作表格子）；客户的值取快照，现在的值取叠上专家那份以后的内容。
// 您改过的格子标紫并写「您改成「…」」，客户空着的写「（空）」；客户原表本身不变

export { compareSheets, type CompareCell, type CompareMode, type CompareRow, type CompareSheet } from './compare';
import { colOrder, type CompareMode, type CompareRow, type CompareSheet } from './compare';

/** 第 2–4 步顶上的「逐项核对 / 对照客户原表」切换（只在资料表格流程显示） */
export function CompareBar({ summary, mode, onChange }: { summary: ReactNode; mode: CompareMode; onChange: (m: CompareMode) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '16px 24px',
        background: gy.surface,
        border: `1px solid ${gy.split}`,
        borderRadius: 8,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, ...type.body, color: gy.secondary }}>{summary}</span>
      <Segmented<CompareMode>
        aria-label="核对方式"
        value={mode}
        onChange={onChange}
        options={[
          { value: 'items', label: '逐项核对' },
          { value: 'sheet', label: '对照客户原表' },
        ]}
      />
    </div>
  );
}

const legendBox = (color: string): CSSProperties => ({ width: 12, height: 12, borderRadius: 2, border: `1px solid ${color}`, flexShrink: 0 });

/** 对照客户原表：每张工作表一张卡片 */
export function CompareSheets({ taskId, workup, sheets }: { taskId: string; workup: Workup; sheets: CompareSheet[] }) {
  const intake = useIntake(taskId, workup.flow === 'intake');
  const { message } = App.useApp();
  const file = intake.data?.dataSheet?.file;
  const download = () => file && void downloadFile(file.fileId).catch((err) => message.error(err instanceof Error ? err.message : '下载失败，请稍后再试'));
  if (sheets.length === 0) {
    return (
      <section style={{ padding: 24, background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, ...type.body, color: gy.secondary }}>
        客户表格里这一步对应的格子都空着。
      </section>
    );
  }
  return (
    <>
      {sheets.map((s) => (
        <section
          key={s.sheet}
          aria-label={`工作表「${s.sheet}」`}
          style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 style={{ margin: 0, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>工作表「{s.sheet}」</h2>
              {file && (
                <span style={caption}>
                  {file.originalName} · {dayOf(file.uploadedAt, true)} 上传 · 只读
                </span>
              )}
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...caption }}>
              <span aria-hidden style={{ ...legendBox(sourceColor.expert.color), background: sourceColor.expert.bg }} />
              您改过 {s.changed} 处
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...caption }}>
              <span aria-hidden style={{ ...legendBox(gy.warning), background: gy.warningBg }} />
              客户没填 {s.empty} 处
            </span>
            {file && (
              <button type="button" style={link14} onClick={download}>
                下载 Excel
              </button>
            )}
          </div>
          <SheetTable rows={s.rows} />
          <span style={caption}>只列这一步用到的行，左边是原表行号。要改内容，切回「逐项核对」。</span>
        </section>
      ))}
    </>
  );
}

function SheetTable({ rows }: { rows: CompareRow[] }) {
  // 一张工作表里可能有几段（工艺一句话、设备表、特种设备参数……），同一列在各段的含义不同：
  // 一列只有一种叫法时表头写「A · 名称」，几种叫法混着时表头只写列号，格子里再标这一格是什么
  const headersOf = new Map<string, Set<string>>();
  for (const c of rows.flatMap((r) => r.cells)) headersOf.set(c.col, (headersOf.get(c.col) ?? new Set()).add(c.header));
  const mixed = (col: string) => (headersOf.get(col)?.size ?? 0) > 1;
  const cols = [...headersOf.entries()].map(([col, hs]) => [col, hs.size > 1 ? '' : [...hs][0]!] as const).sort((a, b) => colOrder(a[0], b[0]));
  const cellBox: CSSProperties = { flex: 1, minWidth: 0, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 };
  return (
    <div role="table" style={{ border: `1px solid ${gy.split}`, borderRadius: 6, overflow: 'hidden' }}>
      <div role="row" style={{ display: 'flex', background: gy.neutralBg, borderBottom: `1px solid ${gy.split}` }}>
        <span role="columnheader" style={{ width: 48, flexShrink: 0 }} />
        {cols.map(([col, header]) => (
          <span key={col} role="columnheader" style={{ ...cellBox, ...type.caption, color: gy.secondary }}>
            {header ? `${col} · ${header}` : col}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={r.row} role="row" aria-label={`第 ${r.row} 行`} style={{ display: 'flex', borderTop: i ? `1px solid ${gy.split}` : undefined }}>
          <span role="rowheader" style={{ width: 48, flexShrink: 0, padding: '10px 0 0 12px', ...type.caption, color: gy.tertiary }}>
            {r.row}
          </span>
          {cols.map(([col]) => {
            const c = r.cells.find((x) => x.col === col);
            if (!c) return <span key={col} role="cell" style={cellBox} />;
            const changed = !r.removed && c.current !== c.original;
            const empty = !c.original;
            return (
              <span
                key={col}
                role="cell"
                data-changed={changed || undefined}
                style={{ ...cellBox, background: changed ? sourceColor.expert.bg : empty ? gy.warningBg : undefined }}
              >
                {mixed(col) && <span style={{ ...type.caption, color: gy.tertiary }}>{c.header}</span>}
                <span
                  style={{ ...type.body, color: empty ? gy.warning : gy.text, overflowWrap: 'anywhere', textDecoration: r.removed ? 'line-through' : undefined }}
                >
                  {empty ? '（空）' : c.original}
                </span>
                {changed && c.current !== undefined && (
                  <span style={{ ...type.caption, color: sourceColor.expert.color, overflowWrap: 'anywhere' }}>
                    {c.current ? `您${empty ? '补上' : '改成'}「${c.current}」` : '您清空了'}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      ))}
      {rows.some((r) => r.removed) && (
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${gy.split}`, ...type.caption, color: gy.tertiary }}>划线的行您在核对时删掉了。</div>
      )}
    </div>
  );
}
