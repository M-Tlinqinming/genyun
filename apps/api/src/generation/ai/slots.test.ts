import { feiyuPlanInput } from '@genyun/shared/fixtures/feiyu-plan';
import { afterEach, describe, expect, it } from 'vitest';
import { generateDocuments } from '../documents.ts';
import { BailianDrafter, FakeSlotDrafter, defaultDrafter, type SlotDrafter, type SlotRequest } from './drafter.ts';
import { checkSlot, draftSlots } from './slots.ts';

/** 把候选倒过来排：AI 只换顺序，应当通过 */
const reorder: SlotDrafter = { name: 'reorder', fill: async (r) => [...r.candidates].reverse().join('，'), rewrite: async (r) => r.paragraphs };
/** 自作主张加了企业没有的机型 */
const inventive: SlotDrafter = { name: 'inventive', fill: async (r) => [...r.candidates, '冲床'].join('、'), rewrite: async (r) => r.paragraphs };
const broken: SlotDrafter = {
  name: 'broken',
  fill: async () => {
    throw new Error('超时');
  },
  rewrite: async () => {
    throw new Error('超时');
  },
};

describe('AI 只填知识块空位', () => {
  it('校验：只能用候选里的内容，可换顺序和分隔符', () => {
    expect(checkSlot('CNC 加工中心高速刀具、压铸机合模抽芯', ['压铸机合模抽芯', 'CNC 加工中心高速刀具'])).toBeNull();
    expect(checkSlot('压铸机合模抽芯、冲床', ['压铸机合模抽芯'])).toMatch(/冲床/);
    expect(checkSlot('  ', ['压铸机合模抽芯'])).toMatch(/为空/);
  });

  // 飞宇没有除尘系统，不出粉尘专项，少了它的 2 个空位
  it('模拟起草：飞宇 15 个空位全部由 AI 填写并通过校验', async () => {
    const { filled, notes } = await draftSlots(feiyuPlanInput, new FakeSlotDrafter());
    expect(notes).toHaveLength(15);
    expect(notes.every((n) => n.source === 'ai')).toBe(true);
    expect(filled['SP03']?.['danger-machines']).toBeTruthy();
    expect(notes.find((n) => n.slot === 'danger-machines')?.label).toBe('危险机械');
  });

  it('只换顺序的写法被采用，进到成稿里', async () => {
    const { filled } = await draftSlots(feiyuPlanInput, reorder);
    const docs = await generateDocuments(feiyuPlanInput, { drafter: reorder });
    expect(JSON.stringify(docs.plan)).toContain(filled['SP03']!['danger-machines']!);
  }, 60_000);

  it('写了企业没有的东西：不用，回到系统推出的内容，并写明原因', async () => {
    const docs = await generateDocuments(feiyuPlanInput, { drafter: inventive });
    expect(docs.notes.every((n) => n.source === 'system')).toBe(true);
    expect(docs.notes[0]!.note).toMatch(/候选以外的内容「冲床」/);
    expect(JSON.stringify(docs.plan)).not.toContain('冲床');
    // 安全要点句照样在
    expect(JSON.stringify(docs.plan)).toContain('不可用倒转设备的方法取出肢体');
  }, 60_000);

  it('AI 服务出错：照样出完整稿子', async () => {
    const docs = await generateDocuments(feiyuPlanInput, { drafter: broken });
    expect(docs.notes.every((n) => n.source === 'system' && n.note.includes('超时'))).toBe(true);
    expect(docs.plan.sections).toHaveLength(4);
    expect(docs.risk.sections).toHaveLength(4);
    expect(docs.resource.sections).toHaveLength(3);
  }, 60_000);

  it('没配置 AI：不发请求，三份照常生成', async () => {
    let calls = 0;
    const spy: SlotDrafter = { name: 'spy', fill: async (r: SlotRequest) => (calls++, r.candidates.join('、')), rewrite: async (r) => r.paragraphs };
    const { notes } = await draftSlots(feiyuPlanInput, null);
    expect(notes).toEqual([]);
    expect(calls).toBe(0);
    await draftSlots(feiyuPlanInput, spy);
    expect(calls).toBe(15);
  });
});

describe('阿里云百炼', () => {
  const req: SlotRequest = { plan: '机械致害事故现场处置方案', slot: 'danger-machines', contract: '名词短语', candidates: ['压铸机合模抽芯', '钻孔攻牙机'], anchors: ['不可用倒转设备的方法取出肢体'] };

  it('按 OpenAI 兼容接口调用，只发预案名、要求、候选和安全要点句', async () => {
    let sent: { url: string; body: { model: string; messages: { content: string }[] }; auth: string } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>).authorization! };
      return new Response(JSON.stringify({ choices: [{ message: { content: '「钻孔攻牙机、压铸机合模抽芯」' } }] }));
    }) as unknown as typeof fetch;
    const d = new BailianDrafter('sk-test', 'qwen-plus', fake);
    expect(await d.fill(req)).toBe('钻孔攻牙机、压铸机合模抽芯');
    expect(sent!.url).toContain('dashscope.aliyuncs.com/compatible-mode');
    expect(sent!.auth).toBe('Bearer sk-test');
    expect(sent!.body.model).toBe('qwen-plus');
    const all = sent!.body.messages.map((m) => m.content).join('\n');
    expect(all).toContain('压铸机合模抽芯');
    expect(all).not.toMatch(/飞宇|李文聪|0752/);
  });

  it('服务返回错误时抛出，由上层改用系统内容', async () => {
    const fake = (async () => new Response('busy', { status: 429 })) as unknown as typeof fetch;
    await expect(new BailianDrafter('sk-test', 'qwen-plus', fake).fill(req)).rejects.toThrow(/429/);
  });
});

describe('按环境变量选 AI 起草服务', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('不设为不用 AI；fake 只在非正式环境可用；不认识的报错', () => {
    delete process.env.AI_DRAFTER;
    expect(defaultDrafter()).toBeNull();
    process.env.AI_DRAFTER = 'fake';
    expect(defaultDrafter()?.name).toBe('fake');
    process.env.NODE_ENV = 'production';
    expect(() => defaultDrafter()).toThrow(/正式环境/);
    process.env.AI_DRAFTER = 'gpt';
    expect(() => defaultDrafter()).toThrow(/未知/);
    process.env.AI_DRAFTER = 'bailian';
    delete process.env.DASHSCOPE_API_KEY;
    expect(() => defaultDrafter()).toThrow(/DASHSCOPE_API_KEY/);
    process.env.DASHSCOPE_API_KEY = 'sk-test';
    process.env.AI_MODEL = 'qwen-max';
    expect(defaultDrafter()?.name).toBe('bailian:qwen-max');
  });
});
