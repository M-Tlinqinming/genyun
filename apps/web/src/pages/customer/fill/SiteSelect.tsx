import type { SiteAddressOption, YesNoUnknown } from '@genyun/shared';
import { Select } from 'antd';
import type { CSSProperties } from 'react';

// 「有 / 没有 / 不清楚」三选一（新增的选填问项都可以答不清楚）
export const YES_NO_UNKNOWN_OPTIONS: { value: YesNoUnknown; label: string }[] = [
  { value: 'yes', label: '有' },
  { value: 'no', label: '没有' },
  { value: 'unknown', label: '不清楚' },
];

/**
 * 一照多址：选所在厂址（选填）。只有一处地址时 addresses 为空，不显示
 */
export function SiteSelect({
  addresses,
  value,
  onChange,
  label,
  style,
}: {
  addresses: readonly SiteAddressOption[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  label: string;
  style?: CSSProperties;
}) {
  if (addresses.length === 0) return null;
  return (
    <Select
      aria-label={label}
      allowClear
      placeholder="所在厂址"
      value={addresses.some((a) => a.id === value) ? value : undefined}
      onChange={(v?: string) => onChange(v || undefined)}
      options={addresses.map((a) => ({ value: a.id, label: a.label, title: a.address }))}
      popupMatchSelectWidth={false}
      style={style}
    />
  );
}
