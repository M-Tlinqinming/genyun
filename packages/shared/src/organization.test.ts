import { describe, expect, it } from 'vitest';
import { openingGaps, orgOpenSchema, orgRegisterSchema, orgServiceState, regionHasLocalAgencies, serviceScopeLabel } from './organization.ts';

const FILE = '11111111-1111-4111-8111-111111111111';
const complete = {
  contractNumber: 'GY-HT-2026-018',
  scopeKind: 'annual' as const,
  scopeEnterprises: 5,
  startsAt: '2026-11-01',
  endsAt: '2027-10-31',
  contractFileId: FILE,
  paymentReceived: true as const,
  adminName: '孙经理',
  adminPhone: '136 2254 1234',
  adminEmail: 'Sun@Huadong-Anping.cn',
};

describe('登记客户组织', () => {
  it('必填名称、地区、主联系人与手机号；选填项空着存为空', () => {
    const r = orgRegisterSchema.parse({ name: ' 华东安评 ', region: '上海市闵行区', contactName: '孙经理', contactPhone: '13622541234', contactEmail: '' });
    expect(r).toMatchObject({ name: '华东安评', socialCreditCode: null, contactEmail: null, note: null });
    expect(orgRegisterSchema.safeParse({ name: '华东安评', region: '', contactName: '孙', contactPhone: '1' }).success).toBe(false);
  });

  it('信用代码转大写并校验 18 位，邮箱转小写', () => {
    const r = orgRegisterSchema.parse({
      name: 'x',
      region: 'y',
      contactName: 'z',
      contactPhone: '1',
      socialCreditCode: '91310112ma1xxxxxx3',
      contactEmail: 'A@B.CN',
    });
    expect(r.socialCreditCode).toBe('91310112MA1XXXXXX3');
    expect(r.contactEmail).toBe('a@b.cn');
    expect(orgRegisterSchema.safeParse({ name: 'x', region: 'y', contactName: 'z', contactPhone: '1', socialCreditCode: '123' }).success).toBe(false);
  });
});

describe('开通前检查', () => {
  it('填齐后没有缺项', () => {
    expect(openingGaps(complete)).toEqual([]);
  });

  it('合同原件没传、没确认到账都不能开通', () => {
    expect(openingGaps({ ...complete, contractFileId: null })).toEqual(['已签合同原件']);
    expect(openingGaps({ ...complete, paymentReceived: false })).toEqual(['合同款已到账']);
  });

  it('什么都没填时按弹窗先后列出全部缺项', () => {
    expect(openingGaps({})).toEqual([
      '合同编号',
      '服务范围',
      '已签合同原件',
      '合同款已到账',
      '合同有效期',
      '首位管理员姓名',
      '首位管理员手机号',
      '首位管理员邮箱',
    ]);
  });

  it('年度服务要写几家企业，编制 1 家不用', () => {
    expect(openingGaps({ ...complete, scopeEnterprises: null })).toEqual(['服务范围']);
    expect(openingGaps({ ...complete, scopeKind: 'single', scopeEnterprises: null })).toEqual([]);
  });
});

describe('开通请求校验', () => {
  it('邮箱转小写；编制 1 家时不存企业数', () => {
    const r = orgOpenSchema.parse({ ...complete, scopeKind: 'single' });
    expect(r.adminEmail).toBe('sun@huadong-anping.cn');
    expect(r.scopeEnterprises).toBeNull();
  });

  it('到期日早于开始日、未确认到账都不通过', () => {
    expect(orgOpenSchema.safeParse({ ...complete, endsAt: '2026-10-01' }).success).toBe(false);
    expect(orgOpenSchema.safeParse({ ...complete, paymentReceived: false }).success).toBe(false);
  });
});

describe('组织状态', () => {
  const contract = { contractStartsAt: '2026-11-01', contractEndsAt: '2027-10-31' };
  it('没开通是待开通，开通后按合同有效期算服务中 / 已到期', () => {
    expect(orgServiceState({ ...contract, activatedAt: null }, '2026-11-02')).toBe('pending');
    expect(orgServiceState({ ...contract, activatedAt: '2026-10-30T02:00:00Z' }, '2026-10-31')).toBe('active');
    expect(orgServiceState({ ...contract, activatedAt: '2026-10-30T02:00:00Z' }, '2027-10-31')).toBe('active');
    expect(orgServiceState({ ...contract, activatedAt: '2026-10-30T02:00:00Z' }, '2027-11-01')).toBe('expired');
  });

  it('服务范围文字', () => {
    expect(serviceScopeLabel('single', null)).toBe('编制 1 家企业');
    expect(serviceScopeLabel('annual', 5)).toBe('年度服务 · 5 家企业');
  });
});

describe('属地机构是否齐备', () => {
  it('知识库目前只有惠州的属地机构，其他地区开通时提醒补齐', () => {
    expect(regionHasLocalAgencies('广东省惠州市惠阳区')).toBe(true);
    expect(regionHasLocalAgencies('上海市闵行区')).toBe(false);
    expect(regionHasLocalAgencies(null)).toBe(false);
  });
});
