import type { IntakeFileView, IntakeView } from '@genyun/shared';
import { describe, expect, it } from 'vitest';
import { currentRows, deleteBody, materialsIntro, submitHint, submittedRows, when } from './materialRows';

const file = (slot: IntakeFileView['slot'], name: string): IntakeFileView => ({
  id: `${slot}-${name}`,
  fileId: `f-${name}`,
  slot,
  originalName: name,
  sizeBytes: 1024,
  contentType: 'application/pdf',
  uploadedAt: '2026-11-20T02:24:00.000Z',
  uploadedByExpert: false,
});

const base: IntakeView = {
  taskId: 't1',
  canEdit: true,
  dataSheet: {
    file: file('data_sheet', '资料表格.xlsx'),
    status: 'read',
    templateVersion: '2026.11',
    oldTemplate: false,
    sheets: Array.from({ length: 6 }, (_, i) => ({ name: `表${i}`, missing: 0 })),
  },
  sitePlan: file('site_plan', '总平面.pdf'),
  evacuationMaps: [file('evacuation_map', '一楼.png'), file('evacuation_map', '二楼.png')],
  others: [file('other', '营业执照.jpg')],
  requiredCheck: { missing: [], optional: [], checkedAt: '2026-11-20T02:24:00.000Z' },
  warnings: [],
  noEvacuationMap: false,
  otherEnterprise: null,
  previousSheet: null,
  updatedAt: '2026-11-20T02:24:00.000Z',
  submission: null,
  withdrawnAt: null,
  canWithdraw: false,
  expertStarted: false,
};

const pick = (rows: ReturnType<typeof currentRows>) => rows.map((r) => `${r.name}｜${r.note}${r.warn ? '｜警告' : ''}`);

describe('资料清单', () => {
  it('确认弹窗：表格、总平面、每张疏散图、每个其他文件各一行', () => {
    expect(pick(currentRows(base))).toEqual([
      '资料表格.xlsx｜6 张表 · 必填已齐',
      '总平面.pdf｜总平面布置图',
      '一楼.png｜紧急疏散示意图',
      '二楼.png｜紧急疏散示意图',
      '营业执照.jpg｜其他图纸与照片',
    ]);
  });

  it('说明了没有疏散图：排在总平面布置图后面，警告色，没有下载', () => {
    const rows = currentRows({ ...base, evacuationMaps: [], noEvacuationMap: true });
    expect(pick(rows)).toEqual([
      '资料表格.xlsx｜6 张表 · 必填已齐',
      '总平面.pdf｜总平面布置图',
      '紧急疏散示意图｜已说明没有这张图｜警告',
      '营业执照.jpg｜其他图纸与照片',
    ]);
    expect(rows[2]!.fileId).toBeNull();
    expect(pick(currentRows({ ...base, evacuationMaps: [], others: [], noEvacuationMap: true })).at(-1)).toBe(
      '紧急疏散示意图｜已说明没有这张图｜警告',
    );
  });

  it('已提交页：取快照，按资料种类排，说明了没有疏散图的换成客服会联系的说法', () => {
    const v: IntakeView = {
      ...base,
      submission: {
        submittedAt: '2026-11-16T02:40:00.000Z',
        submittedByName: '林管理员',
        noEvacuationMap: true,
        files: [
          { fileId: 'f-现场.png', slot: 'other', originalName: '现场.png' },
          { fileId: 'f-资料表格.xlsx', slot: 'data_sheet', originalName: '资料表格.xlsx' },
          { fileId: 'f-总平面.pdf', slot: 'site_plan', originalName: '总平面.pdf' },
        ],
      },
    };
    expect(pick(submittedRows(v))).toEqual([
      '资料表格.xlsx｜6 张表 · 必填已齐',
      '总平面.pdf｜总平面布置图',
      '紧急疏散示意图｜您说明没有这张图，客服会联系您补上｜警告',
      '现场.png｜其他图纸与照片',
    ]);
    expect(submittedRows(base)).toEqual([]);
  });
});

describe('随状态变的文字', () => {
  it('确认弹窗的提示：撤回过的换一句', () => {
    expect(submitHint(base)).toBe('提交后，专家开始核对之前可以撤回一次；专家开始核对后不能再改。完成后会通知您。');
    expect(submitHint({ ...base, withdrawnAt: '2026-11-20T02:52:00.000Z' })).toBe('这次提交后不能再撤回。完成后会通知您。');
  });

  it('删除弹窗：撤回过的最后一句换掉', () => {
    expect(deleteBody('示例电器有限公司', base)).toBe(
      '示例电器有限公司的这次任务，连同已传的表格、图纸和照片会一起删掉，删了找不回来。还没提交，不扣编制次数。',
    );
    expect(deleteBody('示例电器', { ...base, withdrawnAt: '2026-11-20T02:52:00.000Z' })).toMatch(/已经撤回了，不扣编制次数。$/);
  });

  it('资料卡片副标题：能撤回、专家已开始、撤回过、没有编辑权限', () => {
    expect(materialsIntro({ ...base, canWithdraw: true })).toEqual({
      text: '发现填错了？专家开始核对之前可以撤回一次，改好再提交。',
      withdraw: true,
    });
    expect(materialsIntro({ ...base, expertStarted: true, withdrawnAt: '2026-11-20T02:52:00.000Z' }).text).toBe(
      '专家已经开始核对，不能再修改。发现填错了，请联系客服。',
    );
    expect(materialsIntro({ ...base, withdrawnAt: '2026-11-20T02:52:00.000Z' }).text).toBe(
      '已经撤回过一次，不能再撤回。发现填错了，请联系客服。',
    );
    expect(materialsIntro(base)).toEqual({ text: '发现填错了，请联系客服。', withdraw: false });
  });

  it('提交时间写成「11 月 16 日 10:40」', () => {
    expect(when('2026-11-16T02:40:00.000Z', new Date('2026-11-20T00:00:00.000Z'))).toBe('11 月 16 日 10:40');
  });
});
