// 飞宇样例按企业自填各步的存法（enterprises.profile），供演示数据与专业整理的测试用。
// 内容取自 feiyu.ts；生产现场（第 3 步）等第 6 项专家判断时再补。
import type { EnterpriseProfile } from '../profile/basic-step.ts';
import type { DraftPerson } from '../profile/organization-step.ts';
import type { WorkupSnapshot } from '../workup.ts';
import { feiyuBasicInfo, feiyuOrganization, feiyuProduction } from './feiyu.ts';

const { companyName, socialCreditCode, legalRepresentative, registeredAddress, ...basic } = feiyuBasicInfo;

const draft = (p: { id: string; name: string; position?: string; phone?: string }): DraftPerson => ({
  id: p.id,
  name: p.name,
  position: p.position || undefined,
  phone: p.phone,
});

export const feiyuProfile: EnterpriseProfile = {
  basicStep: {
    basic: { ...basic, industry: '38', siteAddress: registeredAddress?.detail },
    later: [],
    // 执照识别带出的字段；联系人取自当前账号
    sources: {
      name: 'license',
      socialCreditCode: 'license',
      legalRepresentative: 'license',
      registeredAddress: 'license',
      companyType: 'license',
      registrationAuthority: 'license',
      registeredCapital: 'license',
      businessScope: 'license',
      contactPerson: 'account',
      siteAddress: 'registered_address',
    },
  },
  organizationStep: {
    step: {
      mode: 'form',
      commander: draft(feiyuOrganization.commander!),
      deputies: feiyuOrganization.deputies.map(draft),
      groups: feiyuOrganization.groups.map((g) => ({
        id: `g-${g.kind}`,
        kind: g.kind,
        name: g.name,
        leader: g.leader && draft(g.leader),
        members: g.members.map(draft),
      })),
      dutyPhone: '0752-3324567',
      compilationExtras: [],
    },
    rosterFileIds: [],
  },
  resourcesStep: {
    step: {
      supplies: [],
      supplyLedgerFileIds: [],
      firstAidKit: { mode: 'standard', items: [], photoFileIds: [] },
      firePool: { volumeLater: false },
      buildings: feiyuProduction.buildings.map((b, i) => ({
        id: `b${i + 1}`,
        name: b.name,
        fireRating: 'expert' as const,
        floors: b.floors,
        areaM2: b.floorAreaM2,
      })),
      fireAcceptanceFileIds: [],
      msds: {},
      drawings: { site_plan: [], evacuation_plan: [], fire_facility_plan: [] },
      neighbors: { answer: 'none', items: [] },
    },
  },
};

export const feiyuSnapshot: WorkupSnapshot = {
  identity: {
    name: companyName,
    socialCreditCode: socialCreditCode || null,
    legalRepresentative: legalRepresentative ?? null,
    registeredAddress: registeredAddress?.detail ?? null,
  },
  profile: feiyuProfile,
};
