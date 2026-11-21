// 测试用：按缺项逐个补齐专业整理，让任务可以确认生成（generation.test、drawings.test 共用）
import {
  emptyProductionWorkup,
  factDefOf,
  resourcesStepView,
  workupGaps,
  type FactValue,
  type WorkupData,
  type WorkupSnapshot,
  type DeliveryDocument,
} from '@genyun/shared';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/client.ts';
import { eq } from 'drizzle-orm';
import { files, tasks } from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';

// 1×1 浅灰 PNG：给了 storage 时存进去，生成时图纸能真的转出来
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4+/fvfwAJ0wPj0oO0VQAAAABJRU5ErkJggg==', 'base64');

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

// 生成门槛要的两张图：在客户组织名下记两份图片（存储里没有内容，生成时按「打不开」跳过，不影响三份文稿）
export interface GateDrawings {
  sitePlan: string;
  evacuationPlan: string;
}
export async function gateDrawings(db: Database, orgId: string, uploadedBy: string, storage?: FileStorage): Promise<GateDrawings> {
  const mk = async (name: string) => {
    const storageKey = storage ? `${orgId}/${randomUUID()}` : `${orgId}/gate-${name}`;
    if (storage) await storage.put(storageKey, TINY_PNG, 'image/png');
    return (
      await db
        .insert(files)
        .values({ orgId, kind: 'customer_material', originalName: name, contentType: 'image/png', sizeBytes: 1, sha256: name, storageKey, uploadedBy })
        .returning({ id: files.id })
    )[0]!.id;
  };
  return { sitePlan: await mk('总平面布置图.png'), evacuationPlan: await mk('紧急疏散示意图.png') };
}

// 按缺项逐个补齐（取第一个选项、判为否），让这份整理可以确认生成；
// 两张必备图纸要传 drawings（gateDrawings 建的文件），不传时图纸那两项留着
export function complete(snapshot: WorkupSnapshot, drawings?: GateDrawings): WorkupData {
  const data: WorkupData = { overrides: {}, production: emptyProductionWorkup(), scope: { switches: {} }, figures: { adopted: {} } };
  if (drawings) {
    const step = resourcesStepView(snapshot, data);
    data.profile = {
      resourcesStep: { step: { ...step, drawings: { ...step.drawings, site_plan: [drawings.sitePlan], evacuation_plan: [drawings.evacuationPlan] } } },
    };
  }
  const refs = drawings
    ? [
        { key: 'site_plan', contentType: 'image/png' },
        { key: 'evacuation_plan', contentType: 'image/png' },
      ]
    : [];
  const open = () => workupGaps(snapshot, data, undefined, refs).gaps.filter((g) => !g.key.startsWith('drawing:'));
  for (let round = 0; round < 5; round++) {
    const gaps = open();
    if (gaps.length === 0) return data;
    for (const g of gaps) {
      if (!g.factKey) continue;
      const kind = factDefOf(snapshot, g.factKey)!.kind;
      const value: FactValue = kind === 'count' ? 5 : kind === 'person' ? { name: '测试人员', phone: '13800000099' } : '测试补充';
      data.overrides[g.factKey] = { value, source: 'expert', ...stamp };
    }
  }
  throw new Error(`补不齐：${open().map((g) => g.label).join('、')}`);
}

// complete 加上门槛要的两张图（文件记在任务的组织名下，上传人是建任务的人）
export async function completeFor(db: Database, taskId: string, snapshot: WorkupSnapshot, storage?: FileStorage): Promise<WorkupData> {
  const [task] = await db.select({ orgId: tasks.orgId, createdBy: tasks.createdBy }).from(tasks).where(eq(tasks.id, taskId));
  return complete(snapshot, await gateDrawings(db, task!.orgId, task!.createdBy, storage));
}
