// 测试用：按缺项逐个补齐专业整理，让任务可以确认生成（generation.test、drawings.test 共用）
import {
  emptyProductionWorkup,
  factDefOf,
  figureSignature,
  figuresView,
  workupGaps,
  type FactValue,
  type FigureKey,
  type ScopeKey,
  type SpecialCategory,
  type WorkupData,
  type WorkupSnapshot,
} from '@genyun/shared';

const stamp = { by: 'u', byName: '周工', at: '2026-10-31T08:00:00.000Z' };

// 按缺项逐个补齐（取第一个选项、判为否），让这份整理可以确认生成
export function complete(snapshot: WorkupSnapshot): WorkupData {
  const data: WorkupData = { overrides: {}, production: emptyProductionWorkup(), scope: { switches: {} }, figures: { adopted: {} } };
  for (let round = 0; round < 5; round++) {
    const { gaps } = workupGaps(snapshot, data);
    if (gaps.length === 0) return data;
    for (const g of gaps) {
      const [head, id] = g.key.split(':') as [string, string | undefined];
      if (g.module === 'facts') {
        const kind = factDefOf(snapshot, g.key)!.kind;
        const value: FactValue = kind === 'count' ? 5 : kind === 'person' ? { name: '测试人员', phone: '13800000099' } : '测试补充';
        data.overrides[g.key] = { value, source: 'expert', ...stamp };
      } else if (head === 'material') data.production!.hazardous[id!] = { ...stamp, value: false };
      else if (head === 'special') data.production!.special[id as SpecialCategory] = { ...stamp, value: { answer: 'no', items: [] } };
      else if (head === 'building') data.production!.fireRatings[id!] = { ...stamp, value: '2' };
      else if (head === 'scope') data.scope!.switches[id as ScopeKey] = { ...stamp, value: false };
      else if (head === 'figure') {
        const view = figuresView(snapshot, data);
        data.figures!.adopted![id as FigureKey] = { ...stamp, signature: figureSignature(view, id as FigureKey) };
      }
    }
  }
  throw new Error(`补不齐：${workupGaps(snapshot, data).gaps.map((g) => g.label).join('、')}`);
}

