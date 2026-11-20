import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { gy, type } from '../theme/tokens';

const TONES = {
  info: { bg: gy.selected, color: gy.primary, Icon: InfoCircleOutlined },
  success: { bg: gy.successBg, color: gy.success, Icon: CheckCircleOutlined },
  warning: { bg: gy.warningBg, color: gy.warning, Icon: ExclamationCircleOutlined },
  error: { bg: gy.errorBg, color: gy.error, Icon: CloseCircleOutlined },
} as const;

/** 提示条颜色：info 告诉一件事 / success 做成了 / warning 要先处理才能往下走 / error 出错了 */
export type NoticeTone = keyof typeof TONES;

// 提示条：浅底、圆角 8、上下 12 左右 16，左边 16 的图标，中间一句话，右边最多一个主色文字链接。
// 没有边框、没有标题、没有关闭按钮：事情解决了由页面把它拿掉。
export function NoticeBar({
  tone,
  children,
  action,
  label,
}: {
  /** 颜色与图标 */
  tone: NoticeTone;
  /** 一句话：先说发生了什么，再说下一步；超过两行请拆开 */
  children: ReactNode;
  /** 右侧一个文字链接（如「去补齐」「重新生成」），用 Button type="link" 或链接 */
  action?: ReactNode;
  /** 读屏用的名字，不传就读正文 */
  label?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-label={label}
      data-tone={tone}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, background: t.bg }}
    >
      <t.Icon style={{ fontSize: 16, color: t.color, flexShrink: 0 }} />
      <div style={{ flex: '1 1 0', minWidth: 0, ...type.body, color: gy.text }}>{children}</div>
      {action && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{action}</div>}
    </div>
  );
}
