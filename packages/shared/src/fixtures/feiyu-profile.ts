// 飞宇样例按企业自填各步的存法（enterprises.profile），供演示数据与专业整理的测试用。
// 内容取自 feiyu.ts。
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
  // 第 3 步按客户的写法记数量（「4 台」「0.2 t」）；压力管道答「拍照给耕云看」，演示专家判定
  productionStep: {
    step: {
      sites: ['workshop', 'warehouse', 'power_room', 'compressor_room'],
      customSites: [],
      specialEquipment: {
        pressureVessels: { answer: 'yes', items: [{ id: 'pv1', medium: '压缩空气' }], photoFileIds: [] },
        boilers: { answer: 'no', items: [], photoFileIds: [] },
        pressurePipelines: { answer: 'photo', items: [], photoFileIds: [] },
        storageTanks: { answer: 'no', items: [], photoFileIds: [] },
      },
      equipment: feiyuProduction.equipment.map((e, i) => ({
        id: `e${i + 1}`,
        name: e.name,
        spec: e.spec,
        quantity: `${e.quantity} ${e.unit}`,
        location: e.department,
        condition: e.condition,
      })),
      materials: feiyuProduction.materials.map((m, i) => ({
        id: `m${i + 1}`,
        kind: 'material' as const,
        name: m.name,
        annualUsage: `${m.annualUsageTons} t`,
        maxStorage: `${m.maxStorageTons} t`,
        storageLocation: m.storageLocation,
        labelPhotoFileIds: [],
      })),
      ledgers: { equipment: [], materials: [] },
      leasesPremises: false,
      ownVehicles: false,
      process: {
        source: 'text',
        description: feiyuProduction.processFlow.description,
        sketchFileIds: [],
        steps: feiyuProduction.processFlow.steps.map((s, i) => ({ id: `s${i + 1}`, name: s.name, equipment: [] })),
      },
    },
  },
  resourcesStep: {
    step: {
      supplies: feiyuProduction.emergencySupplies.map((s, i) => ({
        id: `r${i + 1}`,
        name: s.name,
        unit: s.unit,
        quantity: s.quantity,
        location: s.location,
      })),
      custodianId: 'p20',
      supplyLedgerFileIds: [],
      firstAidKit: {
        answer: 'yes',
        mode: 'manual',
        items: [{ id: 'k1', name: '急救箱（综合配置）', quantity: 2, unit: '箱' }],
        photoFileIds: [],
      },
      firePool: { answer: 'yes', count: 1, volumeM3: 200, volumeLater: false },
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
