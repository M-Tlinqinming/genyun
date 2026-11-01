import { describe, expect, it } from 'vitest';
import { pendingContactRequest } from './contact-request.ts';

// 请求联系的资料项按资料清单固定顺序显示，和数据库返回的先后无关（专家横幅、运营超时兜底同一套）
describe('客户请求联系的资料项顺序', () => {
  it('不论查询返回顺序，都按资料清单顺序', () => {
    const at = new Date('2026-10-30T02:00:00Z');
    const task = { submittedAt: at, closedAt: null, assignedAt: at };
    const call = (itemKey: string) => ({ itemKey, updatedAt: at, updatedByName: '陈志刚' });
    const a = pendingContactRequest(task, [call('fire_pool'), call('emergency_supplies')], []);
    const b = pendingContactRequest(task, [call('emergency_supplies'), call('fire_pool')], []);
    expect(a!.labels).toEqual(['应急物资及装备', '消防水池']);
    expect(b!.labels).toEqual(a!.labels);
  });
});
