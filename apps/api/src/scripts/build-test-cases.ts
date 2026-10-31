// 用测试集各家企业生成三份交付文档：npm run sample:cases -w @genyun/api [-- 短名…]，输出到仓库根目录 out/测试集/
// 与 sample:plan 同一接法：适用范围、危险源、图件按专业整理的规则出，专家没给的按系统建议。
// 测试集含客户真实资料，不进 git（Martin 10-30 定）：放在仓库根目录 testset/（index.ts 导出 TEST_CASES），
// 或用环境变量 GENYUN_TESTSET 指到别的目录。每家的格式见 packages/shared/src/fixtures/test-case.ts。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { figuresView, planFiguresOf, planHazardsOf, planScopeOf, riskView, scopeView, type WorkupData } from '@genyun/shared';
import { casePlanInput, caseSnapshot, type TestCase } from '@genyun/shared/fixtures/test-case';
import { FakeSlotDrafter, defaultDrafter } from '../generation/ai/drafter.ts';
import { generateDocuments } from '../generation/documents.ts';
import { renderWord } from '../generation/word/render.ts';

const testset = resolve(process.env.GENYUN_TESTSET ?? resolve(import.meta.dirname, '../../../../testset'), 'index.ts');
if (!existsSync(testset)) {
  console.error(`没有找到测试集：${testset}。测试集不进 git，请把本机保存的 testset 目录放到仓库根目录，或设 GENYUN_TESTSET。`);
  process.exit(1);
}
const { TEST_CASES } = (await import(pathToFileURL(testset).href)) as { TEST_CASES: TestCase[] };
const dir = resolve(import.meta.dirname, '../../../../out/测试集');
mkdirSync(dir, { recursive: true });
const drafter = defaultDrafter() ?? new FakeSlotDrafter();
console.log(`AI 起草：${drafter.name}`);
const only = process.argv.slice(2);
const names = { plan: '应急预案', risk: '风险评估报告', resource: '应急资源调查报告' } as const;

for (const c of TEST_CASES.filter((c) => !only.length || only.includes(c.slug))) {
  const snapshot = caseSnapshot(c);
  const workup: WorkupData = { overrides: {} };
  const base = casePlanInput(c);
  // 专家成稿列了的危险源当作专家在危险源辨识里手动新增：适用范围按它建议打开对应方案（待确认的按建议算）
  const stamp = { by: 'testset', byName: '测试集专家', at: '2026-10-31T00:00:00.000Z' };
  const added = Object.fromEntries((base.expert.hazards ?? []).map((h, i) => [`x${i}`, { ...stamp, value: { factor: h.factor, workplace: h.workplace } }]));
  const input = {
    ...base,
    expert: {
      ...base.expert,
      scope: { ...planScopeOf(scopeView(snapshot, { ...workup, risks: { rows: added } })), ...base.expert.scope },
      hazards: base.expert.hazards ?? planHazardsOf(riskView(snapshot, workup)),
      figures: planFiguresOf(figuresView(snapshot, workup)),
    },
  };
  const docs = await generateDocuments(input, { drafter });
  for (const key of ['plan', 'risk', 'resource'] as const) {
    const file = resolve(dir, `${c.slug}-${names[key]}`);
    writeFileSync(`${file}.docx`, await renderWord(docs[key]));
    writeFileSync(`${file}.json`, JSON.stringify(docs[key], (k, v) => (k === 'png' ? `<${v.length} bytes>` : v), 2));
  }
  console.log(`${c.basic.companyName}（${c.slug}）：适用范围 ${Object.values(input.expert.scope).filter(Boolean).length} 项，危险源 ${input.expert.hazards.length} 项`);
}
