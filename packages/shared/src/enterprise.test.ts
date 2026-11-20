import { describe, expect, it } from 'vitest';
import { normalizeEnterpriseName } from './enterprise.ts';

describe('企业名称比较', () => {
  it('首尾和中间的空白（含全角空格）都不算', () => {
    expect(normalizeEnterpriseName(' 惠阳 飞宇\u3000电器有限公司 ')).toBe('惠阳飞宇电器有限公司');
  });

  it('不间断空格也不算', () => {
    expect(normalizeEnterpriseName('惠阳飞宇 电器有限公司')).toBe('惠阳飞宇电器有限公司');
  });

  it('全角括号和半角括号当成一样', () => {
    expect(normalizeEnterpriseName('飞宇（惠州）有限公司')).toBe(normalizeEnterpriseName('飞宇(惠州)有限公司'));
  });

  it('英文字母不分大小写', () => {
    expect(normalizeEnterpriseName('ABC 电子')).toBe(normalizeEnterpriseName('abc电子'));
  });

  it('不同的名字仍然不同', () => {
    expect(normalizeEnterpriseName('飞宇电器')).not.toBe(normalizeEnterpriseName('飞宇电子'));
  });
});
