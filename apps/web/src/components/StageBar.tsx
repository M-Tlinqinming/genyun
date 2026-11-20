import { CheckOutlined } from '@ant-design/icons';
import { Fragment } from 'react';
import { gy, type, weight } from '../theme/tokens';

// 向导顶栏中间的阶段条：做完的（浅蓝圆 + 蓝勾、次要色字）、当前的（蓝底白字圆 + 加粗）、
// 还没到的（灰框圆 + 浅灰字）。阶段多（四步以上）时排得紧一些。
export function StageBar({
  stages,
  current,
  label = '进度',
}: {
  /** 各阶段名，按顺序 */
  stages: readonly string[];
  /** 当前阶段的序号，从 0 开始；等于 stages.length 表示全部做完 */
  current: number;
  /** 读屏用的名字 */
  label?: string;
}) {
  const compact = stages.length > 3;
  return (
    <ol
      aria-label={label}
      style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 12, margin: 0, padding: 0, listStyle: 'none' }}
    >
      {stages.map((name, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
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
              <span
                style={{
                  ...type.body,
                  whiteSpace: 'nowrap',
                  color: state === 'done' ? gy.secondary : state === 'current' ? gy.text : gy.tertiary,
                  fontWeight: state === 'current' ? weight.strong : weight.normal,
                }}
              >
                {name}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
