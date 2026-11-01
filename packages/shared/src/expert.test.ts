import { describe, expect, it } from 'vitest';
import { expertTodo } from './expert.ts';
import { addWorkingDays, workingDaysLeft } from './workdays.ts';

// 北京时间写法，方便对照
const bj = (s: string) => new Date(`${s}+08:00`);

describe('专家待办', () => {
  const base = { status: 'submitted' as const, closedAt: null, verifyCount: 0, contactCount: 0 };

  it('已提交的任务进入专业整理；客户请联系优先于其他核实', () => {
    expect(expertTodo(base)).toEqual({ stage: 'organizing', todo: '整理企业资料', action: '开始整理' });
    expect(expertTodo({ ...base, verifyCount: 3 }).todo).toBe('核实 3 项资料');
    expect(expertTodo({ ...base, verifyCount: 3, contactCount: 2 })).toMatchObject({ todo: '电话联系客户问清 2 项', action: '联系客户' });
  });

  it('客户还没提交、已交付各有自己的阶段', () => {
    expect(expertTodo({ ...base, status: 'preparing' }).stage).toBe('customer_preparing');
    expect(expertTodo({ ...base, closedAt: '2026-10-20T00:00:00Z' }).stage).toBe('delivered');
  });
});

describe('请求联系的期限（2 个工作日）', () => {
  it('工作日提出：两天后的同一时刻', () => {
    expect(addWorkingDays(bj('2026-10-27T15:20'), 2)).toEqual(bj('2026-10-29T15:20'));
  });

  it('跳过周末：周五提出，下周二到期', () => {
    expect(addWorkingDays(bj('2026-10-30T15:20'), 2)).toEqual(bj('2026-11-03T15:20'));
  });

  it('剩余工作日按北京时间的日期算', () => {
    const deadline = bj('2026-10-29T15:20');
    expect(workingDaysLeft(deadline, bj('2026-10-27T16:00'))).toBe(2);
    expect(workingDaysLeft(deadline, bj('2026-10-28T23:30'))).toBe(1);
    expect(workingDaysLeft(deadline, bj('2026-10-29T08:00'))).toBe(0);
    expect(workingDaysLeft(deadline, bj('2026-10-29T15:21'))).toBe(-1);
  });

  it('中间隔着周末不算天数', () => {
    expect(workingDaysLeft(bj('2026-11-03T15:20'), bj('2026-10-30T16:00'))).toBe(2);
  });

  it('跳过法定节假日，调休上班的周末算工作日（2026 年国庆）', () => {
    // 9.30 周三提出：10.1–10.7 放假，10.8、10.9 上班
    expect(addWorkingDays(bj('2026-09-30T15:20'), 2)).toEqual(bj('2026-10-09T15:20'));
    // 10.9 周五提出：10.10 周六调休上班，算 1 个工作日
    expect(addWorkingDays(bj('2026-10-09T10:00'), 1)).toEqual(bj('2026-10-10T10:00'));
  });

  it('没有节假日表的年份只跳过周末', () => {
    // 2027-01-01 是周五；表里没有 2027 年，照常算工作日
    expect(addWorkingDays(bj('2026-12-31T09:00'), 1)).toEqual(bj('2027-01-01T09:00'));
  });
});
