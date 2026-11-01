// 保存失败后重试（E18-07）：先查上一次保存到底有没有记上，再决定怎么存。
// 失败后专家可能又改了内容：这时不能用上一次的 saveId 重发（后台会按「已保存」返回旧内容，新打的字被当成已保存）。

export type RetryStep =
  /** 上一次其实存上了，内容也没再改：按已保存处理 */
  | { kind: 'done' }
  /** 上一次没存上、内容没改：用同一个 saveId 重发 */
  | { kind: 'resend' }
  /** 内容改过了：换新的 saveId 保存；上一次已存上时以它的修订次数为基准 */
  | { kind: 'saveNew'; baseRev: number };

export function retryStep(check: { saved: false } | { saved: true; rev: number }, contentChanged: boolean, baseRev: number): RetryStep {
  if (check.saved) return contentChanged ? { kind: 'saveNew', baseRev: check.rev } : { kind: 'done' };
  return contentChanged ? { kind: 'saveNew', baseRev } : { kind: 'resend' };
}
