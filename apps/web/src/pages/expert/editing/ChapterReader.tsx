import { LockOutlined } from '@ant-design/icons';
import { PENDING_MARK, type EditBlock, type LockedPreview, type SectionView, type TextRun } from '@genyun/shared';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { gy, source } from '../../../theme/tokens';
import { when } from './EditDialogs';

// 核对定稿 · 正文（E18-04）：一章里的节按顺序只读显示；正文和表格里的「（待补充）」显示成琥珀色小标签。
// 每处标签带 data-pending="节:序号"（这一节里第几处，按段落、列表、表格的顺序数），右栏点一条待补充时按它定位

const body: CSSProperties = { fontSize: 14, lineHeight: '24px', color: gy.text };
const cell: CSSProperties = { padding: '8px 12px', borderBottom: `1px solid ${gy.split}`, textAlign: 'left', verticalAlign: 'top', fontWeight: 400 };

export const pendingKeyOf = (sectionId: string, n: number) => `${sectionId}:${n}`;

/** 一节里按顺序给每处待补充编号 */
type Counter = { sectionId: string; n: number; flash: string | null };

// 序号在渲染时按顺序数，所以下面都是普通函数（不是组件），一节只在 SectionBlocks 里数一遍
function mark(counter: Counter): ReactNode {
  const key = pendingKeyOf(counter.sectionId, counter.n++);
  const on = counter.flash === key;
  return (
    <span
      key={`m${key}`}
      data-pending={key}
      className={on ? 'gy-pending-flash' : undefined}
      style={{
        display: 'inline-block',
        padding: '0 6px',
        margin: '0 2px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: '20px',
        fontWeight: 600,
        color: gy.warning,
        background: gy.warningBg,
        scrollMarginBlock: 96,
      }}
    >
      待补充
    </span>
  );
}

/** 一段文字：把「（待补充）」换成标签 */
function withMarks(text: string, counter: Counter, bold = false): ReactNode[] {
  const parts = text.split(PENDING_MARK);
  return parts.flatMap((p, i) => [
    ...(i > 0 ? [mark(counter)] : []),
    ...(p ? [bold ? <strong key={`t${i}`} style={{ fontWeight: 600 }}>{p}</strong> : <Fragment key={`t${i}`}>{p}</Fragment>] : []),
  ]);
}

function runs(list: TextRun[], counter: Counter): ReactNode[] {
  return list.map((r, i) => <Fragment key={i}>{typeof r === 'string' ? withMarks(r, counter) : withMarks(r.text, counter, r.bold === true)}</Fragment>);
}

function lockedBlock(key: number, label: string, preview: LockedPreview | undefined, counter: Counter, workupHref: string | null): ReactNode {
  return (
    <div key={key} data-locked="" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>
        <LockOutlined aria-hidden />
        <span style={{ color: gy.secondary }}>{label}</span>
        <span style={{ marginLeft: 'auto' }}>来自资料核对，正文里不能改</span>
        {workupHref && (
          <Link to={workupHref} style={{ color: gy.primary }}>
            去资料核对修改
          </Link>
        )}
      </div>
      {preview?.kind === 'table' && (
        <div style={{ overflowX: 'auto', border: `1px solid ${gy.split}`, borderRadius: 6 }}>
          <table aria-label={label} style={{ borderCollapse: 'collapse', width: '100%', ...body, lineHeight: '22px' }}>
            <thead>
              {preview.header.map((r, i) => (
                <tr key={i} style={{ background: gy.canvas }}>
                  {r.map((c, j) => (
                    <th key={j} style={{ ...cell, color: gy.secondary, fontWeight: 400 }}>
                      {c}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {preview.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} style={{ ...cell, borderBottom: i === preview.rows.length - 1 ? 'none' : cell.borderBottom }}>
                      {withMarks(c, counter)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview?.kind === 'figure' && (
        <img src={preview.src} alt={label} style={{ maxWidth: 360, maxHeight: 240, objectFit: 'contain', alignSelf: 'flex-start', border: `1px solid ${gy.split}`, borderRadius: 6 }} />
      )}
    </div>
  );
}

/** 一节的正文（只读） */
export function SectionBlocks({ view, flash, workupHref }: { view: SectionView; flash: string | null; workupHref: string | null }) {
  const counter: Counter = { sectionId: view.id, n: 0, flash };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {view.blocks.map((b: EditBlock, i) => {
        if (b.type === 'paragraph') {
          return (
            <p key={i} style={{ ...body, margin: 0, textAlign: b.align ?? 'left', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {runs(b.text, counter)}
            </p>
          );
        }
        if (b.type === 'list') {
          const List = b.ordered === false ? 'ul' : 'ol';
          return (
            <List key={i} style={{ ...body, margin: 0, paddingLeft: 24 }}>
              {b.items.map((it, j) => (
                <li key={j} style={{ overflowWrap: 'anywhere' }}>
                  {runs(it, counter)}
                </li>
              ))}
            </List>
          );
        }
        return lockedBlock(i, b.label, view.locked.find((p) => p.index === b.index), counter, workupHref);
      })}
      {view.blocks.length === 0 && <span style={{ ...body, color: gy.tertiary }}>这一节没有正文。</span>}
    </div>
  );
}

/** 节标题下的「您已修改 · 今天 16:02」 */
export function EditedChip({ saved, me }: { saved: NonNullable<SectionView['saved']>; me: string | undefined }) {
  const who = saved.by && saved.by === me ? '您' : saved.byName;
  return (
    <span
      title={saved.note.trim() ? `修改说明：${saved.note}` : undefined}
      style={{ alignSelf: 'flex-start', padding: '0 6px', borderRadius: 4, fontSize: 12, lineHeight: '20px', color: source.expert.color, background: source.expert.bg }}
    >
      {who}已修改 · {when(saved.at)}
    </span>
  );
}
