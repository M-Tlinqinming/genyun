import { describe, expect, it } from 'vitest';
import { localAgenciesOf } from './agencies.ts';

describe('属地机构', () => {
  it('地址只写村名时按有出处的归属认镇街', () => {
    const a = localAgenciesOf({ province: '广东省', city: '惠州市', district: '惠阳区', detail: '惠州市惠阳经济开发区拾围村某地段' });
    expect(a.streetOffice).toEqual({ name: '三和街道应急管理办公室', phone: '0752-3502038' });
    expect(a.streetPlan).toBe('三和街道生产安全事故应急预案');
  });
});
