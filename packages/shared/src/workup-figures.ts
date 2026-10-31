// 专业整理 ·「图件」（Paper 14 页 E18-00F）：应急救援组织体系图与生产工艺流程图由客户填的应急组织和工序自动画出，
// 专家这里只改「怎么画」（副总指挥与应急办公室显不显示、小组顺序、每行几道工序、返工 / 回用支路），
// 人员和工序内容回到对应模块改。两张图各自「采用」；采用后图的内容或画法再变，回到待采用。
// 和其他整理内容一样只记在任务的专业整理里（WorkupData.figures），不写回企业资料。
import { z } from 'zod';
import type { FlowBranch } from './document/figures.ts';
import { addressOptions, groupDisplayNames } from './profile/addresses.ts';
import { PRESET_GROUPS } from './profile/organization.ts';
import { CHART_ORDER } from './profile/organization-step.ts';
import { PROCESS_TEMPLATES } from './profile/process-flow.ts';
import { drawingsSaveSchema, type DrawingSelection } from './workup-drawings.ts';
import type { Stamp } from './workup-production.ts';
import { organizationOf, type WorkupData, type WorkupSnapshot } from './workup.ts';

export const FIGURES = {
  org: '应急救援组织体系图',
  process: '生产工艺流程图',
} as const;
export type FigureKey = keyof typeof FIGURES;
export const FIGURE_KEYS = Object.keys(FIGURES) as FigureKey[];

export const BRANCH_KINDS = { rework: '返工', reuse: '回用' } as const;
export type BranchKind = keyof typeof BRANCH_KINDS;

// 每行工序数：0 = 排成一行
export const PER_ROW_OPTIONS = [3, 4, 5, 0] as const;
export const AUTO_PER_ROW = 5;

const name = z.string().trim().min(1).max(40);

export const orgFigureSchema = z.object({
  deputy: z.boolean().optional(),
  office: z.boolean().optional(),
  // 小组名称的顺序；不设 = 按规则排序
  order: z.array(name).max(20).optional(),
});
export type OrgFigureSettings = z.infer<typeof orgFigureSchema>;

export const branchSchema = z.object({
  id: z.string().min(1).max(40),
  // 工序名称：工序改名或删掉后这条支路不再画
  from: name,
  to: name,
  kind: z.enum(['rework', 'reuse']),
});
export type ProcessBranch = z.infer<typeof branchSchema>;

export const processFigureSchema = z.object({
  perRow: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(0)]).optional(),
  branches: z.array(branchSchema).max(10, '支路最多 10 条').optional(),
});
export type ProcessFigureSettings = z.infer<typeof processFigureSchema>;

export interface FiguresWorkup {
  org?: OrgFigureSettings;
  process?: ProcessFigureSettings;
  // 采用时记下图的内容与画法，之后有变化就回到待采用
  adopted?: Partial<Record<FigureKey, Stamp & { signature: string }>>;
  // 客户图纸选进附件 7 的页（workup-drawings.ts），按文件记；没记的默认第 1 页
  drawings?: DrawingSelection;
}

// 一次保存：改某张图的画法（null = 恢复自动排版）和 / 或采用图
export const figuresSaveSchema = z.object({
  version: z.number().int().min(1),
  org: orgFigureSchema.nullable().optional(),
  process: processFigureSchema.nullable().optional(),
  adopt: z.array(z.enum(['org', 'process'])).max(2).optional(),
  // 只覆盖带上的文件，其余文件的选页不动
  drawings: drawingsSaveSchema.optional(),
});
export type FiguresSave = z.infer<typeof figuresSaveSchema>;

export type FigureStatus = 'pending' | 'adopted' | 'changed';

export interface OrgFigureView {
  key: 'org';
  // 实际画出来的
  deputy: boolean;
  office: boolean;
  groups: string[];
  // 自动排版时的样子
  auto: { deputy: boolean; order: string[] };
  hasDeputy: boolean;
  customOrder: boolean;
  customized: boolean;
  status: FigureStatus;
  adopted?: Stamp;
}

export interface ProcessFigureView {
  key: 'process';
  // 有工序才画得出；客户只传了照片时用照片
  available: boolean;
  steps: string[];
  perRow: number;
  branches: (ProcessBranch & { valid: boolean })[];
  // 画图用（下标从 0 起）
  flowBranches: FlowBranch[];
  source: string;
  sketchFileIds: string[];
  customized: boolean;
  status: FigureStatus;
  adopted?: Stamp;
}

export interface FiguresView {
  org: OrgFigureView;
  process: ProcessFigureView;
  pending: { key: FigureKey; label: string }[];
  // 必需项：画得出的图都要采用
  required: number;
}

const groupName = (g: { kind: keyof typeof PRESET_GROUPS | 'custom'; name: string }) =>
  (g.kind === 'custom' ? g.name : g.name || PRESET_GROUPS[g.kind]).trim();

const orgSignature = (o: { deputy: boolean; office: boolean; groups: string[] }) =>
  JSON.stringify({ deputy: o.deputy, office: o.office, groups: o.groups });
const processSignature = (p: { steps: string[]; perRow: number; flowBranches: FlowBranch[] }) =>
  JSON.stringify({ steps: p.steps, perRow: p.perRow, flowBranches: p.flowBranches });

function status(adopted: (Stamp & { signature: string }) | undefined, signature: string): FigureStatus {
  return !adopted ? 'pending' : adopted.signature === signature ? 'adopted' : 'changed';
}

function stampOf(a: (Stamp & { signature: string }) | undefined): Stamp | undefined {
  if (!a) return undefined;
  const { signature: _, ...stamp } = a;
  return stamp;
}

// 按保存的顺序排，新出现的小组按规则排在后面
export function orderGroups(ruleOrder: string[], order: string[] | undefined): string[] {
  if (!order) return ruleOrder;
  const kept = order.filter((n, i) => ruleOrder.includes(n) && order.indexOf(n) === i);
  return [...kept, ...ruleOrder.filter((n) => !kept.includes(n))];
}

export function figuresView(snapshot: WorkupSnapshot, data: Pick<WorkupData, 'overrides' | 'figures'>): FiguresView {
  const settings = data.figures ?? {};

  // ── 组织体系图：组名按规则排序（与客户自填页一致）；副总指挥有人才显示，专家可改 ──
  const org = organizationOf(snapshot);
  // 分厂址各设同名小组时组名带厂址
  const basic = snapshot.profile.basicStep?.basic;
  const names = groupDisplayNames(
    org.groups.map((g) => ({ name: groupName(g), addressId: g.addressId })),
    addressOptions(basic?.siteAddress, basic?.otherAddresses),
  );
  const ruleOrder = org.groups
    .map((g, i) => ({ n: names[i]!, kind: g.kind, i }))
    .filter((g) => g.n !== '')
    .sort((a, b) => CHART_ORDER.indexOf(a.kind) - CHART_ORDER.indexOf(b.kind) || a.i - b.i)
    .map((g) => g.n);
  const hasDeputy =
    org.deputies.some((d) => d.name.trim() !== '') || Object.keys(data.overrides).some((k) => k.startsWith('deputy.'));
  const os = settings.org ?? {};
  const groups = orderGroups(ruleOrder, os.order);
  const deputy = os.deputy ?? hasDeputy;
  const office = os.office ?? false;
  const customOrder = groups.join('\n') !== ruleOrder.join('\n');
  const orgView: OrgFigureView = {
    key: 'org',
    deputy,
    office,
    groups,
    auto: { deputy: hasDeputy, order: ruleOrder },
    hasDeputy,
    customOrder,
    customized: deputy !== hasDeputy || office || customOrder,
    status: status(settings.adopted?.org, orgSignature({ deputy, office, groups })),
    adopted: stampOf(settings.adopted?.org),
  };

  // ── 工艺流程图 ──
  const draft = snapshot.profile.productionStep?.step.process;
  const steps = (draft?.steps ?? []).map((s) => s.name.trim()).filter(Boolean);
  const ps = settings.process ?? {};
  const perRow = ps.perRow ?? AUTO_PER_ROW;
  const branches = (ps.branches ?? []).map((b) => ({
    ...b,
    valid: b.from !== b.to && steps.includes(b.from) && steps.includes(b.to),
  }));
  const flowBranches = branches
    .filter((b) => b.valid)
    .map((b) => ({ from: steps.indexOf(b.from), to: steps.indexOf(b.to), label: BRANCH_KINDS[b.kind] }));
  const source =
    draft?.source === 'template' && draft.templateId
      ? `来自「${PROCESS_TEMPLATES[draft.templateId].label}」模板`
      : draft?.source === 'text'
        ? '由客户的一句话描述拆出'
        : draft?.source === 'sketch'
          ? '客户上传了流程图照片'
          : '客户填写';
  const processView: ProcessFigureView = {
    key: 'process',
    available: steps.length > 0,
    steps,
    perRow,
    branches,
    flowBranches,
    source,
    sketchFileIds: draft?.sketchFileIds ?? [],
    customized: perRow !== AUTO_PER_ROW || branches.length > 0,
    status: status(settings.adopted?.process, processSignature({ steps, perRow, flowBranches })),
    adopted: stampOf(settings.adopted?.process),
  };

  const pending = [orgView, ...(processView.available ? [processView] : [])]
    .filter((f) => f.status !== 'adopted')
    .map((f) => ({ key: f.key, label: FIGURES[f.key] }));
  return { org: orgView, process: processView, pending, required: processView.available ? 2 : 1 };
}

// 采用时记下的内容，与 figuresView 里判断「有变化」用的同一份
export function figureSignature(view: FiguresView, key: FigureKey): string {
  return key === 'org' ? orgSignature(view.org) : processSignature(view.process);
}

export function figuresSaveError(view: FiguresView, save: FiguresSave): string | null {
  if (save.adopt?.includes('process') && !view.process.available) return '没有工序，画不出工艺流程图';
  for (const b of save.process?.branches ?? []) {
    if (b.from === b.to) return '支路的起点和终点不能是同一道工序';
  }
  return null;
}

// 给第 10 项生成用（PlanInput.expert.figures）：按名称记，生成时与整理后的组织、工序对上
export interface PlanFigures {
  org?: { deputy: boolean; office: boolean; order: string[] };
  process?: { perRow: number; branches: { from: string; to: string; kind: BranchKind }[] };
}

export function planFiguresOf(view: FiguresView): PlanFigures {
  return {
    org: { deputy: view.org.deputy, office: view.org.office, order: view.org.groups },
    process: {
      perRow: view.process.perRow,
      branches: view.process.branches.filter((b) => b.valid).map(({ from, to, kind }) => ({ from, to, kind })),
    },
  };
}

// 生成 Word 时画工艺流程图的参数：支路按名称对到工序下标，对不上的不画
export function flowOptionsOf(steps: string[], p: PlanFigures['process']): { perRow?: number; branches: FlowBranch[] } {
  return {
    perRow: p?.perRow,
    branches: (p?.branches ?? [])
      .map((b) => ({ from: steps.indexOf(b.from), to: steps.indexOf(b.to), label: BRANCH_KINDS[b.kind] }))
      .filter((b) => b.from >= 0 && b.to >= 0 && b.from !== b.to),
  };
}
