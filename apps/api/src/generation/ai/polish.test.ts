import { describe, expect, it } from 'vitest';
import type { ParagraphPolisher, PolishRequest } from './drafter.ts';
import { polishParagraph } from './polish.ts';

const context = {
  plan: '应急预案',
  section: '1.2 应急通讯录',
  companyName: '惠阳飞宇电器有限公司',
  people: ['陈志刚', '李某'],
  facts: { sites: ['压铸车间'], processes: ['压铸'], equipment: ['压铸机'], materials: ['铝锭'] },
};

function drafter(answer: (req: PolishRequest) => string | Promise<string>): ParagraphPolisher & { seen: PolishRequest[] } {
  const seen: PolishRequest[] = [];
  return {
    seen,
    polish: async (req) => {
      seen.push(req);
      return answer(req);
    },
  };
}

describe('帮我改写这段', () => {
  it('不发企业名称、人名、电话；改写后还原', async () => {
    const d = drafter((req) => req.text.replace('负责', '主要负责'));
    const text = '惠阳飞宇电器有限公司应急办公室由陈志刚负责，电话 13800000001，发生事故时立即上报。';
    const out = await polishParagraph(d, context, text);
    expect(d.seen[0]!.text).not.toMatch(/飞宇|陈志刚|13800000001/);
    expect(out).toEqual({
      source: 'ai',
      text: '惠阳飞宇电器有限公司应急办公室由陈志刚主要负责，电话 13800000001，发生事故时立即上报。',
      note: expect.stringContaining('已核对'),
    });
  });

  it('AI 写的通不过检查：用原文并说明原因', async () => {
    const text = '压铸车间发生火灾时，现场人员立即切断压铸机电源并报告。';
    const invent = await polishParagraph(drafter(() => '压铸车间发生火灾时，现场人员立即切断叉车电源并报告。'), context, text);
    expect(invent).toMatchObject({ source: 'system', text });
    expect(invent.note).toMatch(/叉车/);

    const number = await polishParagraph(drafter(() => '压铸车间发生火灾时，3 分钟内切断压铸机电源并报告。'), context, text);
    expect(number.note).toMatch(/数字/);

    const dropped = await polishParagraph(
      drafter(() => '应急办公室负责，发生事故时立即上报，并做好记录工作。'),
      context,
      '应急办公室由陈志刚负责，发生事故时立即上报。',
    );
    expect(dropped).toMatchObject({ source: 'system' });
    expect(dropped.note).toMatch(/人名|电话/);
  });

  it('服务出错或没开启：用原文', async () => {
    const text = '压铸车间发生火灾时，现场人员立即报告。';
    const failed = await polishParagraph(drafter(() => Promise.reject(new Error('超时'))), context, text);
    expect(failed).toMatchObject({ source: 'system', text });
    expect(failed.note).toMatch(/AI 服务出错/);
    expect(await polishParagraph(null, context, text)).toMatchObject({ source: 'system', text, note: expect.stringMatching(/没有开启/) });
  });

  it('AI 认为不用改', async () => {
    const text = '压铸车间发生火灾时，现场人员立即报告。';
    expect(await polishParagraph(drafter((r) => r.text), context, text)).toMatchObject({ source: 'system', text });
  });
});
