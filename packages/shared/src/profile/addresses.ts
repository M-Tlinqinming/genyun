// 一照多址：第 1 步「实际生产地址」之外的「其他生产经营地址」（Martin 10-31 定）。
// 有两处及以上地址时，应急小组、设备、物料、应急物资、危险源可以标所在厂址（选填，从地址里选）；
// 只有一处地址时不出现厂址，生成稿一切照旧。
import { z } from 'zod';

/** 实际生产地址（第 1 步）的厂址 id；其他地址用各自的 id */
export const MAIN_ADDRESS_ID = 'main';

export const otherAddressSchema = z.object({
  id: z.string().min(1).max(40),
  address: z.string().trim().max(200, '地址最多 200 个字').default(''),
});
export type OtherAddress = z.infer<typeof otherAddressSchema>;

export const MAX_OTHER_ADDRESSES = 9;

export interface SiteAddressOption {
  id: string;
  address: string;
  /** 表格「厂址」列和组名后面用的短写：去掉省、市、区县 */
  label: string;
}

/**
 * 「广东省惠州市示例区示例三路8号厂房5楼」→「示例三路8号厂房5楼」；地址里的括注去掉（「示例小区（厂房）示例路1号」→「示例小区示例路1号」）。
 * 取不出（去掉后为空）时用原地址
 */
export function shortAddress(address: string): string {
  const rest = address
    .trim()
    .replace(/^.{0,6}?省/, '')
    .replace(/^.{0,6}?市/, '')
    .replace(/^.{0,10}?[区县]/, '')
    // 短写要放进组名的括号里，去掉地址里自带的括注，免得套两层括号
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim();
  return rest || address.trim();
}

/** 可选的厂址：实际生产地址 + 填了的其他地址；不到两处返回空（不用标厂址） */
export function addressOptions(main: string | undefined, others: readonly OtherAddress[] | undefined): SiteAddressOption[] {
  const list = [
    { id: MAIN_ADDRESS_ID, address: main?.trim() ?? '' },
    ...(others ?? []).map((a) => ({ id: a.id, address: a.address.trim() })),
  ].filter((a) => a.address !== '');
  if (list.length < 2) return [];
  const shorts = list.map((a) => shortAddress(a.address));
  // 短写撞了（如两处只差区县）就用全称
  return list.map((a, i) => ({ ...a, label: shorts.indexOf(shorts[i]!) === i && shorts.lastIndexOf(shorts[i]!) === i ? shorts[i]! : a.address }));
}

/** 按厂址 id 取短写；只有一处地址或没标的返回空 */
export function addressLabelOf(options: readonly SiteAddressOption[], id: string | undefined): string {
  return (id && options.find((o) => o.id === id)?.label) || '';
}

/**
 * 应急小组在正文、体系图里的名称：多处厂址各设同名小组时，名称后面带厂址（「抢险救灾组（示例三路8号厂房5楼）」），
 * 其余照原名
 */
export function groupDisplayNames(groups: readonly { name: string; addressId?: string }[], options: readonly SiteAddressOption[]): string[] {
  return groups.map((g) => {
    const name = g.name.trim();
    const label = addressLabelOf(options, g.addressId);
    const duplicated = groups.filter((x) => x.name.trim() === name).length > 1;
    return duplicated && label ? `${name}（${label}）` : name;
  });
}
