import { REGION_PLACEHOLDER_CITIES, formatTaskDayTime } from '@genyun/shared';
import type { OperatorTask } from '../../api/operator';

// 北京时间的月、日、时、分
function beijing(iso: string) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { m: get('month'), d: get('day'), hh: get('hour').padStart(2, '0'), mm: get('minute') };
}

/** 「11 月 12 日 14:20」（北京时间，不写今天 / 昨天） */
export function monthDayTime(iso: string): string {
  const p = beijing(iso);
  return `${p.m} 月 ${p.d} 日 ${p.hh}:${p.mm}`;
}

/** 「今天 10:52」「11 月 12 日 14:20」 */
export const dayTime = (iso: string, now: Date = new Date()) => formatTaskDayTime(new Date(iso), now);

/** 地区简称：市 + 区县（直辖市、省直辖县写省 + 区县）；没有分级的用登记时的原文 */
export function regionShort(
  t: Pick<OperatorTask, 'orgRegion' | 'orgRegionProvince' | 'orgRegionCity' | 'orgRegionDistrict'>,
): string | null {
  const { orgRegionProvince: province, orgRegionCity: city, orgRegionDistrict: district } = t;
  if (!province || !city) return t.orgRegion;
  const hidden = city === province || (REGION_PLACEHOLDER_CITIES as readonly string[]).includes(city);
  return `${hidden ? province : city}${district ?? ''}`;
}
