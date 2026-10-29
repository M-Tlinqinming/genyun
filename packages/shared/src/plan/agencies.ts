// 属地机构（应急管理局、街道、消防）：TECH-PLAN 3.5 定为耕云知识库按地址带出，运营维护。
// 知识库页面在 M3；第一版只内置已核实过的属地（迁自旧仓库 e2-contacts.ts 与飞宇样例），
// 查不到的留空，文档里写通用说法或「（待补充）」，不编造电话。
import type { Address } from '../profile/basic.ts';

export interface LocalAgencies {
  emergencyBureau?: { name: string; phone?: string };
  streetOffice?: { name: string; phone?: string };
  fireDept?: { name: string; phone?: string };
  /** 上级预案名称，预案体系与衔接图用 */
  districtPlan?: string;
  streetPlan?: string;
}

interface KnownArea {
  /** 地址里同时出现这些词才算命中，越具体的放越前 */
  match: string[];
  agencies: LocalAgencies;
}

const KNOWN_AREAS: KnownArea[] = [
  {
    match: ['仲恺', '陈江'],
    agencies: {
      emergencyBureau: { name: '惠州市仲恺高新区应急管理局', phone: '0752-3271388' },
      streetOffice: { name: '陈江街道应急办', phone: '0752-3896139' },
      fireDept: { name: '仲恺高新区消防救援大队', phone: '119' },
      districtPlan: '惠州市仲恺高新区生产安全事故应急预案',
      streetPlan: '陈江街道生产安全事故应急预案',
    },
  },
  {
    match: ['仲恺'],
    agencies: {
      emergencyBureau: { name: '惠州市仲恺高新区应急管理局', phone: '0752-3271388' },
      fireDept: { name: '仲恺高新区消防救援大队', phone: '119' },
      districtPlan: '惠州市仲恺高新区生产安全事故应急预案',
    },
  },
];

export function localAgenciesOf(address: Address | undefined): LocalAgencies {
  if (!address) return {};
  const text = [address.province, address.city, address.district, address.detail].join(' ');
  return KNOWN_AREAS.find((a) => a.match.every((w) => text.includes(w)))?.agencies ?? {};
}
