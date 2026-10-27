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
