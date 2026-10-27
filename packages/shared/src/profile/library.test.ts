import { describe, expect, it } from 'vitest';
import { libraryFilesOf } from './library.ts';
import { productionStepSchema } from './production-step.ts';
import { resourcesStepSchema } from './resources-step.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('自填文件进企业资料库', () => {
  it('执照、花名册、台账、流程图、MSDS、图纸、消防验收资料按填写位置分类；零散照片不进库', () => {
    const files = libraryFilesOf({
      basicStep: { basic: {}, later: [], sources: {}, licenseFileId: id(1) },
      organizationStep: { rosterFileIds: [id(2)], step: { mode: 'roster', deputies: [], groups: [], compilationExtras: [] } },
      productionStep: {
        step: productionStepSchema.parse({
          ledgers: { equipment: [id(3)], materials: [id(4)] },
          materials: [{ id: 'm1', name: '油漆', labelPhotoFileIds: [id(90)] }],
          process: { sketchFileIds: [id(5)] },
        }),
      },
      resourcesStep: {
        step: resourcesStepSchema.parse({
          supplyLedgerFileIds: [id(6)],
          fireAcceptanceFileIds: [id(7)],
          msds: { m1: { fileIds: [id(8)] } },
          drawings: { site_plan: [id(9)], evacuation_plan: [id(10)] },
          firstAidKit: { answer: 'yes', mode: 'photo', photoFileIds: [id(91)] },
        }),
      },
    });
    expect(files).toEqual([
      { fileId: id(1), category: 'basic' },
      { fileId: id(2), category: 'organization' },
      { fileId: id(3), category: 'production' },
      { fileId: id(5), category: 'production' },
      { fileId: id(4), category: 'materials' },
      { fileId: id(6), category: 'resources' },
      { fileId: id(7), category: 'basic' },
      { fileId: id(8), category: 'materials' },
      { fileId: id(9), category: 'drawings' },
      { fileId: id(10), category: 'drawings' },
    ]);
  });

  it('什么都没传时为空；同一文件只算一次', () => {
    expect(libraryFilesOf({})).toEqual([]);
    const step = resourcesStepSchema.parse({ drawings: { site_plan: [id(1)], fire_facility_plan: [id(1)] } });
    expect(libraryFilesOf({ resourcesStep: { step } })).toEqual([{ fileId: id(1), category: 'drawings' }]);
  });
});
