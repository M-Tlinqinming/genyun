import { SearchOutlined } from '@ant-design/icons';
import { chinaToday } from '@genyun/shared';
import { Input } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { gy } from '../../../theme/tokens';

// 知识库三个分页共用的样式（数值按 Paper 16 页「知识库 · 属地应急机构」「知识库 · 工艺模板」）

export const body: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };
export const muted: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.secondary };
export const small: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary };
export const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export function Tag({ tone, children, dense }: { tone: { color: string; bg: string }; children: ReactNode; dense?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: dense ? '0 6px' : '0 8px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: dense ? '18px' : '22px',
        color: tone.color,
        background: tone.bg,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <Input
      allowClear
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      prefix={<SearchOutlined style={{ color: '#8B929F' }} />}
    />
  );
}

// 左栏树 / 列表的一行
export function TreeRow({
  label,
  count,
  indent,
  selected,
  onClick,
}: {
  label: ReactNode;
  count?: ReactNode;
  indent: 12 | 28 | 44;
  selected?: boolean;
  onClick?: () => void;
}) {
  const color = selected ? gy.primary : gy.text;
  const style: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    padding: `6px 12px 6px ${indent}px`,
    borderRadius: 6,
    border: 'none',
    background: selected ? gy.selected : 'transparent',
    textAlign: 'left',
    font: 'inherit',
    cursor: onClick ? 'pointer' : 'default',
  };
  const content = (
    <>
      <span style={{ ...body, color, ...ellipsis }}>{label}</span>
      {count !== undefined && <span style={{ fontSize: 12, lineHeight: '22px', color: selected ? gy.primary : gy.secondary, flexShrink: 0 }}>{count}</span>}
    </>
  );
  return onClick ? (
    <button type="button" style={style} onClick={onClick} aria-current={selected ? 'true' : undefined}>
      {content}
    </button>
  ) : (
    <div style={style}>{content}</div>
  );
}

// 「10.18」（北京时间）
export function monthDay(iso: string): string {
  const d = chinaToday(new Date(iso));
  return `${d.slice(5, 7)}.${d.slice(8, 10)}`;
}

// 填好的一组词（地址里的叫法、设备、物料等）用 Select 的标签模式录入，回车或逗号分开
export const tagSelectProps = {
  mode: 'tags' as const,
  open: false,
  tokenSeparators: [',', '，', '、', ' '],
  suffixIcon: null,
};
