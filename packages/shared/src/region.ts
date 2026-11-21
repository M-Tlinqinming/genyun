// 所在地区：省 / 市 / 区县三级（16 页登记客户组织弹窗；K11 企业地址也用）。
// 全国区划数据来自 @vant/area-data（键是 6 位行政区划代码），这个文件不引数据包，由调用方把 areaList 传进来：
// 区县的上级市 = 代码前 4 位 + '00'，市的上级省 = 代码前 2 位 + '0000'。
import { z } from 'zod';

export interface RegionParts {
  province: string;
  city: string;
  /** 区县；东莞、中山这类不设区的市，这里是镇街。可以为空（老数据、演示数据） */
  district: string | null;
}

/** @vant/area-data 的 areaList 结构 */
export interface AreaList {
  province_list: Record<string, string>;
  city_list: Record<string, string>;
  county_list: Record<string, string>;
}

/** 区划里占位的「市」：直辖市下的「县」、省直辖县级行政区划。拼地区时不写 */
export const REGION_PLACEHOLDER_CITIES = ['县', '省直辖县', '自治区直辖县级行政区划'] as const;

// 市和省同名（直辖市）或是占位的，拼地区时不写市
function cityHidden(p: Pick<RegionParts, 'province' | 'city'>): boolean {
  return p.city === p.province || (REGION_PLACEHOLDER_CITIES as readonly string[]).includes(p.city);
}

/**
 * 拼地区文字。full = 省 + 市 + 区县；short = 省 + 市（市不写时改写区县）。
 * 例：江苏省苏州市吴中区 / 江苏省苏州市；上海市闵行区 / 上海市闵行区；湖北省仙桃市 / 湖北省仙桃市
 */
export function formatRegion(parts: RegionParts, mode: 'full' | 'short'): string {
  const hidden = cityHidden(parts);
  const district = parts.district ?? '';
  if (mode === 'full') return `${parts.province}${hidden ? '' : parts.city}${district}`;
  return hidden ? `${parts.province}${district}` : `${parts.province}${parts.city}`;
}

/** 列表「所在地区」筛选用的键：省 + 市；市和省同名或是占位的只写省 */
export function regionFilterKey(parts: Pick<RegionParts, 'province' | 'city'>): string {
  return cityHidden(parts) ? parts.province : `${parts.province}${parts.city}`;
}

/** 三列 → RegionParts；省、市都空的老数据为 null */
export function regionPartsOf(row: {
  regionProvince: string | null;
  regionCity: string | null;
  regionDistrict: string | null;
}): RegionParts | null {
  if (!row.regionProvince || !row.regionCity) return null;
  return { province: row.regionProvince, city: row.regionCity, district: row.regionDistrict || null };
}

export const regionPartsSchema = z.object(
  {
    province: z.string({ error: '请选择所在地区' }).trim().min(1, '请选择所在地区').max(30),
    city: z.string({ error: '请选到市' }).trim().min(1, '请选到市').max(30),
    district: z
      .string()
      .trim()
      .max(30)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  },
  { error: '请选择所在地区' },
);
export type RegionPartsInput = z.input<typeof regionPartsSchema>;

export const REGION_NOT_IN_AREA = '所在地区不在全国区划里，请重新选择';

function codeOf(list: Record<string, string>, name: string, prefix: string): string | null {
  for (const [code, n] of Object.entries(list)) if (n === name && code.startsWith(prefix)) return code;
  return null;
}

/** 区划代码 → 三级名称（选择组件回填用）；找不到为 null */
export function regionCodesOf(parts: RegionParts, areaList: AreaList): { province: string; city: string | null; district: string | null } | null {
  const province = codeOf(areaList.province_list, parts.province, '');
  if (!province) return null;
  const city = codeOf(areaList.city_list, parts.city, province.slice(0, 2));
  const district = city && parts.district ? codeOf(areaList.county_list, parts.district, city.slice(0, 4)) : null;
  return { province, city, district };
}

/**
 * 核对三级是否都在区划里、上下级对得上。返回报错文字，没问题为 null。
 * 这个市下面有区县、却没选时报「请选到区县」。
 */
export function checkRegionParts(parts: RegionParts, areaList: AreaList): string | null {
  const province = codeOf(areaList.province_list, parts.province, '');
  if (!province) return REGION_NOT_IN_AREA;
  const city = codeOf(areaList.city_list, parts.city, province.slice(0, 2));
  if (!city) return REGION_NOT_IN_AREA;
  const cityPrefix = city.slice(0, 4);
  if (parts.district) {
    return codeOf(areaList.county_list, parts.district, cityPrefix) ? null : REGION_NOT_IN_AREA;
  }
  const hasDistricts = Object.keys(areaList.county_list).some((code) => code.startsWith(cityPrefix));
  return hasDistricts ? '请选到区县' : null;
}
