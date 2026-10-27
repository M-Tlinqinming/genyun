import type { ReactNode } from 'react';
import { gy } from '../theme/tokens';
import { Logo } from './Logo';

// 编制向导（选择开始方式、企业自填）的顶栏：不带侧栏，左侧写明在为哪家企业编制什么
export function WizardHeader({ enterpriseName, extra }: { enterpriseName?: string; extra: ReactNode }) {
  return (
    <header
      style={{
        height: 64,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        background: gy.surface,
        borderBottom: `1px solid ${gy.split}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Logo />
        <span style={{ width: 1, height: 24, background: gy.split }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>编制应急预案</span>
          <span style={{ fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>{enterpriseName}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>{extra}</div>
    </header>
  );
}
