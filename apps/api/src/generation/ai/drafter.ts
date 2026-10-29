// AI 起草：只改写限定的句子——知识块里留出的空位（如「压铸机合模抽芯、钻孔攻牙机」这类危险机械名称）。
// 安全要点句、模板其余正文、表格数据都由系统确定性生成，AI 碰不到。
// AI 写出的内容只能由系统从设备物料推出的候选组成（可挑选、排序），多出任何别的字就不用，回到系统推出的内容；
// 服务出错、没配置时同样回到系统推出的内容，所以有没有 AI 都能出完整的稿子。
// 正式服务用阿里云百炼（TECH-PLAN 4.1）：AI_DRAFTER=bailian + DASHSCOPE_API_KEY，模型由 AI_MODEL 选（默认 qwen-plus）。

import { SLOT_SYSTEM, slotUserPrompt } from './prompts.ts';

export interface SlotRequest {
  /** 预案名称，如「机械致害事故现场处置方案」 */
  plan: string;
  slot: string;
  /** 这个空位的填写要求（来自知识块） */
  contract: string;
  /** 允许使用的候选 */
  candidates: string[];
  /** 不得与之抵触的安全要点句 */
  anchors: string[];
}

export interface SlotDrafter {
  readonly name: string;
  /** 返回填进空位的一句；服务出错时抛异常 */
  fill(req: SlotRequest): Promise<string>;
}

/**
 * 开发与自动测试用的模拟起草：按候选原样用「、」连起来。
 * 只在明确设置 AI_DRAFTER=fake 时启用，正式环境拒绝启用。
 */
export class FakeSlotDrafter implements SlotDrafter {
  readonly name = 'fake';
  async fill(req: SlotRequest): Promise<string> {
    return req.candidates.join('、');
  }
}

const BAILIAN_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * 阿里云百炼（OpenAI 兼容接口）。密钥只从服务器配置读取，不进代码与日志。
 * 发送的只有预案名称、空位要求、候选词和安全要点句，不含企业名称、人员姓名与电话。
 */
export class BailianDrafter implements SlotDrafter {
  readonly name: string;
  constructor(
    private readonly apiKey: string,
    readonly model = 'qwen-plus',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `bailian:${model}`;
  }

  async fill(req: SlotRequest): Promise<string> {
    const res = await this.fetchImpl(BAILIAN_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SLOT_SYSTEM },
          { role: 'user', content: slotUserPrompt(req) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`百炼返回 ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('百炼没有返回内容');
    return text.replace(/^["“「]|["”」。]$/g, '');
  }
}

// 没配置时为 null：空位用系统推出的内容
export function defaultDrafter(): SlotDrafter | null {
  const kind = process.env.AI_DRAFTER;
  if (!kind) return null;
  if (kind === 'fake') {
    if (process.env.NODE_ENV === 'production') throw new Error('正式环境不能使用模拟的 AI 起草');
    return new FakeSlotDrafter();
  }
  if (kind === 'bailian') {
    const key = process.env.DASHSCOPE_API_KEY?.trim();
    if (!key) throw new Error('AI_DRAFTER=bailian 需要配置 DASHSCOPE_API_KEY');
    return new BailianDrafter(key, process.env.AI_MODEL?.trim() || 'qwen-plus');
  }
  throw new Error(`未知的 AI 起草服务 AI_DRAFTER=${kind}`);
}
