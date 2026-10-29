// 用飞宇样例生成三份交付文档：npm run sample:plan -w @genyun/api，输出到仓库根目录 out/
// AI 起草用模拟实现（只填知识块空位）；同名 .json 是文档结构，核对用。
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import { FakeSlotDrafter, defaultDrafter } from '../generation/ai/drafter.ts';
import { generateDocuments } from '../generation/documents.ts';
import { renderWord } from '../generation/word/render.ts';

const dir = resolve(import.meta.dirname, '../../../../out');
mkdirSync(dir, { recursive: true });
// 配了 AI_DRAFTER（如 apps/api/.env 里的百炼密钥）就用它，否则用模拟
const drafter = defaultDrafter() ?? new FakeSlotDrafter();
console.log(`AI 起草：${drafter.name}`);
const docs = await generateDocuments(feiyuPlanInput, { drafter });
const names = { plan: '应急预案', risk: '风险评估报告', resource: '应急资源调查报告' } as const;
for (const key of ['plan', 'risk', 'resource'] as const) {
  const base = resolve(dir, `样例-飞宇${names[key]}`);
  writeFileSync(`${base}.docx`, await renderWord(docs[key]));
  writeFileSync(`${base}.json`, JSON.stringify(docs[key], (k, v) => (k === 'png' ? `<${v.length} bytes>` : v), 2));
  console.log(`${base}.docx`);
}
for (const n of docs.notes) console.log(`${n.plan} · ${n.label}：${n.source === 'ai' ? 'AI' : '系统'}（${n.note}）`);
