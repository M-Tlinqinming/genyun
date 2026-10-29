// 资料清单：6 类 19 项。依据 Paper 03 页 FM02（采集规则）与 TECH-PLAN 3.5。
// 两种开始方式（企业自填 / 上传已有资料）写入同一份清单。

export const CATEGORIES = {
  basic: '企业基本资料',
  production: '生产工艺与设备',
  materials: '原辅料与安全资料',
  organization: '应急组织与联系人',
  resources: '应急资源与设施',
  drawings: '厂区实际图纸',
} as const;

export type Category = keyof typeof CATEGORIES;

// start = 开始编制必需；before_delivery = 交付前补齐；system = 耕云代办（客户不必提供）
export type Requirement = 'start' | 'before_delivery' | 'system';

export interface ChecklistItemDef {
  key: string;
  label: string;
  category: Category;
  requirement: Requirement;
  // 有些项「开始编制必需」只要求其中一部分，其余交付前补齐
  startPart?: string;
  // 「有则提供」的项先问有没有：允许客户回答「没有」
  allowNone: boolean;
  // 拿不准有没有时可「拍照给耕云看」，由注安师判断
  allowPhoto: boolean;
}

const item = (
  key: string,
  label: string,
  category: Category,
  requirement: Requirement,
  opts: { startPart?: string; conditional?: boolean; allowPhoto?: boolean } = {},
): ChecklistItemDef => ({
  key,
  label,
  category,
  requirement,
  startPart: opts.startPart,
  allowNone: opts.conditional ?? false,
  allowPhoto: opts.allowPhoto ?? false,
});

export const CHECKLIST_ITEMS = [
  item('business_license', '营业执照', 'basic', 'start'),
  item('basic_info', '企业基本情况', 'basic', 'start', {
    startPart: '联系人与电话、职工人数、主要产品',
  }),
  item('buildings', '建（构）筑物一览', 'basic', 'before_delivery'),

  item('process_flow', '生产工艺流程', 'production', 'start', { startPart: '一句话文字即可' }),
  item('equipment', '生产设备设施', 'production', 'start', { startPart: '主要设备名称与数量' }),
  item('special_equipment', '特种设备与储存设施', 'production', 'start', {
    startPart: '有 / 没有的回答',
    conditional: true,
    allowPhoto: true,
  }),

  item('materials', '原辅材料贮存量', 'materials', 'start', { startPart: '名称与最大储存量' }),
  item('msds', '化学品安全技术说明书（MSDS）', 'materials', 'before_delivery', {
    conditional: true,
  }),

  item('emergency_groups', '各应急小组成员', 'organization', 'start', {
    startPart: '总指挥及手机',
  }),
  item('org_chart', '应急救援组织体系图', 'organization', 'system'),
  item('duty_phone', '24 小时值班电话', 'organization', 'start'),
  item('compilation_team', '应急预案编制小组', 'organization', 'system'),
  item('external_resources', '外部应急队伍与资源', 'organization', 'before_delivery'),

  item('emergency_supplies', '应急物资及装备', 'resources', 'start', {
    startPart: '灭火器等消防器材数量',
  }),
  item('first_aid_kit', '急救药箱药品清单', 'resources', 'before_delivery', { conditional: true }),
  item('fire_pool', '消防水池', 'resources', 'before_delivery', { conditional: true }),

  item('site_plan', '总平面布置图', 'drawings', 'start'),
  item('evacuation_plan', '紧急疏散示意图', 'drawings', 'start'),
  item('fire_facility_plan', '消防设施布置图', 'drawings', 'before_delivery'),
] as const satisfies readonly ChecklistItemDef[];

export type ChecklistItemKey = (typeof CHECKLIST_ITEMS)[number]['key'];

export const CHECKLIST_ITEM_KEYS = CHECKLIST_ITEMS.map((i) => i.key) as [
  ChecklistItemKey,
  ...ChecklistItemKey[],
];

export function getItemDef(key: ChecklistItemKey): ChecklistItemDef {
  return CHECKLIST_ITEMS.find((i) => i.key === key)!;
}
