import { describe, expect, it } from 'vitest';
import { TASK_VIEW_STAGES, formatTaskDay, formatTaskDayTime, isReopenedPending, taskView, type TaskViewInput } from './task-status.ts';

// 北京时间 2026-11-13 10:00
const now = new Date('2026-11-13T02:00:00Z');
const at = (iso: string) => new Date(iso);
const EXPERT = 'expert-1';

function input(over: Partial<TaskViewInput> = {}): TaskViewInput {
  return {
    flow: 'intake',
    status: 'preparing',
    deletedAt: null,
    tableUploaded: false,
    missingCount: 0,
    submittedAt: null,
    withdrawnBefore: false,
    assignedExpertId: null,
    snapshotAt: null,
    workupStepsDone: 0,
    awaitingCustomerSince: null,
    awaitingCustomerItems: null,
    draft: 'none',
    lastDelivery: null,
    reopenedAt: null,
    chargeStatus: 'not_charged',
    now,
    viewer: { side: 'customer', isCustomerAdmin: true },
    ...over,
  };
}

const customer = { side: 'customer', isCustomerAdmin: true } as const;
const member = { side: 'customer', isCustomerAdmin: false } as const;
const expert = { side: 'expert', userId: EXPERT } as const;
const operator = { side: 'operator' } as const;

const submitted = {
  status: 'submitted' as const,
  tableUploaded: true,
  submittedAt: at('2026-11-12T06:20:00Z'), // 北京 11-12 14:20
  assignedExpertId: EXPERT,
};
const delivered = { ...submitted, snapshotAt: at('2026-11-12T08:00:00Z'), draft: 'ready' as const, lastDelivery: { at: at('2026-11-06T03:00:00Z'), kind: 'first' as const }, chargeStatus: 'charged' as const };

describe('日期按北京时间', () => {
  it('今天、昨天、几月几日', () => {
    expect(formatTaskDay(at('2026-11-12T16:30:00Z'), now)).toBe('今天'); // 北京 11-13 00:30
    expect(formatTaskDay(at('2026-11-12T15:59:00Z'), now)).toBe('昨天'); // 北京 11-12 23:59
    expect(formatTaskDay(at('2026-11-11T02:00:00Z'), now)).toBe('11 月 11 日');
    expect(formatTaskDayTime(at('2026-11-11T06:20:00Z'), now)).toBe('11 月 11 日 14:20');
  });
});

describe('已删除的任务三端都不显示', () => {
  it.each([customer, member, expert, operator])('%o', (viewer) => {
    expect(taskView(input({ ...delivered, deletedAt: now, viewer }))).toBeNull();
    expect(taskView(input({ deletedAt: now, viewer }))).toBeNull();
  });
});

describe('客户端', () => {
  it('还没上传资料表格', () => {
    const v = taskView(input())!;
    expect(v).toMatchObject({ key: 'preparing_no_table', label: '准备资料', tone: 'action', nextStep: '下载资料模板，填好后上传', detail: '还没上传资料表格', stage: 0, needsAction: true, readOnly: false });
  });
  it('表格已上传、还差几项必填', () => {
    const v = taskView(input({ tableUploaded: true, missingCount: 4 }))!;
    expect(v).toMatchObject({ key: 'preparing_missing', nextStep: '还差 4 项必填，补齐后提交', detail: '资料表格已上传', needsAction: true });
  });
  it('必填齐了', () => {
    expect(taskView(input({ tableUploaded: true }))!).toMatchObject({ key: 'preparing_ready', nextStep: '必填都齐了，可以提交给专家' });
  });
  it('撤回后回到准备资料，第二行提示撤回过', () => {
    expect(taskView(input({ tableUploaded: true, withdrawnBefore: true, missingCount: 1 }))!.detail).toBe('已撤回，改好后再提交');
    expect(taskView(input({ withdrawnBefore: true }))!.detail).toBe('已撤回，改好后再提交');
    expect(taskView(input({ tableUploaded: true, withdrawnBefore: true }))!.detail).toBe('已撤回，这次提交后不能再撤回');
  });
  it('普通成员也能补资料、提交', () => {
    expect(taskView(input({ viewer: member }))!.needsAction).toBe(true);
  });
  it('已提交到交付前都是专家编制，不管专家做到哪一步', () => {
    for (const extra of [{ assignedExpertId: null }, {}, { snapshotAt: now }, { snapshotAt: now, draft: 'ready' as const }, { awaitingCustomerSince: now, awaitingCustomerItems: 3 }]) {
      const v = taskView(input({ ...submitted, ...extra }))!;
      expect(v).toMatchObject({ key: 'expert_working', label: '专家编制', tone: 'progress', nextStep: '专家正在编制，交付后邮件通知您', detail: '资料 昨天已提交', stage: 1, needsAction: false, readOnly: true });
    }
  });
  it('已交付', () => {
    expect(taskView(input(delivered))!).toMatchObject({ key: 'delivered', label: '已交付', tone: 'done', nextStep: '成果已交付，三份 Word 可以下载', detail: '11 月 6 日专家已交付', stage: 2, needsAction: false, readOnly: true });
  });
  it('再次交付后显示已更新', () => {
    expect(taskView(input({ ...delivered, lastDelivery: { at: at('2026-11-13T01:00:00Z'), kind: 'update' } }))!.detail).toBe('今天已更新');
  });
  it('重新打开期间客户仍看到已交付', () => {
    expect(taskView(input({ ...delivered, reopenedAt: at('2026-11-12T00:00:00Z') }))!.key).toBe('delivered');
  });
  it('等次数：管理员看到续约后可下载，普通成员不提次数', () => {
    const locked = { ...delivered, chargeStatus: 'awaiting_credits' as const };
    const a = taskView(input({ ...locked, viewer: customer }))!;
    expect(a).toMatchObject({ key: 'delivered_locked', label: '已编制好 · 续约后可下载', tone: 'action', needsAction: true, stage: 2 });
    const m = taskView(input({ ...locked, viewer: member }))!;
    expect(m).toMatchObject({ key: 'delivered_locked', label: '已编制好 · 暂不能下载', needsAction: false });
    expect(`${m.label}${m.nextStep}${m.detail}`).not.toMatch(/次数|续约/);
  });
  it('旧流程：交付了显示已交付，没交付的只读并指向客服', () => {
    expect(taskView(input({ ...delivered, flow: 'legacy' }))!.key).toBe('delivered');
    const p = taskView(input({ flow: 'legacy' }))!;
    expect(p).toMatchObject({ key: 'legacy_readonly', label: '准备资料', readOnly: true, needsAction: false, detail: '有要改的地方，请联系耕云客服' });
    const s = taskView(input({ ...submitted, flow: 'legacy' }))!;
    expect(s).toMatchObject({ key: 'legacy_readonly', label: '专家编制', stage: 1, readOnly: true });
  });
});

describe('专家端', () => {
  it('没分配、分给别人、还没提交（含撤回后）都看不到', () => {
    expect(taskView(input({ ...submitted, assignedExpertId: null, viewer: expert }))).toBeNull();
    expect(taskView(input({ ...submitted, assignedExpertId: 'other', viewer: expert }))).toBeNull();
    expect(taskView(input({ ...submitted, status: 'preparing', submittedAt: null, withdrawnBefore: true, viewer: expert }))).toBeNull();
    expect(taskView(input({ ...submitted, viewer: { side: 'expert' } }))).toBeNull();
  });
  it('待核对资料', () => {
    expect(taskView(input({ ...submitted, viewer: expert, fileCounts: { table: 1, others: 12 } }))!).toMatchObject({ key: 'to_check', label: '待核对资料', tone: 'action', detail: '资料表格 1 份 · 图纸与照片 12 份', stage: 0, needsAction: true, readOnly: false });
    expect(taskView(input({ ...submitted, viewer: expert }))!.detail).toBe('客户已提交，等您开始');
  });
  it('编制中：核对步数、生成中、初稿已生成、生成失败', () => {
    const w = { ...submitted, snapshotAt: now, viewer: expert };
    expect(taskView(input({ ...w, workupStepsDone: 3 }))!).toMatchObject({ key: 'working', label: '编制中', tone: 'action', detail: '资料核对 3 / 5 步', stage: 1, needsAction: true });
    expect(taskView(input({ ...w, workupStepsDone: 9 }))!.detail).toBe('资料核对 5 / 5 步');
    expect(taskView(input({ ...w, draft: 'generating' }))!.detail).toBe('初稿生成中');
    expect(taskView(input({ ...w, draft: 'ready' }))!.detail).toBe('三份初稿已生成');
    expect(taskView(input({ ...w, draft: 'failed' }))!).toMatchObject({ tone: 'error', detail: '初稿生成失败，请重试' });
  });
  it('等客户补资料', () => {
    const v = taskView(input({ ...submitted, snapshotAt: now, awaitingCustomerSince: at('2026-11-11T02:00:00Z'), awaitingCustomerItems: 3, viewer: expert }))!;
    expect(v).toMatchObject({ key: 'awaiting_customer', label: '等客户补资料', tone: 'progress', detail: '缺 3 项 · 11 月 11 日列出', stage: 2, needsAction: false });
    expect(taskView(input({ ...submitted, awaitingCustomerSince: now, viewer: expert }))!.detail).toBe('缺项清单 · 今天列出');
  });
  it('已交付；次数用完时专家这边照常', () => {
    expect(taskView(input({ ...delivered, viewer: expert }))!).toMatchObject({ key: 'delivered', label: '已交付', tone: 'done', detail: '11 月 6 日交付', stage: 3, readOnly: true, needsAction: false });
    const locked = taskView(input({ ...delivered, chargeStatus: 'awaiting_credits', viewer: expert }))!;
    expect(locked.key).toBe('delivered');
    expect(`${locked.label}${locked.detail}`).not.toMatch(/次数/);
  });
  it('重新打开 · 待交付；再次交付后回到已交付', () => {
    const r = taskView(input({ ...delivered, reopenedAt: at('2026-11-13T01:00:00Z'), viewer: expert }))!;
    expect(r).toMatchObject({ key: 'reopened', label: '重新打开 · 待交付', tone: 'action', stage: 4, needsAction: true, readOnly: false });
    const again = taskView(input({ ...delivered, reopenedAt: at('2026-11-12T00:00:00Z'), lastDelivery: { at: at('2026-11-12T05:00:00Z'), kind: 'update' }, viewer: expert }))!;
    expect(again).toMatchObject({ key: 'delivered', detail: '昨天再次交付' });
  });
  it('旧流程按已有字段：没快照待核对、有快照编制中、交付了已交付', () => {
    const l = { ...submitted, flow: 'legacy' as const, viewer: expert };
    expect(taskView(input(l))!.key).toBe('to_check');
    expect(taskView(input({ ...l, snapshotAt: now }))!.key).toBe('working');
    expect(taskView(input({ ...l, ...delivered, flow: 'legacy', viewer: expert }))!.key).toBe('delivered');
    // 旧流程没有缺项清单这一步
    expect(taskView(input({ ...l, snapshotAt: now, awaitingCustomerSince: now }))!.key).toBe('working');
  });
});

describe('运营端', () => {
  it('资料准备的几种第二行', () => {
    expect(taskView(input({ viewer: operator }))!).toMatchObject({ key: 'preparing', label: '资料准备', tone: 'progress', detail: '还没上传资料表格', stage: 0, needsAction: false });
    expect(taskView(input({ tableUploaded: true, missingCount: 4, viewer: operator }))!.detail).toBe('表格已上传，还差 4 项必填');
    expect(taskView(input({ tableUploaded: true, viewer: operator }))!.detail).toBe('必填都齐了，客户还没提交');
    expect(taskView(input({ tableUploaded: true, withdrawnBefore: true, viewer: operator }))!.detail).toBe('客户撤回了，改好后再提交');
    expect(taskView(input({ flow: 'legacy', viewer: operator }))!.detail).toBe('客户还没提交');
  });
  it('待分配专家', () => {
    expect(taskView(input({ ...submitted, assignedExpertId: null, viewer: operator }))!).toMatchObject({ key: 'to_assign', label: '待分配专家', tone: 'action', detail: '昨天 14:20 提交', stage: 1, needsAction: true });
  });
  it('等客户补资料', () => {
    expect(taskView(input({ ...submitted, snapshotAt: now, awaitingCustomerSince: at('2026-11-11T02:00:00Z'), awaitingCustomerItems: 3, viewer: operator }))!).toMatchObject({ key: 'awaiting_customer', label: '等客户补资料', tone: 'action', detail: '缺 3 项 · 11 月 11 日列出', stage: 2, needsAction: true });
  });
  it('专家处理中：待核对资料、核对中、初稿已生成、生成失败', () => {
    const s = { ...submitted, viewer: operator };
    expect(taskView(input(s))!).toMatchObject({ key: 'to_check', label: '待核对资料', tone: 'action', detail: '已分配，专家还没开始', stage: 3, needsAction: false });
    expect(taskView(input({ ...s, snapshotAt: now, workupStepsDone: 3 }))!).toMatchObject({ key: 'checking', label: '核对中', tone: 'progress', detail: '资料核对 3 / 5 步', stage: 3 });
    expect(taskView(input({ ...s, snapshotAt: now, draft: 'generating' }))!.detail).toBe('初稿生成中');
    expect(taskView(input({ ...s, snapshotAt: now, draft: 'ready' }))!).toMatchObject({ key: 'draft_ready', label: '初稿已生成', tone: 'progress', detail: '等专家核对定稿', stage: 3 });
    expect(taskView(input({ ...s, snapshotAt: now, draft: 'failed' }))!).toMatchObject({ key: 'checking', tone: 'error', detail: '初稿生成失败，等专家重试' });
  });
  it('已交付、等次数、重新打开', () => {
    expect(taskView(input({ ...delivered, viewer: operator }))!).toMatchObject({ key: 'delivered', tone: 'done', stage: 4, readOnly: true });
    expect(taskView(input({ ...delivered, chargeStatus: 'awaiting_credits', viewer: operator }))!).toMatchObject({ key: 'delivered_locked', label: '已交付 · 等次数', tone: 'action', stage: 4 });
    expect(taskView(input({ ...delivered, reopenedAt: now, viewer: operator }))!).toMatchObject({ key: 'reopened', label: '重新打开 · 待交付', tone: 'action', stage: 3 });
  });
});

describe('阶段序号和重新打开判断', () => {
  it('每端的 stage 都落在自己的阶段表里', () => {
    const cases: Partial<TaskViewInput>[] = [{}, { tableUploaded: true, missingCount: 2 }, submitted, { ...submitted, snapshotAt: now }, { ...submitted, awaitingCustomerSince: now }, delivered, { ...delivered, reopenedAt: now }, { ...delivered, chargeStatus: 'awaiting_credits' }];
    for (const side of [customer, member, expert, operator]) {
      for (const c of cases) {
        const v = taskView(input({ ...c, viewer: side }));
        if (!v) continue;
        expect(v.stage).toBeGreaterThanOrEqual(0);
        expect(v.stage).toBeLessThan(TASK_VIEW_STAGES[side.side].length);
      }
    }
  });
  it('重新打开时间晚于最近一次成功交付才算', () => {
    const d = { at: at('2026-11-10T00:00:00Z'), kind: 'first' as const };
    expect(isReopenedPending({ reopenedAt: null, lastDelivery: d })).toBe(false);
    expect(isReopenedPending({ reopenedAt: at('2026-11-09T00:00:00Z'), lastDelivery: d })).toBe(false);
    expect(isReopenedPending({ reopenedAt: at('2026-11-10T00:00:00Z'), lastDelivery: d })).toBe(false);
    expect(isReopenedPending({ reopenedAt: at('2026-11-11T00:00:00Z'), lastDelivery: d })).toBe(true);
    expect(isReopenedPending({ reopenedAt: now, lastDelivery: null })).toBe(false);
  });
});
