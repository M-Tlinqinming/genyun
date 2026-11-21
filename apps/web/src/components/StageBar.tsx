import { CheckOutlined } from '@ant-design/icons';
import { Fragment } from 'react';
import { Link } from 'react-router';
import { gy, type, weight } from '../theme/tokens';

// 向导顶栏中间的阶段条：做完的（浅蓝圆 + 蓝勾、次要色字）、当前的（蓝底白字圆 + 加粗）、
// 还没到的（灰框圆 + 浅灰字）。阶段多（四步以上）时排得紧一些。
export function StageBar({
  stages,
  current,
  label = '进度',
  notes,
  links,
  lastStrong,
}: {
  /** 各阶段名，按顺序 */
  stages: readonly string[];
  /** 当前阶段的序号，从 0 开始；等于 stages.length 表示全部做完 */
  current: number;
  /** 读屏用的名字 */
  label?: string;
  /** 某一段名字后面的灰字，如 { 0: '5 步' } */
  notes?: Partial<Record<number, string>>;
  /** 做完的段可以点回去：名字变成链接，title 是悬停提示 */
  links?: Partial<Record<number, { to: string; title: string }>>;
  /** 最后一段的名字用加粗正文色（全部做完时突出最后一段，如已交付页的「交付」） */
  lastStrong?: boolean;
}) {
  const compact = stages.length > 3;
  return (
    <ol
      aria-label={label}
      style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 12, margin: 0, padding: 0, listStyle: 'none' }}
    >
      {stages.map((name, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        const link = state === 'done' ? links?.[i] : undefined;
        const note = notes?.[i];
        return (
          <Fragment key={i}>
            {i > 0 && (
              <li
                aria-hidden
                style={{ width: compact ? 24 : 48, height: 1, flexShrink: 0, background: i <= current ? gy.primary : gy.split }}
              />
            )}
            <li
              aria-current={state === 'current' ? 'step' : undefined}
              data-state={state}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxSizing: 'border-box',
                  fontSize: 12,
                  lineHeight: '20px',
                  ...(state === 'done'
                    ? { background: gy.selected, color: gy.primary }
                    : state === 'current'
                      ? { background: gy.primary, color: gy.surface, fontWeight: weight.strong }
                      : { border: `1px solid ${gy.split}`, color: gy.tertiary }),
                }}
              >
                {state === 'done' ? <CheckOutlined style={{ fontSize: 12 }} aria-label="已完成" /> : i + 1}
              </span>
              {(() => {
                const strong = state === 'current' || (lastStrong && i === stages.length - 1);
                const style = {
                  ...type.body,
                  whiteSpace: 'nowrap' as const,
                  color: strong ? gy.text : state === 'done' ? gy.secondary : gy.tertiary,
                  fontWeight: strong ? weight.strong : weight.normal,
                };
                return link ? (
                  <Link to={link.to} title={link.title} className="gy-stage-link" style={style}>
                    {name}
                  </Link>
                ) : (
                  <span style={style}>{name}</span>
                );
              })()}
              {note && <span style={{ ...type.caption, whiteSpace: 'nowrap', color: gy.tertiary }}>{note}</span>}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
