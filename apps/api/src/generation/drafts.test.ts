import { DRAFT_KIND_KEYS, planInputOf } from '@genyun/shared';
import { feiyuSnapshot } from '@genyun/shared/fixtures/feiyu-profile';
import { describe, expect, it } from 'vitest';
import { FakeSlotDrafter } from './ai/drafter.ts';
import { generateDocument } from './documents.ts';
import { draftSteps } from './drafts.ts';
import { renderWord } from './word/render.ts';

describe('按整理结果拼的输入生成三份草稿', () => {
  const input = planInputOf(feiyuSnapshot, { overrides: {} }, '2026-11-01');

  // 应急预案要画组织体系图、工艺流程图，较慢
  it.each(DRAFT_KIND_KEYS)('%s：能生成 Word，企业名称在文档里', async (kind) => {
    const { document } = await generateDocument(kind, input);
    expect(JSON.stringify(document)).toContain('惠阳飞宇电器有限公司');
    const word = await renderWord(document);
    expect(word.length).toBeGreaterThan(10_000);
  }, 60_000);
});

describe('生成时报进度', () => {
  const input = planInputOf(feiyuSnapshot, { overrides: {} }, '2026-11-01');

  it('应急预案配了 AI：每个模板一步「写」，再写风险描述；报的顺序和排好的步骤一致', async () => {
    const drafter = new FakeSlotDrafter();
    const steps = draftSteps('plan', input, drafter, true);
    expect(steps.slice(-3).map((s) => s.step)).toEqual(['risk', 'layout', 'pdf']);
    const writes = steps.filter((s) => s.step === 'write');
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every((s) => s.title)).toBe(true);
    const seen: string[] = [];
    await generateDocument('plan', input, {
      drafter,
      onProgress: (p) => void seen.push(p.step === 'write' ? `write:${p.index}` : p.step),
    });
    // 没有空位的模板也报
    expect(seen).toEqual([...writes.map((_, i) => `write:${i}`), 'risk']);
  }, 60_000);

  it('另两份、没配 AI 的应急预案：先整理内容，再排版；不转 PDF 就没有那一步', async () => {
    for (const kind of DRAFT_KIND_KEYS) {
      expect(draftSteps(kind, input, null, false).map((s) => s.step)).toEqual(['content', 'layout']);
      const seen: string[] = [];
      await generateDocument(kind, input, { onProgress: (p) => void seen.push(p.step) });
      expect(seen).toEqual(['content']);
    }
    expect(draftSteps('risk', input, new FakeSlotDrafter(), true).map((s) => s.step)).toEqual(['content', 'layout', 'pdf']);
  }, 60_000);
});
