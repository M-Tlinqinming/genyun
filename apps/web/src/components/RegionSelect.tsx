import { type AreaList, type RegionParts } from '@genyun/shared';
import { Select } from 'antd';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { gy, type } from '../theme/tokens';

// 全国区划数据第一次用到时才加载，不进首屏包；加载过一次后各处共用
let areaPromise: Promise<AreaList> | null = null;
function loadArea(): Promise<AreaList> {
  areaPromise ??= import('@vant/area-data').then((m) => m.areaList as AreaList);
  return areaPromise;
}

export function useAreaList(): AreaList | null {
  const [area, setArea] = useState<AreaList | null>(null);
  useEffect(() => {
    let alive = true;
    void loadArea().then((a) => alive && setArea(a));
    return () => {
      alive = false;
    };
  }, []);
  return area;
}

type Option = { value: string; label: string; title: string };

const children = (list: Record<string, string>, prefix: string, len: number): Option[] =>
  Object.entries(list)
    .filter(([code]) => code.startsWith(prefix.slice(0, len)))
    .map(([, name]) => ({ value: name, label: name, title: name }));

const search = (input: string, option?: Option) => (option?.label ?? '').includes(input.trim());

/**
 * 省市区选择（16 页登记客户组织弹窗；K11 企业地址也用）：三个可搜索的下拉一行排开。
 * 换省清空市和区县，换市清空区县。值按名称存（RegionParts），区县没有可选项（如东莞的镇街以外）时留空。
 * legacyText：老数据只有文字、没有三级时，三个框空着，下面提示原来填的文字，请重新选
 */
export function RegionSelect({
  value,
  onChange,
  legacyText,
  id,
  status,
  disabled,
}: {
  value?: Partial<RegionParts> | null;
  onChange?: (v: Partial<RegionParts> | null) => void;
  legacyText?: string | null;
  id?: string;
  status?: 'error' | 'warning';
  disabled?: boolean;
}) {
  const area = useAreaList();
  const province = value?.province ?? undefined;
  const city = value?.city ?? undefined;
  const district = value?.district ?? undefined;

  const codes = useMemo(() => {
    if (!area) return { province: null, city: null };
    const p = province ? Object.entries(area.province_list).find(([, n]) => n === province)?.[0] ?? null : null;
    const c =
      p && city ? Object.entries(area.city_list).find(([code, n]) => n === city && code.startsWith(p.slice(0, 2)))?.[0] ?? null : null;
    return { province: p, city: c };
  }, [area, province, city]);

  const provinces = useMemo<Option[]>(
    () => (area ? Object.values(area.province_list).map((n) => ({ value: n, label: n, title: n })) : []),
    [area],
  );
  const cities = useMemo<Option[]>(() => (area && codes.province ? children(area.city_list, codes.province, 2) : []), [area, codes.province]);
  const districts = useMemo<Option[]>(() => (area && codes.city ? children(area.county_list, codes.city, 4) : []), [area, codes.city]);

  const emit = (v: Partial<RegionParts>) => onChange?.(v.province ? v : null);
  const box: CSSProperties = { flex: 1, minWidth: 0 };
  const common = {
    showSearch: { filterOption: search },
    allowClear: true,
    popupMatchSelectWidth: false,
    loading: !area,
    disabled,
    status,
    style: box,
  } as const;
  const showLegacy = !!legacyText && !province;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Select<string, Option>
          {...common}
          id={id}
          aria-label="省"
          placeholder="省"
          value={province}
          options={provinces}
          onChange={(p) => emit({ province: p, city: undefined, district: null })}
          labelRender={(o) => <span title={String(o.label ?? '')}>{o.label}</span>}
        />
        <Select<string, Option>
          {...common}
          aria-label="市"
          placeholder="市"
          value={city}
          options={cities}
          disabled={disabled || !province}
          onChange={(c) => emit({ province, city: c, district: null })}
          labelRender={(o) => <span title={String(o.label ?? '')}>{o.label}</span>}
        />
        <Select<string, Option>
          {...common}
          aria-label="区县"
          placeholder="区县"
          value={district}
          options={districts}
          disabled={disabled || !city || (area !== null && districts.length === 0)}
          onChange={(d) => emit({ province, city, district: d ?? null })}
          labelRender={(o) => <span title={String(o.label ?? '')}>{o.label}</span>}
        />
      </div>
      {showLegacy && (
        <div style={{ ...type.caption, color: gy.warning, marginTop: 8 }}>
          原来填的是「{legacyText}」，请按省、市、区县重新选一次。
        </div>
      )}
    </div>
  );
}
