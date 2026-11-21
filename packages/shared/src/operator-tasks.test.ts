import { describe, expect, it } from 'vitest';
import {
  expertPickLine,
  operatorTaskCounts,
  operatorTaskGroup,
  operatorWorkingLine,
  sortOperatorTasks,
  waitingLine,
  type OperatorTaskGroup,
} from './operator-tasks.ts';
import { TASK_VIEW_STAGES } from './task-status.ts';

describe('运营任务分组', () => {
  it('每种 key 归到对应的组', () => {
    expect(operatorTaskGroup('to_assign')).toBe('to_assign');
    expect(operatorTaskGroup('awaiting_customer')).toBe('awaiting');
    for (const k of ['reopened', 'to_check', 'checking', 'draft_ready']) expect(operatorTaskGroup(k)).toBe('working');
    expect(operatorTaskGroup('preparing')).toBe('preparing');
    expect(operatorTaskGroup('delivered')).toBe('delivered');
    expect(operatorTaskGroup('delivered_locked')).toBe('delivered');
  });

  it('旧流程只读的按阶段分组，认不出的算专家处理中', () => {
    const stage = (label: string) => TASK_VIEW_STAGES.operator.indexOf(label as never);
    expect(operatorTaskGroup('legacy_readonly', stage('已交付'))).toBe('delivered');
    expect(operatorTaskGroup('legacy_readonly', stage('资料准备'))).toBe('preparing');
    expect(operatorTaskGroup('legacy_readonly', stage('专家处理中'))).toBe('working');
    expect(operatorTaskGroup('legacy_readonly')).toBe('working');
  });
});

describe('运营任务排序', () => {
  const row = (id: string, group: OperatorTaskGroup, t: { w?: string; a?: string; d?: string } = {}) => ({
    id,
    group,
    waitingSince: t.w ?? null,
    activityAt: t.a ?? '2026-11-01T00:00:00Z',
    deliveredAt: t.d ?? null,
  });

  it('先按组，组内各按各的时间', () => {
    const rows = [
      row('d-old', 'delivered', { d: '2026-11-01T00:00:00Z' }),
      row('d-new', 'delivered', { d: '2026-11-10T00:00:00Z' }),
      row('p-old', 'preparing', { a: '2026-11-01T00:00:00Z' }),
      row('p-new', 'preparing', { a: '2026-11-09T00:00:00Z' }),
      row('w-old', 'working', { a: '2026-11-02T00:00:00Z' }),
      row('w-new', 'working', { a: '2026-11-08T00:00:00Z' }),
      row('aw-new', 'awaiting', { w: '2026-11-08T00:00:00Z' }),
      row('aw-old', 'awaiting', { w: '2026-11-02T00:00:00Z' }),
      row('ta-new', 'to_assign', { w: '2026-11-09T00:00:00Z' }),
      row('ta-old', 'to_assign', { w: '2026-11-01T00:00:00Z' }),
    ];
    expect(sortOperatorTasks(rows).map((r) => r.id)).toEqual([
      'ta-old',
      'ta-new',
      'aw-old',
      'aw-new',
      'w-new',
      'w-old',
      'p-new',
      'p-old',
      'd-new',
      'd-old',
    ]);
  });

  it('不改原数组', () => {
    const rows = [row('b', 'delivered'), row('a', 'to_assign', { w: '2026-11-01T00:00:00Z' })];
    sortOperatorTasks(rows);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('等了多久', () => {
  const now = new Date('2026-11-12T10:00:00+08:00');
  it('当天写不到 1 天', () => {
    expect(waitingLine('2026-11-12T00:30:00+08:00', now)).toBe('已等不到 1 天');
  });
  it('按北京时间的日历天算', () => {
    expect(waitingLine('2026-11-11T23:50:00+08:00', now)).toBe('已等 1 天');
    // UTC 是 11 日、北京时间已是 12 日
    expect(waitingLine('2026-11-11T16:30:00Z', now)).toBe('已等不到 1 天');
    expect(waitingLine('2026-11-09T09:00:00+08:00', now)).toBe('已等 3 天');
  });
});

describe('专家处理中第二行', () => {
  it('为 0 的不写', () => {
    expect(operatorWorkingLine({ toCheck: 1, checking: 0, draftReady: 2, reopened: 0 })).toBe('待核对资料 1 · 初稿已生成 2');
  });
  it('全是 0', () => {
    expect(operatorWorkingLine({ toCheck: 0, checking: 0, draftReady: 0, reopened: 0 })).toBe('没有专家在处理的任务');
  });
  it('有重新打开的接在最后', () => {
    expect(operatorWorkingLine({ toCheck: 1, checking: 1, draftReady: 1, reopened: 1 })).toBe(
      '待核对资料 1 · 核对中 1 · 初稿已生成 1 · 重新打开 1',
    );
  });
  it('计数：核对中包括生成失败、旧流程只读的', () => {
    const c = operatorTaskCounts([
      { group: 'working', key: 'to_check' },
      { group: 'working', key: 'checking' },
      { group: 'working', key: 'legacy_readonly' },
      { group: 'working', key: 'draft_ready' },
      { group: 'working', key: 'reopened' },
      { group: 'to_assign', key: 'to_assign' },
      { group: 'delivered', key: 'delivered' },
    ]);
    expect(c.working).toEqual({ toCheck: 1, checking: 2, draftReady: 1, reopened: 1 });
    expect(c.groups.to_assign).toBe(1);
    expect(c.open).toBe(6);
  });
});

describe('分配弹窗里专家的第二行', () => {
  it('没有行业只写在办', () => {
    expect(expertPickLine(0, [])).toBe('在办 0 个');
    expect(expertPickLine(2, null)).toBe('在办 2 个');
  });
  it('一个、两个行业', () => {
    expect(expertPickLine(1, ['27'])).toBe('在办 1 个 · 擅长 医药制造业');
    expect(expertPickLine(3, ['27', '21'])).toBe('在办 3 个 · 擅长 医药制造业、家具制造业');
  });
  it('超过两个接「等 N 个」', () => {
    expect(expertPickLine(3, ['27', '21', '22', '23', '26'])).toBe('在办 3 个 · 擅长 医药制造业、家具制造业 等 5 个');
  });
  it('不认识的代码跳过', () => {
    expect(expertPickLine(1, ['xx', '27'])).toBe('在办 1 个 · 擅长 医药制造业');
    expect(expertPickLine(1, ['xx'])).toBe('在办 1 个');
  });
});
