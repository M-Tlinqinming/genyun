// 用飞宇样例生成一整份应急预案：npm run sample:plan -w @genyun/api，输出到仓库根目录 out/
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import { buildPlan } from '../generation/plan/assemble.ts';
import { renderWord } from '../generation/word/render.ts';

const dir = resolve(import.meta.dirname, '../../../../out');
mkdirSync(dir, { recursive: true });
const plan = buildPlan(feiyuPlanInput);
const file = resolve(dir, '样例-飞宇应急预案.docx');
writeFileSync(file, await renderWord(plan));
writeFileSync(resolve(dir, '样例-飞宇应急预案.json'), JSON.stringify(plan, (k, v) => (k === 'png' ? `<${v.length} bytes>` : v), 2));
console.log(file);
