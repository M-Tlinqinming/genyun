import { PRESET_GROUPS, type DraftPerson, type OrganizationStep } from '@genyun/shared';

// 第 2 步的人员：按 id 改（同一人兼任几处时一起改）、校验、保存前清理

export type PersonField = 'name' | 'position' | 'phone';

const filled = (v: string | undefined) => Boolean(v && v.trim());

/** 手机号：只拦明显填错的（不是数字、1 开头却不是 11 位）；座机不拦，由客服核实 */
export function phoneError(phone: string | undefined): string | undefined {
  const v = (phone ?? '').trim();
  if (!v) return undefined;
  const digits = v.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return '手机号只能填数字';
  if (digits.startsWith('1') && digits.length !== 11) {
    return digits.length < 11 ? `手机号是 11 位，少了 ${11 - digits.length} 位` : `手机号是 11 位，多了 ${digits.length - 11} 位`;
  }
  return undefined;
}

export function personErrors(p: DraftPerson | undefined): Partial<Record<PersonField, string>> {
  if (!p) return {};
  const e: Partial<Record<PersonField, string>> = {};
  if (!filled(p.name) && (filled(p.phone) || filled(p.position))) e.name = '请填姓名';
  const phone = phoneError(p.phone);
  if (phone) e.phone = phone;
  return e;
}

/** 这一步所有人（含重复出现的），按出现顺序 */
export function allPeople(step: OrganizationStep): DraftPerson[] {
  return [step.commander, ...step.deputies, ...step.groups.flatMap((g) => [g.leader, ...g.members])].filter((p): p is DraftPerson => Boolean(p));
}

/** 有错的项：键为「人员 id:字段」 */
export function stepErrors(step: OrganizationStep): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of allPeople(step)) {
    for (const [f, msg] of Object.entries(personErrors(p))) out.set(`${p.id}:${f}`, msg);
  }
  return out;
}

/** 按 id 改一个人（兼任几处的一起改） */
export function updatePerson(step: OrganizationStep, id: string, patch: Partial<DraftPerson>): OrganizationStep {
  const fix = (p: DraftPerson | undefined) => (p && p.id === id ? { ...p, ...patch } : p);
  return {
    ...step,
    commander: fix(step.commander),
    deputies: step.deputies.map((d) => fix(d)!),
    groups: step.groups.map((g) => ({ ...g, leader: fix(g.leader), members: g.members.map((m) => fix(m)!) })),
  };
}

const empty = (p: DraftPerson | undefined) => !p || (!filled(p.name) && !filled(p.phone) && !filled(p.position));
const trimmed = (p: DraftPerson): DraftPerson => {
  const out: DraftPerson = { id: p.id, name: p.name.trim() };
  if (filled(p.position)) out.position = p.position!.trim();
  if (filled(p.phone)) out.phone = p.phone!.trim();
  return out;
};

/**
 * 保存用的那份：空行去掉；有错的人先用上次存上的样子（新加的还没存过就先不存），
 * 改对了再一起存。返回 null 表示这一人这次不存
 */
export function stepForSave(step: OrganizationStep, saved: OrganizationStep): OrganizationStep {
  const errors = stepErrors(step);
  const before = new Map(allPeople(saved).map((p) => [p.id, p]));
  const pick = (p: DraftPerson | undefined): DraftPerson | undefined => {
    if (empty(p)) return undefined;
    const bad = [...errors.keys()].some((k) => k.startsWith(`${p!.id}:`));
    if (!bad) return trimmed(p!);
    const prev = before.get(p!.id);
    return prev && !empty(prev) ? trimmed(prev) : undefined;
  };
  return {
    ...step,
    commander: pick(step.commander),
    deputies: step.deputies.map(pick).filter((p): p is DraftPerson => Boolean(p)),
    groups: step.groups.map((g) => ({
      ...g,
      leader: pick(g.leader),
      members: g.members.map(pick).filter((p): p is DraftPerson => Boolean(p)),
    })),
    dutyPhone: step.dutyPhone?.trim() || undefined,
  };
}

export const groupTitle = (g: OrganizationStep['groups'][number]) =>
  (g.kind === 'custom' ? g.name || '自定义小组' : g.name || PRESET_GROUPS[g.kind]).trim();

/** 这个人现在在哪些位置（总指挥、副总指挥、某组组长 / 组员） */
export function rolesOf(step: OrganizationStep, id: string): string[] {
  const out: string[] = [];
  if (step.commander?.id === id) out.push('总指挥');
  if (step.deputies.some((d) => d.id === id)) out.push('副总指挥');
  for (const g of step.groups) {
    if (g.leader?.id === id) out.push(`${groupTitle(g)}组长`);
    else if (g.members.some((m) => m.id === id)) out.push(groupTitle(g));
  }
  return out;
}
