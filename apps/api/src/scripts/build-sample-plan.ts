// 用飞宇样例生成三份交付文档：npm run sample:plan -w @genyun/api，输出到仓库根目录 out/
// AI 起草用模拟实现（只填知识块空位）；同名 .json 是文档结构，核对用。
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { figuresView, planFiguresOf, planHazardsOf, planScopeOf, riskView, scopeView, type WorkupData } from '@genyun/shared';
import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import { feiyuSnapshot } from '@genyun/shared/fixtures/feiyu-profile';
import { FakeSlotDrafter, defaultDrafter } from '../generation/ai/drafter.ts';
import { generateDocuments } from '../generation/documents.ts';
import { renderWord } from '../generation/word/render.ts';

const dir = resolve(import.meta.dirname, '../../../../out');
mkdirSync(dir, { recursive: true });
// 配了 AI_DRAFTER（如 apps/api/.env 里的百炼密钥）就用它，否则用模拟
const drafter = defaultDrafter() ?? new FakeSlotDrafter();
console.log(`AI 起草：${drafter.name}`);
// 适用范围、危险源、图件按专业整理的结果出（与第 10 项生成同一接法），专家没动过的按系统建议
// 跌落、淹溺系统不再默认打开，飞宇专家成稿两份方案都有：按专家在适用范围里确认打开
const confirmed = { by: 'sample', byName: '样例专家', at: '2026-04-11T00:00:00.000Z', value: true };
const workup: WorkupData = { overrides: {}, scope: { switches: { fallRisk: confirmed, waterHazard: confirmed } } };
const input = {
  ...feiyuPlanInput,
  expert: {
    ...feiyuPlanInput.expert,
    scope: planScopeOf(scopeView(feiyuSnapshot, workup)),
    hazards: planHazardsOf(riskView(feiyuSnapshot, workup)),
    figures: planFiguresOf(figuresView(feiyuSnapshot, workup)),
  },
};
const docs = await generateDocuments(input, { drafter });
const names = { plan: '应急预案', risk: '风险评估报告', resource: '应急资源调查报告' } as const;
for (const key of ['plan', 'risk', 'resource'] as const) {
  const base = resolve(dir, `样例-飞宇${names[key]}`);
  writeFileSync(`${base}.docx`, await renderWord(docs[key]));
  writeFileSync(`${base}.json`, JSON.stringify(docs[key], (k, v) => (k === 'png' ? `<${v.length} bytes>` : v), 2));
  console.log(`${base}.docx`);
}
for (const n of docs.notes) console.log(`${n.plan} · ${n.label}：${n.source === 'ai' ? 'AI' : '系统'}（${n.note}）`);
