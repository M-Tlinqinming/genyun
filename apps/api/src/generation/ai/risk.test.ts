import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import { describe, expect, it } from 'vitest';
import { generateDocuments } from '../documents.ts';
import { riskParagraphs } from '../plan/assemble.ts';
import { BailianDrafter, FakeSlotDrafter, type RiskRequest, type SlotDrafter } from './drafter.ts';
import { checkRiskParagraph, draftRisks, riskFacts } from './risk.ts';

const facts = riskFacts(feiyuPlanInput);
const fill = async (r: { candidates: string[] }) => r.candidates.join('、');
/** 把「各」换成「本企业」：贴合企业的改写，应当通过 */
const tailor: SlotDrafter = {
  name: 'tailor',
  fill,
  rewrite: async (r) => r.paragraphs.map((p) => p.replace(/各/, `${facts.sites[0]}等`)),
};
/** 编了企业没有的设备和电话 */
const inventive: SlotDrafter = {
  name: 'inventive',
  fill,
  rewrite: async (r) => r.paragraphs.map((p, i) => (i === 0 ? `${p}车间另有锅炉。` : i === 1 ? `${p}值班电话 13800138000。` : p)),
};

describe('AI 按企业改写事故风险描述', () => {
  it('只改用了通用模板的现场处置方案，用了知识块的不动', () => {
    const plans = riskParagraphs(feiyuPlanInput);
    expect(plans.length).toBeGreaterThan(0);
    // 飞宇的机械致害、灼烫、熔融物等用了按企业写好的知识块
    expect(plans.map((p) => p.id)).not.toContain('SP03');
    expect(plans.every((p) => p.paragraphs.every((x) => !/^\*\*|^#/.test(x)))).toBe(true);
  });

  it('校验：保留开头标签，不编设备、数字、电话、企业名称，篇幅相当', () => {
    const original = '（2）事故区域：各使用电气设备、设施及使用电动工具的岗位，电工作业场所等。';
    const site = facts.sites[0]!;
    expect(checkRiskParagraph(original, `（2）事故区域：${site}使用电气设备、设施及电动工具的岗位，电工作业场所等。`, facts)).toBeNull();
    expect(checkRiskParagraph(original, '事故区域：各岗位。', facts)).toMatch(/开头|篇幅/);
    expect(checkRiskParagraph(original, `（2）事故区域：${site}锅炉房及使用电气设备的岗位，电工作业场所等。`, facts)).toMatch(/锅炉/);
    expect(checkRiskParagraph(original, `（2）事故区域：${site}共 36 个使用电气设备的岗位，电工作业场所等。`, facts)).toMatch(/数字/);
    expect(checkRiskParagraph(original, `（2）事故区域：${site}使用电气设备的岗位，电话 0752-1234567。`, facts)).toMatch(/电话/);
  });

  it('改写通过的段落进到成稿，并记为 AI 写的', async () => {
    const docs = await generateDocuments(feiyuPlanInput, { drafter: tailor });
    const risk = docs.notes.filter((n) => n.slot.startsWith('risk-'));
    expect(risk.some((n) => n.source === 'ai' && n.label.startsWith('事故风险描述（'))).toBe(true);
    expect(JSON.stringify(docs.plan)).toContain(`${facts.sites[0]}等用电场所`);
  }, 60_000);

  it('编造的段落不用，回到系统原文并写明原因；其余段照常', async () => {
    const { rewrites, notes } = await draftRisks(feiyuPlanInput, inventive);
    expect(JSON.stringify(rewrites)).not.toMatch(/锅炉。|13800138000/);
    expect(notes.some((n) => n.source === 'system' && n.note.includes('锅炉'))).toBe(true);
    expect(notes.some((n) => n.source === 'system' && n.note.includes('电话'))).toBe(true);
  });

  it('段数对不上：整个方案用系统原文', async () => {
    const short: SlotDrafter = { name: 'short', fill, rewrite: async (r) => r.paragraphs.slice(1) };
    const { rewrites, notes } = await draftRisks(feiyuPlanInput, short);
    expect(rewrites).toEqual({});
    expect(notes.every((n) => n.source === 'system' && n.note.includes('段数'))).toBe(true);
  });

  it('模拟起草原样返回：不算 AI 改写', async () => {
    const { rewrites, notes } = await draftRisks(feiyuPlanInput, new FakeSlotDrafter());
    expect(rewrites).toEqual({});
    expect(notes.every((n) => n.note.includes('未改动'))).toBe(true);
  });

  it('百炼：只发系统原文和场所、工序、设备、物料名称，逐行取回', async () => {
    let body = '';
    const fake = (async (_url: string, init: RequestInit) => {
      body = init.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: '（1）甲\n\n（2）乙\n' } }] }));
    }) as unknown as typeof fetch;
    const req: RiskRequest = { plan: '触电事故现场处置方案', paragraphs: ['（1）a', '（2）b'], facts };
    expect(await new BailianDrafter('sk-test', 'qwen3.8-flash', fake).rewrite(req)).toEqual(['（1）甲', '（2）乙']);
    expect(body).toContain(facts.sites[0]!);
    expect(body).not.toMatch(/飞宇|李文聪|0752/);
  });
});
