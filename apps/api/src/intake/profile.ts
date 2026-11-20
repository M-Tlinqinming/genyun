// 把读出来的格子放进企业资料的形状（identity + 四步），K10 专家五步核对直接拿去用。
// 先拼出原始对象，再用各步现有的 schema 校验一遍（顺带补上默认值）；
// 校验不过的值（超长、电话里有汉字等）原样记进 unplaced，不悄悄丢掉。
import {
  BOILER_TYPES,
  INDUSTRY_NAMES,
  MAX_OTHER_ADDRESSES,
  PRESET_GROUPS,
  SITE_TYPES,
  SOCIAL_CREDIT_CODE,
  SUPPLY_CATALOG,
  basicStepSchema,
  enterpriseInputSchema,
  organizationStepSchema,
  productionStepSchema,
  resourcesStepSchema,
  standardFirstAidItems,
  type FieldSource,
  type IntakeCellRef,
  type IntakeParseResult,
  type IntakeUnplacedValue,
  type PresetGroupKey,
  type SiteType,
  type SupplyKey,
} from '@genyun/shared';
import type { z } from 'zod';
import { normalizeLabel } from './cell-text.ts';
import { OPTIONAL_GROUPS, readOrg, REQUIRED_GROUPS, type PersonVals } from './org-read.ts';
import type { ReadRow, Val, WorkbookRead } from './read.ts';
import {
  isSameAsRegistered,
  parseFireRating,
  parseInteger,
  parseNumber,
  parseYesNo,
  splitList,
} from './values.ts';

type Obj = Record<string, unknown>;

/** 记下每个值从哪一格来，校验不过时按路径找回原格 */
class Builder {
  readonly unplaced: IntakeUnplacedValue[] = [];
  readonly refs = new Map<string, { v: Val; label: string }>();
  /** settle 时因超长、格式不对移到 unplaced 的字段（完整路径） */
  readonly dropped = new Set<string>();

  /** 有字才放；放的时候记下来源 */
  put(target: Obj, path: string, key: string, v: Val | undefined, label: string, value: unknown = v?.text) {
    if (!v || !v.text || value === undefined || value === '') return;
    target[key] = value;
    this.refs.set(`${path}.${key}`, { v, label });
  }

  drop(v: Val, label: string) {
    if (v.text) this.unplaced.push({ sheet: v.sheet, cell: v.cell, label, text: v.text });
  }

  /** 整行放不进（如超过条数上限） */
  dropRow(cells: Val[], label: string) {
    const text = cells.map((c) => c.text).filter(Boolean).join(' / ');
    const first = cells.find((c) => c.cell);
    if (text && first) this.unplaced.push({ sheet: first.sheet, cell: `第 ${first.row} 行`, label, text });
  }

  /**
   * 用 schema 校验；不过的字段移到 unplaced 再校验，直到通过。
   * 必填字段移走后仍校验不过（缺了）：fallbacks 里有这个字段就填占位值，没有就抛错。
   * 调用方用 dropped 判断占位值是不是这样填上的。
   */
  settle<S extends z.ZodType>(schema: S, raw: Obj, path: string, fallbacks: Obj = {}): z.infer<S> {
    for (let attempt = 0; attempt < 500; attempt++) {
      const r = schema.safeParse(raw);
      if (r.success) return r.data;
      let fixed = false;
      for (const issue of r.error.issues) {
        const keys = issue.path.map(String);
        for (let n = keys.length; n > 0; n--) {
          const ref = this.refs.get([path, ...keys.slice(0, n)].join('.'));
          if (!ref) continue;
          const at = keys.slice(0, n);
          if (removeAt(raw, at)) {
            this.drop(ref.v, ref.label);
            this.dropped.add([path, ...at].join('.'));
            fixed = true;
          } else if (n === 1 && at[0]! in fallbacks && !(at[0]! in raw)) {
            raw[at[0]!] = fallbacks[at[0]!];
            fixed = true;
          }
          break;
        }
      }
      if (!fixed) throw new Error(`读表结果校验不过：${path} ${JSON.stringify(r.error.issues)}`);
    }
    throw new Error(`读表结果校验不过：${path}`);
  }

  sources(): Record<string, IntakeCellRef> {
    const out: Record<string, IntakeCellRef> = {};
    for (const [k, { v }] of this.refs) if (v.cell) out[k] = { sheet: v.sheet, cell: v.cell, row: v.row };
    return out;
  }
}

function removeAt(root: Obj, keys: string[]): boolean {
  let node: unknown = root;
  for (const k of keys.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return false;
    node = (node as Obj)[k];
  }
  const last = keys[keys.length - 1]!;
  if (node === null || typeof node !== 'object' || !(last in (node as Obj))) return false;
  if (Array.isArray(node)) node.splice(Number(last), 1);
  else delete (node as Obj)[last];
  return true;
}

const SITE_BY_NAME = new Map(
  (Object.entries(SITE_TYPES) as [SiteType, string][]).map(([k, name]) => [normalizeLabel(name), k]),
);
// 模板物资名称和物资清单的对应；对不上的不带 catalogKey，名称照客户写的
const SUPPLY_ALIASES: Record<string, SupplyKey> = {
  灭火器: 'fire_ext_portable',
  室内消防栓: 'hydrant_indoor',
  室内消火栓: 'hydrant_indoor',
  应急照明灯: 'emergency_light',
  疏散指示标志: 'exit_sign',
  安全绳: 'safety_rope',
};
for (const [k, def] of Object.entries(SUPPLY_CATALOG) as [SupplyKey, { name: string }][]) {
  SUPPLY_ALIASES[normalizeLabel(def.name)] ??= k;
}

const joinParts = (parts: [string, string][]) =>
  parts
    .filter(([, v]) => v)
    .map(([label, v]) => (label ? `${label} ${v}` : v))
    .join('；');

export function buildParseResult(read: WorkbookRead, now = new Date()): IntakeParseResult {
  const b = new Builder();
  const f = read.fields;
  const old = read.layout.old;

  // —— 企业身份四项 ——
  const identityRaw: Obj = {};
  b.put(identityRaw, 'identity', 'name', f.name, '企业名称');
  const code = f.creditCode;
  if (code?.text) {
    const upper = code.text.replace(/\s/g, '').toUpperCase();
    if (SOCIAL_CREDIT_CODE.test(upper)) b.put(identityRaw, 'identity', 'socialCreditCode', code, '统一社会信用代码', upper);
    else b.drop(code, '统一社会信用代码');
  }
  b.put(identityRaw, 'identity', 'legalRepresentative', f.legalRep, '法定代表人');
  b.put(identityRaw, 'identity', 'registeredAddress', f.regAddress, '注册地址');
  // 企业名称是空的、或超过 100 个字被移到 unplaced 的，也要能过校验：先占个位，
  // 后面换回空字符串（接口按任务的企业名称补；超长的缺项里有「企业名称」）
  const NAME_PLACEHOLDER = '-';
  const nameEmpty = !identityRaw.name;
  if (nameEmpty) identityRaw.name = NAME_PLACEHOLDER;
  const identityParsed = b.settle(enterpriseInputSchema, identityRaw, 'identity', { name: NAME_PLACEHOLDER });
  const identity = {
    name: nameEmpty || b.dropped.has('identity.name') ? '' : identityParsed.name,
    socialCreditCode: identityParsed.socialCreditCode ?? null,
    legalRepresentative: identityParsed.legalRepresentative ?? null,
    registeredAddress: identityParsed.registeredAddress ?? null,
  };

  // —— 第 1 步 企业基本信息 ——
  const basic: Obj = {};
  const sources: Partial<Record<string, FieldSource>> = {};
  const P = 'basic';
  b.put(basic, P, 'companyType', f.companyType, '企业类型');
  b.put(basic, P, 'registrationAuthority', f.authority, '登记机关');
  b.put(basic, P, 'registeredCapital', f.capital, '注册资本');
  b.put(basic, P, 'businessScope', f.scope, '经营范围');
  if (f.industry?.text) {
    const name = normalizeLabel(f.industry.text);
    const code = Object.entries(INDUSTRY_NAMES).find(([, n]) => normalizeLabel(n) === name)?.[0];
    if (code) b.put(basic, P, 'industry', f.industry, '所属行业', code);
    else b.put(basic, P, 'industryText', f.industry, '所属行业');
  }
  const site = f.siteAddress;
  if (site?.text && isSameAsRegistered(site.text)) {
    if (f.regAddress?.text) {
      b.put(basic, P, 'siteAddress', f.regAddress, '生产场所地址');
      sources.siteAddress = 'registered_address';
    }
  } else b.put(basic, P, 'siteAddress', site, '生产场所地址');
  if (f.otherAddresses?.text) {
    const list = splitList(f.otherAddresses.text);
    const kept = list.slice(0, MAX_OTHER_ADDRESSES);
    basic.otherAddresses = kept.map((address, i) => ({ id: `addr-${i + 1}`, address }));
    kept.forEach((_, i) => b.refs.set(`${P}.otherAddresses.${i}`, { v: f.otherAddresses!, label: '其他生产地址' }));
    if (list.length > kept.length) {
      b.drop({ ...f.otherAddresses, text: list.slice(kept.length).join('；') }, '其他生产地址（超过 9 处）');
    }
  }
  const park = parseYesNo(f.inPark?.text ?? '');
  if (park) b.put(basic, P, 'inPark', f.inPark, '是否位于园区', park);
  else if (f.inPark) b.drop(f.inPark, '是否位于园区');
  b.put(basic, P, 'parkManager', f.parkManager, '园区管理方名称');
  b.put(basic, P, 'parkDutyPhone', f.parkPhone, '园区值班电话');
  numberField(b, basic, P, 'landAreaM2', f.landArea, '厂区占地面积', parseNumber);
  numberField(b, basic, P, 'totalBuildingAreaM2', f.totalArea, '总建筑面积', parseNumber);
  b.put(basic, P, 'mainProducts', f.mainProducts, '主要产品');
  numberField(b, basic, P, 'employeeCount', f.employees, '员工人数', parseInteger);
  numberField(b, basic, P, 'technicalManagementCount', f.techCount, '技术管理人员', parseInteger);
  numberField(b, basic, P, 'safetyManagementCount', f.safetyCount, '安全管理人员', parseInteger);
  if (old) {
    // 旧版没有「安全生产主管负责人」，用法定代表人
    if (f.legalRep?.text) {
      b.put(basic, P, 'responsiblePerson', f.legalRep, '安全生产主管负责人');
      sources.responsiblePerson = 'legal_rep';
    }
  } else b.put(basic, P, 'responsiblePerson', f.responsible, '安全生产主管负责人');
  b.put(basic, P, 'contactPerson', f.contact, '联系人');
  b.put(basic, P, 'contactPhone', f.contactPhone, '联系人手机');
  b.put(basic, P, 'email', f.email, '电子邮箱');
  const basicStep = b.settle(basicStepSchema, basic, P);

  // —— 第 3 步 生产情况 ——
  const production: Obj = {};
  const Q = 'production';
  const sites: SiteType[] = [];
  const customSites: string[] = [];
  for (const r of read.sites.rows) {
    const c = r.cells;
    const name = normalizeLabel(c.name.text);
    const has = parseYesNo(c.has.text);
    if (name === normalizeLabel('其他场所')) {
      if (has !== 'no' && c.note.text) {
        for (const s of splitList(c.note.text)) {
          if (s.length <= 20 && customSites.length < 10) customSites.push(s);
          else b.drop({ ...c.note, text: s }, '其他场所');
        }
      }
      continue;
    }
    if (has !== 'yes') continue;
    const key = SITE_BY_NAME.get(name);
    if (key) {
      if (!sites.includes(key)) sites.push(key);
    } else if (c.name.text.length <= 20 && customSites.length < 10) customSites.push(c.name.text);
    else b.drop(c.name, '场所');
    if (c.note.text) b.drop(c.note, `${c.name.text}的补充说明`);
  }
  production.sites = sites;
  production.customSites = customSites;

  production.specialEquipment = specialEquipment(b, read, old);
  const other = otherSpecial(read, old);
  if (other.length) production.otherSpecialEquipment = other;

  const equipmentRows = read.equipment.rows.filter((r) => r.filled);
  production.equipment = limit(b, equipmentRows, 200, '设备（超过 200 台）').map((r, i) => {
    const c = r.cells;
    const e: Obj = { id: `e-${r.row}` };
    const path = `${Q}.equipment.${i}`;
    b.put(e, path, 'name', c.name, '设备名称');
    b.put(e, path, 'spec', c.spec, '规格型号');
    const qty = [c.qty.text, c.unit.text].filter(Boolean).join(' ');
    if (c.qty.text) b.put(e, path, 'quantity', c.qty, '设备数量', qty);
    b.put(e, path, 'location', c.location, '使用部门 / 地点');
    b.put(e, path, 'condition', c.condition, '使用状况');
    b.put(e, path, 'note', c.note, '设备备注');
    return e;
  });

  const unit = read.layout.fixedMaterialUnit;
  const materialRows = read.materials.rows.filter((r) => r.filled);
  production.materials = limit(b, materialRows, 200, '原辅料（超过 200 种）').map((r, i) => {
    const c = r.cells;
    const path = `${Q}.materials.${i}`;
    const cylinder = normalizeLabel(c.kind.text) === '气瓶';
    const m: Obj = { id: `m-${r.row}`, kind: cylinder ? 'cylinder' : 'material' };
    const u = unit ?? c.unit.text;
    const withUnit = (v: Val) => [v.text, u].filter(Boolean).join(' ');
    b.put(m, path, 'name', c.name, '物料名称');
    b.put(m, path, 'casNumber', c.cas, 'CAS 号');
    b.put(m, path, 'annualUsage', c.annual, '年用量', withUnit(c.annual));
    b.put(m, path, 'maxStorage', c.max, '最大存放量', withUnit(c.max));
    b.put(m, path, 'storageLocation', c.location, '存放位置');
    const spec = c.cylinder.text;
    b.put(m, path, 'cylinderSpec', c.cylinder, '气瓶规格', /^\d+(\.\d+)?$/.test(spec) ? `${spec}L` : spec);
    return m;
  });

  const leases = parseYesNo(f.leases?.text ?? '');
  if (leases === 'yes' || leases === 'no') b.put(production, Q, 'leasesPremises', f.leases, '厂中厂', leases === 'yes');
  if (f.tenants?.text) {
    const list = splitList(f.tenants.text);
    const ok = list.filter((t) => t.length <= 100).slice(0, 20);
    if (ok.length) production.tenants = ok;
    for (const t of list.filter((x) => !ok.includes(x))) b.drop({ ...f.tenants, text: t }, '承租企业名称');
  }
  const vehicles = parseYesNo(f.vehicles?.text ?? '');
  if (vehicles === 'yes' || vehicles === 'no') b.put(production, Q, 'ownVehicles', f.vehicles, '自有车辆', vehicles === 'yes');
  const v: Obj = {};
  b.put(v, `${Q}.vehicles`, 'count', f.vehicleCount, '车辆数量');
  b.put(v, `${Q}.vehicles`, 'location', f.vehicleLocation, '车辆停放位置');
  b.put(v, `${Q}.vehicles`, 'contact', f.vehicleContact, '车辆联系人');
  b.put(v, `${Q}.vehicles`, 'contactPhone', f.vehiclePhone, '车辆联系人电话');
  if (Object.keys(v).length) production.vehicles = v;
  const process: Obj = {};
  if (f.process?.text) {
    process.source = 'text';
    b.put(process, `${Q}.process`, 'description', f.process, '生产工艺');
  }
  production.process = process;
  const productionStep = b.settle(productionStepSchema, production, Q);

  // —— 第 2 步 应急组织 ——
  const org = readOrg(read);
  const R = 'organization';
  const personObj = (p: PersonVals, path: string, id: string, label: string): Obj | undefined => {
    if (!p.name.text && !p.phone.text && !p.position.text) return undefined;
    const o: Obj = { id, name: '' };
    b.put(o, path, 'name', p.name, `${label}姓名`);
    b.put(o, path, 'position', p.position, `${label}职务`);
    b.put(o, path, 'phone', p.phone, `${label}手机`);
    return o;
  };
  const orgRaw: Obj = { mode: 'form', compilationExtras: [] };
  const commander = personObj(org.commander, `${R}.commander`, 'p-commander', '总指挥');
  if (commander) orgRaw.commander = commander;
  const deputy = personObj(org.deputy, `${R}.deputies.0`, 'p-deputy', '副总指挥');
  orgRaw.deputies = deputy ? [deputy] : [];
  const kinds: PresetGroupKey[] = [...REQUIRED_GROUPS, ...OPTIONAL_GROUPS.filter((k) => org.groups[k].filled)];
  orgRaw.groups = kinds.map((kind, gi) => {
    const g = org.groups[kind];
    const path = `${R}.groups.${gi}`;
    const group: Obj = { id: `g-${kind}`, kind, name: PRESET_GROUPS[kind], members: [] };
    const leader = personObj(g.leader, `${path}.leader`, `p-${kind}-leader`, `${PRESET_GROUPS[kind]}组长`);
    if (leader) group.leader = leader;
    const members = g.members.slice(0, 30);
    group.members = members.map((m, mi) => personObj(m, `${path}.members.${mi}`, `p-${kind}-${m.name.row}`, `${PRESET_GROUPS[kind]}组员`));
    for (const m of g.members.slice(30)) b.dropRow([m.name, m.position, m.phone], `${PRESET_GROUPS[kind]}组员（超过 30 人）`);
    return group;
  });
  for (const r of org.unknownRows) b.dropRow([r.cells.group, r.cells.role, r.cells.name, r.cells.position, r.cells.phone], '应急小组');
  b.put(orgRaw, R, 'dutyPhone', f.dutyPhone, '24 小时值班电话');
  const organizationStep = b.settle(organizationStepSchema, orgRaw, R);

  // —— 第 4 步 应急资源 ——
  const res: Obj = {};
  const S = 'resources';
  const supplyRows = read.supplies.rows.filter((r) => r.filled);
  res.supplies = limit(b, supplyRows, 100, '应急物资（超过 100 项）').map((r, i) => {
    const c = r.cells;
    const path = `${S}.supplies.${i}`;
    const key = SUPPLY_ALIASES[normalizeLabel(c.name.text)];
    const s: Obj = { id: `s-${r.row}`, name: '' };
    if (key) {
      s.catalogKey = key;
      s.unit = SUPPLY_CATALOG[key].unit;
    }
    // 模板里灭火器那一格带红色 *，名称不带
    b.put(s, path, 'name', c.name, '物资名称', c.name.text.replace(/^\*\s*/, ''));
    numberField(b, s, path, 'quantity', c.qty, `${c.name.text || '物资'}数量`, parseInteger);
    b.put(s, path, 'location', c.location, '物资存放位置');
    b.put(s, path, 'keeper', c.keeper, '保管人');
    b.put(s, path, 'keeperPhone', c.keeperPhone, '保管人电话');
    b.put(s, path, 'status', c.status, '物资状态');
    return s;
  });

  const aidRows = read.firstAid?.rows.filter((r) => r.filled && r.cells.name.text) ?? [];
  if (aidRows.length) {
    res.firstAidKit = {
      answer: 'yes',
      mode: 'manual',
      items: limit(b, aidRows, 50, '急救药品（超过 50 项）').map((r, i) => {
        const c = r.cells;
        const path = `${S}.firstAidKit.items.${i}`;
        const item: Obj = { id: `fa-${r.row}`, name: '' };
        b.put(item, path, 'name', c.name, '药品名称');
        numberField(b, item, path, 'quantity', c.qty, `${c.name.text}数量`, parseInteger);
        b.put(item, path, 'unit', c.unit, '药品单位');
        return item;
      }),
    };
  } else {
    // 一行都没填：按常规配置（模板里写的 7 样）
    res.firstAidKit = { mode: 'standard', items: standardFirstAidItems().map((it, i) => ({ ...it, id: `fa-std-${i + 1}` })) };
  }

  const pool: Obj = {};
  const poolAnswer = parseYesNo(f.pool?.text ?? '');
  if (poolAnswer === 'yes' || poolAnswer === 'no') b.put(pool, `${S}.firePool`, 'answer', f.pool, '消防水池', poolAnswer);
  else if (f.pool?.text) b.drop(f.pool, '消防水池');
  numberField(b, pool, `${S}.firePool`, 'volumeM3', f.poolVolume, '消防水池容量', parseNumber);
  b.put(pool, `${S}.firePool`, 'location', f.poolLocation, '消防水池位置');
  res.firePool = pool;

  const buildingRows = read.buildings.rows.filter((r) => r.filled);
  res.buildings = limit(b, buildingRows, 50, '建筑（超过 50 栋）').map((r, i) => {
    const c = r.cells;
    const path = `${S}.buildings.${i}`;
    const o: Obj = { id: `b-${r.row}`, name: '' };
    b.put(o, path, 'name', c.name, '建筑名称');
    const floors = parseInteger(c.floors.text);
    if (floors !== null && floors >= 1) b.put(o, path, 'floors', c.floors, '层数', floors);
    else b.drop(c.floors, '层数');
    const area = parseNumber(c.area.text);
    if (area !== null) b.put(o, path, 'areaM2', c.area, '建筑面积', area);
    else b.drop(c.area, '建筑面积');
    const rating = parseFireRating(c.fireRating.text);
    o.fireRating = rating ?? 'expert';
    if (rating) b.refs.set(`${path}.fireRating`, { v: c.fireRating, label: '耐火等级' });
    // 写「不清楚」的交给专家，不算放不进去
    else if (normalizeLabel(c.fireRating.text) !== '不清楚') b.drop(c.fireRating, '耐火等级');
    b.put(o, path, 'structure', c.structure, '结构类型');
    b.put(o, path, 'use', c.use, '用途');
    return o;
  });

  contacts(b, read, res, S);
  const resourcesStep = b.settle(resourcesStepSchema, res, S);

  return {
    templateVersion: read.templateVersion,
    identity,
    profile: {
      basicStep: { basic: basicStep, later: [], sources },
      organizationStep: { step: organizationStep, rosterFileIds: [] },
      productionStep: { step: productionStep },
      resourcesStep: { step: resourcesStep },
    },
    sources: b.sources(),
    unplaced: b.unplaced,
    parsedAt: now.toISOString(),
  };
}

function numberField(
  b: Builder,
  target: Obj,
  path: string,
  key: string,
  v: Val | undefined,
  label: string,
  parse: (t: string) => number | null,
) {
  if (!v?.text) return;
  const n = parse(v.text);
  if (n === null) b.drop(v, label);
  else b.put(target, path, key, v, label, n);
}

function limit<K extends string>(b: Builder, rows: ReadRow<K>[], max: number, label: string): ReadRow<K>[] {
  for (const r of rows.slice(max)) b.dropRow(Object.values(r.cells) as Val[], label);
  return rows.slice(0, max);
}

// —— 特种设备 ——
type SpecialRow = ReadRow<'category' | 'has' | 'ident' | 'medium' | 'qty' | 'unit' | 'params' | 'location' | 'note'>;
const CATEGORY: Record<string, 'pressureVessels' | 'boilers' | 'pressurePipelines' | 'storageTanks' | 'other'> = {
  压力容器: 'pressureVessels',
  锅炉: 'boilers',
  压力管道: 'pressurePipelines',
  储罐: 'storageTanks',
  油库: 'storageTanks',
  其他: 'other',
};

/** 新版看「有无」列；旧版没有这一列，B–F 有内容就算有 */
function specialAnswer(r: SpecialRow, old: boolean): 'yes' | 'no' | null {
  if (old) return r.filled ? 'yes' : null;
  const a = parseYesNo(r.cells.has.text);
  if (a === 'yes' || a === 'no') return a;
  return r.filled ? 'yes' : null;
}

const qtyOf = (c: SpecialRow['cells']) => [c.qty.text, c.unit.text].filter(Boolean).join(' ');

function specialEquipment(b: Builder, read: WorkbookRead, old: boolean): Obj {
  const out: Record<string, { answer?: 'yes' | 'no'; items: Obj[] }> = {
    pressureVessels: { items: [] },
    boilers: { items: [] },
    pressurePipelines: { items: [] },
    storageTanks: { items: [] },
  };
  for (const r of read.special.rows) {
    const cat = CATEGORY[normalizeLabel(r.cells.category.text)];
    if (!cat || cat === 'other') continue;
    const answer = specialAnswer(r, old);
    if (!answer) continue;
    const slot = out[cat]!;
    if (answer === 'no') {
      slot.answer ??= 'no';
      continue;
    }
    slot.answer = 'yes';
    const c = r.cells;
    const id = `sp-${r.row}`;
    // 名称或编号、数量、位置、备注等放不进专门字段的，拼成一句放 note
    const rest = joinParts([
      ['名称或编号', c.ident.text],
      ['数量', qtyOf(c)],
      ['位置', c.location.text],
      ['备注', c.note.text],
    ]);
    let item: Obj;
    if (cat === 'pressureVessels') {
      const mpa = /([\d.]+)\s*MPa/i.exec(c.params.text)?.[1];
      const vol = /([\d.]+)\s*(m³|m3|立方)/i.exec(c.params.text)?.[1];
      item = { id, medium: c.medium.text || undefined };
      if (mpa && !Number.isNaN(Number(mpa))) item.maxWorkingPressureMPa = Number(mpa);
      if (vol && !Number.isNaN(Number(vol))) item.volumeM3 = Number(vol);
      item.note = joinParts([['参数', c.params.text], ['', rest]]) || undefined;
    } else if (cat === 'boilers') {
      const words = `${c.medium.text}${c.ident.text}${c.params.text}`;
      const type = /导热油|有机热载体/.test(words)
        ? 'thermal_oil'
        : /热水/.test(words)
          ? 'hot_water'
          : /蒸汽/.test(words)
            ? 'steam'
            : undefined;
      item = { id, type, ratedParams: c.params.text || undefined };
      item.note = joinParts([['介质或类型', type && c.medium.text === BOILER_TYPES[type] ? '' : c.medium.text], ['', rest]]) || undefined;
    } else if (cat === 'pressurePipelines') {
      const dn = /DN\s*\d+/i.exec(c.params.text)?.[0];
      item = { id, medium: c.medium.text || undefined, nominalDiameter: dn };
      item.note = joinParts([['参数', c.params.text], ['', rest]]) || undefined;
    } else {
      const isDepot = normalizeLabel(c.category.text) === '油库';
      item = {
        id,
        substance: c.medium.text || undefined,
        capacity: qtyOf(c) || undefined,
      };
      item.note =
        joinParts([
          ['', isDepot ? '油库' : ''],
          ['名称或编号', c.ident.text],
          ['参数', c.params.text],
          ['位置', c.location.text],
          ['备注', c.note.text],
        ]) || undefined;
    }
    // 各字段长度有上限，超长的整格放 unplaced
    const path = `production.specialEquipment.${cat}.items.${slot.items.length}`;
    for (const [k, val] of Object.entries(item)) {
      if (val === undefined) delete item[k];
      else if (k !== 'id') b.refs.set(`${path}.${k}`, { v: { ...c.category, text: String(val) }, label: `${c.category.text}` });
    }
    slot.items.push(item);
  }
  for (const k of Object.keys(out)) {
    const slot = out[k]!;
    if (slot.items.length > 20) {
      for (const it of slot.items.slice(20)) b.drop({ ...read.special.rows[0]!.cells.category, text: JSON.stringify(it) }, k);
      slot.items = slot.items.slice(0, 20);
    }
  }
  return out;
}

function otherSpecial(read: WorkbookRead, old: boolean): Obj[] {
  return read.special.rows
    .filter((r) => CATEGORY[normalizeLabel(r.cells.category.text)] === 'other' && specialAnswer(r, old) === 'yes')
    .map((r) => {
      const c = r.cells;
      const description = joinParts([
        ['', c.medium.text],
        ['', c.ident.text],
        ['数量', qtyOf(c)],
        ['参数', c.params.text],
        ['位置', c.location.text],
        ['备注', c.note.text],
      ]);
      return { id: `os-${r.row}`, description: description.slice(0, 200) };
    })
    .filter((o) => o.description)
    .slice(0, 20);
}

// —— 周边可以求助的单位 ——
function contacts(b: Builder, read: WorkbookRead, res: Obj, S: string) {
  const neighbors: Obj[] = [];
  const parties: string[] = [];
  const others: Obj[] = [];
  let hospital: Obj | undefined;
  for (const r of read.contacts.rows.filter((x) => x.filled)) {
    const c = r.cells;
    const type = normalizeLabel(c.type.text);
    if (type === '就近医院' && !hospital) {
      hospital = {};
      b.put(hospital, `${S}.hospital`, 'name', c.name, '就近医院');
      b.put(hospital, `${S}.hospital`, 'phone', c.phone, '就近医院电话');
      b.put(hospital, `${S}.hospital`, 'note', c.note, '就近医院备注');
      continue;
    }
    if ((type === '周边企业' || type === '周围企业') && c.name.text) {
      const path = `${S}.neighbors.items.${neighbors.length}`;
      const n: Obj = { id: `n-${r.row}`, name: '' };
      b.put(n, path, 'name', c.name, '周边企业');
      const contact = [c.phone.text, c.note.text].filter(Boolean).join(' ');
      if (contact) b.put(n, path, 'contact', c.phone.text ? c.phone : c.note, '周边企业联系方式', contact);
      neighbors.push(n);
      continue;
    }
    if (type === '协议救援单位' && c.name.text) {
      parties.push(c.name.text);
      // 电话、备注放进其他联系单位，免得丢
      if (!c.phone.text && !c.note.text) continue;
    }
    const path = `${S}.otherContacts.${others.length}`;
    const o: Obj = { id: `c-${r.row}` };
    b.put(o, path, 'type', c.type, '单位类型');
    b.put(o, path, 'name', c.name, '单位名称');
    b.put(o, path, 'phone', c.phone, '单位电话');
    b.put(o, path, 'note', c.note, '单位备注');
    others.push(o);
  }
  if (neighbors.length) res.neighbors = { answer: 'has', items: neighbors.slice(0, 20) };
  if (parties.length) {
    res.rescueAgreement = { answer: 'yes', parties: parties.join('、') };
    b.refs.set(`${S}.rescueAgreement.parties`, {
      v: read.contacts.rows.find((r) => normalizeLabel(r.cells.type.text) === '协议救援单位')!.cells.name,
      label: '协议救援单位',
    });
  }
  if (hospital && Object.keys(hospital).length) res.hospital = hospital;
  if (others.length) res.otherContacts = others.slice(0, 20);
}
