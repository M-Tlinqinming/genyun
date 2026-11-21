// 资料核对第 1–4 步「客户未填」：客户该填、现在（叠上专家那份以后）还空着的项。
// 各步底栏的「N 项客户未填」、第 5 步汇总、缺项清单的「最好补齐」、「等客户补资料」的自动取消都用这一个函数，
// key 要稳定（缺项清单靠它判断某一项补没补上）。专家决定的项（是否危化品、耐火等级、特种设备判定）不算；
// 标了「先留空」的照样算，因为它还是没填。
import { PRESET_GROUPS } from './profile/organization.ts';
import { msdsHintOf } from './profile/production-step.ts';
import { msdsNeedOf } from './profile/resources-step.ts';
import type { DrawingFileKey } from './workup-drawings.ts';
import { productionView, type ProductionWorkup } from './workup-production.ts';
import {
  basicStepView,
  organizationStepView,
  productionStepView,
  resourcesStepView,
  type ExpertCopy,
} from './workup-steps.ts';
import type { FactOverride, WorkupSnapshot } from './workup.ts';

export interface CustomerGap {
  key: string;
  // 给专家看的名称
  label: string;
  // 写给客户看的说法（缺项清单里用），如「油漆的 MSDS（向供应商要）」
  customerLabel: string;
  // 在向导第几步补
  step: 1 | 2 | 3 | 4;
}

type GapData = { overrides: Record<string, FactOverride>; production?: ProductionWorkup } & Partial<ExpertCopy>;

const filled = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '');

// 第 1 步：K10 底栏的 18 项（收起的选填工商信息、系统带出的属地部门、自动合计的建筑面积不算）
const BASIC_GAPS: [field: string, label: string, customerLabel?: string][] = [
  ['identity.name', '企业名称'],
  ['identity.socialCreditCode', '统一社会信用代码', '统一社会信用代码（看营业执照）'],
  ['identity.legalRepresentative', '法定代表人'],
  ['identity.registeredAddress', '注册地址', '注册地址（看营业执照）'],
  ['basic.industry', '所属行业'],
  ['basic.businessScope', '经营范围', '经营范围（看营业执照）'],
  ['basic.companyType', '公司类型'],
  ['basic.registeredCapital', '注册资本'],
  ['basic.registrationAuthority', '登记机关'],
  ['basic.siteAddress', '实际生产地址'],
  ['basic.employeeCount', '员工人数'],
  ['basic.safetyManagementCount', '专职或兼职安全管理人员人数'],
  ['basic.technicalManagementCount', '技术管理人员人数'],
  ['basic.mainProducts', '主要产品'],
  ['basic.landAreaM2', '占地面积', '厂区占地面积（平方米）'],
  ['basic.contactPerson', '联系人'],
  ['basic.contactPhone', '联系电话'],
  ['basic.responsiblePerson', '安全生产主管负责人', '安全生产主管负责人姓名'],
];

/**
 * 客户未填，按第 1–4 步排好。drawings：任务里现有的图纸（drawingCandidates 算出的 key），
 * 消防设施布置图看它；总平面图、疏散图缺了是生成门槛，不在这里
 */
export function customerGaps(snapshot: WorkupSnapshot, data: GapData, drawings: readonly { key: DrawingFileKey | string }[] = []): CustomerGap[] {
  const out: CustomerGap[] = [];
  const push = (step: CustomerGap['step'], key: string, label: string, customerLabel = label) => out.push({ key, label, customerLabel, step });

  // ── 第 1 步 ──
  const basic = basicStepView(snapshot, data);
  for (const [field, label, customerLabel] of BASIC_GAPS) {
    const [part, name] = field.split('.') as ['identity' | 'basic', string];
    const value = part === 'identity' ? (basic.identity as Record<string, unknown>)[name] : (basic.basic as Record<string, unknown>)[name];
    if (!filled(value)) push(1, `field:${field}`, label, customerLabel);
  }

  // ── 第 2 步 ──
  const org = organizationStepView(snapshot, data);
  if (!org.commander?.name.trim()) push(2, 'field:organization.commander', '总指挥', '应急总指挥姓名和手机');
  if (!filled(org.dutyPhone)) push(2, 'field:organization.dutyPhone', '24 小时值班电话');
  for (const g of org.groups) {
    const name = g.name || (g.kind !== 'custom' ? PRESET_GROUPS[g.kind] : '小组');
    if (!g.leader?.name.trim()) push(2, `leader:${g.id}`, `${name}组长`, `${name}组长姓名和手机`);
    if (!g.members.some((m) => m.name.trim())) push(2, `group:${g.id}`, `${name}组员`, `${name}组员姓名和手机`);
  }

  // ── 第 3 步 ──
  const step = productionStepView(snapshot, data);
  const res = resourcesStepView(snapshot, data);
  const hazards = new Map(productionView(snapshot, data).materials.map((m) => [m.id, m.hazard]));
  for (const m of step.materials) {
    const name = m.name.trim();
    if (!name) continue;
    if (!filled(m.annualUsage)) push(3, `material.annual:${m.id}`, `${name}年用量`);
    if (!filled(m.maxStorage)) push(3, `material.max:${m.id}`, `${name}最大存放量`, `${name}厂里最多存放多少`);
    // 专家判定不是危化品的不用再要
    if (hazards.get(m.id)?.value === false) continue;
    if (msdsNeedOf(m) === 'supplier' && !res.msds[m.id]?.fileIds.length) push(3, `msds:${m.id}`, `${name}的 MSDS`, `${name}的 MSDS（向供应商要）`);
    if (msdsHintOf(m) === 'label_needed') push(3, `label:${m.id}`, `${name}的包装标签照片`, `${name}的包装标签照片（拍桶身上的标签）`);
  }
  const p = step.process;
  if (!p.steps.some((s) => s.name.trim()) && !p.description?.trim() && p.sketchFileIds.length === 0) {
    push(3, 'field:process', '生产工艺流程', '生产工艺流程（一句话写清从原料到成品的几道工序）');
  }

  // ── 第 4 步 ──
  if (!res.supplies.some((s) => s.name.trim())) push(4, 'field:supplies', '应急物资', '厂里有的应急物资和数量');
  const kit = res.firstAidKit;
  if (kit.answer === undefined) push(4, 'field:firstAid', '有没有急救药箱');
  else if (kit.answer === 'yes' && kit.mode === 'manual' && !kit.items.some((i) => i.name.trim())) push(4, 'field:firstAid.items', '急救药箱药品清单');
  const pool = res.firePool;
  if (pool.answer === undefined) push(4, 'field:firePool', '有没有消防水池');
  else if (pool.answer === 'yes' && pool.volumeM3 === undefined) push(4, 'field:firePool.volume', '消防水池容积', '消防水池容积（立方米）');
  if (!res.buildings.some((b) => b.name.trim())) push(4, 'field:buildings', '厂区建筑', '厂区建筑名称、层数和面积');
  if (!drawings.some((d) => d.key === 'fire_facility_plan')) {
    push(4, 'drawing:fire_facility_plan', '消防设施布置图', '消防设施布置图（在平面图打印件上标出灭火器、消火栓，拍照即可）');
  }
  return out;
}

/** 按步数一数，底栏用 */
export function customerGapCount(gaps: readonly CustomerGap[], step: CustomerGap['step']): number {
  return gaps.filter((g) => g.step === step).length;
}
