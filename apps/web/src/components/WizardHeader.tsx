import type { ReactNode } from 'react';
import { gy, layout, type, weight } from '../theme/tokens';
import { Logo } from './Logo';
import { StageBar } from './StageBar';

// 向导顶栏（高 64，不带侧栏）：左边 Logo + 在做什么、为哪家企业；中间阶段条；右边保存状态和返回按钮
export function WizardHeader({
  title = '编制应急预案',
  enterpriseName,
  stages,
  current = 0,
  extra,
  sideWidth = 360,
  stageNotes,
  stageLinks,
}: {
  /** 左边第一行：在做什么，如「编制应急预案」「资料核对」 */
  title?: ReactNode;
  /** 左边第二行：为哪家企业 */
  enterpriseName?: string;
  /** 中间阶段条的各阶段名；不传就不显示阶段条 */
  stages?: readonly string[];
  /** 当前阶段序号，从 0 开始 */
  current?: number;
  /** 右边：自动保存状态、「返回工作台」按钮等 */
  extra: ReactNode;
  /** 左右两块的宽度，默认 360 */
  sideWidth?: number;
  /** 阶段名后面的灰字，原样传给阶段条 */
  stageNotes?: Partial<Record<number, string>>;
  /** 做完的阶段可以点回去，原样传给阶段条 */
  stageLinks?: Partial<Record<number, { to: string; title: string }>>;
}) {
  return (
    <header
      style={{
        height: layout.header,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        padding: '0 32px',
        background: gy.surface,
        borderBottom: `1px solid ${gy.split}`,
      }}
    >
      {/* 左右栏收窄到 280 时（资料核对向导），Logo、分隔线、标题之间按设计稿收成 16 */}
      <div style={{ flex: `0 0 ${sideWidth}px`, minWidth: 0, display: 'flex', alignItems: 'center', gap: sideWidth < 360 ? 16 : 24 }}>
        <Logo />
        <span style={{ width: 1, height: 24, flexShrink: 0, background: gy.split }} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text, whiteSpace: 'nowrap' }}>{title}</span>
          {enterpriseName && (
            <span
              title={enterpriseName}
              style={{ ...type.caption, color: gy.tertiary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {enterpriseName}
            </span>
          )}
        </div>
      </div>
      {stages && <StageBar stages={stages} current={current} notes={stageNotes} links={stageLinks} />}
      <div style={{ flex: `0 0 ${sideWidth}px`, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: sideWidth < 360 ? 16 : 20 }}>
        {extra}
      </div>
    </header>
  );
}
