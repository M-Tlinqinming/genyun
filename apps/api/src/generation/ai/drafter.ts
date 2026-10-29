// AI 起草：只改写限定的句子——知识块里留出的空位（如「压铸机合模抽芯、钻孔攻牙机」这类危险机械名称）。
// 安全要点句、模板其余正文、表格数据都由系统确定性生成，AI 碰不到。
// AI 写出的内容只能由系统从设备物料推出的候选组成（可挑选、排序），多出任何别的字就不用，回到系统推出的内容；
// 服务出错、没配置时同样回到系统推出的内容，所以有没有 AI 都能出完整的稿子。
// 正式服务计划接阿里云百炼（TECH-PLAN 4.1），有密钥后新写一个实现，在 defaultDrafter 里按环境变量选用。

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

// 没配置时为 null：空位用系统推出的内容
export function defaultDrafter(): SlotDrafter | null {
  const kind = process.env.AI_DRAFTER;
  if (!kind) return null;
  if (kind === 'fake') {
    if (process.env.NODE_ENV === 'production') throw new Error('正式环境不能使用模拟的 AI 起草');
    return new FakeSlotDrafter();
  }
  throw new Error(`未知的 AI 起草服务 AI_DRAFTER=${kind}`);
}
