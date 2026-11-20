import type { ReactNode } from 'react';
import { source, type } from '../theme/tokens';

const DEFAULT_TEXT = { customer: '客户填写', expert: '专家补充', system: '耕云补全' } as const;

/** 信息来源：客户填写 / 专家补充 / 系统调取 */
export type SourceKind = keyof typeof source;

// 来源标签：标在一项信息旁边，说明这条是谁给的
export function SourceTag({
  kind,
  children,
}: {
  /** 来源：customer 客户 / expert 专家 / system 系统 */
  kind: SourceKind;
  /** 标签文字，不传用默认写法（客户填写、专家补充、耕云补全） */
  children?: ReactNode;
}) {
  const c = source[kind];
  return (
    <span
      data-source={kind}
      style={{
        display: 'inline-block',
        padding: '0 8px',
        borderRadius: 4,
        fontSize: type.caption.fontSize,
        lineHeight: '22px',
        whiteSpace: 'nowrap',
        color: c.color,
        background: c.bg,
      }}
    >
      {children ?? DEFAULT_TEXT[kind]}
    </span>
  );
}
