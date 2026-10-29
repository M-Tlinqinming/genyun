// 生成排版验收用的样例 Word：npm run sample:word -w @genyun/api，输出到仓库根目录 out/
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWord } from '../generation/word/render.ts';
import { samplePlan } from '../generation/word/sample.ts';

const dir = resolve(import.meta.dirname, '../../../../out');
mkdirSync(dir, { recursive: true });
const file = resolve(dir, '样例-应急预案排版.docx');
writeFileSync(file, await renderWord(samplePlan()));
console.log(file);
