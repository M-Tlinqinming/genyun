// 专业整理 ·「生产设备与物料」（Paper 14 页 E18-00B、E18-00B2）：专家对照客户第 3、4 步的内容整理 8 类清单，
// 并做三种专业判断：物料是否危化品、特种设备有没有（客户拍照给耕云看的）、建筑耐火等级。
// 和企业事实一样只记在任务的专业整理里（WorkupData.production），不写回企业资料。
// 急救药箱清单由客户填写（Martin 10-29），客户只传了照片的请客户补，专家不代为整理。
import { z } from 'zod';
import type { Production } from './profile/production.ts';
import {
  draftEquipmentSchema,
  draftMaterialSchema,
  isGeneralMaterial,
  SPECIAL_CATEGORIES,
  SPECIAL_CATEGORY_KEYS,
  type DraftEquipment,
  type DraftMaterial,
  type SiteType,
  type SpecialAnswer,
  type SpecialCategory,
} from './profile/production-step.ts';
import { FIRE_RATINGS, type DraftSupply } from './profile/resources-step.ts';
import { SCOPE_SWITCHES, type ScopeKey } from './plan/catalog.ts';
import type { PlanInput } from './plan/input.ts';
import { suggestScope, type ScopeSuggestion } from './plan/scope.ts';
import type { WorkupSnapshot } from './workup.ts';

export const PRODUCTION_LISTS = {
  equipment: '设备清单',
  special: '特种设备',
  materials: '原辅材料',
  buildings: '建构筑物',
  fire: '消防设施',
  supplies: '应急物资',
  firstAid: '急救药箱',
  process: '工艺流程',
} as const;
export type ProductionList = keyof typeof PRODUCTION_LISTS;
export const PRODUCTION_LIST_KEYS = Object.keys(PRODUCTION_LISTS) as ProductionList[];

// 专家写下的每一条都记谁、什么时候、对照的哪份原件
export interface Stamp {
  by: string;
  byName: string;
  at: string;
  fileId?: string;
}
export type Judged<T> = Stamp & { value: T };

// 专家改过或新增的设备、物料行（字段同客户填写，名称必填）
export const expertEquipmentSchema = draftEquipmentSchema
  .omit({ id: true })
  .extend({ name: z.string().trim().min(1, '请填写设备名称').max(50, '设备名称最多 50 个字') });
export type ExpertEquipment = z.infer<typeof expertEquipmentSchema>;
export const expertMaterialSchema = draftMaterialSchema
  .omit({ id: true, labelPhotoFileIds: true })
  .extend({ name: z.string().trim().min(1, '请填写物料名称').max(50, '物料名称最多 50 个字') });
export type ExpertMaterial = z.infer<typeof expertMaterialSchema>;

export type FireGrade = Exclude<keyof typeof FIRE_RATINGS, 'expert'>;
export const FIRE_GRADES = ['1', '2', '3', '4'] as const satisfies readonly FireGrade[];

// 特种设备的判定：有（可补参数，行的格式同客户填写）或没有。判定为没有不用写理由
export interface SpecialJudgement {
  answer: 'yes' | 'no';
  items: Record<string, unknown>[];
}

export interface ProductionWorkup {
  // 键是客户行的 id（改过）或专家新增行的 id（x 开头）
  equipment: Record<string, Judged<ExpertEquipment>>;
  materials: Record<string, Judged<ExpertMaterial>>;
  // 物料 id → 是否危化品
  hazardous: Record<string, Judged<boolean>>;
  special: Partial<Record<SpecialCategory, Judged<SpecialJudgement>>>;
  // 建筑 id → 耐火等级
  fireRatings: Record<string, Judged<FireGrade>>;
}

export const emptyProductionWorkup = (): ProductionWorkup => ({
  equipment: {},
  materials: {},
  hazardous: {},
  special: {},
  fireRatings: {},
});

const rowId = z.string().min(1).max(40);
const base = { version: z.number().int().min(1), fileId: z.uuid().optional() };

// 保存一条：value 为 null 表示撤回（专家新增的行就是删掉）
export const productionSaveSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('equipment'), rowId, value: expertEquipmentSchema.nullable() }),
  z.object({ ...base, kind: z.literal('material'), rowId, value: expertMaterialSchema.nullable() }),
  z.object({ ...base, kind: z.literal('hazardous'), rowId, value: z.boolean().nullable() }),
  z.object({
    ...base,
    kind: z.literal('special'),
    category: z.enum(SPECIAL_CATEGORY_KEYS as [SpecialCategory, ...SpecialCategory[]]),
    value: z
      .object({ answer: z.enum(['yes', 'no']), items: z.array(z.record(z.string(), z.unknown())).max(20, '每类最多 20 台').default([]) })
      .nullable(),
  }),
  z.object({ ...base, kind: z.literal('fireRating'), rowId, value: z.enum(FIRE_GRADES).nullable() }),
]);
export type ProductionSave = z.infer<typeof productionSaveSchema>;

export const isAddedRow = (id: string) => id.startsWith('x');

// ---------- 危化品的系统建议 ----------
// 名单按常见名称整理：可燃液体来自知识库「产生可燃液体蒸气化学品」，腐蚀品来自「化学品灼烫分类」，
// 其余沿用适用范围的关键词。第一版的保守写法，M3 化学品知识库（危化品目录）上线后改为查库。
const HAZARD_GROUPS: { kind: string; names: string[]; neg?: string[] }[] = [
  {
    kind: '易燃液体',
    names: [
      '汽油', '柴油', '煤油', '石脑油', '石油醚', '甲醇', '乙醇', '酒精', '丁醇', '乙醚', '乙酸乙酯', '甲基叔丁基醚',
      '二甲苯', '甲苯', '丙酮', '环己烷', '二硫化碳', '乙腈', '洗枪水', '天那水', '香蕉水', '稀释剂', '开油水', '油漆',
    ],
    neg: ['乙醇胺'],
  },
  { kind: '易燃气体', names: ['液化石油气', '液化气', '天然气', '氢气', '乙炔', '甲烷', '丙烷', '丁烷', '一氧化碳'] },
  { kind: '压缩气体', names: ['氧气', '氮气', '氩气', '氦气', '二氧化碳'] },
  {
    kind: '腐蚀品',
    names: ['硫酸', '盐酸', '硝酸', '氢氟酸', '磷酸', '冰醋酸', '醋酸', '氢氧化钠', '烧碱', '氢氧化钾', '氨水'],
  },
  { kind: '有毒品', names: ['苯酚', '甲醛', '氰', '硫化氢', '氯气', '液氨', '光气', '二氧化硫', '丙烯腈', '苯'], neg: ['聚苯', '苯板'] },
  { kind: '氧化剂', names: ['高锰酸钾', '过氧化氢', '双氧水', '铬酸'] },
];

export interface HazardSuggestion {
  value: boolean;
  reason: string;
}

export function hazardSuggestionOf(name: string): HazardSuggestion | undefined {
  const n = name.trim();
  if (!n) return undefined;
  for (const g of HAZARD_GROUPS) {
    if (g.neg?.some((x) => n.includes(x))) continue;
    const hit = g.names.find((x) => n.includes(x));
    if (hit) return { value: true, reason: `名称含「${hit}」，属于${g.kind}，建议判定为危化品` };
  }
  if (isGeneralMaterial(n)) {
    return { value: false, reason: '一般原料，不是危化品' };
  }
  return undefined;
}

// ---------- 整理结果 ----------
export type RowSource = 'customer' | 'expert';

export interface EquipmentRow extends ExpertEquipment {
  id: string;
  source: RowSource;
  added: boolean;
  edited?: Judged<ExpertEquipment>;
}

export interface HazardView {
  value?: boolean;
  // expert = 专家判定；system = 一般原料，系统直接判定不是；null = 待专家确认
  decidedBy: 'expert' | 'system' | null;
  suggestion?: HazardSuggestion;
  judged?: Judged<boolean>;
}

export interface MaterialRow extends ExpertMaterial {
  id: string;
  source: RowSource;
  added: boolean;
  edited?: Judged<ExpertMaterial>;
  labelPhotoFileIds: string[];
  hazard: HazardView;
}

export interface SpecialRow {
  category: SpecialCategory;
  label: string;
  // 客户的回答
  customer?: SpecialAnswer;
  // 现在的结论：专家判定的优先，其次客户答的有 / 没有
  answer?: 'yes' | 'no';
  items: Record<string, unknown>[];
  photoFileIds: string[];
  judged?: Judged<SpecialJudgement>;
  pending: boolean;
}

export interface BuildingRow {
  id: string;
  name: string;
  floors?: number;
  areaM2?: number;
  fireRating?: FireGrade;
  // customer = 客户按消防验收资料选的；expert = 专家判断
  ratingBy: RowSource | null;
  judged?: Judged<FireGrade>;
}

export interface SupplyRow {
  name: string;
  quantity?: number;
  unit?: string;
  location?: string;
}

export interface FirstAidView {
  // needs_customer = 客户还没给清单（只传了照片或没回答），请客户补
  status: 'provided' | 'none' | 'needs_customer';
  items: SupplyRow[];
  photoFileIds: string[];
}

export interface PendingJudgement {
  list: ProductionList;
  // 页面定位用：material:<id>、special:<类别>、building:<id>、firstAid
  key: string;
  label: string;
}

export interface ProductionView {
  equipment: EquipmentRow[];
  special: SpecialRow[];
  materials: MaterialRow[];
  buildings: BuildingRow[];
  fire: {
    firePool: { answer?: 'yes' | 'no'; count?: number; volumeM3?: number };
    supplies: SupplyRow[];
    acceptanceFileIds: string[];
  };
  supplies: SupplyRow[];
  firstAid: FirstAidView;
  process: { description?: string; steps: string[]; sketchFileIds: string[] };
  pending: PendingJudgement[];
}

// 消防器材归到「消防设施」，其余在「应急物资」
const FIRE_SUPPLIES = new Set(['fire_ext_portable', 'fire_ext_cart', 'hydrant_indoor', 'hydrant_outdoor', 'fire_sand', 'co2_ext', 'fire_blanket']);
const FIRE_WORDS = ['灭火', '消火栓', '消防'];
const isFireSupply = (s: DraftSupply) => (s.catalogKey ? FIRE_SUPPLIES.has(s.catalogKey) : FIRE_WORDS.some((w) => s.name.includes(w)));

const filled = (v: string | undefined) => Boolean(v && v.trim() !== '');

// 专家新增的行按保存时间排在客户行之后（jsonb 不保留键的顺序）
function addedRows<T>(edits: Record<string, Judged<T>>): [string, Judged<T>][] {
  return Object.entries(edits)
    .filter(([id]) => isAddedRow(id))
    .sort((a, b) => a[1].at.localeCompare(b[1].at));
}

export function productionView(snapshot: WorkupSnapshot, data: { production?: ProductionWorkup }): ProductionView {
  const w = data.production ?? emptyProductionWorkup();
  const step = snapshot.profile.productionStep?.step;
  const res = snapshot.profile.resourcesStep?.step;
  const pending: PendingJudgement[] = [];

  const equipment: EquipmentRow[] = [
    ...(step?.equipment ?? [])
      .filter((e) => filled(e.name) || w.equipment[e.id])
      .map((e: DraftEquipment): EquipmentRow => {
        const edited = w.equipment[e.id];
        const { id, ...own } = e;
        return { ...own, ...(edited?.value ?? {}), id, source: edited ? 'expert' : 'customer', added: false, edited };
      }),
    ...addedRows(w.equipment).map(([id, j]): EquipmentRow => ({ ...j.value, id, source: 'expert', added: true, edited: j })),
  ];

  const hazardOf = (id: string, name: string): HazardView => {
    const judged = w.hazardous[id];
    const suggestion = hazardSuggestionOf(name);
    if (judged) return { value: judged.value, decidedBy: 'expert', suggestion, judged };
    if (suggestion && !suggestion.value) return { value: false, decidedBy: 'system', suggestion };
    return { decidedBy: null, suggestion };
  };
  const materials: MaterialRow[] = [
    ...(step?.materials ?? [])
      .filter((m) => filled(m.name) || w.materials[m.id])
      .map((m: DraftMaterial): MaterialRow => {
        const edited = w.materials[m.id];
        const { id, labelPhotoFileIds, ...own } = m;
        const row = { ...own, ...(edited?.value ?? {}) };
        return { ...row, id, labelPhotoFileIds, source: edited ? 'expert' : 'customer', added: false, edited, hazard: hazardOf(id, row.name) };
      }),
    ...addedRows(w.materials).map(
      ([id, j]): MaterialRow => ({ ...j.value, id, labelPhotoFileIds: [], source: 'expert', added: true, edited: j, hazard: hazardOf(id, j.value.name) }),
    ),
  ];
  for (const m of materials) {
    if (m.hazard.decidedBy === null) pending.push({ list: 'materials', key: `material:${m.id}`, label: `${m.name}是否危化品` });
  }

  const special: SpecialRow[] = SPECIAL_CATEGORY_KEYS.map((category) => {
    const c = step?.specialEquipment[category];
    const judged = w.special[category];
    const customer = c?.answer;
    const answer = judged?.value.answer ?? (customer === 'yes' || customer === 'no' ? customer : undefined);
    const items = judged ? judged.value.items : ((c?.items ?? []) as Record<string, unknown>[]);
    const label = SPECIAL_LABELS[category];
    const isPending = answer === undefined;
    if (isPending) pending.push({ list: 'special', key: `special:${category}`, label: `${label}判定` });
    return { category, label, customer, answer, items, photoFileIds: c?.photoFileIds ?? [], judged, pending: isPending };
  });

  const buildings: BuildingRow[] = (res?.buildings ?? [])
    .filter((b) => filled(b.name))
    .map((b) => {
      const judged = w.fireRatings[b.id];
      const fromCustomer = b.fireRating !== 'expert' ? b.fireRating : undefined;
      const fireRating = judged?.value ?? fromCustomer;
      if (!fireRating) pending.push({ list: 'buildings', key: `building:${b.id}`, label: `${b.name}耐火等级` });
      return {
        id: b.id,
        name: b.name,
        floors: b.floors,
        areaM2: b.areaM2,
        fireRating,
        ratingBy: judged ? 'expert' : fromCustomer ? 'customer' : null,
        judged,
      };
    });

  const supplyRow = (s: DraftSupply): SupplyRow => ({ name: s.name, quantity: s.quantity, unit: s.unit, location: s.location });
  const supplies = (res?.supplies ?? []).filter((s) => filled(s.name));

  const kit = res?.firstAidKit;
  const kitItems = (kit?.items ?? []).filter((i) => filled(i.name)).map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit }));
  const firstAid: FirstAidView = {
    status: kit?.answer === 'no' ? 'none' : kit?.answer === 'yes' && kit.mode !== 'photo' && kitItems.length > 0 ? 'provided' : 'needs_customer',
    items: kit?.mode === 'photo' ? [] : kitItems,
    photoFileIds: kit?.photoFileIds ?? [],
  };
  if (firstAid.status === 'needs_customer') pending.push({ list: 'firstAid', key: 'firstAid', label: '急救药箱清单（请客户补）' });

  return {
    equipment,
    special,
    materials,
    buildings,
    fire: {
      firePool: { answer: res?.firePool.answer, count: res?.firePool.count, volumeM3: res?.firePool.volumeM3 },
      supplies: supplies.filter(isFireSupply).map(supplyRow),
      acceptanceFileIds: res?.fireAcceptanceFileIds ?? [],
    },
    supplies: supplies.filter((s) => !isFireSupply(s)).map(supplyRow),
    firstAid,
    process: {
      description: step?.process.description,
      steps: (step?.process.steps ?? []).map((s) => s.name).filter(Boolean),
      sketchFileIds: step?.process.sketchFileIds ?? [],
    },
    pending,
  };
}

// 界面用的短名称（客户填写页的名称带括号说明）
export const SPECIAL_LABELS: Record<SpecialCategory, string> = {
  pressureVessels: '压力容器',
  boilers: '锅炉',
  pressurePipelines: '压力管道',
  storageTanks: '储罐 / 油库',
};

// 左栏每类的数字：行数或「N 待确认」
export function listCounts(view: ProductionView): Record<ProductionList, { count: number; pending: number }> {
  const pendingOf = (list: ProductionList) => view.pending.filter((p) => p.list === list).length;
  return {
    equipment: { count: view.equipment.length, pending: 0 },
    special: { count: view.special.filter((s) => s.answer === 'yes').length, pending: pendingOf('special') },
    materials: { count: view.materials.length, pending: pendingOf('materials') },
    buildings: { count: view.buildings.length, pending: pendingOf('buildings') },
    fire: { count: view.fire.supplies.length + (view.fire.firePool.answer === 'yes' ? 1 : 0), pending: 0 },
    supplies: { count: view.supplies.length, pending: 0 },
    firstAid: { count: view.firstAid.items.length, pending: pendingOf('firstAid') },
    process: { count: view.process.steps.length, pending: 0 },
  };
}

// 保存前校验：行、物料、建筑在这份整理里存在，特种设备参数的格式对得上
export function productionSaveError(snapshot: WorkupSnapshot, data: { production?: ProductionWorkup }, save: ProductionSave): string | null {
  const view = productionView(snapshot, data);
  const step = snapshot.profile.productionStep?.step;
  switch (save.kind) {
    case 'equipment':
      if (isAddedRow(save.rowId)) return null;
      return step?.equipment.some((e) => e.id === save.rowId) ? null : '没有这一行设备';
    case 'material':
      if (isAddedRow(save.rowId)) return null;
      return step?.materials.some((m) => m.id === save.rowId) ? null : '没有这一行物料';
    case 'hazardous':
      return view.materials.some((m) => m.id === save.rowId) ? null : '没有这一行物料';
    case 'fireRating':
      return view.buildings.some((b) => b.id === save.rowId) ? null : '没有这栋建筑';
    case 'special': {
      if (!save.value) return null;
      const rows = SPECIAL_CATEGORIES[save.category].schema.shape.items.safeParse(save.value.items.map((r, i) => ({ id: `s${i + 1}`, ...r })));
      return rows.success ? null : (rows.error.issues[0]?.message ?? '参数格式不对');
    }
  }
}

// ---------- 给生成和适用范围用的生产现场数据 ----------
// 「200 kg」「0.6 t」「1.5吨」换成吨；瓶、桶等数不出重量的不算
export function parseTons(text: string | undefined): number | undefined {
  const m = text?.trim().match(/^([\d.]+)\s*(t|吨|kg|公斤|千克|g|克)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (m[2] ?? 't').toLowerCase();
  if (unit === 't' || unit === '吨') return n;
  if (unit === 'kg' || unit === '公斤' || unit === '千克') return Math.round(n) / 1000;
  return n / 1_000_000;
}

const leadingInt = (text: string | undefined) => {
  const m = text?.match(/\d+/);
  return m ? Number(m[0]) : undefined;
};

// 整理后的生产现场（productionSchema 格式）与场所、两个业务问题。第 10 项生成 Word 时接着用，数量按能读出的部分换算
export function planProductionOf(snapshot: WorkupSnapshot, view: ProductionView): Pick<PlanInput, 'production' | 'business'> & { hazardousMaterials: string[] } {
  const step = snapshot.profile.productionStep?.step;
  const res = snapshot.profile.resourcesStep?.step;
  const specialEquipment: Production['specialEquipment'] = {};
  for (const s of view.special) {
    const cat = s.category;
    if (s.answer === 'no') specialEquipment[cat] = { answer: 'no' };
    else if (s.answer === 'yes') specialEquipment[cat] = { answer: 'yes', items: specialItems(cat, s.items), nameplateFileIds: s.photoFileIds } as never;
    else if (s.customer === 'photo') specialEquipment[cat] = { answer: 'photo', nameplateFileIds: s.photoFileIds };
  }
  const production: Production = {
    buildings: view.buildings.map((b) => ({ name: b.name, floors: b.floors, floorAreaM2: b.areaM2 })),
    equipment: view.equipment.map((e) => ({
      name: e.name,
      spec: e.spec,
      quantity: leadingInt(e.quantity),
      unit: e.quantity?.replace(/^[\d\s]+/, '').trim() || '台',
      department: e.location || '车间',
      location: e.location || '车间',
      condition: e.condition === '停用' ? '停用' : e.condition === '维修中' ? '异常' : '正常',
    })),
    specialEquipment,
    materials: view.materials.map((m) => ({
      name: m.name,
      annualUsageTons: parseTons(m.annualUsage),
      maxStorageTons: parseTons(m.maxStorage),
      storageLocation: m.storageLocation,
      cylinderSpec: m.kind === 'cylinder' ? m.cylinderSpec || '气瓶' : undefined,
      labelPhotoFileIds: m.labelPhotoFileIds,
      msdsFileIds: res?.msds[m.id]?.fileIds ?? [],
    })),
    processFlow: {
      source: step?.process.source,
      description: step?.process.description,
      sketchFileIds: step?.process.sketchFileIds ?? [],
      templateId: step?.process.templateId,
      steps: view.process.steps.map((name) => ({ name, equipment: [], inputs: [], next: 'next' as const })),
    },
    emergencySupplies: [...view.fire.supplies, ...view.supplies].map((s) => ({ ...s, custodianId: res?.custodianId })),
    firstAidKit:
      view.firstAid.status === 'none'
        ? { answer: 'no' }
        : view.firstAid.status === 'provided'
          ? { answer: 'yes', items: view.firstAid.items }
          : undefined,
    firePool:
      view.fire.firePool.answer === 'yes'
        ? { answer: 'yes', count: view.fire.firePool.count, volumeM3: view.fire.firePool.volumeM3 }
        : view.fire.firePool.answer === 'no'
          ? { answer: 'no' }
          : undefined,
  };
  return {
    production,
    business: { sites: (step?.sites ?? []) as SiteType[], leasesPremises: step?.leasesPremises, ownVehicles: step?.ownVehicles },
    // 待确认的按系统建议算，专家确认前的预览和确认后一致
    hazardousMaterials: view.materials.filter((m) => m.hazard.value ?? m.hazard.suggestion?.value).map((m) => m.name),
  };
}

function specialItems(cat: SpecialCategory, items: Record<string, unknown>[]) {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  switch (cat) {
    case 'pressureVessels':
      return items.map((r) => ({ medium: str(r.medium), maxWorkingPressureMPa: num(r.maxWorkingPressureMPa), volumeM3: num(r.volumeM3) }));
    case 'boilers':
      return items.map((r) => ({ type: r.type === 'steam' || r.type === 'hot_water' ? r.type : undefined }));
    case 'pressurePipelines':
      return items.map((r) => ({ nominalDiameterMm: leadingInt(str(r.nominalDiameter)) }));
    case 'storageTanks':
      return items.map((r) => ({ substance: str(r.substance), capacityTons: parseTons(str(r.capacity)) }));
  }
}

// 「本表影响的适用范围开关」：两张表各自影响的开关，按现在的整理结果给出系统建议（第 8 项专家再确认）
const SCOPE_BY_LIST: Partial<Record<ProductionList, ScopeKey[]>> = {
  materials: ['chemicalsOver1t', 'flammableLiquid', 'combustibleGas', 'toxicChemicals', 'inertGas'],
  special: ['pressureVessel', 'pressurePipeline'],
};

export interface ScopeImpact {
  key: ScopeKey;
  label: string;
  suggestion: ScopeSuggestion;
}

export function scopeImpact(snapshot: WorkupSnapshot, view: ProductionView, list: ProductionList): ScopeImpact[] {
  const keys = SCOPE_BY_LIST[list];
  if (!keys) return [];
  const { production, business, hazardousMaterials } = planProductionOf(snapshot, view);
  const suggested = suggestScope({ production, business, expert: { hazardousMaterials } });
  return keys.map((key) => ({ key, label: SCOPE_SWITCHES[key], suggestion: suggested[key] }));
}
