import { ArrowLeftOutlined } from '@ant-design/icons';
import { Divider, Typography } from 'antd';
import type { ReactNode } from 'react';
import { gy } from '../theme/tokens';
import { Logo, LogoMark } from './Logo';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? '/';

// 登录、账号恢复共用的页面框架（A01 / A03）：顶栏 + 左侧品牌说明 + 右侧 456 宽卡片
// raise：卡片比 A01 往上提的距离。A03 的卡片更高，设计稿把它顶边放在页头下 60px（A01 是 108px）
export function AuthShell({ children, raise = 0 }: { children: ReactNode; raise?: number }) {
  return (
    <div style={{ minHeight: '100vh', background: gy.canvas }}>
      <header
        style={{
          height: 92,
          background: gy.surface,
          borderBottom: `1px solid ${gy.frameLine}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 80px 0 64px',
        }}
      >
        <Logo />
        <a href={SITE_URL} style={{ color: gy.text, display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <ArrowLeftOutlined style={{ fontSize: 14 }} />
          返回官网
        </a>
      </header>

      {/* 上边距见 global.css 的 .gy-auth-main：视口不高于 800 时收小到 48px */}
      <main
        className="gy-auth-main"
        style={{
          maxWidth: 1056,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 48,
        }}
      >
        <section style={{ paddingTop: 32, width: 368 }}>
          <LogoMark width={120} height={48} />
          <Typography.Title level={1} style={{ fontSize: 36, lineHeight: '54px', fontWeight: 500, margin: '17px 0 0' }}>
            把专业的事，
            <br />
            交给同一个工作空间。
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 16, lineHeight: '30px', marginTop: 20 }}>
            围绕企业资料、编制任务和成果交付，延续每一次有据可查的协作。
          </Typography.Paragraph>
          <Divider style={{ width: 80, minWidth: 80, margin: '32px 0' }} />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            通过邀请开通账户，进入获授权的工作空间。
          </Typography.Text>
        </section>

        <section
          className="gy-auth-card"
          style={{
            width: 456,
            boxSizing: 'border-box',
            background: gy.surface,
            border: `1px solid ${gy.split}`,
            borderRadius: 12,
            padding: '35px 36px 35px',
            marginTop: -raise,
          }}
        >
          {children}
        </section>
      </main>
    </div>
  );
}
