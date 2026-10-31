import { describe, expect, it } from 'vitest';
import { feiyuSnapshot } from './fixtures/feiyu-profile.ts';
import { feiyuPlanInput } from './fixtures/feiyu-plan.ts';
import { planInputOf } from './workup-plan.ts';
import type { FactOverride, FactValue } from './workup.ts';

const by = { source: 'expert' as const, by: 'u-zhou', byName: '周工', at: '2026-10-31T08:00:00.000Z' };
const override = (value: FactValue): FactOverride => ({ value, ...by });

describe('按整理结果拼生成输入', () => {
  const input = planInputOf(feiyuSnapshot, { overrides: {} }, '2026-11-01');

  it('没改过的：客户资料原样带过去', () => {
    expect(input.issuedOn).toBe('2026-11-01');
    expect(input.basic.companyName).toBe(feiyuPlanInput.basic.companyName);
    expect(input.basic.employeeCount).toBe(feiyuPlanInput.basic.employeeCount);
    expect(input.basic.registeredAddress?.detail).toBe(feiyuPlanInput.basic.registeredAddress?.detail);
    expect(input.location.siteAddress.detail).toBe(feiyuPlanInput.location.siteAddress.detail);
    expect(input.organization.commander?.name).toBe(feiyuPlanInput.organization.commander?.name);
    expect(input.organization.deputies.map((d) => d.name)).toEqual(feiyuPlanInput.organization.deputies.map((d) => d.name));
    expect(input.organization.groups.map((g) => g.leader?.name)).toEqual(feiyuPlanInput.organization.groups.map((g) => g.leader?.name));
    expect(input.organization.compilationTeam).toBeUndefined();
    expect(input.agencies).toEqual(feiyuPlanInput.agencies);
    expect(input.business.sites).toEqual(feiyuPlanInput.business.sites);
    expect(input.production.equipment.map((e) => e.name)).toEqual(feiyuPlanInput.production.equipment.map((e) => e.name));
  });

  it('专家这一块：危险源、适用范围、图件都有；没补充的事实不编造', () => {
    expect(input.expert.hazards?.length).toBeGreaterThan(0);
    expect(input.expert.scope).toBeDefined();
    expect(input.expert.figures).toBeDefined();
    expect(input.expert.facts).toEqual({});
  });

  it('专家改过的事实盖在客户资料上', () => {
    const changed = planInputOf(
      feiyuSnapshot,
      {
        overrides: {
          technicalManagementCount: override(12),
          landArea: override('8000 m²'),
          dutyPhone: override('0752-1234567'),
          commander: override({ name: '张三', position: '董事长', phone: '13900000000' }),
          'group.rescue': override({ name: '李四' }),
          'agency.fireDept': override('仲恺消防救援大队 · 0752-0000119'),
          'agency.rescueAgreement': override('有 · 惠州市第三人民医院'),
          shortName: override('FY'),
          hospital: override('惠州市第三人民医院'),
          trainingDepartment: override('安全管理部'),
        },
      },
      '2026-11-01',
    );
    expect(changed.basic.technicalManagementCount).toBe(12);
    expect(changed.basic.landAreaM2).toBe(8000);
    expect(changed.organization.dutyPhone).toBe('0752-1234567');
    expect(changed.organization.commander).toMatchObject({ name: '张三', position: '董事长', phone: '13900000000' });
    // 沿用原来的人员 id，物资保管人等处的引用不断
    expect(changed.organization.commander?.id).toBe(input.organization.commander?.id);
    expect(changed.organization.groups.find((g) => g.kind === 'rescue')?.leader?.name).toBe('李四');
    expect(changed.agencies.fireDept).toEqual({ name: '仲恺消防救援大队', phone: '0752-0000119' });
    expect(changed.location.rescueAgreement).toEqual({ answer: 'yes', parties: '惠州市第三人民医院' });
    expect(changed.expert.facts).toEqual({ shortName: 'FY', hospital: { name: '惠州市第三人民医院' }, training: { department: '安全管理部' } });
  });

  it('客户另加了编制组成员：编制小组整张列出，总指挥任组长', () => {
    const step = feiyuSnapshot.profile.organizationStep!;
    const snapshot = {
      ...feiyuSnapshot,
      profile: {
        ...feiyuSnapshot.profile,
        organizationStep: { ...step, step: { ...step.step, compilationExtras: [{ id: 'c1', name: '赵六', title: '行政主管', duty: '资料收集' }] } },
      },
    };
    const team = planInputOf(snapshot, { overrides: {} }, '2026-11-01').organization.compilationTeam!;
    expect(team.leader?.name).toBe(feiyuPlanInput.organization.commander?.name);
    expect(team.members.at(-1)).toEqual({ name: '赵六', title: '行政主管', duty: '资料收集' });
  });
});
