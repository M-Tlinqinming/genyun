import type { IntakeFileView, IntakeMissingItem, IntakeView } from '@genyun/shared';
import { describe, expect, it } from 'vitest';
import {
  clock,
  dayLabel,
  footerNote,
  formatSize,
  headline,
  missingDrawings,
  optionalLine,
  optionalNote,
  optionalSummary,
  phaseOf,
  shortName,
  stamp,
} from './intakeText';

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

const empty: IntakeView = {
  taskId: 't1',
  canEdit: true,
  dataSheet: null,
  sitePlan: null,
  evacuationMaps: [],
  others: [],
  requiredCheck: null,
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

const sheetMissing = (label: string): IntakeMissingItem => ({
  field: `x.${label}`,
  label,
  sheet: '企业信息',
  row: 5,
  cell: 'C5',
  note: '没填。',
});
const drawingMissing: IntakeMissingItem = {
  field: 'drawing.evacuation_plan',
  label: '紧急疏散示意图',
  sheet: null,
  row: null,
  cell: null,
  note: '还没传。',
};

const readView = (missing: IntakeMissingItem[], optional = 0): IntakeView => ({
  ...empty,
  dataSheet: {
    file: file('data_sheet', '资料.xlsx'),
    status: 'read',
    templateVersion: '2026.11',
    oldTemplate: false,
    sheets: [{ name: '企业信息', missing: missing.length }],
  },
  requiredCheck: {
    missing,
    optional: Array.from({ length: optional }, (_, i) => ({ field: `o${i}`, label: `选填${i}`, sheet: '企业信息' })),
    checkedAt: '2026-11-20T02:24:00.000Z',
  },
});

describe('准备资料页：步骤和标题', () => {
  it('没传表格是下载模板；以前提交过的是在上次的表上改', () => {
    expect(phaseOf(empty)).toBe('template');
    expect(headline(empty).title).toBe('先下载资料模板，填好后传上来');
    const prev = { ...empty, previousSheet: { fileId: 'p', originalName: '上次.xlsx', submittedAt: '2026-11-16T02:00:00Z' } };
    expect(phaseOf(prev)).toBe('previous');
  });

  it('不是模板、别家企业各有标题，副标题相同', () => {
    const notTemplate: IntakeView = {
      ...empty,
      dataSheet: { file: file('data_sheet', '清单.xlsx'), status: 'not_template', templateVersion: null, oldTemplate: false, sheets: [] },
    };
    expect(phaseOf(notTemplate)).toBe('not_template');
    expect(headline(notTemplate).title).toBe('这份文件读不了，请用资料模板重新上传');
    expect(headline(notTemplate).subtitle).toBe(headline(empty).subtitle);
  });

  it('读到表格、缺必填：分开数回表格改的和直接传的图', () => {
    const v = readView([sheetMissing('企业名称'), sheetMissing('从业人数'), drawingMissing], 3);
    expect(headline(v)).toEqual({
      title: '表格已读取，还差 3 项必填',
      subtitle: '2 项回表格改好后重新上传，1 张图直接在这里传。选填没填的不用管，专家会补。',
    });
    expect(footerNote(v)).toBe('还差 3 项必填，补齐后可以提交');
    expect(missingDrawings(v)).toBe(1);
  });

  it('必填齐了：有选填没填才提一句', () => {
    expect(headline(readView([], 7)).subtitle).toBe(
      '表格里的必填都填了，2 张必填图也处理好了。下面 7 项选填没填，可以不填，专家编制时会补。',
    );
    expect(headline(readView([])).subtitle).toBe('表格里的必填都填了，2 张必填图也处理好了。');
    expect(footerNote(readView([]))).toBe('必填已齐，提交后专家开始核对');
  });

  it('撤回过一次：必填齐了提示再提交后不能撤回，没齐照旧', () => {
    const withdrawnAt = '2026-11-20T02:52:00.000Z';
    expect(footerNote({ ...readView([]), withdrawnAt })).toBe('这次提交后不能再撤回');
    expect(footerNote({ ...empty, withdrawnAt })).toBe('还差资料表格和 2 张必填图，传齐后可以提交');
  });

  it('还没读到表格时，底部按图纸算还差几张', () => {
    expect(footerNote(empty)).toBe('还差资料表格和 2 张必填图，传齐后可以提交');
    const oneMap = { ...empty, sitePlan: file('site_plan', '总平面.pdf') };
    expect(footerNote(oneMap)).toBe('还差资料表格和 1 张必填图，传齐后可以提交');
    expect(footerNote({ ...oneMap, noEvacuationMap: true })).toBe('还差资料表格，传齐后可以提交');
  });
});

describe('准备资料页：选填和其他文字', () => {
  it('选填提示取前两项，「年用量」写成「物料年用量」', () => {
    const items = [
      { field: 'a', label: '规格型号', sheet: '生产与设备' },
      { field: 'b', label: '年用量', sheet: '原辅料与危化品' },
      { field: 'c', label: '注册资本', sheet: '企业信息' },
    ];
    expect(optionalSummary(items)).toBe('另有 3 项选填没填（如规格型号、物料年用量），可以不填，专家编制时会补。');
    expect(optionalSummary([])).toBeNull();
  });

  it('按列算的选填带数量和量词', () => {
    const item = { field: 'b', label: '结构类型', sheet: '建筑与场所', count: 2, unitWord: '栋' };
    expect(optionalNote(item)).toBe('2 栋没填。');
    expect(optionalNote({ field: 'organization.medical', label: '医疗救护组组长', sheet: '应急组织', note: '员工 100 人以上，5 个组都要有组长。' })).toBe('员工 100 人以上，5 个组都要有组长。');
    expect(optionalNote({ field: 'x', label: 'x', sheet: '企业信息' })).toBe('没填。');
    expect(optionalLine(item)).toBe('建筑与场所：结构类型（2 栋没填）');
    expect(optionalNote({ field: 'c', label: '注册资本', sheet: '企业信息' })).toBe('没填。');
  });

  it('时间按北京时间，今天的写「今天」', () => {
    const now = new Date('2026-11-20T08:00:00Z');
    expect(clock('2026-11-20T02:24:00Z')).toBe('10:24');
    expect(stamp('2026-11-20T02:24:00Z', now)).toBe('今天 10:24');
    expect(stamp('2026-11-16T02:24:00Z', now)).toBe('11 月 16 日 10:24');
    expect(dayLabel('2025-11-16T02:24:00Z', now)).toBe('2025 年 11 月 16 日');
  });

  it('文件大小、企业简称', () => {
    expect(formatSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(formatSize(300)).toBe('1 KB');
    expect(shortName('示例电子有限公司')).toBe('示例电子');
    expect(shortName('示例化工股份有限公司')).toBe('示例化工');
    expect(shortName('公司')).toBe('公司');
  });
});
