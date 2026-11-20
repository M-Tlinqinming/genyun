import { describe, expect, it } from 'vitest';
import {
  expertCenterButton,
  expertCenterGroup,
  expertCenterStats,
  expertCenterTime,
  isDeliveredThisMonth,
  isExpertCenterOpen,
  sortExpertCenter,
  type ExpertCenterFacts,
} from './expert-center.ts';
import type { TaskView } from './task-status.ts';

// 北京时间 2026-11-13 10:00
const now = new Date('2026-11-13T02:00:00Z');
const at = (iso: string) => new Date(iso);

function v(key: string): TaskView {
  return { key, label: key, tone: 'action', nextStep: null, detail: null, stage: 0, needsAction: true, readOnly: false };
}

function facts(key: string, over: Partial<ExpertCenterFacts> & { id?: string } = {}): ExpertCenterFacts & { id: string } {
  return {
    id: key,
    view: v(key),
    draft: 'none',
    assignedAt: at('2026-11-12T02:00:00Z'),
    activityAt: at('2026-11-12T02:00:00Z'),
    awaitingCustomerSince: null,
    lastDelivery: null,
    ...over,
  };
}

describe('分组与排序', () => {
  it('按组排：待核对、编制中（含重新打开）、等客户、旧流程、已交付', () => {
    expect(expertCenterGroup(v('reopened'))).toBe('working');
    expect(expertCenterGroup(v('legacy_readonly'))).toBe('legacy');
    const rows = [
      facts('delivered', { lastDelivery: { at: at('2026-11-01T00:00:00Z') } }),
      facts('legacy_readonly'),
      facts('awaiting_customer', { awaitingCustomerSince: at('2026-11-10T00:00:00Z') }),
      facts('reopened'),
      facts('to_check'),
    ];
    expect(sortExpertCenter(rows).map((r) => r.id)).toEqual(['to_check', 'reopened', 'awaiting_customer', 'legacy_readonly', 'delivered']);
  });

  it('组内：待核对先分配的在前，编制中最近更新的在前，等客户等得久的在前，已交付最近交付的在前', () => {
    const rows = [
      facts('to_check', { id: 'c-late', assignedAt: at('2026-11-12T00:00:00Z') }),
      facts('to_check', { id: 'c-early', assignedAt: at('2026-11-10T00:00:00Z') }),
      facts('working', { id: 'w-old', activityAt: at('2026-11-10T00:00:00Z') }),
      facts('reopened', { id: 'w-new', activityAt: at('2026-11-12T00:00:00Z') }),
      facts('awaiting_customer', { id: 'a-new', awaitingCustomerSince: at('2026-11-12T00:00:00Z') }),
      facts('awaiting_customer', { id: 'a-old', awaitingCustomerSince: at('2026-11-05T00:00:00Z') }),
      facts('delivered', { id: 'd-old', lastDelivery: { at: at('2026-10-01T00:00:00Z') } }),
      facts('delivered', { id: 'd-new', lastDelivery: { at: at('2026-11-11T00:00:00Z') } }),
    ];
    expect(sortExpertCenter(rows).map((r) => r.id)).toEqual(['c-early', 'c-late', 'w-new', 'w-old', 'a-old', 'a-new', 'd-new', 'd-old']);
  });
});

describe('按钮文字', () => {
  it('照状态和初稿情况', () => {
    expect(expertCenterButton(facts('to_check'))).toBe('开始核对');
    expect(expertCenterButton(facts('working'))).toBe('继续核对');
    expect(expertCenterButton(facts('working', { draft: 'ready' }))).toBe('核对文稿');
    expect(expertCenterButton(facts('working', { draft: 'generating' }))).toBe('查看进度');
    expect(expertCenterButton(facts('working', { draft: 'failed' }))).toBe('重新生成');
    expect(expertCenterButton(facts('awaiting_customer'))).toBe('查看缺项');
    expect(expertCenterButton(facts('reopened'))).toBe('继续编制');
    expect(expertCenterButton(facts('delivered'))).toBe('查看');
    expect(expertCenterButton(facts('legacy_readonly'))).toBe('查看');
  });
});

describe('时间列', () => {
  it('待核对资料：几时分配，琥珀色', () => {
    expect(expertCenterTime(facts('to_check', { assignedAt: at('2026-11-13T01:00:00Z') }), now)).toEqual({ text: '今天分配', tone: 'action' });
    expect(expertCenterTime(facts('to_check', { assignedAt: at('2026-11-12T01:00:00Z') }), now).text).toBe('昨天分配');
    expect(expertCenterTime(facts('to_check', { assignedAt: at('2026-11-05T01:00:00Z') }), now).text).toBe('11 月 5 日分配');
  });

  it('等客户补资料：按北京时间自然日算，当天写「不到 1 天」', () => {
    // 北京时间 11-13 00:30，和 now 同一天
    expect(expertCenterTime(facts('awaiting_customer', { awaitingCustomerSince: at('2026-11-12T16:30:00Z') }), now)).toEqual({
      text: '不到 1 天',
      tone: 'muted',
    });
    // 北京时间 11-12 23:30：跨了一个自然日
    expect(expertCenterTime(facts('awaiting_customer', { awaitingCustomerSince: at('2026-11-12T15:30:00Z') }), now).text).toBe('已等 1 天');
    expect(expertCenterTime(facts('awaiting_customer', { awaitingCustomerSince: at('2026-11-11T02:00:00Z') }), now).text).toBe('已等 2 天');
  });

  it('已交付写交付时间，其余写最近更新', () => {
    expect(expertCenterTime(facts('delivered', { lastDelivery: { at: at('2026-11-12T08:20:00Z') } }), now)).toEqual({
      text: '昨天 16:20',
      tone: 'muted',
    });
    expect(expertCenterTime(facts('working', { activityAt: at('2026-11-12T03:05:00Z') }), now).text).toBe('昨天 11:05');
    expect(expertCenterTime(facts('legacy_readonly', { activityAt: at('2026-11-13T01:00:00Z') }), now).text).toBe('今天 09:00');
  });
});

describe('在办、本月已交付、四格计数', () => {
  it('在办不含已交付，含旧流程和重新打开', () => {
    expect(isExpertCenterOpen(v('legacy_readonly'))).toBe(true);
    expect(isExpertCenterOpen(v('reopened'))).toBe(true);
    expect(isExpertCenterOpen(v('delivered'))).toBe(false);
  });

  it('本月按北京时间算', () => {
    // 北京时间 11-01 00:30 是本月；10-31 23:30 是上月
    expect(isDeliveredThisMonth(facts('delivered', { lastDelivery: { at: at('2026-10-31T16:30:00Z') } }), now)).toBe(true);
    expect(isDeliveredThisMonth(facts('delivered', { lastDelivery: { at: at('2026-10-31T15:30:00Z') } }), now)).toBe(false);
    // 重新打开的不算已交付
    expect(isDeliveredThisMonth(facts('reopened', { lastDelivery: { at: at('2026-11-05T00:00:00Z') } }), now)).toBe(false);
  });

  it('四格互不重叠：重新打开算编制中，旧流程、上月交付不计', () => {
    const rows = [
      { view: v('to_check'), deliveredThisMonth: false },
      { view: v('working'), deliveredThisMonth: false },
      { view: v('reopened'), deliveredThisMonth: false },
      { view: v('awaiting_customer'), deliveredThisMonth: false },
      { view: v('legacy_readonly'), deliveredThisMonth: false },
      { view: v('delivered'), deliveredThisMonth: true },
      { view: v('delivered'), deliveredThisMonth: false },
    ];
    expect(expertCenterStats(rows)).toEqual({ to_check: 1, working: 2, awaiting: 1, delivered_month: 1 });
  });
});
