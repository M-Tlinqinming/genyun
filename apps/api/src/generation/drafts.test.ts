import { DRAFT_KIND_KEYS, planInputOf } from '@genyun/shared';
import { feiyuSnapshot } from '@genyun/shared/fixtures/feiyu-profile';
import { describe, expect, it } from 'vitest';
import { generateDocument } from './documents.ts';
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
