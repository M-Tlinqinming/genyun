import type { ReactNode } from 'react';
import { source, type } from '../theme/tokens';

/** 信息来源：客户给的 / 专家补的 / 耕云系统补全的 */
export type SourceKind = keyof typeof source;

// 来源标签：标在一项信息旁边，说明这条是谁给的。颜色按来源，文字按场景写（如「客户表格」「您已修改」「由您上传」「只有专家能填」）
export function SourceTag({
  kind,
  text,
}: {
  /** 来源，决定颜色：customer 客户 / expert 专家 / system 耕云系统 */
  kind: SourceKind;
  /** 标签文字，必须按场景写，没有默认值 */
  text: ReactNode;
}) {
  const c = source[kind];
  return (
    <span
      data-source={kind}
      style={{
        display: 'inline-block',
        padding: '0 6px',
        borderRadius: 4,
        fontSize: type.caption.fontSize,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        color: c.color,
        background: c.bg,
      }}
    >
      {text}
    </span>
  );
}
