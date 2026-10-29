import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import {
  factDefOf,
  factSaveError,
  formatFact,
  nextMissing,
  workupFacts,
  workupProgress,
  type FactOverride,
  type WorkupSnapshot,
} from './workup.ts';

const none = { overrides: {} };
const byExpert = (value: FactOverride['value'], source: FactOverride['source'] = 'expert'): FactOverride => ({
  value,
  source,
  by: 'u-zhou',
  byName: '周工',
  at: '2026-10-29T08:00:00.000Z',
});
const fact = (snapshot: WorkupSnapshot, key: string, data = none) => workupFacts(snapshot, data).find((f) => f.key === key)!;

// 上传已有资料的路线：企业资料里只有名称
const uploadOnly: WorkupSnapshot = {
  identity: { name: '示例五金制品有限公司', socialCreditCode: null, legalRepresentative: null, registeredAddress: null },
  profile: {},
};

describe('企业事实的来源标签', () => {
  it('执照识别带出的是客户原件，按规则带出的是系统推导，自己填的是客户确认', () => {
    expect(fact(feiyuSnapshot, 'socialCreditCode')).toMatchObject({ source: 'original', sourceNote: '营业执照', status: 'done' });
    expect(fact(feiyuSnapshot, 'contactPerson')).toMatchObject({ source: 'system', sourceNote: '当前账号' });
    expect(fact(feiyuSnapshot, 'employeeCount')).toMatchObject({ source: 'customer', value: 86 });
    expect(fact(feiyuSnapshot, 'industry').value).toBe('电气机械和器材制造业');
  });

  it('属地机构按地址从知识库带出；没收录的地区留空让专家填', () => {
    expect(fact(feiyuSnapshot, 'agency.emergencyBureau')).toMatchObject({ source: 'system', sourceNote: '知识库' });
    expect(String(fact(feiyuSnapshot, 'agency.emergencyBureau').value)).toContain('仲恺');
    const elsewhere = { ...uploadOnly, identity: { ...uploadOnly.identity, registeredAddress: '佛山市顺德区勒流街道' } };
    expect(fact(elsewhere, 'agency.emergencyBureau')).toMatchObject({ status: 'empty' });
    expect(fact(elsewhere, 'agency.emergencyBureau').hint).toContain('知识库还没有收录');
  });

  it('总建筑面积由建筑表合计，编制小组按分工模板生成，都不能在这里改', () => {
    expect(fact(feiyuSnapshot, 'totalFloorArea').value).toBe('2400 m²（1 栋合计）');
    expect(fact(feiyuSnapshot, 'compilation.leader').value).toBe('李文聪 · 计划、评审、签署颁布');
    expect(factSaveError(factDefOf(feiyuSnapshot, 'compilation.leader'), '张三')).toContain('由系统按规则生成');
  });
});

describe('专家整理', () => {
  it('直接填写后标为专家整理，记下对照的原件；撤回后回到客户的值', () => {
    const data = { overrides: { technicalManagementCount: { ...byExpert(6), fileId: 'f-roster' } } };
    expect(fact(uploadOnly, 'technicalManagementCount')).toMatchObject({ status: 'missing' });
    expect(fact(uploadOnly, 'technicalManagementCount', data)).toMatchObject({ status: 'done', source: 'expert', value: 6, fileId: 'f-roster' });
    expect(fact(feiyuSnapshot, 'employeeCount', { overrides: { employeeCount: byExpert(90) } }).source).toBe('expert');
    expect(fact(feiyuSnapshot, 'employeeCount').value).toBe(86);
  });

  it('电话问过客户的标为客户确认', () => {
    const data = { overrides: { dutyPhone: byExpert('0752-1234567', 'customer') } };
    expect(fact(uploadOnly, 'dutyPhone', data)).toMatchObject({ source: 'customer', sourceNote: '电话确认', status: 'done' });
  });

  it('值的类型要和这一项对得上', () => {
    expect(factSaveError(factDefOf(feiyuSnapshot, 'commander'), '李文聪')).toBe('请填写姓名、职位和电话');
    expect(factSaveError(factDefOf(feiyuSnapshot, 'employeeCount'), '八十六')).toBe('请填写人数');
    expect(factSaveError(factDefOf(feiyuSnapshot, 'commander'), { name: '李文聪', phone: '13800000001' })).toBeNull();
    expect(factSaveError(factDefOf(feiyuSnapshot, 'nope'), 'x')).toBe('没有这一项');
  });

  it('人员显示为姓名 · 职位 · 电话', () => {
    expect(formatFact({ name: '李文聪', position: '总经理', phone: '13800000001' }, 'person')).toBe('李文聪 · 总经理 · 13800000001');
    expect(formatFact(86, 'count')).toBe('86 人');
  });
});

describe('必需项进度与下一个缺失项', () => {
  it('飞宇自填齐全：必需项全部完成', () => {
    const p = workupProgress(workupFacts(feiyuSnapshot, none));
    expect(p.done).toBe(p.required);
    expect(p.missing).toEqual([]);
  });

  it('上传路线：缺的必需项按小节统计，补一项少一项', () => {
    const facts = workupFacts(uploadOnly, none);
    const p = workupProgress(facts);
    expect(p.required).toBe(11);
    expect(p.done).toBe(1);
    expect(p.sections.find((s) => s.section === 'organization')?.missing).toBe(2);
    const after = workupProgress(workupFacts(uploadOnly, { overrides: { dutyPhone: byExpert('0752-1234567') } }));
    expect(after.done).toBe(2);
  });

  it('客户点了稍后补的项显示稍后补，仍算没完成', () => {
    const later: WorkupSnapshot = {
      ...uploadOnly,
      profile: { basicStep: { basic: {}, later: ['technicalManagementCount'], sources: {} } },
    };
    expect(fact(later, 'technicalManagementCount').status).toBe('later');
    expect(workupProgress(workupFacts(later, none)).missing.map((f) => f.key)).toContain('technicalManagementCount');
  });

  it('从当前项往后找，到底了从头找', () => {
    const facts = workupFacts(uploadOnly, none);
    expect(nextMissing(facts)?.key).toBe('socialCreditCode');
    expect(nextMissing(facts, 'socialCreditCode')?.key).toBe('legalRepresentative');
    expect(nextMissing(facts, 'dutyPhone')?.key).toBe('socialCreditCode');
    expect(nextMissing(workupFacts(feiyuSnapshot, none))).toBeUndefined();
  });
});
