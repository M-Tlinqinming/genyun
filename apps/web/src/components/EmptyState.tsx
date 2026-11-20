import type { ReactNode } from 'react';
import { gy, type } from '../theme/tokens';

// 空状态：卡片里居中一句话，下面一个按钮或链接。三种用法：
// 第一次用（主按钮）、筛选后没有（「清除筛选」链接）、没读出来（「重新加载」描边按钮）
export function EmptyState({
  children,
  action,
  minHeight = 200,
}: {
  /** 一句话，如「没有符合当前条件的任务。」 */
  children: ReactNode;
  /** 下面的一个按钮或链接，可不传 */
  action?: ReactNode;
  /** 区域最小高度，默认 200 */
  minHeight?: number;
}) {
  return (
    <div
      style={{
        minHeight,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '32px 24px',
        textAlign: 'center',
      }}
    >
      <div style={{ ...type.body, color: gy.secondary }}>{children}</div>
      {action}
    </div>
  );
}
