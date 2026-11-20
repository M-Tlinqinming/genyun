import type { ReactNode } from 'react';
import { WizardHeader } from '../components/WizardHeader';
import { gy, layout } from '../theme/tokens';

/** 客户这一端的三个阶段 */
export const CUSTOMER_STAGES = ['准备资料', '专家编制', '已交付'] as const;
/** 专家这一端的四个阶段 */
export const EXPERT_STAGES = ['资料核对', '生成初稿', '核对定稿', '交付'] as const;

// 向导壳子：顶栏 64（带阶段条）+ 画布底色的内容区（宽 1080，上下 48）+ 贴底的操作栏。
// 不带侧栏，用于客户准备资料、专家核对这类一步一步往下走的页面。
export function WizardLayout({
  title,
  enterpriseName,
  stages,
  current,
  headerExtra,
  footer,
  paddingBlock = 48,
  paddingTop,
  paddingBottom,
  sideWidth,
  children,
}: {
  /** 顶栏左边第一行：在做什么 */
  title?: ReactNode;
  /** 顶栏左边第二行：为哪家企业 */
  enterpriseName?: string;
  /** 阶段条各阶段名，客户用 CUSTOMER_STAGES，专家用 EXPERT_STAGES，也可传本页的分步 */
  stages: readonly string[];
  /** 当前阶段序号，从 0 开始 */
  current: number;
  /** 顶栏右边：自动保存状态、返回按钮 */
  headerExtra: ReactNode;
  /** 底部操作栏（ActionBar），不传就没有 */
  footer?: ReactNode;
  /** 内容区上下内边距，默认 48 */
  paddingBlock?: number;
  /** 只改上内边距（如资料核对上 24），不传用 paddingBlock */
  paddingTop?: number;
  /** 只改下内边距（如资料核对下 32），不传用 paddingBlock */
  paddingBottom?: number;
  /** 顶栏左右两块的宽度，默认 360；阶段多时可以窄一些 */
  sideWidth?: number;
  /** 页面内容 */
  children: ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: gy.canvas }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <WizardHeader title={title} enterpriseName={enterpriseName} stages={stages} current={current} extra={headerExtra} sideWidth={sideWidth} />
      </div>
      <main style={{ flex: '1 0 auto', display: 'flex', justifyContent: 'center', padding: `${paddingTop ?? paddingBlock}px 24px ${paddingBottom ?? paddingBlock}px` }}>
        <div style={{ width: '100%', maxWidth: layout.wizard }}>{children}</div>
      </main>
      {footer}
    </div>
  );
}
