import { ArrowLeftOutlined } from '@ant-design/icons';
import { Divider, Typography } from 'antd';
import type { ReactNode } from 'react';
import { gy } from '../theme/tokens';
import { Logo, LogoMark } from './Logo';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? '/';

// 左栏标语距顶栏 140px（Paper 10 页 A01、A02 同一位置）
const SLOGAN_TOP = 140;

// 账户页框架：登录、接受邀请共用（Paper 10 页 A01 / A02）。
// cardTop 是右侧卡片距顶栏的距离：登录 108，接受邀请表单较高用 60
export function AccountShell({ children, cardTop = 108 }: { children: ReactNode; cardTop?: number }) {
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

      <main
        style={{
          maxWidth: 1056,
          margin: '0 auto',
          padding: `${cardTop}px 0 64px`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 48,
        }}
      >
        <section style={{ paddingTop: SLOGAN_TOP - cardTop, width: 368 }}>
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

        {children}
      </main>
    </div>
  );
}

// 右侧白色卡片
export const accountCard = {
  width: 456,
  boxSizing: 'border-box',
  background: gy.surface,
  border: `1px solid ${gy.split}`,
  borderRadius: 12,
  padding: '35px 36px 35px',
} as const;
