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
  type DeliveryDocument,
} from '@genyun/shared';

// 测试用的小文档结构：一章两节，第二节有一张表（正文编辑测试用）
export function testDocument(kind: 'plan' | 'risk' | 'resource'): DeliveryDocument {
  return {
    kind,
    title: `测试${kind}`,
    cover: { company: '测试', name: kind, lines: [], dates: [] },
    frontPages: [],
    sections: [
      {
        id: 'ch1',
        title: '1 总则',
        blocks: [{ type: 'paragraph', text: ['总则正文。'] }],
        sections: [
          { id: 'ch1.1', title: '1.1 编制目的', blocks: [{ type: 'paragraph', text: ['原来的编制目的。'] }], sections: [] },
          {
            id: 'ch1.2',
            title: '1.2 应急通讯录',
            blocks: [
              { type: 'paragraph', text: ['应急办公室联系人：陈某，电话 13800000001。'] },
              { type: 'table', caption: '表 1 应急通讯录', header: [['姓名']], rows: [['陈某']] },
            ],
            sections: [],
          },
        ],
      },
    ],
  };
}

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

