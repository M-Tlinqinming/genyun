// 飞宇样例（虚构联系人电话），迁自旧仓库 fixtures/feiyu.ts 并改为新字段。
// 用作测试样本：一家已备齐「开始编制必需」资料的企业。
import type { ChecklistState } from '../checklist/status.ts';
import type { BasicInfo } from '../profile/basic.ts';
import type { Location } from '../profile/location.ts';
import type { Organization } from '../profile/organization.ts';
import type { Production } from '../profile/production.ts';

export const feiyuBasicInfo: BasicInfo = {
  companyName: '惠阳飞宇电器有限公司',
  socialCreditCode: '91441300726483224B',
  legalRepresentative: '李文聪',
  companyType: '有限公司(外国法人独资)',
  registrationAuthority: '惠州市仲恺高新区技术产业开发区国家税务局',
  registeredCapital: '99 万美元',
  registeredAddress: {
    province: '广东省',
    city: '惠州市',
    district: '惠城区',
    detail: '惠州市仲恺高新区陈江街道正大路 17 号',
  },
  businessScope: '灯头、电线、电器开关、灯具、电子电器配件的设计、制造、加工与销售',
  contactPerson: '李文聪',
  contactPhone: '0752-3324567',
  employeeCount: 86,
  mainProducts: '灯头(陶瓷灯头 E27 / E14 / B22 系列)、电线、电器开关、灯具、电子电器配件',
  responsiblePerson: '李文聪',
  technicalManagementCount: 8,
  safetyManagementCount: 2,
  postalCode: '516029',
  fax: '0752-3324568',
  website: '无',
  email: '',
  economicNature: '私有制',
  fixedAssets: '289 万人民币',
  lastYearRevenue: '1319 万人民币',
};

export const feiyuLocation: Location = {
  siteAddress: feiyuBasicInfo.registeredAddress!,
  neighbours: { answer: 'listed', items: [{ name: '相邻五金加工厂' }, { name: '同园区电子组装厂' }] },
};

const person = (id: string, name: string, position: string, phone: string) => ({ id, name, position, phone });

export const feiyuOrganization: Organization = {
  commander: person('p1', '李文聪', '总经理', '13800000001'),
  deputies: [person('p2', '陈志刚', '副总经理', '13800000002'), person('p3', '王秀英', '安全总监', '13800000003')],
  hasEmergencyOffice: false,
  groups: [
    {
      kind: 'rescue',
      name: '抢险救灾组',
      leader: person('p10', '刘海涛', '', '13800000010'),
      members: [person('p11', '周建国', '', '13800000011'), person('p12', '黄志强', '', '13800000012')],
    },
    {
      kind: 'logistics',
      name: '综合保障组',
      leader: person('p20', '张丽华', '', '13800000020'),
      members: [person('p21', '吴敏', '', '13800000021')],
    },
    {
      kind: 'communication',
      name: '通讯联络组',
      leader: person('p30', '赵小龙', '', '13800000030'),
      members: [person('p31', '孙佩华', '', '13800000031')],
    },
  ],
};

const machine = (name: string, quantity: number, department: string, spec?: string) => ({
  name,
  spec,
  quantity,
  unit: '台',
  department,
  location: '1 号厂房',
  condition: '正常' as const,
});

const material = (name: string, casNumber: string, annualUsageTons: number, maxStorageTons: number, storageLocation: string) => ({
  name,
  casNumber,
  annualUsageTons,
  maxStorageTons,
  storageLocation,
  labelPhotoFileIds: [],
  msdsFileIds: [],
});

export const feiyuProduction: Production = {
  buildings: [{ name: '1 号生产厂房', floors: 1, floorAreaM2: 2400, remarks: '单层标准厂房，含压铸 / 加工 / 装配区' }],
  equipment: [
    machine('熔炉', 4, '压铸车间'),
    machine('锌压铸机', 2, '压铸车间'),
    machine('铝压铸机', 1, '压铸车间', '200T'),
    machine('铝压铸机', 1, '压铸车间', '350T'),
    machine('钻孔攻牙机', 19, '加工车间'),
    machine('喷砂机', 2, '加工车间'),
    machine('CNC', 1, '加工车间'),
    { ...machine('空压机', 1, '公用工程'), location: '空压机房' },
  ],
  // 只有空压机储气罐：回答「有」，参数可免填
  specialEquipment: {
    pressureVessels: { answer: 'yes', items: [], nameplateFileIds: [] },
    boilers: { answer: 'no' },
    pressurePipelines: { answer: 'no' },
    storageTanks: { answer: 'no' },
  },
  materials: [
    material('锌锭', '7440-66-6', 8, 0.3, '原料仓库'),
    material('铝锭', '7429-90-5', 55, 1, '原料仓库'),
    material('陶瓷灯头', '/', 120, 1, '成品仓库'),
    material('电线', '/', 5, 0.2, '辅料仓库'),
    material('酒精', '64-17-5', 0.2, 0.05, '化学品柜'),
  ],
  processFlow: {
    source: 'text',
    description: '熔融、压铸、攻牙、冲压、喷砂、抛光、CNC 加工、组装、品质检测、包装出货',
    sketchFileIds: [],
    steps: ['熔融', '压铸', '攻牙', '冲压', '喷砂', '抛光', 'CNC加工', '组装', '品质检测', '包装出货'].map(
      (name) => ({ name, equipment: [], inputs: [], next: 'next' as const }),
    ),
  },
  emergencySupplies: [
    { name: '干粉灭火器', quantity: 30, unit: '具', location: '厂房各区', custodianId: 'p20' },
    { name: '二氧化碳灭火器', quantity: 4, unit: '具', location: '配电房', custodianId: 'p20' },
    { name: '室内消火栓', quantity: 6, unit: '处', location: '1 号厂房' },
  ],
  firstAidKit: { answer: 'yes', items: [{ name: '急救箱(综合配置)', quantity: 2, unit: '箱' }] },
  firePool: { answer: 'yes', count: 1, volumeM3: 200 },
};

const by = { confirmedBy: 'u-feiyu-admin', confirmedAt: '2026-10-27T09:00:00.000Z' };
const filled = { status: 'provided' as const, fileIds: [], callRequested: false, ...by };
const uploaded = (fileId: string) => ({ status: 'provided' as const, fileIds: [fileId], callRequested: false });

// 开始编制必需的资料都已处理；MSDS、消防设施布置图稍后补
export const feiyuChecklist: ChecklistState = {
  business_license: uploaded('f-license'),
  basic_info: filled,
  buildings: filled,
  process_flow: filled,
  equipment: filled,
  special_equipment: filled,
  materials: filled,
  msds: { status: 'later', fileIds: [], callRequested: false },
  emergency_groups: filled,
  duty_phone: filled,
  external_resources: filled,
  emergency_supplies: filled,
  first_aid_kit: filled,
  fire_pool: filled,
  site_plan: uploaded('f-site-plan'),
  evacuation_plan: uploaded('f-evacuation'),
  fire_facility_plan: { status: 'later', fileIds: [], callRequested: false },
};
