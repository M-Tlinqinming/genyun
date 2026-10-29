// 一次生成三份交付文档：应急预案、风险评估报告、应急资源调查报告。
// AI 只参与应急预案知识块的空位（见 ai/slots.ts）；notes 记下每个空位用的是 AI 还是系统的内容，给专家核对。
import type { DeliveryDocument, PlanInput } from '@genyun/shared';
import type { SlotDrafter } from './ai/drafter.ts';
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

export async function generateDocuments(
  input: PlanInput,
  options: { drawings?: PlanDrawings; drafter?: SlotDrafter | null } = {},
): Promise<GeneratedDocuments> {
  const { filled, notes } = await draftSlots(input, options.drafter ?? null);
  return {
    plan: buildPlan(input, options.drawings, filled),
    risk: buildRiskReport(input),
    resource: buildResourceReport(input),
    notes,
  };
}
