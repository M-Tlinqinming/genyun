import { CheckCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons';
import { Skeleton } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { gy } from '../theme/tokens';

// 页面上反复出现的几种基础样式与组件，只在这里写一份；页面里不再各写各的（设计对齐第 2 步）

// 表单必填星号放在标签后面（登记、开通弹窗和接受邀请一致）
export const requiredAfter = (label: ReactNode, { required }: { required: boolean }) => (
  <>
    {label}
    {required && <span style={{ color: gy.error, marginLeft: 4 }}>*</span>}
  </>
);

// 白底卡片面板
export const panel: CSSProperties = { borderRadius: 8, background: gy.surface, border: `1px solid ${gy.split}` };

// 看起来像文字链接的按钮（「去补充」「查看说明」等）
export const linkButton: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '22px',
  color: gy.primary,
  textAlign: 'left',
  fontFamily: 'inherit',
};

// 卡片和抽屉里的小号文字链接
export const linkButtonSmall: CSSProperties = { ...linkButton, fontSize: 13, lineHeight: '20px' };

const NOTICE_TONES = {
  info: { bg: gy.selected, border: '#9DB7EE', icon: <InfoCircleFilled style={{ color: gy.primary }} /> },
  warning: { bg: gy.warningBg, border: '#D9A441', icon: <ExclamationCircleFilled style={{ color: gy.warning }} /> },
  success: { bg: gy.successBg, border: gy.success, icon: <CheckCircleFilled style={{ color: gy.success }} /> },
} as const;

// 页面顶部的提示条：一句标题、一句说明，右侧可放一个按钮（13 页 F03、F07；12 页 P05）
export function Notice({
  tone,
  title,
  text,
  action,
  label,
}: {
  tone: keyof typeof NOTICE_TONES;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  label?: string;
}) {
  const t = NOTICE_TONES[tone];
  return (
    <div
      role="status"
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '20px 24px',
        borderRadius: 8,
        background: t.bg,
        border: `1px solid ${t.border}`,
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 0, flexShrink: 0 }}>{t.icon}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>{title}</span>
        {text && <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{text}</span>}
      </div>
      {action}
    </div>
  );
}

// 加载中：先画出灰色的大致排版，内容到了再替换，页面不跳（Martin 10-28 选定骨架屏）
export function Loading({ rows = 4, card = true }: { rows?: number; card?: boolean }) {
  return (
    <div aria-busy="true" aria-label="正在加载" style={card ? { ...panel, padding: 24 } : { padding: '24px 0' }}>
      <Skeleton active title paragraph={{ rows }} />
    </div>
  );
}
