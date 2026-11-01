import { describe, expect, it } from 'vitest';
import { retryStep } from './saveRetry';

describe('保存失败后重试', () => {
  it('上一次没存上、内容没改：同一个 saveId 重发', () => {
    expect(retryStep({ saved: false }, false, 2)).toEqual({ kind: 'resend' });
  });
  it('上一次没存上、之后又改了：换新的 saveId，基准不变', () => {
    expect(retryStep({ saved: false }, true, 2)).toEqual({ kind: 'saveNew', baseRev: 2 });
  });
  it('上一次其实存上了、内容没改：按已保存处理', () => {
    expect(retryStep({ saved: true, rev: 3 }, false, 2)).toEqual({ kind: 'done' });
  });
  it('上一次存上了、之后又改了：以存上的那次为基准换新的 saveId 再存，新打的字不会被当成已保存', () => {
    expect(retryStep({ saved: true, rev: 3 }, true, 2)).toEqual({ kind: 'saveNew', baseRev: 3 });
  });
});
