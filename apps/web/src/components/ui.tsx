import { Skeleton } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { gy } from '../theme/tokens';
import { NoticeBar, type NoticeTone } from './NoticeBar';

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
export const linkButtonSmall: CSSProperties = { ...linkButton, fontSize: 14, lineHeight: '22px' };

// 页面上的提示条：已按设计系统改成无边框、圆角 8、上下 12 左右 16、16 号图标。
// 新页面请用 NoticeBar（只有一句话、不带标题）；这里保留标题 + 说明两行的旧写法，给已有页面用。
export function Notice({
  tone,
  title,
  text,
  action,
  label,
}: {
  /** 颜色：info 告知 / success 做成了 / warning 要先处理 / error 出错了 */
  tone: NoticeTone;
  /** 第一行（有说明时加粗） */
  title: ReactNode;
  /** 第二行说明，可不传 */
  text?: ReactNode;
  /** 右侧一个按钮或链接 */
  action?: ReactNode;
  /** 读屏用的名字 */
  label?: string;
}) {
  return (
    <NoticeBar tone={tone} action={action} label={label}>
      {text ? (
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <span style={{ color: gy.secondary }}>{text}</span>
        </span>
      ) : (
        title
      )}
    </NoticeBar>
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
