// 测试集的一家企业：客户资料按新资料格式写一份，生成输入与专业整理用的自填各步都从它推出来（写法同 feiyu-profile.ts）。
// 资料来自 Martin 10-30 给的客户实际资料（桌面「耕耘\知识库及客户文档案例10-29」）；联系人电话一律改成虚构号码。
// 各家案例含客户员工姓名等真实资料，不进 git：放在仓库根目录 testset/，备份在上述目录的「耕云测试集」，用法见 build-test-cases.ts。
// 专家部分只取对照成稿里专家写的（周边环境、医院、危险源取值等），没有成稿的企业不填，走系统建议。
import type { EnterpriseProfile } from '../profile/basic-step.ts';
import type { BasicInfo } from '../profile/basic.ts';
import type { Location } from '../profile/location.ts';
import type { Organization, Person } from '../profile/organization.ts';
import type { DraftPerson } from '../profile/organization-step.ts';
import type { Production } from '../profile/production.ts';
import type { SiteType } from '../profile/production-step.ts';
import { localAgenciesOf } from '../plan/agencies.ts';
import type { ExpertInput, PlanInput } from '../plan/input.ts';
import type { WorkupSnapshot } from '../workup.ts';

export interface TestCase {
  /** 文件名用的短名，如 jiemeiqi */
  slug: string;
  /** 所属行业代码（industries.ts） */
  industry?: string;
  basic: BasicInfo;
  location: Location;
  organization: Organization;
  production: Production;
  business: { sites: SiteType[]; leasesPremises?: boolean; ownVehicles?: boolean };
  /** 压力容器的介质（客户答「有」时） */
  pressureVesselMedium?: string;
  issuedOn: string;
  expert: ExpertInput;
  /** 对照用的专家成稿（测试集目录下的相对路径）；没有成稿的不写 */
  references?: string[];
  /** 整理时的取舍：资料里缺什么、哪里按什么口径填的 */
  notes: string[];
}

export function casePlanInput(c: TestCase): PlanInput {
  return {
    basic: c.basic,
    location: c.location,
    organization: c.organization,
    production: c.production,
    business: c.business,
    agencies: localAgenciesOf(c.location.siteAddress),
    issuedOn: c.issuedOn,
    expert: c.expert,
  };
}

const draft = (p: Person): DraftPerson => ({ id: p.id, name: p.name, position: p.position || undefined, phone: p.phone });

const special = (s: { answer: 'yes' | 'no' | 'photo' } | undefined, items: { id: string; medium?: string }[] = []) =>
  s?.answer === 'yes'
    ? { answer: 'yes' as const, items, photoFileIds: [] }
    : s?.answer === 'photo'
      ? { answer: 'photo' as const, items: [], photoFileIds: [] }
      : { answer: 'no' as const, items: [], photoFileIds: [] };

// 资料里 CAS 号写「/」「-」的算没填
const cas = (v: string | undefined) => (v && /[0-9]/.test(v) ? v.trim() : undefined);

/** 按企业自填各步的存法（enterprises.profile） */
export function caseProfile(c: TestCase): EnterpriseProfile {
  const { companyName, socialCreditCode, legalRepresentative, registeredAddress, ...basic } = c.basic;
  const org = c.organization;
  const p = c.production;
  const se = p.specialEquipment;
  const custodian = p.emergencySupplies.find((s) => s.custodianId)?.custodianId;
  const loc = c.location;
  return {
    basicStep: {
      basic: {
        ...basic,
        industry: c.industry,
        siteAddress: loc.siteAddress.detail,
        otherAddresses: loc.otherAddresses,
        inPark: loc.park?.answer,
        parkManager: loc.park?.manager,
        parkDutyPhone: loc.park?.dutyPhone,
      },
      later: [],
      sources: {},
    },
    organizationStep: {
      step: {
        mode: 'form',
        commander: org.commander && draft(org.commander),
        deputies: org.deputies.map(draft),
        groups: org.groups.map((g, i) => ({
          id: `g${i + 1}`,
          kind: g.kind,
          name: g.name,
          leader: g.leader && draft(g.leader),
          members: g.members.map(draft),
          addressId: g.addressId,
        })),
        dutyPhone: org.dutyPhone,
        paSystem: org.paSystem,
        imGroup: org.imGroup,
        compilationExtras: [],
      },
      rosterFileIds: [],
    },
    productionStep: {
      step: {
        sites: c.business.sites,
        customSites: [],
        specialEquipment: {
          pressureVessels: special(se.pressureVessels, c.pressureVesselMedium ? [{ id: 'pv1', medium: c.pressureVesselMedium }] : []),
          boilers: special(se.boilers),
          pressurePipelines: special(se.pressurePipelines),
          storageTanks: special(se.storageTanks),
        },
        equipment: p.equipment.map((e, i) => ({
          id: `e${i + 1}`,
          name: e.name,
          spec: e.spec,
          quantity: e.quantity === undefined ? undefined : `${e.quantity} ${e.unit}`,
          location: e.location,
          condition: e.condition,
          addressId: e.addressId,
        })),
        materials: p.materials.map((m, i) => ({
          id: `m${i + 1}`,
          kind: 'material' as const,
          name: m.name,
          casNumber: cas(m.casNumber),
          annualUsage: m.annualUsageTons === undefined ? undefined : `${m.annualUsageTons} t`,
          maxStorage: m.maxStorageTons === undefined ? undefined : `${m.maxStorageTons} t`,
          storageLocation: m.storageLocation,
          labelPhotoFileIds: [],
          addressId: m.addressId,
        })),
        ledgers: { equipment: [], materials: [] },
        leasesPremises: c.business.leasesPremises ?? false,
        ownVehicles: c.business.ownVehicles ?? false,
        process: {
          source: 'text',
          description: p.processFlow.description,
          sketchFileIds: [],
          steps: p.processFlow.steps.map((s, i) => ({ id: `s${i + 1}`, name: s.name, equipment: s.equipment })),
        },
      },
    },
    resourcesStep: {
      step: {
        supplies: p.emergencySupplies.map((s, i) => ({ id: `r${i + 1}`, name: s.name, unit: s.unit, quantity: s.quantity, location: s.location, addressId: s.addressId })),
        custodianId: custodian,
        supplyLedgerFileIds: [],
        firstAidKit:
          p.firstAidKit?.answer === 'yes'
            ? { answer: 'yes', mode: 'manual', items: p.firstAidKit.items.map((k, i) => ({ id: `k${i + 1}`, ...k })), photoFileIds: [] }
            : { answer: 'no', mode: 'manual', items: [], photoFileIds: [] },
        firePool:
          p.firePool?.answer === 'yes'
            ? { answer: 'yes', count: p.firePool.count, volumeM3: p.firePool.volumeM3, volumeLater: false }
            : { answer: 'no', volumeLater: false },
        buildings: p.buildings.map((b, i) => ({ id: `b${i + 1}`, name: b.name, fireRating: 'expert' as const, floors: b.floors, areaM2: b.floorAreaM2 })),
        fireAcceptanceFileIds: [],
        msds: {},
        drawings: { site_plan: [], evacuation_plan: [], fire_facility_plan: [] },
        neighbors:
          c.location.neighbours?.answer === 'listed'
            ? { answer: 'has', items: c.location.neighbours.items.map((n, i) => ({ id: `n${i + 1}`, name: n.name, contact: n.contact })) }
            : { answer: 'none', items: [] },
        rescueAgreement: loc.rescueAgreement,
        mutualAid: loc.mutualAid,
        assemblyPoint: p.assemblyPoint,
      },
    },
  };
}

export function caseSnapshot(c: TestCase): WorkupSnapshot {
  return {
    identity: {
      name: c.basic.companyName,
      socialCreditCode: c.basic.socialCreditCode || null,
      legalRepresentative: c.basic.legalRepresentative ?? null,
      registeredAddress: c.basic.registeredAddress?.detail ?? null,
    },
    profile: caseProfile(c),
  };
}
