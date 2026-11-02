// 企业自填上传的文件哪些进企业资料库、归哪一类（TECH-PLAN 3.4.2）。分类按填写位置定，用资料清单的 6 类。
// 铭牌、包装标签、药箱照片是零散照片，只留在自填内容里，不进资料库
import type { Category } from '../checklist/items.ts';
import type { EnterpriseProfile } from './basic-step.ts';

export interface LibraryFile {
  fileId: string;
  category: Category;
}

export function libraryFilesOf(profile: EnterpriseProfile): LibraryFile[] {
  const out: LibraryFile[] = [];
  const add = (ids: readonly string[] | undefined, category: Category) => {
    for (const fileId of ids ?? []) out.push({ fileId, category });
  };
  const { basicStep, organizationStep, productionStep, resourcesStep } = profile;
  if (basicStep?.licenseFileId) add([basicStep.licenseFileId], 'basic');
  add(organizationStep?.rosterFileIds, 'organization');
  if (productionStep) {
    const { step } = productionStep;
    add(step.ledgers.equipment, 'production');
    add(step.process.sketchFileIds, 'production');
    add(step.ledgers.materials, 'materials');
  }
  if (resourcesStep) {
    const { step } = resourcesStep;
    add(step.supplyLedgerFileIds, 'resources');
    // 消防验收资料跟建筑走（资料清单里建筑属于企业基本资料）
    add(step.fireAcceptanceFileIds, 'basic');
    add(Object.values(step.msds).flatMap((m) => m.fileIds), 'materials');
    add(Object.values(step.drawings).flat(), 'drawings');
  }
  // 同一文件出现在两处时按先出现的算
  const seen = new Set<string>();
  return out.filter((f) => !seen.has(f.fileId) && seen.add(f.fileId));
}

// 企业档案里引用的所有文件（M3 第 7 项：判断成员能不能看某个文件）。比资料库多出铭牌、包装标签、药箱等零散照片。
// 按字段逐个取，不在整段内容里搜文本：自由填写的地址、说明里写进别家的文件 ID 不算引用。
// 存下来的内容可能是早期版本、缺字段，所以每一层都按可能缺失来取
export function profileFileIdsOf(profile: EnterpriseProfile | null | undefined): string[] {
  if (!profile) return [];
  const ids: (string | undefined)[] = [];
  const add = (list: readonly (string | undefined)[] | undefined) => {
    if (Array.isArray(list)) ids.push(...list);
  };
  ids.push(profile.basicStep?.licenseFileId);
  add(profile.organizationStep?.rosterFileIds);
  const production = profile.productionStep?.step;
  if (production) {
    add(production.ledgers?.equipment);
    add(production.ledgers?.materials);
    add(production.process?.sketchFileIds);
    for (const c of Object.values(production.specialEquipment ?? {})) add((c as { photoFileIds?: string[] } | undefined)?.photoFileIds);
    for (const m of production.materials ?? []) add(m?.labelPhotoFileIds);
  }
  const resources = profile.resourcesStep?.step;
  if (resources) {
    add(resources.supplyLedgerFileIds);
    add(resources.fireAcceptanceFileIds);
    add(resources.firstAidKit?.photoFileIds);
    for (const m of Object.values(resources.msds ?? {})) add(m?.fileIds);
    for (const d of Object.values(resources.drawings ?? {})) add(d);
  }
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
}
