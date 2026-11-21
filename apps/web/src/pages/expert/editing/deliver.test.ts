import type { PublishView } from '@genyun/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/request';
import { monthDay } from './DeliverDialogs';
import { deliveredAt } from './DeliveredView';
import { previousEditsHint } from './ReviewParts';
import { deliverStatusOf, deliverStorageKey, uncertain } from './useDeliver';

// 定稿并交付（15 页）：交付状态、日期写法、「上一版您改过的 N 节」那一句

const view = (patch: Partial<PublishView>): PublishView => ({
  batchId: 'b1',
  enterpriseName: '飞宇',
  taskNumber: 'GY-2026-001',
  docs: [],
  review: null,
  editable: true,
  canPublish: true,
  blocker: null,
  nextVersion: 1,
  attempt: null,
  deliveries: [],
  delivered: null,
  ...patch,
});
const attempt = (status: 'publishing' | 'failed' | 'done') =>
  ({ publishId: 'p1', status, version: 1, byName: '周工', at: '2026-11-20T02:50:00Z', error: null }) as unknown as PublishView['attempt'];

describe('交付状态', () => {
  it('请求还没回来、结果没确认，先看页面自己的状态', () => {
    expect(deliverStatusOf(view({ attempt: attempt('failed') }), 'sending')).toBe('sending');
    expect(deliverStatusOf(view({}), 'unknown')).toBe('unknown');
  });

  it('按后台最近一次（重新打开之后的）尝试', () => {
    expect(deliverStatusOf(undefined, 'idle')).toBe('idle');
    expect(deliverStatusOf(view({}), 'idle')).toBe('idle');
    expect(deliverStatusOf(view({ attempt: attempt('publishing') }), 'idle')).toBe('publishing');
    expect(deliverStatusOf(view({ attempt: attempt('failed') }), 'idle')).toBe('failed');
    const delivered = { version: 1, at: '2026-11-20T02:50:00Z', reviewerName: '周工', note: '已核对', files: [] };
    expect(deliverStatusOf(view({ attempt: attempt('done'), delivered }), 'idle')).toBe('done');
  });

  it('断网、超时、网关出错算结果不确定；后台明确拒绝的不算', () => {
    expect(uncertain(new TypeError('Failed to fetch'))).toBe(true);
    expect(uncertain(new ApiError(0, '网络'))).toBe(true);
    expect(uncertain(new ApiError(502, '网关'))).toBe(true);
    expect(uncertain(new ApiError(409, '已交付'))).toBe(false);
    expect(uncertain(new ApiError(400, '不对'))).toBe(false);
  });

  it('publishId 按任务和这一批分开存', () => {
    expect(deliverStorageKey('t1', 'b1')).toBe('genyun.publish.t1.b1');
    expect(deliverStorageKey('t1', 'b2')).not.toBe(deliverStorageKey('t1', 'b1'));
  });
});

describe('日期写法（北京时间）', () => {
  it('灰条和再次交付弹窗里的月日', () => {
    expect(monthDay('2026-11-20T02:50:00Z')).toBe('11 月 20 日');
    // 北京时间已经是第二天
    expect(monthDay('2026-11-20T16:30:00Z')).toBe('11 月 21 日');
  });

  it('已交付页的交付时间', () => {
    expect(deliveredAt('2026-11-20T02:50:00Z')).toBe('2026 年 11 月 20 日 10:50');
    expect(deliveredAt('2026-01-04T16:05:00Z')).toBe('2026 年 1 月 5 日 00:05');
  });
});

describe('上一版您改过的 N 节', () => {
  it('1 节、2 节、3 节以上的说法', () => {
    expect(previousEditsHint(1)).toBe('重新生成会换掉这一节，原文留在这里供您对照');
    expect(previousEditsHint(2)).toBe('重新生成会换掉这两节，原文留在这里供您对照');
    expect(previousEditsHint(3)).toBe('重新生成会换掉这 3 节，原文留在这里供您对照');
  });
});
