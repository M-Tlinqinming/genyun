import { Typography } from 'antd';
import type { ReactNode } from 'react';
import { gy } from '../theme/tokens';

// 页面标题区：面包屑小字 / 28 号标题 / 一句说明 / 右侧主操作
export function PageHeader({
  eyebrow,
  title,
  description,
  extra,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 32 }}>
      <div>
        {eyebrow && <div style={{ fontSize: 12, lineHeight: '19px', color: gy.secondary, marginBottom: 4 }}>{eyebrow}</div>}
        <Typography.Title level={1} style={{ fontSize: 28, lineHeight: '40px', fontWeight: 500, margin: 0 }}>
          {title}
        </Typography.Title>
        {description && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            {description}
          </Typography.Text>
        )}
      </div>
      {extra}
    </div>
  );
}
