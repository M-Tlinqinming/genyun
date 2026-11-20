import type { ReactNode } from 'react';
import { gy, type, weight } from '../theme/tokens';
import { BackLink } from './BackLink';

// 页头：（详情页）返回链接 / 24 号标题 + 阶段标签 / 一句说明，右侧最多一个入口按钮。
// 页头距顶栏 32（由内容区留出），距下面的内容 24。
export function PageHeader({
  back,
  eyebrow,
  title,
  tag,
  description,
  actions,
  extra,
  gap = 4,
}: {
  /** 详情页的返回链接；一级页面不传 */
  back?: { to: string; label: string };
  /** 旧写法：标题上方的一行小字。新页面请改用 back，不要再加 */
  eyebrow?: ReactNode;
  /** 页面标题，24 号加粗 */
  title: ReactNode;
  /** 跟在标题右边的阶段标签（StatusTag） */
  tag?: ReactNode;
  /** 标题下的一句说明，14 号次要色 */
  description?: ReactNode;
  /** 右侧操作区：最多一个入口按钮，或一个开关 */
  actions?: ReactNode;
  /** 旧名，等同 actions，保留给已有页面 */
  extra?: ReactNode;
  /** 左侧各行之间的间距：工作台页默认 4，向导页头用 8 */
  gap?: number;
}) {
  const right = actions ?? extra;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap, minWidth: 0 }}>
        {back && <BackLink to={back.to} label={back.label} />}
        {eyebrow && <div style={{ ...type.caption, color: gy.secondary }}>{eyebrow}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <h1 style={{ margin: 0, ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>{title}</h1>
          {tag}
        </div>
        {description && <div style={{ ...type.body, color: gy.secondary }}>{description}</div>}
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minHeight: 32 }}>{right}</div>}
    </div>
  );
}
