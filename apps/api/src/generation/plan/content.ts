// 读模板与知识块（apps/api/content/plan，原样迁自旧仓库 templates/ 与 lib/safety-kb/blocks/），填企业数据。
// 知识块是按企业实际改写过的版本（压铸、金属粉尘、酒精等），里面留了空位由设备物料推出的内容填；
// 只有每个空位都有内容时才用知识块，否则用通用模板——知识块是按压铸厂写的，没有这些设备的企业不能套用。
// 知识块里的安全要点句（命门）必须一字不差地留在成稿里，缺了就报错，不出文档。
import { readFileSync } from 'node:fs';
import type { PlanSignals, PlanTemplate } from '@genyun/shared';

const CONTENT_DIR = new URL('../../../content/plan/', import.meta.url);

interface ContentFile {
  body: string;
  /** 知识块的命门句 */
  anchors: string[];
  /** 知识块空位的填写要求（给 AI 看） */
  contracts: Record<string, string>;
}

const cache = new Map<string, ContentFile>();

function load(path: string): ContentFile | undefined {
  if (cache.has(path)) return cache.get(path);
  let raw: string;
  try {
    raw = readFileSync(new URL(path, CONTENT_DIR), 'utf8').replace(/\r\n?/g, '\n');
  } catch {
    return undefined;
  }
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const front = m?.[1] ?? '';
  const file = {
    body: m ? raw.slice(m[0].length) : raw,
    anchors: [...front.matchAll(/^\s*anchor:\s*"(.*)"\s*$/gm)].map((a) => a[1]!),
    contracts: Object.fromEntries(
      [...front.matchAll(/^\s*-\s*name:\s*([a-z-]+)\s*\n\s*contract:\s*"(.*)"\s*$/gm)].map((c) => [c[1]!, c[2]!]),
    ),
  };
  cache.set(path, file);
  return file;
}

const SLOT = /\{\{slot:([a-z-]+)\}\}/g;

/** 空位可用的内容：全部由设备物料推出，AI 只能在这里面挑选、排序 */
export function slotWhitelist(name: string, s: PlanSignals): string[] {
  switch (name) {
    case 'melt-types':
      return s.meltTypes;
    case 'furnace-equip':
      return s.furnaceEquip;
    case 'cordon-dist':
      return [s.cordonDist].filter(Boolean);
    case 'flammable-liquids':
      return s.flammableLiquids;
    case 'liquid-storage':
      return [s.liquidStorage].filter(Boolean);
    case 'hazard-positions':
      return [s.hazardPositions].filter(Boolean);
    case 'metal-dust-types':
      return s.metalDustTypes;
    case 'dust-workstations':
      return s.dustWorkstations;
    case 'danger-machines':
      return s.dangerMachines;
    case 'pressure-vessels':
      return s.pressureVessels;
    default:
      throw new Error(`知识块里有未知的空位：${name}`);
  }
}

/** 不用 AI 时空位填的内容 */
export const slotValue = (name: string, s: PlanSignals) => slotWhitelist(name, s).join('、');

/** 这一份用知识块还是通用模板 */
function knowledgeBlock(t: PlanTemplate, s: PlanSignals): ContentFile | undefined {
  const block = load(`blocks/${t.id}.md`);
  if (!block) return undefined;
  // 容器爆炸知识块没有锅炉的内容
  if (t.id === 'SP05' && s.boiler) return undefined;
  const slots = [...block.body.matchAll(SLOT)].map((m) => m[1]!);
  return slots.every((name) => slotValue(name, s) !== '') ? block : undefined;
}

/** 用知识块时要填的空位及其填写要求（AI 起草用） */
export function templateSlots(t: PlanTemplate, signals: PlanSignals): { name: string; contract: string; anchors: string[] }[] {
  const block = knowledgeBlock(t, signals);
  if (!block) return [];
  const names = [...new Set([...block.body.matchAll(SLOT)].map((m) => m[1]!))];
  return names.map((name) => ({ name, contract: block.contracts[name] ?? '', anchors: block.anchors }));
}

/**
 * 模板正文（Markdown），空位已填、占位符未替换。
 * filled 是 AI 起草时已校验过的空位内容，没有的空位用设备物料推出的内容。
 */
export function templateBody(t: PlanTemplate, signals: PlanSignals, filled: Record<string, string> = {}): string {
  const block = knowledgeBlock(t, signals);
  if (block) {
    const body = block.body.replace(SLOT, (_, name: string) => filled[name] ?? slotValue(name, signals));
    for (const anchor of block.anchors) {
      // 个别命门写成正则（同一句在模板里有两种语序），其余按原文比对
      const found = anchor.includes('(?:') ? new RegExp(anchor).test(body) : body.includes(anchor);
      if (!found) throw new Error(`「${t.title}」缺少安全要点：${anchor}`);
    }
    return body;
  }
  const file = load(`${t.kind}/${t.id}.md`);
  if (!file) throw new Error(`没有模板：${t.title}`);
  return file.body;
}

/** 用了知识块的有哪些（测试与核对用） */
export function usesKnowledgeBlock(t: PlanTemplate, signals: PlanSignals): boolean {
  return knowledgeBlock(t, signals) !== undefined;
}
