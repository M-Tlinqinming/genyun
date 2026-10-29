import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import { describe, expect, it } from 'vitest';
import { generateDocuments } from '../documents.ts';
import { convertToPdf } from './pdf.ts';
import { renderWord } from './render.ts';

// 需要本机装了 LibreOffice（SOFFICE_PATH 指向 soffice）；没装时跳过
describe.skipIf(!process.env.SOFFICE_PATH)('Word 转 PDF', () => {
  it('飞宇应急预案转成 PDF，页数与 Word 相当（Word 里 130 页）', async () => {
    const docs = await generateDocuments(feiyuPlanInput);
    const pdf = await convertToPdf(await renderWord(docs.plan));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
    expect(pages).toBeGreaterThan(120);
    expect(pages).toBeLessThan(140);
  }, 180_000);
});
