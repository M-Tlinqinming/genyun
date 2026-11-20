import type { ReactNode } from 'react';
import { gy, stage, type } from '../theme/tokens';

/** 阶段标签的四种颜色：要动手（琥珀）、在等别人（灰）、做完了（绿）、出错了（红）。蓝色不用来表示阶段 */
export type StatusTone = keyof typeof stage;

// 阶段标签：浅底、圆角 4、12 号字、高 22；可在下面跟一行 12 号灰字说明
export function StatusTag({
  tone,
  children,
  note,
}: {
  /** 颜色：action 要动手 / progress 在等别人 / done 做完了 / error 出错了 */
  tone: StatusTone;
  /** 标签文字，即阶段名 */
  children: ReactNode;
  /** 标签下面一行的说明（表格阶段列用），不传就只有标签 */
  note?: ReactNode;
}) {
  const c = stage[tone];
  const tag = (
    <span
      data-tone={tone}
      style={{
        display: 'inline-block',
        padding: '0 8px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: '22px',
        whiteSpace: 'nowrap',
        color: c.color,
        background: c.bg,
      }}
    >
      {children}
    </span>
  );
  if (!note) return tag;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      {tag}
      <span style={{ ...type.caption, color: gy.tertiary }}>{note}</span>
    </span>
  );
}
