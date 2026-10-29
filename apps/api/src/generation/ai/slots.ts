// 生成应急预案前先请 AI 填知识块的空位（迁自旧仓库 lib/md-generator/slot-prefill.ts 与 engine-slots.ts）。
// 每个空位单独请求；校验不过、服务出错都不进结果，生成时这个空位用系统推出的内容。
import { planSignals, resolveScope, selectPlans, type PlanInput } from '@genyun/shared';
import { slotWhitelist, templateSlots } from '../plan/content.ts';
import type { SlotDrafter } from './drafter.ts';

/** 模板编号 → 空位名 → AI 写的内容（已校验） */
export type FilledSlots = Record<string, Record<string, string>>;

/** 空位的业务名称，给专家看（空位名是内部编号，不进页面） */
export const SLOT_LABELS: Record<string, string> = {
  'melt-types': '熔融金属种类',
  'furnace-equip': '熔炼设备',
  'cordon-dist': '警戒距离',
  'flammable-liquids': '可燃液体',
  'liquid-storage': '可燃液体存放处',
  'hazard-positions': '涉可燃液体岗位',
  'metal-dust-types': '金属粉尘种类',
  'dust-workstations': '产尘工位',
  'danger-machines': '危险机械',
  'pressure-vessels': '压力容器',
};

export interface SlotNote {
  plan: string;
  slot: string;
  /** 业务名称，如「危险机械」 */
  label: string;
  source: 'ai' | 'system';
  /** 给专家看的说明：为什么没用 AI 写的 */
  note: string;
}

/** AI 写的内容去掉所有候选和分隔符后还剩别的字，就是越界 */
export function checkSlot(value: string, candidates: string[]): string | null {
  if (!value.trim()) return '内容为空';
  const rest = [...candidates]
    .sort((a, b) => b.length - a.length)
    .reduce((s, c) => s.split(c).join(''), value)
    .replace(/[、，,;；\s]/g, '');
  return rest ? `用了候选以外的内容「${rest}」` : null;
}

export async function draftSlots(input: PlanInput, drafter: SlotDrafter | null): Promise<{ filled: FilledSlots; notes: SlotNote[] }> {
  const filled: FilledSlots = {};
  const notes: SlotNote[] = [];
  if (!drafter) return { filled, notes };
  const signals = planSignals(input);
  const selection = selectPlans(resolveScope(input));
  for (const t of [...selection.specialty, ...selection.site]) {
    for (const slot of templateSlots(t, signals)) {
      const candidates = slotWhitelist(slot.name, signals);
      let note: string | null;
      let value = '';
      try {
        value = await drafter.fill({ plan: t.title, slot: slot.name, contract: slot.contract, candidates, anchors: slot.anchors });
        note = checkSlot(value, candidates);
      } catch (e) {
        note = `AI 服务出错：${e instanceof Error ? e.message : String(e)}`;
      }
      const label = SLOT_LABELS[slot.name] ?? slot.name;
      if (note === null) {
        (filled[t.id] ??= {})[slot.name] = value.trim();
        notes.push({ plan: t.title, slot: slot.name, label, source: 'ai', note: 'AI 填写，已核对只用了设备物料里有的内容' });
      } else {
        notes.push({ plan: t.title, slot: slot.name, label, source: 'system', note: `${note}，改用系统按设备物料推出的内容` });
      }
    }
  }
  return { filled, notes };
}
