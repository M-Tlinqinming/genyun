// 一次生成三份交付文档：应急预案、风险评估报告、应急资源调查报告。
// AI 只参与应急预案知识块的空位（见 ai/slots.ts）和现场处置方案的风险描述（见 ai/risk.ts）；
// notes 记下每个空位、每段用的是 AI 还是系统的内容，给专家核对。
import type { DeliveryDocument, DraftKind, PlanInput } from '@genyun/shared';
import type { SlotDrafter } from './ai/drafter.ts';
import { draftRisks } from './ai/risk.ts';
import { draftSlots, type SlotNote } from './ai/slots.ts';
import { buildPlan, type PlanDrawings } from './plan/assemble.ts';
import { buildResourceReport } from './reports/resource.ts';
import { buildRiskReport } from './reports/risk.ts';

export interface GeneratedDocuments {
  plan: DeliveryDocument;
  risk: DeliveryDocument;
  resource: DeliveryDocument;
  notes: SlotNote[];
}

// 只生成其中一份（第 10 项后台排队时三份各自生成、失败的单独重试）。AI 只在应急预案里用
export async function generateDocument(
  kind: DraftKind,
  input: PlanInput,
  options: { drawings?: PlanDrawings; drafter?: SlotDrafter | null } = {},
): Promise<{ document: DeliveryDocument; notes: SlotNote[] }> {
  if (kind === 'risk') return { document: buildRiskReport(input), notes: [] };
  if (kind === 'resource') return { document: buildResourceReport(input), notes: [] };
  const { filled, notes: slotNotes } = await draftSlots(input, options.drafter ?? null);
  const { rewrites, notes: riskNotes } = await draftRisks(input, options.drafter ?? null);
  return { document: buildPlan(input, options.drawings, filled, rewrites), notes: [...slotNotes, ...riskNotes] };
}

export async function generateDocuments(
  input: PlanInput,
  options: { drawings?: PlanDrawings; drafter?: SlotDrafter | null } = {},
): Promise<GeneratedDocuments> {
  const { filled, notes: slotNotes } = await draftSlots(input, options.drafter ?? null);
  const { rewrites, notes: riskNotes } = await draftRisks(input, options.drafter ?? null);
  return {
    plan: buildPlan(input, options.drawings, filled, rewrites),
    risk: buildRiskReport(input),
    resource: buildResourceReport(input),
    notes: [...slotNotes, ...riskNotes],
  };
}
