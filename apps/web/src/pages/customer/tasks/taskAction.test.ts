import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '../../../api/enterprises';
import { taskAction } from './shared';

// 每种状态的按钮文字和去处：准备资料的三种都去准备资料页，专家编制看任务，已交付看成果
const task = (key: string, stage = 0, delivery: TaskSummary['delivery'] = null) =>
  ({ id: 't1', view: { key, stage }, delivery }) as unknown as TaskSummary;

describe('taskAction', () => {
  it('准备资料：去上传、去补齐、去提交都到准备资料页', () => {
    expect(taskAction(task('preparing_no_table'), 'workbench')).toEqual({ label: '去上传', to: '/customer/tasks/t1/prepare' });
    expect(taskAction(task('preparing_missing'), 'workbench')).toEqual({ label: '去补齐', to: '/customer/tasks/t1/prepare' });
    expect(taskAction(task('preparing_ready'), 'list')).toEqual({ label: '去提交', to: '/customer/tasks/t1/prepare' });
  });

  it('专家编制：工作台写「查看进度」，列表写「查看」，都到任务页', () => {
    expect(taskAction(task('expert_working', 1), 'workbench')).toEqual({ label: '查看进度', to: '/customer/tasks/t1' });
    expect(taskAction(task('expert_working', 1), 'list')).toEqual({ label: '查看', to: '/customer/tasks/t1' });
  });

  it('已交付：列表直接下载，工作台去成果页；锁住的只能查看', () => {
    const delivered = task('delivered', 2, { version: 1, publishedAt: '2026-11-21T00:00:00Z' });
    expect(taskAction(delivered, 'list')).toEqual({ label: '下载', to: null });
    expect(taskAction(delivered, 'workbench')).toEqual({ label: '查看成果', to: '/customer/documents/t1' });
    expect(taskAction(task('delivered_locked', 2), 'workbench')).toEqual({ label: '查看', to: '/customer/documents/t1' });
  });

  it('老流程：没提交的回任务页，提交过的看记录', () => {
    expect(taskAction(task('legacy_readonly', 0), 'workbench').to).toBe('/customer/tasks/t1');
    expect(taskAction(task('legacy_readonly', 1), 'workbench').to).toBe('/customer/tasks/t1?tab=records');
  });
});
