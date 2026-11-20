import type { OrganizationStep } from '@genyun/shared';
import { describe, expect, it } from 'vitest';
import { phoneError, stepErrors } from './people';

describe('指挥部和小组成员的手机号', () => {
  it('空着不报错；11 位、1 开头才对，空格和连字符不算', () => {
    expect(phoneError(undefined)).toBeUndefined();
    expect(phoneError('  ')).toBeUndefined();
    expect(phoneError('13800000001')).toBeUndefined();
    expect(phoneError('138-0000-0001')).toBeUndefined();
  });

  it('不是 1 开头（如座机）：「手机号要以 1 开头」', () => {
    expect(phoneError('07523324567')).toBe('手机号要以 1 开头');
    expect(phoneError('0752-3324567')).toBe('手机号要以 1 开头');
  });

  it('位数不对说差几位；有字母说只能填数字', () => {
    expect(phoneError('1380000000')).toBe('手机号是 11 位，少了 1 位');
    expect(phoneError('138000000012')).toBe('手机号是 11 位，多了 1 位');
    expect(phoneError('1380000000a')).toBe('手机号只能填数字');
  });

  it('客户原来填的座机：打开这一步就算出错（页面一打开就标红）', () => {
    const step: OrganizationStep = {
      mode: 'form',
      commander: { id: 'c', name: '李文聪', phone: '0752-3324567' },
      deputies: [],
      groups: [{ id: 'g', kind: 'rescue', name: '抢险救灾组', leader: { id: 'l', name: '刘海涛', phone: '13800000010' }, members: [] }],
      compilationExtras: [],
    };
    const errors = stepErrors(step);
    expect([...errors.values()]).toEqual(['手机号要以 1 开头']);
    expect([...errors.keys()][0]).toMatch(/:phone$/);
  });
});
