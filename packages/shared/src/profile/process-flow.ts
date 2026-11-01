// 企业自填第 3 步第 2 页「工艺流程」（Paper 12 页 S03b）。
// 三种起点：选行业模板后增删工序 / 写一句话自动拆成工序 / 拍照上传已有流程图。顺序大致对就行，专家审核时确认。
// 工序只记名称和用到的设备；投入物料、去向（返工 / 回用）由专家在 productionSchema 里补。
import { z } from 'zod';

const id = z.string().min(1).max(40);

export const PROCESS_STEP_MAX = 40;

export const draftProcessStepSchema = z.object({
  id,
  name: z.string().trim().max(20, '工序名称最多 20 个字').default(''),
  // 这道工序用到的设备名称（模板带出），用来和设备表核对
  equipment: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
});
export type DraftProcessStep = z.infer<typeof draftProcessStepSchema>;

// 第一版内置 6 个常见行业（2026-10-27 Martin 确认）。M3 第 5 项起由运营在知识库维护（数据库表 process_templates），
// 迁移 0025 把这 6 个原样写进去；数据库没有数据时用这里的内置模板
export const PROCESS_TEMPLATES = {
  lithium_battery: {
    label: '锂电池组装（电芯封装）',
    keywords: ['锂电', '电池', '电芯'],
    steps: [
      ['喷码', ['喷码机']],
      ['裁切', ['裁切机']],
      ['打印', ['打印机']],
      ['电芯检测', ['检测柜']],
      ['电芯包装', []],
      ['电焊插头线', ['点焊机']],
      ['装热缩套管', ['热风枪']],
      ['成品检测', ['检测柜']],
      ['外观检测', []],
      ['装盘装箱', []],
    ],
  },
  smt: {
    label: 'SMT 电子装配',
    keywords: ['SMT', '贴片', '电路板', '线路板', 'PCB', '电子元器件', '电子产品'],
    steps: [
      ['来料检验', []],
      ['锡膏印刷', ['锡膏印刷机']],
      ['贴片', ['贴片机']],
      ['回流焊', ['回流焊炉']],
      ['AOI 检测', ['AOI 检测仪']],
      ['插件', []],
      ['波峰焊', ['波峰焊机']],
      ['手工补焊', ['电烙铁']],
      ['功能测试', []],
      ['包装入库', []],
    ],
  },
  injection_molding: {
    label: '塑料注塑',
    keywords: ['注塑', '塑料制品', '塑胶'],
    steps: [
      ['原料烘干', ['干燥机']],
      ['配色混料', ['混料机']],
      ['注塑成型', ['注塑机']],
      ['去水口修边', []],
      ['水口料粉碎', ['粉碎机']],
      ['品质检验', []],
      ['包装入库', []],
    ],
  },
  metal_stamping: {
    label: '五金冲压',
    keywords: ['冲压', '五金', '钣金'],
    steps: [
      ['下料', ['剪板机']],
      ['冲压成型', ['冲床']],
      ['折弯', ['折弯机']],
      ['攻牙', ['攻牙机']],
      ['去毛刺', []],
      ['品质检验', []],
      ['包装入库', []],
    ],
  },
  spraying: {
    label: '喷涂',
    keywords: ['喷涂', '喷漆', '涂装', '喷塑', '喷粉'],
    steps: [
      ['除油清洗', []],
      ['打磨', ['打磨机']],
      ['遮蔽', []],
      ['喷涂', ['喷漆房']],
      ['流平', []],
      ['烘干固化', ['烘箱']],
      ['品质检验', []],
      ['包装入库', []],
    ],
  },
  furniture: {
    label: '家具木加工',
    keywords: ['家具', '木制品', '木材加工', '板式', '实木'],
    steps: [
      ['开料', ['裁板锯']],
      ['封边', ['封边机']],
      ['钻孔', ['排钻']],
      ['砂光', ['砂光机']],
      ['喷漆', ['喷漆房']],
      ['晾干', []],
      ['组装', []],
      ['检验包装', []],
    ],
  },
} as const satisfies Record<
  string,
  { label: string; keywords: readonly string[]; steps: readonly (readonly [string, readonly string[]])[] }
>;
export type ProcessTemplateId = keyof typeof PROCESS_TEMPLATES;
export const PROCESS_TEMPLATE_IDS = Object.keys(PROCESS_TEMPLATES) as [ProcessTemplateId, ...ProcessTemplateId[]];

// 客户选用的工艺模板（知识库里已发布的那一版）：只有工序名称和常见设备，风险提示等只给注安师看
export interface ProcessTemplate {
  id: string;
  label: string;
  keywords: readonly string[];
  steps: readonly { name: string; equipment: readonly string[] }[];
}

export const BUILTIN_PROCESS_TEMPLATES: readonly ProcessTemplate[] = PROCESS_TEMPLATE_IDS.map((id) => ({
  id,
  label: PROCESS_TEMPLATES[id].label,
  keywords: PROCESS_TEMPLATES[id].keywords,
  steps: PROCESS_TEMPLATES[id].steps.map(([name, equipment]) => ({ name, equipment })),
}));

// 模板编号：内置的是英文短名（如 metal_stamping），运营新增的由系统生成
export const PROCESS_TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export const processDraftSchema = z.object({
  // 最近一次从哪里开始：模板 / 一句话 / 照片
  source: z.enum(['template', 'text', 'sketch']).optional(),
  // 知识库里的模板编号（保存时接口再核对模板存在）
  templateId: z.string().regex(PROCESS_TEMPLATE_ID_PATTERN, '没有这个行业模板').optional(),
  // 选用时模板的名称（模板以后改名、停用，整理页仍显示客户当时选的）
  templateLabel: z.string().trim().max(40).optional(),
  description: z.string().trim().max(500, '描述最多 500 个字').optional(),
  // 已有流程图的照片（同时挂在任务的「生产工艺流程」上）
  sketchFileIds: z.array(z.uuid()).max(20, '每处最多 20 个文件').default([]),
  steps: z.array(draftProcessStepSchema).max(PROCESS_STEP_MAX, `工序最多 ${PROCESS_STEP_MAX} 道`).default([]),
});
export type ProcessDraft = z.infer<typeof processDraftSchema>;

// 按经营范围推荐一个模板（关键词先出现的优先），没有接近的不推荐
export function recommendedTemplate(
  businessScope: string | undefined,
  templates: readonly ProcessTemplate[] = BUILTIN_PROCESS_TEMPLATES,
): string | undefined {
  if (!businessScope) return undefined;
  let best: { id: string; at: number } | undefined;
  for (const t of templates) {
    for (const word of t.keywords) {
      if (!word) continue;
      const at = businessScope.toUpperCase().indexOf(word.toUpperCase());
      if (at >= 0 && (!best || at < best.at)) best = { id: t.id, at };
    }
  }
  return best?.id;
}

export function stepsFromTemplate(template: ProcessTemplate | ProcessTemplateId, makeId: () => string): DraftProcessStep[] {
  const t = typeof template === 'string' ? BUILTIN_PROCESS_TEMPLATES.find((x) => x.id === template)! : template;
  return t.steps.map(({ name, equipment }) => ({
    id: makeId(),
    name,
    equipment: [...equipment],
  }));
}

// 整理页显示「来自「X」模板」用的名称：先用客户选用时记下的，老数据按内置模板查
export function processTemplateLabel(draft: { templateId?: string; templateLabel?: string }): string | undefined {
  if (draft.templateLabel) return draft.templateLabel;
  return BUILTIN_PROCESS_TEMPLATES.find((t) => t.id === draft.templateId)?.label;
}

// 一句话拆成工序：按顿号、逗号、箭头、换行等分开，如「熔融、压铸、攻牙→包装出货」
export function stepsFromDescription(description: string, makeId: () => string): DraftProcessStep[] {
  return description
    .split(/[、，,；;。\n→>＞—\-]+|\s{2,}/)
    .map((s) => s.trim().slice(0, 20))
    .filter(Boolean)
    .slice(0, PROCESS_STEP_MAX)
    .map((name) => ({ id: makeId(), name, equipment: [] }));
}

// 「生产工艺流程」开始编制只要一句话：有工序、写了描述或传了流程图照片都算
export function processStartReady(p: ProcessDraft): boolean {
  return (
    p.steps.some((s) => s.name.trim() !== '') || Boolean(p.description?.trim()) || p.sketchFileIds.length > 0
  );
}

// 工序用到的设备和设备表核对：名称互相包含就算同一种（如「点焊机」和「气动点焊机」）
export interface ProcessEquipmentCheck {
  linked: { step: string; equipment: string; quantity?: string }[];
  missing: string[];
}

export function checkProcessEquipment(
  steps: DraftProcessStep[],
  equipment: { name: string; quantity?: string }[],
): ProcessEquipmentCheck {
  const rows = equipment.filter((e) => e.name.trim() !== '');
  const linked: ProcessEquipmentCheck['linked'] = [];
  const missing: string[] = [];
  for (const s of steps) {
    if (!s.name.trim()) continue;
    for (const name of s.equipment) {
      const row = rows.find((e) => e.name.includes(name) || name.includes(e.name.trim()));
      if (row) linked.push({ step: s.name, equipment: row.name, quantity: row.quantity });
      else if (!missing.includes(name)) missing.push(name);
    }
  }
  return { linked, missing };
}

// 流程图按行蛇形排列：第 1 行从左到右，第 2 行从右到左……行末向下接到下一行。
// 返回每行的工序（已按显示顺序从左到右排好）和这一行是否反向
export function snakeRows<T>(items: T[], perRow: number): { items: T[]; reversed: boolean }[] {
  const rows: { items: T[]; reversed: boolean }[] = [];
  for (let i = 0; i < items.length; i += perRow) {
    const reversed = rows.length % 2 === 1;
    const chunk = items.slice(i, i + perRow);
    rows.push({ items: reversed ? chunk.reverse() : chunk, reversed });
  }
  return rows;
}
