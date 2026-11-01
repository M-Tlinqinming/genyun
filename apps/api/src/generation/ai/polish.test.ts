import { describe, expect, it } from 'vitest';
import type { ParagraphPolisher, PolishRequest } from './drafter.ts';
import { polishParagraph } from './polish.ts';

const context = {
  plan: '应急预案',
  section: '1.2 应急通讯录',
  companyName: '惠阳飞宇电器有限公司',
  shortName: '飞宇电器',
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
      promptVersion: 'polish-v1',
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

  it('电话的各种写法、企业简称都遮掉；小组名称不当人名', async () => {
    const d = drafter((req) => req.text.replace('负责', '主要负责'));
    const text = '飞宇电器通讯联络组由李某负责，手机 138 0000 0001、138-0000-0002，值班电话（0752）3388123、0752-3388124。';
    const out = await polishParagraph(d, context, text);
    expect(d.seen[0]!.text).not.toMatch(/飞宇|李某|0000|3388/);
    expect(d.seen[0]!.text).toContain('通讯联络组');
    expect(out).toMatchObject({ source: 'ai', text: text.replace('负责', '主要负责'), promptVersion: 'polish-v1' });
  });

  it('强制性措辞变少、原文数字丢了都不采用；数字按整串比', async () => {
    const text = '发现火情后必须立即报告，严禁使用电梯，2 分钟内到达集合点。';
    const softened = await polishParagraph(drafter(() => '发现火情后应尽快报告，严禁使用电梯，2 分钟内到达集合点。'), context, text);
    expect(softened).toMatchObject({ source: 'system', text });
    expect(softened.note).toMatch(/少了原文里的「(必须|立即)」/);
    const lost = await polishParagraph(drafter(() => '发现火情后必须立即报告，严禁使用电梯，并尽快到达集合点。'), context, text);
    expect(lost.note).toMatch(/漏了原文里的数字「2」/);
    // 原文有 1 和 2，写成 12 也算新数字
    const merged = await polishParagraph(drafter(() => '第 12 条：发现火情后必须立即报告，严禁使用电梯，2 分钟内到达集合点。'), { ...context }, '第 1 条：' + text);
    expect(merged.note).toMatch(/没有的数字「12」/);
  });

  it('400 / 800 电话也遮掉；原文里的国标编号不算新增的长数字', async () => {
    const d = drafter((req) => req.text.replace('执行', '严格执行'));
    const text = '按 GB/T 29639-2020 执行，客服电话 400-123-4567、800 123 4567、4001234567。';
    const out = await polishParagraph(d, context, text);
    expect(d.seen[0]!.text).not.toMatch(/123|4567/);
    expect(d.seen[0]!.text).toContain('29639-2020');
    expect(out).toMatchObject({ source: 'ai', text: text.replace('执行', '严格执行') });
    const invented = await polishParagraph(drafter(() => '按 GB/T 29639-2020 执行，值班 13912345678 接警。'), context, '按 GB/T 29639-2020 执行，值班人员接警。');
    expect(invented.note).toBe('AI 改写没有通过系统检查（写了原文里没有的电话或长串数字「13912345678」），保留原文');
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
