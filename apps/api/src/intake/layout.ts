// 资料模板每个版本的「位置说明」：哪张表、哪个字段、哪一列、表头文字是什么。
// 读表和必填检查都按这里走。换模板时加一份新的版本说明，不改读表代码。
// 客户可能插行：字段按 A 列字段名找行，表格按表头文字找表头行；找不到再用这里写的默认行。

export const DATA_SHEETS = ['企业信息', '建筑与场所', '生产与设备', '原辅料与危化品', '应急组织', '应急资源'] as const;
export type DataSheet = (typeof DATA_SHEETS)[number];
export const GUIDE_SHEET = '填写说明';

/** 一个字段：A 列字段名、默认行；值在 B 列 */
export interface FieldSpec {
  sheet: DataSheet;
  label: string;
  row: number;
  /** 模板自带的字（如旧版工艺格里的「例：…」），是这些的算没填 */
  preset?: (text: string) => boolean;
}

/** 一张表格：按表头 A 列（和 B 列）文字找表头行，数据从下一行读到下一个分节标题或最后一行 */
export interface TableSpec<K extends string = string> {
  sheet: DataSheet;
  headerA: string;
  headerB?: string;
  /** 同一张工作表里有几张表头一样的表时，取第几张（从 1 数） */
  occurrence?: number;
  headerRow: number;
  /** 每个字段在哪一列；这一版没有的列不写 */
  cols: Partial<Record<K, string>>;
  /** 只填了这些列（下拉、模板预置的名称）的行算空行 */
  ignore?: K[];
  /** 这些列里是模板预置的字时，不算客户填的，但字留着（如物资名称） */
  presetText?: Partial<Record<K, readonly string[]>>;
  /** 这些列里是占位字时当空格读（如旧版小组表的「组长」） */
  placeholder?: Partial<Record<K, readonly string[]>>;
}

export type BasicField =
  | 'name'
  | 'creditCode'
  | 'legalRep'
  | 'companyType'
  | 'industry'
  | 'authority'
  | 'capital'
  | 'scope'
  | 'regAddress'
  | 'siteAddress'
  | 'otherAddresses'
  | 'inPark'
  | 'parkManager'
  | 'parkPhone'
  | 'landArea'
  | 'totalArea'
  | 'leases'
  | 'tenants'
  | 'mainProducts'
  | 'employees'
  | 'techCount'
  | 'safetyCount'
  | 'responsible'
  | 'contact'
  | 'contactPhone'
  | 'email';

export type OtherField =
  | 'process'
  | 'dutyPhone'
  | 'commanderName'
  | 'commanderPhone'
  | 'deputyName'
  | 'deputyPhone'
  | 'pool'
  | 'poolVolume'
  | 'poolLocation'
  | 'vehicles'
  | 'vehicleCount'
  | 'vehicleLocation'
  | 'vehicleContact'
  | 'vehiclePhone';

export type FieldKey = BasicField | OtherField;

export type BuildingCol = 'name' | 'floors' | 'area' | 'structure' | 'fireRating' | 'use';
export type SiteCol = 'name' | 'has' | 'note';
export type EquipmentCol = 'name' | 'spec' | 'qty' | 'unit' | 'location' | 'condition' | 'note';
export type SpecialCol = 'category' | 'has' | 'ident' | 'medium' | 'qty' | 'unit' | 'params' | 'location' | 'note';
export type MaterialCol = 'kind' | 'name' | 'cas' | 'annual' | 'max' | 'unit' | 'location' | 'cylinder';
export type OrgCol = 'group' | 'role' | 'name' | 'position' | 'phone';
export type ContactCol = 'type' | 'name' | 'phone' | 'note';
export type SupplyCol = 'name' | 'qty' | 'location' | 'keeper' | 'keeperPhone' | 'status';
export type FirstAidCol = 'name' | 'qty' | 'unit';

export interface TemplateLayout {
  /** 填写说明 B2 写的版本号；旧版没有这一格，记 'old' */
  version: string;
  old: boolean;
  fields: Partial<Record<FieldKey, FieldSpec>>;
  buildings: TableSpec<BuildingCol>;
  sites: TableSpec<SiteCol>;
  equipment: TableSpec<EquipmentCol>;
  special: TableSpec<SpecialCol>;
  materials: TableSpec<MaterialCol>;
  /** 应急小组表；旧版有两张（100 人以下、100 人以上），同一个组两张都填了以第二张为准 */
  orgTables: TableSpec<OrgCol>[];
  contacts: TableSpec<ContactCol>;
  supplies: TableSpec<SupplyCol>;
  firstAid?: TableSpec<FirstAidCol>;
  /** 旧版原辅料没有单位列，年用量、最大存放量一律按这个单位读，也不查单位 */
  fixedMaterialUnit?: string;
}

const isExample = (t: string) => /^例[:：]/.test(t);

const basic = (rows: Partial<Record<BasicField, [label: string, row: number]>>) =>
  Object.fromEntries(
    Object.entries(rows).map(([k, v]) => [k, { sheet: '企业信息', label: v![0], row: v![1] } satisfies FieldSpec]),
  ) as Partial<Record<BasicField, FieldSpec>>;

// 模板预置的物资名称（两版一样）
const PRESET_SUPPLIES = [
  '灭火器',
  '室内消防栓',
  '应急照明灯',
  '疏散指示标志',
  '急救药箱',
  '防毒面具 / 空气呼吸器',
  '安全绳',
  '应急沙袋',
] as const;

export const LAYOUT_2026_11: TemplateLayout = {
  version: '2026.11',
  old: false,
  fields: {
    ...basic({
      name: ['企业名称', 3],
      creditCode: ['统一社会信用代码', 4],
      legalRep: ['法定代表人', 5],
      companyType: ['企业类型', 6],
      industry: ['所属行业', 7],
      authority: ['登记机关', 8],
      capital: ['注册资本（万元）', 9],
      scope: ['经营范围', 10],
      regAddress: ['注册地址', 11],
      siteAddress: ['生产场所地址', 12],
      otherAddresses: ['其他生产地址', 13],
      inPark: ['是否位于园区', 14],
      parkManager: ['园区管理方名称', 15],
      parkPhone: ['园区值班电话', 16],
      landArea: ['厂区占地面积（㎡）', 17],
      totalArea: ['总建筑面积（㎡）', 18],
      leases: ['是否把厂房分租给其他企业（厂中厂）', 19],
      tenants: ['承租企业名称', 20],
      mainProducts: ['主要产品', 21],
      employees: ['员工人数', 22],
      techCount: ['技术管理人员（人）', 23],
      safetyCount: ['专职或兼职安全管理人员（人）', 24],
      responsible: ['安全生产主管负责人', 25],
      contact: ['联系人', 26],
      contactPhone: ['联系人手机', 27],
      email: ['电子邮箱', 28],
    }),
    process: { sheet: '生产与设备', label: '生产工艺（一句话）', row: 2, preset: isExample },
    dutyPhone: { sheet: '应急组织', label: '24 小时值班电话', row: 2 },
    pool: { sheet: '应急资源', label: '消防水池', row: 35 },
    poolVolume: { sheet: '应急资源', label: '消防水池容量（m³）', row: 36 },
    poolLocation: { sheet: '应急资源', label: '消防水池位置', row: 37 },
    vehicles: { sheet: '应急资源', label: '自有车辆', row: 38 },
    vehicleCount: { sheet: '应急资源', label: '车辆数量（辆）', row: 39 },
    vehicleLocation: { sheet: '应急资源', label: '车辆停放位置', row: 40 },
    vehicleContact: { sheet: '应急资源', label: '车辆联系人', row: 41 },
    vehiclePhone: { sheet: '应急资源', label: '车辆联系人电话', row: 42 },
  },
  buildings: {
    sheet: '建筑与场所',
    headerA: '建筑或构筑物名称',
    headerRow: 4,
    cols: { name: 'A', floors: 'B', area: 'C', structure: 'D', fireRating: 'E', use: 'F' },
  },
  sites: {
    sheet: '建筑与场所',
    headerA: '场所',
    headerB: '有无',
    headerRow: 20,
    cols: { name: 'A', has: 'B', note: 'C' },
    ignore: ['name'],
  },
  equipment: {
    sheet: '生产与设备',
    headerA: '设备名称',
    headerRow: 6,
    cols: { name: 'A', spec: 'B', qty: 'C', unit: 'D', location: 'E', condition: 'F', note: 'G' },
    ignore: ['unit', 'condition'],
  },
  special: {
    sheet: '生产与设备',
    headerA: '类别',
    headerB: '有无',
    headerRow: 29,
    cols: { category: 'A', has: 'B', medium: 'C', qty: 'D', unit: 'E', params: 'F', location: 'G' },
    ignore: ['category', 'unit'],
  },
  materials: {
    sheet: '原辅料与危化品',
    headerA: '类型',
    headerB: '名称',
    headerRow: 4,
    cols: { kind: 'A', name: 'B', cas: 'C', annual: 'D', max: 'E', unit: 'F', location: 'G', cylinder: 'H' },
    ignore: ['kind', 'unit'],
  },
  orgTables: [
    {
      sheet: '应急组织',
      headerA: '小组名称',
      headerRow: 6,
      cols: { group: 'A', role: 'B', name: 'C', position: 'D', phone: 'E' },
      ignore: ['group', 'role'],
    },
  ],
  contacts: {
    sheet: '应急组织',
    headerA: '类型',
    headerB: '名称',
    headerRow: 32,
    cols: { type: 'A', name: 'B', phone: 'C', note: 'D' },
    ignore: ['type'],
  },
  supplies: {
    sheet: '应急资源',
    headerA: '物资名称',
    headerRow: 3,
    cols: { name: 'A', qty: 'B', location: 'C', keeper: 'D', keeperPhone: 'E', status: 'F' },
    ignore: ['status'],
    presetText: { name: PRESET_SUPPLIES },
  },
  firstAid: {
    sheet: '应急资源',
    headerA: '药品名称',
    headerRow: 21,
    cols: { name: 'A', qty: 'B', unit: 'C' },
    ignore: ['unit'],
  },
};

// 旧版（11-14 之前发出去的）：填写说明没有 B2 版本格
export const LAYOUT_OLD: TemplateLayout = {
  version: 'old',
  old: true,
  fields: {
    ...basic({
      name: ['企业名称', 3],
      creditCode: ['统一社会信用代码', 4],
      legalRep: ['法定代表人', 5],
      companyType: ['企业类型', 6],
      industry: ['所属行业', 7],
      authority: ['登记机关', 8],
      capital: ['注册资本（万元）', 9],
      scope: ['经营范围', 10],
      regAddress: ['注册地址', 11],
      siteAddress: ['生产场所地址', 12],
      otherAddresses: ['其他生产地址', 13],
      inPark: ['是否位于园区', 14],
      parkManager: ['园区管理方名称', 15],
      parkPhone: ['园区值班电话', 16],
      landArea: ['厂区占地面积（m2）', 17],
      totalArea: ['总建筑面积（m2）', 18],
      leases: ['是否出租厂房', 19],
      mainProducts: ['主要产品', 20],
      employees: ['员工人数', 21],
      techCount: ['技术管理人员', 22],
      safetyCount: ['专职或兼职安全管理人员', 23],
      contact: ['联系人', 24],
      contactPhone: ['联系人电话', 25],
      email: ['电子邮箱', 26],
    }),
    process: {
      sheet: '生产与设备',
      label: '生产工艺流程（一句话描述，用"→"箭头符号隔开）',
      row: 2,
      preset: isExample,
    },
    commanderName: { sheet: '应急组织', label: '总指挥姓名', row: 2 },
    commanderPhone: { sheet: '应急组织', label: '总指挥手机', row: 3 },
    deputyName: { sheet: '应急组织', label: '副总指挥姓名', row: 4 },
    deputyPhone: { sheet: '应急组织', label: '副总指挥手机', row: 5 },
    dutyPhone: { sheet: '应急组织', label: '24 小时值班电话', row: 6 },
    pool: { sheet: '应急资源', label: '消防水池', row: 20 },
    poolVolume: { sheet: '应急资源', label: '消防水池容量（m³）', row: 21 },
    poolLocation: { sheet: '应急资源', label: '消防水池位置', row: 22 },
  },
  buildings: {
    sheet: '建筑与场所',
    headerA: '建筑或构筑物名称',
    headerRow: 3,
    cols: { name: 'A', floors: 'B', area: 'C', structure: 'D', fireRating: 'E', use: 'F' },
  },
  sites: {
    sheet: '建筑与场所',
    headerA: '场所',
    headerB: '有无',
    headerRow: 18,
    cols: { name: 'A', has: 'B', note: 'C' },
    ignore: ['name'],
    // 「其他场所」一行模板自带「有」和一句说明
    placeholder: { note: ['在左侧填写其他场所名称，最多 10 个，用分号；分隔'] },
  },
  equipment: {
    sheet: '生产与设备',
    headerA: '设备名称',
    headerRow: 5,
    cols: { name: 'A', spec: 'B', qty: 'C', location: 'D', condition: 'E', note: 'F' },
    ignore: ['condition'],
  },
  special: {
    sheet: '生产与设备',
    headerA: '类别',
    headerRow: 28,
    cols: { category: 'A', ident: 'B', params: 'C', qty: 'D', location: 'E', note: 'F' },
    ignore: ['category'],
  },
  materials: {
    sheet: '原辅料与危化品',
    headerA: '类型',
    headerB: '名称',
    headerRow: 4,
    cols: { kind: 'A', name: 'B', cas: 'C', annual: 'D', max: 'E', location: 'F', cylinder: 'G' },
    ignore: ['kind'],
  },
  orgTables: [
    {
      sheet: '应急组织',
      headerA: '小组名称',
      occurrence: 1,
      headerRow: 9,
      cols: { group: 'A', role: 'B', name: 'C', phone: 'D' },
      ignore: ['group', 'role'],
    },
    {
      sheet: '应急组织',
      headerA: '小组名称',
      occurrence: 2,
      headerRow: 20,
      cols: { group: 'A', role: 'B', name: 'C', phone: 'D' },
      ignore: ['group', 'role'],
      placeholder: { name: ['组长'], phone: ['组长'] },
    },
  ],
  contacts: {
    sheet: '应急组织',
    headerA: '类型',
    headerB: '名称',
    headerRow: 37,
    cols: { type: 'A', name: 'B', phone: 'C', note: 'D' },
    ignore: ['type'],
  },
  supplies: {
    sheet: '应急资源',
    headerA: '物资名称',
    headerRow: 3,
    cols: { name: 'A', qty: 'B', location: 'C', status: 'D' },
    ignore: ['status'],
    presetText: { name: PRESET_SUPPLIES },
  },
  fixedMaterialUnit: '吨',
};

export const LATEST_LAYOUT = LAYOUT_2026_11;
const BY_VERSION: Record<string, TemplateLayout> = { [LAYOUT_2026_11.version]: LAYOUT_2026_11 };

/** 按「填写说明」B2 选版本：没有这一格是旧版；不认识的版本号按最新版读 */
export function layoutFor(versionCell: string): TemplateLayout {
  const m = /^模板版本\s*(\S+)/.exec(versionCell.trim());
  if (!m) return LAYOUT_OLD;
  return BY_VERSION[m[1]!] ?? LATEST_LAYOUT;
}
