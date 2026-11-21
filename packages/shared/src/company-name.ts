// 企业简称与预案编号建议：去掉括号里的部分、开头的省市区县名、末尾的组织形式，剩下的就是字号。
// 预案编号（第 5 步）取字号前两个汉字的拼音首字母 + 编制年份（拼音在接口里换，见 apps/api plan-code.ts）；
// 缺项清单抬头的企业简称也用这里的去后缀。

import { BUILTIN_AGENCY_DISTRICTS } from './plan/agencies.ts';

// 知识库内置的区县名（带后缀和不带后缀）：企业名称里的地名不一定在地址里（如「惠阳某某」开在仲恺），也要去掉
const BUILTIN_PLACES = BUILTIN_AGENCY_DISTRICTS.flatMap((d) => [d.name, d.name.replace(/(高新区|区|县)$/, '')]).filter((p) => p.length >= 2);

// 公司组织形式后缀，长的在前
const ORG_SUFFIXES = ['股份有限公司', '有限责任公司', '有限公司', '股份公司', '集团公司', '集团', '责任公司', '公司', '厂', '店', '经营部', '商行'];
const PLACE_SUFFIX = /(省|自治区|特别行政区|市|自治州|地区|盟|区|县|旗)$/;
// 地址开头一层行政区：2–7 个汉字，以省、市、区、县这类字结尾；街道、镇、村不算
const PLACE_LAYER = /^([一-龥]{1,6}?(?:省|自治区|特别行政区|市|自治州|地区|盟|区|县|旗))/;

/** 去掉末尾的组织形式：「示例电子有限公司」→「示例电子」，「示例集团有限公司」→「示例」；去完是空的保留原名 */
export function stripOrgSuffix(name: string): string {
  let n = name.trim();
  // 「集团有限公司」这类叠在一起的，一层层去
  for (let round = 0; round < 3; round++) {
    const s = ORG_SUFFIXES.find((x) => n.endsWith(x) && n.length > x.length);
    if (!s) break;
    n = n.slice(0, -s.length);
  }
  return n;
}

/** 去掉括号和括号里的字：「飞宇（惠州）电器」→「飞宇电器」 */
export function stripBrackets(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, '').trim();
}

/** 地址开头的几层行政区名，带后缀和不带后缀两种写法：「广东省惠州市惠阳区秋长街道」→ 广东省、广东、惠州市、惠州、惠阳区、惠阳 */
export function placeNamesOf(address: string | null | undefined): string[] {
  let rest = (address ?? '').replace(/\s/g, '');
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const m = rest.match(PLACE_LAYER);
    if (!m) break;
    const layer = m[1]!;
    if (/街道|镇|乡|村|路|号/.test(layer)) break;
    out.push(layer);
    const bare = layer.replace(PLACE_SUFFIX, '');
    if (bare.length >= 2) out.push(bare);
    rest = rest.slice(layer.length);
  }
  return out;
}

/** 去掉名称开头的省市区县名（地址里的几层 + 知识库内置的区县；可连着几层，带不带「省、市、区、县」都去）：「惠州市惠阳飞宇电器」→「飞宇电器」 */
export function stripPlaces(name: string, addresses: readonly (string | null | undefined)[]): string {
  const places = [...new Set([...addresses.flatMap(placeNamesOf), ...BUILTIN_PLACES])].sort((a, b) => b.length - a.length);
  let n = name.trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of places) {
      if (n.startsWith(p) && n.length > p.length) {
        n = n.slice(p.length);
        changed = true;
        break;
      }
    }
  }
  return n;
}

/** 企业简称（缺项清单抬头等）：去括号、去开头地名、去组织形式 */
export function companyShortName(name: string, addresses: readonly (string | null | undefined)[] = []): string {
  const short = stripOrgSuffix(stripPlaces(stripBrackets(name), addresses));
  return short || name.trim();
}

/** 字号的前两个汉字（预案编号用）；不足两个汉字返回空串 */
export function planCodeSeed(name: string | null | undefined, addresses: readonly (string | null | undefined)[] = []): string {
  if (!name?.trim()) return '';
  const han = stripOrgSuffix(stripPlaces(stripBrackets(name), addresses)).replace(/[^一-龥]/g, '');
  return han.length >= 2 ? han.slice(0, 2) : '';
}

/** 按中国时间算的年份 */
export function chinaYear(now: Date = new Date()): number {
  return new Date(now.getTime() + 8 * 3600_000).getUTCFullYear();
}
