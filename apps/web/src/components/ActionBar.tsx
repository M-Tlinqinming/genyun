import type { ReactNode } from 'react';
import { gy, layout, type } from '../theme/tokens';

// 底部操作栏：贴在窗口底部，白底、上分隔线，上下 12 左右 24；里面和页面内容一样宽。
// 最左可放红色危险文字（如「删除任务」），主按钮在最右，按钮左边一句说明（可带「联系客服」链接）。
export function ActionBar({
  danger,
  note,
  children,
  width = layout.wizard,
  sticky = true,
}: {
  /** 最左边的危险操作，一般是 Button type="link" danger */
  danger?: ReactNode;
  /** 按钮左边的一句说明，比如为什么还不能提交 */
  note?: ReactNode;
  /** 右侧按钮：最多一个主按钮，放最右 */
  children: ReactNode;
  /** 内容宽度，与页面内容对齐：向导 1080，工作台 1152 */
  width?: number;
  /** 是否贴住窗口底部，默认是 */
  sticky?: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="页面操作"
      style={{
        position: sticky ? 'sticky' : 'static',
        bottom: 0,
        zIndex: 10,
        display: 'flex',
        justifyContent: 'center',
        padding: '12px 24px',
        background: gy.surface,
        borderTop: `1px solid ${gy.split}`,
      }}
    >
      <div style={{ width: '100%', maxWidth: width, display: 'flex', alignItems: 'center', gap: 16 }}>
        {danger}
        <span style={{ flex: '1 1 0' }} />
        {note && <span style={{ ...type.body, color: gy.secondary, textAlign: 'right' }}>{note}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>{children}</div>
      </div>
    </div>
  );
}
