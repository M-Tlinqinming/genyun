// 企业自填第 2 步「人员与应急组织」（Paper 12 页 S02；体系图规则见 12 页「组织体系图 · 生成规则」）。
// 边填边保存，所以姓名、电话都允许暂时空着；交付前由注册安全工程师按 organizationSchema 核对。
import { z } from 'zod';
import { YES_NO_UNKNOWN } from './basic.ts';
import { PRESET_GROUPS, type PresetGroupKey } from './organization.ts';

const phone = z
  .string()
  .trim()
  .max(30, '电话最多 30 位')
  .regex(/^[\d\s\-+()（）]*$/, '电话只能填数字、空格和短横线')
  .optional();

export const draftPersonSchema = z.object({
  // 同一个人可兼任多个小组，用 id 关联（改一处，各处一起改）
  id: z.string().min(1).max(40),
  name: z.string().trim().max(50, '姓名最多 50 个字').default(''),
  position: z.string().trim().max(50, '职位最多 50 个字').optional(),
  phone,
});
export type DraftPerson = z.infer<typeof draftPersonSchema>;

const GROUP_KINDS = [...(Object.keys(PRESET_GROUPS) as PresetGroupKey[]), 'custom'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const draftGroupSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(GROUP_KINDS),
  name: z.string().trim().max(20, '小组名称最多 20 个字'),
  leader: draftPersonSchema.optional(),
  members: z.array(draftPersonSchema).max(30, '每组最多 30 名组员').default([]),
  // 所在厂址（有两处及以上地址时选填，见 addresses.ts）
  addressId: z.string().max(40).optional(),
});
export type DraftGroup = z.infer<typeof draftGroupSchema>;

export const compilationExtraSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().max(50).default(''),
  title: z.string().trim().max(50).optional(),
  duty: z.string().trim().max(100).optional(),
});
export type CompilationExtra = z.infer<typeof compilationExtraSchema>;

export const MIN_GROUPS = 2;
export const MAX_GROUPS = 6;

export const organizationStepSchema = z
  .object({
    // form = 逐项填写；roster = 上传花名册，由专家整理
    mode: z.enum(['form', 'roster']).default('form'),
    commander: draftPersonSchema.optional(),
    deputies: z.array(draftPersonSchema).max(2, '副总指挥最多 2 人').default([]),
    groups: z
      .array(draftGroupSchema)
      .min(MIN_GROUPS, `至少设 ${MIN_GROUPS} 个应急小组`)
      .max(MAX_GROUPS, `最多设 ${MAX_GROUPS} 个应急小组`),
    // 由客户填写，不默认总指挥手机
    dutyPhone: phone,
    // 应急通讯（选填）：有没有覆盖厂区的应急广播系统、有没有应急微信群 / 工作群
    paSystem: z.enum(YES_NO_UNKNOWN).optional(),
    imGroup: z.enum(YES_NO_UNKNOWN).optional(),
    // 编制小组里总指挥、副总指挥、各组组长之外另加的成员
    compilationExtras: z.array(compilationExtraSchema).max(20).default([]),
  })
  .refine(
    (s) => {
      const presets = s.groups.filter((g) => g.kind !== 'custom').map((g) => g.kind);
      return new Set(presets).size === presets.length;
    },
    { message: '同一个小组不能添加两次', path: ['groups'] },
  );
export type OrganizationStep = z.infer<typeof organizationStepSchema>;

export const organizationStepSaveSchema = z.object({
  version: z.number().int().min(1),
  step: organizationStepSchema,
});
export type OrganizationStepSave = z.infer<typeof organizationStepSaveSchema>;

// 存在企业资料里的第 2 步内容；花名册文件同时挂在任务的「各应急小组成员」上
export interface OrganizationStepStored {
  step: OrganizationStep;
  rosterFileIds: string[];
}

export const GROUP_DESCRIPTIONS: Record<GroupKind, string> = {
  rescue: '现场控制、搜救、抢修',
  evacuation: '警戒、疏散、人员清点',
  medical: '现场急救、伤员转送',
  logistics: '物资、车辆、后勤、医疗',
  communication: '报警、通知、对外联络',
  custom: '',
};

// 体系图上小组的排列顺序：抢险救灾 → 警戒疏散 → 医疗救护 → 综合保障 → 通讯联络 → 自定义
export const CHART_ORDER: GroupKind[] = ['rescue', 'evacuation', 'medical', 'logistics', 'communication', 'custom'];

// 建议规模（Martin 10-26 确认）：50 人以下 3 组；50–100 人 3–4 组；100 人以上 5 组。
// 危化品在第 3 步之后才知道，由专家审核时调整
export function suggestedGroups(employeeCount: number | undefined): { min: number; max: number } {
  if (employeeCount !== undefined && employeeCount >= 100) return { min: 5, max: 5 };
  if (employeeCount !== undefined && employeeCount >= 50) return { min: 3, max: 4 };
  return { min: 3, max: 3 };
}

let seq = 0;
// 新建行用的 id，只要在本企业资料里不重复
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function presetGroup(kind: PresetGroupKey): DraftGroup {
  return { id: newId('g'), kind, name: PRESET_GROUPS[kind], members: [] };
}

// 第一次打开时的内容：按员工人数预设小组
export function defaultOrganizationStep(employeeCount: number | undefined): OrganizationStep {
  const kinds: PresetGroupKey[] =
    suggestedGroups(employeeCount).min >= 5
      ? ['rescue', 'evacuation', 'medical', 'logistics', 'communication']
      : ['rescue', 'logistics', 'communication'];
  return { mode: 'form', deputies: [], groups: kinds.map(presetGroup), compilationExtras: [] };
}

const filled = (v: string | undefined) => Boolean(v && v.trim() !== '');

// 「各应急小组成员」开始编制只要求总指挥及手机
export function emergencyGroupsStartReady(step: OrganizationStep): boolean {
  return step.mode === 'form' && filled(step.commander?.name) && filled(step.commander?.phone);
}

// 24 小时值班电话：由客户自己填，不默认带出总指挥手机——值班的往往是值班室、门卫等其他人（Martin 10-28 确认）
export function dutyPhoneOfStep(step: OrganizationStep): string | undefined {
  return filled(step.dutyPhone) ? step.dutyPhone!.trim() : undefined;
}

// 组织体系图：总指挥 →（有副总指挥时）副总指挥 → 各小组，组名竖排、只写职务
export interface OrgChart {
  deputy: boolean;
  groups: string[];
}

export function orgChartOf(step: OrganizationStep): OrgChart {
  const groups = step.groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.name.trim() !== '')
    .sort((a, b) => CHART_ORDER.indexOf(a.g.kind) - CHART_ORDER.indexOf(b.g.kind) || a.i - b.i)
    .map(({ g }) => g.name.trim());
  return { deputy: step.deputies.some((d) => filled(d.name)), groups };
}

// 应急预案编制小组：总指挥任组长，副总指挥和各组组长任成员，分工按常规写好
export const COMMANDER_DUTY = '制定编制计划，组织编制、评审、修订，签署并颁布实施';
export const DEPUTY_DUTY = '汇总统稿，负责后期管理和维护';
export const GROUP_LEADER_DUTIES: Record<GroupKind, string> = {
  rescue: '重点编写风险评估与现场处置',
  evacuation: '重点编写警戒疏散与人员安置',
  medical: '重点编写医疗救护与伤员转送',
  logistics: '重点编写后勤保障、人员疏散与善后处理',
  communication: '重点编写信息报告与应急通讯',
  custom: '参与相关章节编写',
};

export interface CompilationRow {
  // 自动生成的行 id 为人员 id，另加的成员为 compilationExtras 里的 id
  id: string;
  role: '组长' | '成员';
  name: string;
  title?: string;
  duty: string;
  auto: boolean;
}

export function compilationTeamOf(step: OrganizationStep): CompilationRow[] {
  const rows: CompilationRow[] = [];
  const seen = new Set<string>();
  const add = (p: DraftPerson | undefined, role: CompilationRow['role'], duty: string) => {
    if (!p || !filled(p.name) || seen.has(p.id)) return;
    seen.add(p.id);
    rows.push({ id: p.id, role, name: p.name.trim(), title: p.position || undefined, duty, auto: true });
  };
  add(step.commander, '组长', COMMANDER_DUTY);
  for (const d of step.deputies) add(d, '成员', DEPUTY_DUTY);
  for (const g of step.groups) add(g.leader, '成员', GROUP_LEADER_DUTIES[g.kind]);
  for (const e of step.compilationExtras) {
    rows.push({ id: e.id, role: '成员', name: e.name, title: e.title, duty: e.duty ?? '', auto: false });
  }
  return rows;
}

// 已填过的人（供「从已填人员中选」）：按 id 去重，没写姓名的不算
export function peopleOf(step: OrganizationStep): DraftPerson[] {
  const all = [step.commander, ...step.deputies, ...step.groups.flatMap((g) => [g.leader, ...g.members])];
  const byId = new Map<string, DraftPerson>();
  for (const p of all) if (p && filled(p.name) && !byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()];
}
