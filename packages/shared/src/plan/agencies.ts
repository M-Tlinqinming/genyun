// 属地机构（应急管理局、街道、消防）：TECH-PLAN 3.5 定为耕云知识库按地址带出，运营维护。
// 知识库页面在 M3；第一版内置业主知识库四张表（基层应急管理机构、各区应急机构 24 小时电话、
// 消防大队联系方式）里的惠州数据，上级预案名称按 Martin 的批注（2026-10 预案批注 [42][43]）。
// 查不到的留空，文档里写通用说法或「（待补充）」，不编造电话。
import type { Address } from '../profile/basic.ts';

export interface LocalAgencies {
  emergencyBureau?: { name: string; phone?: string };
  streetOffice?: { name: string; phone?: string };
  /** 辖区消防救援大队，电话是 24 小时值班电话；报警一律写 119 */
  fireDept?: { name: string; phone?: string };
  /** 上级预案名称（不带书名号），预案体系与衔接用 */
  districtPlan?: string;
  streetPlan?: string;
}

interface District {
  name: string;
  /** 地址里出现任一个词就算这个区县 */
  aliases: string[];
  bureau: string;
  bureauPhone: string;
  fire: string;
  firePhone: string;
  plan?: string;
  /** 镇街名称（含「街道 / 镇 / 乡」或园区全称）与应急管理办公室电话；电话不详的不写 */
  towns: [name: string, phone?: string][];
}

const DISTRICTS: District[] = [
  {
    name: '仲恺高新区',
    aliases: ['仲恺'],
    bureau: '惠州市仲恺高新区应急管理局',
    bureauPhone: '0752-3271385',
    fire: '仲恺高新区消防救援大队',
    firePhone: '0752-3165029',
    plan: '仲恺高新区生产工贸行业事故应急预案',
    towns: [
      ['陈江街道', '0752-3896139'],
      ['惠环街道', '0752-2618181'],
      ['沥林镇', '0752-3868110'],
      ['潼侨镇', '0752-3791373'],
      ['潼湖镇', '0752-3886020'],
      ['东江科技园', '0752-2380110'],
      ['惠南科技园', '0752-2598808'],
    ],
  },
  {
    name: '惠城区',
    aliases: ['惠城'],
    bureau: '惠州市惠城区应急管理局',
    bureauPhone: '0752-7809633',
    fire: '惠城区消防救援大队',
    firePhone: '0752-2223119',
    plan: '惠城区生产安全事故应急预案',
    towns: [
      ['桥东街道', '0752-2257110'],
      ['桥西街道', '0752-2382278'],
      ['龙丰街道', '0752-2289011'],
      ['江南街道', '0752-2248502'],
      ['江北街道', '0752-2802552'],
      ['河南岸街道', '0752-2526976'],
      ['小金口街道', '0752-2290820'],
      ['水口街道', '0752-2312399'],
      ['马安镇', '0752-3617568'],
      ['三栋镇', '0752-2599669'],
      ['汝湖镇', '0752-2796789'],
      ['横沥镇', '0752-3183921'],
      ['芦洲镇', '0752-3287751'],
    ],
  },
  {
    name: '惠阳区',
    aliases: ['惠阳'],
    bureau: '惠州市惠阳区应急管理局',
    bureauPhone: '0752-3362119',
    fire: '惠阳区消防救援大队',
    firePhone: '0752-3814218',
    plan: '惠阳区生产安全事故应急预案',
    towns: [
      ['淡水街道', '0752-3360690'],
      ['秋长街道', '0752-3557885'],
      ['三和街道', '0752-3502038'],
      ['沙田镇', '0752-3754119'],
      ['新圩镇', '0752-3330001'],
      ['镇隆镇', '0752-3699129'],
      ['永湖镇', '0752-3714127'],
      ['良井镇', '0752-3651926'],
      ['平潭镇', '0752-3303333'],
    ],
  },
  {
    name: '惠东县',
    aliases: ['惠东'],
    bureau: '惠东县应急管理局',
    bureauPhone: '0752-8811235',
    fire: '惠东县消防救援大队',
    firePhone: '0752-8890119',
    plan: '惠东县生产安全事故应急预案',
    // 知识库里惠东各镇街应急办电话为「/」
    towns: [
      ['平山街道'],
      ['大岭街道'],
      ['白花镇'],
      ['多祝镇'],
      ['稔山镇'],
      ['梁化镇'],
      ['平海镇'],
      ['铁涌镇'],
      ['吉隆镇'],
      ['黄埠镇'],
      ['白盆珠镇'],
      ['高潭镇'],
      ['安墩镇'],
      ['宝口镇'],
    ],
  },
  {
    name: '博罗县',
    aliases: ['博罗'],
    bureau: '博罗县应急管理局',
    bureauPhone: '0752-6635600',
    fire: '博罗县消防救援大队',
    firePhone: '0752-6283119',
    plan: '博罗县生产安全事故应急预案',
    towns: [
      ['罗阳街道', '0752-6633655'],
      ['龙溪街道', '0752-6678007'],
      ['园洲镇', '0752-6689909'],
      ['湖镇镇', '0752-6657567'],
      ['石湾镇', '0752-6610026'],
      ['杨村镇', '0752-6691200'],
      ['公庄镇', '0752-6115201'],
      ['长宁镇', '0752-6660516'],
      ['横河镇', '0752-6380203'],
      ['龙华镇', '0752-6862928'],
      ['柏塘镇', '0752-6330125'],
      ['泰美镇', '0752-6605336'],
      ['杨侨镇', '0752-6690212'],
      ['麻陂镇', '0752-6130088'],
      ['观音阁镇', '0752-6233255'],
      ['石坝镇', '0752-6160019'],
      ['福田镇', '0752-6886119'],
    ],
  },
  {
    name: '龙门县',
    aliases: ['龙门'],
    bureau: '龙门县应急管理局',
    bureauPhone: '0752-7889202',
    fire: '龙门县消防救援大队',
    firePhone: '0752-7872968',
    plan: '龙门县生产安全事故应急预案',
    towns: [
      ['龙城街道', '0752-7882780'],
      ['平陵街道', '0752-7303201'],
      ['龙田镇', '0752-7789080'],
      ['麻榨镇', '0752-7560044'],
      ['永汉镇', '0752-7600728'],
      ['龙潭镇', '0752-7721128'],
      ['地派镇', '0752-7230081'],
      ['龙华镇', '0752-7361000'],
      ['龙江镇', '0752-7330010'],
      ['蓝田瑶族乡', '0752-7235619'],
    ],
  },
  {
    // 知识库没有大亚湾的镇街应急办；上级预案名称批注里也没给
    name: '大亚湾区',
    aliases: ['大亚湾'],
    bureau: '惠州大亚湾经济技术开发区应急管理局',
    bureauPhone: '0752-5562928',
    fire: '大亚湾区消防救援大队',
    firePhone: '0752-5108905',
    towns: [],
  },
];

/** 去掉「街道 / 镇 / 乡」后的简称，地址里常这么写（如「陈江」）；园区不缩 */
const short = (town: string) => town.replace(/(街道|镇|乡)$/, '');

export function localAgenciesOf(address: Address | undefined): LocalAgencies {
  if (!address) return {};
  const text = [address.province, address.city, address.district, address.detail].join(' ');
  // 镇街重名（博罗、龙门都有龙华镇），先认区县；地址里没写区县时只认全名唯一的镇街
  const district = DISTRICTS.find((d) => d.aliases.some((w) => text.includes(w)));
  const candidates = district ? [district] : DISTRICTS;
  const hits = candidates.flatMap((d) => d.towns.filter(([t]) => text.includes(t)).map((t) => ({ d, t })));
  const shortHits = district ? district.towns.filter(([t]) => short(t) !== t && text.includes(short(t))).map((t) => ({ d: district, t })) : [];
  const found = hits.length === 1 ? hits[0] : hits.length === 0 && shortHits.length === 1 ? shortHits[0] : undefined;
  const d = district ?? found?.d;
  if (!d) return {};
  const town = found && found.d === d ? found.t : undefined;
  return {
    emergencyBureau: { name: d.bureau, phone: d.bureauPhone },
    fireDept: { name: d.fire, phone: d.firePhone },
    ...(d.plan ? { districtPlan: d.plan } : {}),
    ...(town
      ? {
          streetOffice: { name: `${town[0]}应急管理办公室`, ...(town[1] ? { phone: town[1] } : {}) },
          ...(short(town[0]) !== town[0] ? { streetPlan: `${town[0]}生产安全事故应急预案` } : {}),
        }
      : {}),
  };
}
