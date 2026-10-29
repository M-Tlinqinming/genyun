// AI 起草：只改写限定的句子——知识块里留出的空位（如「压铸机合模抽芯、钻孔攻牙机」这类危险机械名称），
// 以及现场处置方案「事故风险描述」各段（按企业的场所、设备、物料改写，见 risk.ts）。
// 安全要点句、模板其余正文、表格数据都由系统确定性生成，AI 碰不到。
// AI 写出的内容只能由系统从设备物料推出的候选组成（可挑选、排序），多出任何别的字就不用，回到系统推出的内容；
// 服务出错、没配置时同样回到系统推出的内容，所以有没有 AI 都能出完整的稿子。
// 正式服务用阿里云百炼（TECH-PLAN 4.1）：AI_DRAFTER=bailian + DASHSCOPE_API_KEY，模型由 AI_MODEL 选（默认 qwen3.8-flash，Martin 10-29 定），非北京地域用 AI_BASE_URL。

import { RISK_SYSTEM, SLOT_SYSTEM, riskUserPrompt, slotUserPrompt } from './prompts.ts';

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

export interface RiskRequest {
  plan: string;
  /** 系统原文，一段一项 */
  paragraphs: string[];
  /** 企业实际的场所、工序、设备、物料名称（不含企业名称、人员、电话） */
  facts: { sites: string[]; processes: string[]; equipment: string[]; materials: string[] };
}

export interface SlotDrafter {
  readonly name: string;
  /** 返回填进空位的一句；服务出错时抛异常 */
  fill(req: SlotRequest): Promise<string>;
  /** 返回逐段改写的风险描述（与原文段数相同）；服务出错时抛异常 */
  rewrite(req: RiskRequest): Promise<string[]>;
}

/**
 * 开发与自动测试用的模拟起草：按候选原样用「、」连起来，风险描述原样返回。
 * 只在明确设置 AI_DRAFTER=fake 时启用，正式环境拒绝启用。
 */
export class FakeSlotDrafter implements SlotDrafter {
  readonly name = 'fake';
  async fill(req: SlotRequest): Promise<string> {
    return req.candidates.join('、');
  }
  async rewrite(req: RiskRequest): Promise<string[]> {
    return req.paragraphs;
  }
}

// 华北2（北京）的接入地址；密钥按地域开，不能跨地域混用，其他地域用 AI_BASE_URL 指定
export const BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_MODEL = 'qwen3.8-flash';

/**
 * 阿里云百炼（OpenAI 兼容接口）。密钥只从服务器配置读取，不进代码与日志。
 * 发送的只有预案名称、空位要求、候选词和安全要点句，不含企业名称、人员姓名与电话。
 */
export class BailianDrafter implements SlotDrafter {
  readonly name: string;
  constructor(
    private readonly apiKey: string,
    readonly model = DEFAULT_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = BAILIAN_BASE_URL,
  ) {
    this.name = `bailian:${model}`;
  }

  async fill(req: SlotRequest): Promise<string> {
    const text = await this.chat(SLOT_SYSTEM, slotUserPrompt(req));
    return text.replace(/^["“「]|["”」。]$/g, '');
  }

  async rewrite(req: RiskRequest): Promise<string[]> {
    const text = await this.chat(RISK_SYSTEM, riskUserPrompt(req));
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  private async chat(system: string, user: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        // 千问 3 系列默认先「思考」再作答，改写几段话用不着，关掉免得超时
        enable_thinking: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      // 百炼的错误说明（如模型不存在、额度不足）带上便于排查；不含密钥
      const detail = await res.text().catch(() => '');
      throw new Error(`百炼返回 ${res.status} ${detail.slice(0, 200)}`.trim());
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('百炼没有返回内容');
    return text;
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
    return new BailianDrafter(key, process.env.AI_MODEL?.trim() || DEFAULT_MODEL, fetch, process.env.AI_BASE_URL?.trim() || BAILIAN_BASE_URL);
  }
  throw new Error(`未知的 AI 起草服务 AI_DRAFTER=${kind}`);
}
