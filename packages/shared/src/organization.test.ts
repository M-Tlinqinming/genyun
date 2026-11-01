import { describe, expect, it } from 'vitest';
import { openingGaps, operatorTaskStage, orgOpenSchema, orgRegisterSchema, orgServiceState, serviceScopeLabel } from './organization.ts';

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

const reg = {
  name: ' 华东安评 ',
  region: '上海市闵行区',
  socialCreditCode: '91310112ma1xxxxxx3',
  contactName: '孙经理',
  contactPhone: '136 2254 1234',
  contactEmail: 'Sun@Huadong-Anping.CN',
};

describe('登记客户组织', () => {
  it('名称、地区、统一社会信用代码、主联系人、手机号、邮箱都必填；备注空着存为空', () => {
    const r = orgRegisterSchema.parse({ ...reg, note: '' });
    expect(r).toMatchObject({ name: '华东安评', note: null });
    for (const field of ['name', 'region', 'socialCreditCode', 'contactName', 'contactPhone', 'contactEmail'] as const) {
      expect(orgRegisterSchema.safeParse({ ...reg, [field]: '' }).success, field).toBe(false);
    }
    expect(orgRegisterSchema.safeParse({ ...reg, socialCreditCode: undefined }).error?.issues[0]?.message).toBe('请填写统一社会信用代码');
    expect(orgRegisterSchema.safeParse({ ...reg, contactEmail: undefined }).error?.issues[0]?.message).toBe('请填写邮箱');
  });

  it('信用代码转大写并校验 18 位，邮箱转小写', () => {
    const r = orgRegisterSchema.parse(reg);
    expect(r.socialCreditCode).toBe('91310112MA1XXXXXX3');
    expect(r.contactEmail).toBe('sun@huadong-anping.cn');
    expect(orgRegisterSchema.safeParse({ ...reg, socialCreditCode: '123' }).success).toBe(false);
  });

  it('手机号至少 7 位数字', () => {
    expect(orgRegisterSchema.safeParse({ ...reg, contactPhone: '123 456' }).error?.issues[0]?.message).toBe('手机号至少 7 位数字');
    expect(orgRegisterSchema.safeParse({ ...reg, contactPhone: '0752-520083' }).success).toBe(true);
  });
});

describe('合同有效期', () => {
  it('不存在的日期（如 2 月 30 日）说明怎么改', () => {
    const r = orgOpenSchema.safeParse({ ...complete, startsAt: '2026-02-30' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('日期不存在，请按 年-月-日 重新选择');
  });

  it('到期日早于今天时拦下', () => {
    const r = orgOpenSchema.safeParse({ ...complete, startsAt: '2020-01-01', endsAt: '2020-12-31' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('合同有效期已过，请核对');
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

describe('运营看到的任务进展', () => {
  it('资料准备、待分配、耕云编制、已交付', () => {
    expect(operatorTaskStage({ status: 'preparing', assignedExpertId: null, closedAt: null })).toBe('preparing');
    expect(operatorTaskStage({ status: 'submitted', assignedExpertId: null, closedAt: null })).toBe('unassigned');
    expect(operatorTaskStage({ status: 'submitted', assignedExpertId: 'u', closedAt: null })).toBe('drafting');
    expect(operatorTaskStage({ status: 'submitted', assignedExpertId: 'u', closedAt: '2026-10-01' })).toBe('delivered');
  });
});
