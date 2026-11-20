// 三端任务状态（新流程，DEV-PLAN K3）：同一个任务在客户、专家、运营三端各显示什么。
// 纯函数：不查库、不取当前时间（now 由调用方传入），显示文字、颜色、第二行以 Paper 画板为准：
// 客户 11 页 C01 / C04 / C01·S02，专家 13 页 E1、15 页 R11–R14，运营 16 页 I04、「次数用完」。
// 旧的状态函数（task.ts、expert.ts、operator.ts）先不动，等各页切到新流程后再删。
import type { ChargeStatus } from './credits.ts';

export type TaskViewSide = 'customer' | 'expert' | 'operator';

/** action = 琥珀色（要人处理）；progress = 灰色（进行中）；done = 绿色（已交付）；error = 红色 */
export type TaskViewTone = 'action' | 'progress' | 'done' | 'error';

/** 初稿情况：还没生成、生成中、生成失败、三份初稿已生成 */
export type TaskDraftState = 'none' | 'generating' | 'failed' | 'ready';

export interface TaskViewer {
  side: TaskViewSide;
  /** 客户端：是不是组织管理员（只有管理员看得到次数） */
  isCustomerAdmin?: boolean;
  /** 专家端：当前专家的用户 ID；只看得到分给自己的任务 */
  userId?: string;
}

export interface TaskViewInput {
  /** intake = 新流程（有「准备资料」记录）；legacy = 旧流程的任务 */
  flow: 'intake' | 'legacy';
  status: 'preparing' | 'submitted';
  deletedAt: Date | null;
  /** 资料表格是否已上传（新流程） */
  tableUploaded: boolean;
  /** 必填还缺几项（新流程，含两张图） */
  missingCount: number;
  submittedAt: Date | null;
  /** 撤回过一次（撤回后回到准备资料；再提交后不能再撤回） */
  withdrawnBefore: boolean;
  assignedExpertId: string | null;
  /** 专家点开任务开始核对的时间；为空 = 还没开始 */
  snapshotAt: Date | null;
  /** 资料核对五步做完了几步（0–5） */
  workupStepsDone: number;
  /** 专家复制缺项清单的时间（等客户补资料）；专家替客户传了资料后清空 */
  awaitingCustomerSince: Date | null;
  /** 缺项清单里列了几项 */
  awaitingCustomerItems: number | null;
  draft: TaskDraftState;
  /** 最近一次成功交付；kind = first 首次交付，update = 重新打开后再次交付 */
  lastDelivery: { at: Date; kind: 'first' | 'update' } | null;
  reopenedAt: Date | null;
  chargeStatus: ChargeStatus;
  /** 专家端「待核对资料」第二行用：提交的资料表格份数、图纸与照片份数；不传时第二行换成通用说法 */
  fileCounts?: { table: number; others: number };
  now: Date;
  viewer: TaskViewer;
}

export interface TaskView {
  key: string;
  /** 状态标签 */
  label: string;
  tone: TaskViewTone;
  /** 客户端列表的「下一步」主句（如「还差 4 项必填，补齐后提交」）；专家、运营端为 null */
  nextStep: string | null;
  /** 第二行小字 */
  detail: string | null;
  /** 这一端进度条或分组的序号，从 0 起，对应 TASK_VIEW_STAGES[side] */
  stage: number;
  /** 当前这个人要不要处理（进「待我处理」、标琥珀色计数） */
  needsAction: boolean;
  /** 当前这个人只能看、不能改任务内容 */
  readOnly: boolean;
}

/** 三端各自的阶段（客户是进度条三段；专家、运营是列表分组） */
export const TASK_VIEW_STAGES: Record<TaskViewSide, readonly string[]> = {
  customer: ['准备资料', '专家编制', '已交付'],
  expert: ['待核对资料', '编制中', '等客户补资料', '已交付', '重新打开 · 待交付'],
  operator: ['资料准备', '待分配专家', '等客户补资料', '专家处理中', '已交付'],
};

export const WORKUP_STEP_COUNT = 5;

// ---------- 日期：一律按北京时间 ----------

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingParts(d: Date) {
  const b = new Date(d.getTime() + BEIJING_OFFSET_MS);
  return {
    y: b.getUTCFullYear(),
    m: b.getUTCMonth() + 1,
    d: b.getUTCDate(),
    hh: String(b.getUTCHours()).padStart(2, '0'),
    mm: String(b.getUTCMinutes()).padStart(2, '0'),
    dayIndex: Math.floor((d.getTime() + BEIJING_OFFSET_MS) / 86_400_000),
  };
}

/** 「今天」「昨天」或「11 月 12 日」 */
export function formatTaskDay(d: Date, now: Date): string {
  const p = beijingParts(d);
  const diff = beijingParts(now).dayIndex - p.dayIndex;
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${p.m} 月 ${p.d} 日`;
}

/** 「今天 10:52」「11 月 12 日 14:20」 */
export function formatTaskDayTime(d: Date, now: Date): string {
  const p = beijingParts(d);
  return `${formatTaskDay(d, now)} ${p.hh}:${p.mm}`;
}

// ---------- 主函数 ----------

/** 交付后又重新打开、还没再次交付 */
export function isReopenedPending(input: Pick<TaskViewInput, 'reopenedAt' | 'lastDelivery'>): boolean {
  const { reopenedAt, lastDelivery } = input;
  return !!reopenedAt && !!lastDelivery && reopenedAt.getTime() > lastDelivery.at.getTime();
}

/**
 * 算出这个任务在这一端怎么显示。返回 null = 这一端不该看到这个任务
 * （已删除的任务三端都不显示；专家只看得到分给自己、已提交的任务）。
 */
export function taskView(input: TaskViewInput): TaskView | null {
  if (input.deletedAt) return null;
  switch (input.viewer.side) {
    case 'customer':
      return customerView(input);
    case 'expert':
      return expertView(input);
    case 'operator':
      return operatorView(input);
  }
}

function view(side: TaskViewSide, v: Omit<TaskView, 'stage'> & { stageLabel: string }): TaskView {
  const { stageLabel, ...rest } = v;
  return { ...rest, stage: TASK_VIEW_STAGES[side].indexOf(stageLabel) };
}

function customerView(i: TaskViewInput): TaskView {
  const isAdmin = !!i.viewer.isCustomerAdmin;
  if (i.lastDelivery) {
    if (i.chargeStatus === 'awaiting_credits') {
      // C01·S02：次数用完，成果先锁住。管理员看到「续约后可下载」，普通成员不提次数、续约
      return view('customer', {
        key: 'delivered_locked',
        label: isAdmin ? '已编制好 · 续约后可下载' : '已编制好 · 暂不能下载',
        tone: 'action',
        nextStep: isAdmin ? '编制次数已经用完，续约后就能下载' : '需要组织管理员处理后才能下载',
        detail: isAdmin ? '三份文档都在，续约后自动放开，算 1 次' : '需要贵组织管理员处理，请联系管理员',
        stageLabel: '已交付',
        needsAction: isAdmin,
        readOnly: true,
      });
    }
    // 重新打开期间客户照常看到已交付，仍能下载上一次交付的那一版
    return view('customer', {
      key: 'delivered',
      label: '已交付',
      tone: 'done',
      nextStep: '成果已交付，三份 Word 可以下载',
      detail:
        i.lastDelivery.kind === 'update'
          ? `${formatTaskDay(i.lastDelivery.at, i.now)}已更新`
          : `${formatTaskDay(i.lastDelivery.at, i.now)}专家已交付`,
      stageLabel: '已交付',
      needsAction: false,
      readOnly: true,
    });
  }

  if (i.flow === 'legacy') {
    // 旧流程没交付的任务：只能看，有事找客服
    const submitted = i.status === 'submitted';
    return view('customer', {
      key: 'legacy_readonly',
      label: submitted ? '专家编制' : '准备资料',
      tone: 'progress',
      nextStep: '这个任务按原来的方式办理，现在只能查看',
      detail: '有要改的地方，请联系耕云客服',
      stageLabel: submitted ? '专家编制' : '准备资料',
      needsAction: false,
      readOnly: true,
    });
  }

  if (i.status === 'submitted') {
    return view('customer', {
      key: 'expert_working',
      label: '专家编制',
      tone: 'progress',
      nextStep: '专家正在编制，交付后邮件通知您',
      detail: i.submittedAt ? `资料 ${formatTaskDay(i.submittedAt, i.now)}已提交` : '资料已提交',
      stageLabel: '专家编制',
      needsAction: false,
      readOnly: true,
    });
  }

  const base = { label: '准备资料', tone: 'action' as const, stageLabel: '准备资料', needsAction: true, readOnly: false };
  if (!i.tableUploaded) {
    return view('customer', {
      ...base,
      key: 'preparing_no_table',
      nextStep: '下载资料模板，填好后上传',
      detail: i.withdrawnBefore ? '已撤回，改好后再提交' : '还没上传资料表格',
    });
  }
  if (i.missingCount > 0) {
    return view('customer', {
      ...base,
      key: 'preparing_missing',
      nextStep: `还差 ${i.missingCount} 项必填，补齐后提交`,
      detail: i.withdrawnBefore ? '已撤回，改好后再提交' : '资料表格已上传',
    });
  }
  return view('customer', {
    ...base,
    key: 'preparing_ready',
    nextStep: '必填都齐了，可以提交给专家',
    detail: i.withdrawnBefore ? '已撤回，这次提交后不能再撤回' : '资料表格已上传',
  });
}

function expertView(i: TaskViewInput): TaskView | null {
  // 专家只看得到分给自己的、已提交的任务；客户撤回后回到准备资料，专家这边先不显示
  if (!i.assignedExpertId || i.assignedExpertId !== i.viewer.userId) return null;
  if (i.status !== 'submitted') return null;

  if (i.lastDelivery) {
    if (isReopenedPending(i)) {
      return view('expert', {
        key: 'reopened',
        label: '重新打开 · 待交付',
        tone: 'action',
        nextStep: null,
        detail: `${formatTaskDay(i.reopenedAt!, i.now)}重新打开，客户仍能下载上一次交付的那一版`,
        stageLabel: '重新打开 · 待交付',
        needsAction: true,
        readOnly: false,
      });
    }
    // 专家端不提次数：次数用完时专家这边照常显示已交付
    return view('expert', {
      key: 'delivered',
      label: '已交付',
      tone: 'done',
      nextStep: null,
      detail: `${formatTaskDay(i.lastDelivery.at, i.now)}${i.lastDelivery.kind === 'update' ? '再次交付' : '交付'}`,
      stageLabel: '已交付',
      needsAction: false,
      readOnly: true,
    });
  }

  if (i.flow === 'intake' && i.awaitingCustomerSince) {
    return view('expert', {
      key: 'awaiting_customer',
      label: '等客户补资料',
      tone: 'progress',
      nextStep: null,
      detail: missingListLine(i),
      stageLabel: '等客户补资料',
      needsAction: false,
      readOnly: false,
    });
  }

  if (!i.snapshotAt) {
    return view('expert', {
      key: 'to_check',
      label: '待核对资料',
      tone: 'action',
      nextStep: null,
      detail: i.fileCounts
        ? `资料表格 ${i.fileCounts.table} 份 · 图纸与照片 ${i.fileCounts.others} 份`
        : '客户已提交，等您开始',
      stageLabel: '待核对资料',
      needsAction: true,
      readOnly: false,
    });
  }

  return view('expert', {
    key: 'working',
    label: '编制中',
    tone: i.draft === 'failed' ? 'error' : 'action',
    nextStep: null,
    detail: workingLine(i, '请重试'),
    stageLabel: '编制中',
    needsAction: true,
    readOnly: false,
  });
}

function operatorView(i: TaskViewInput): TaskView {
  if (i.lastDelivery) {
    if (isReopenedPending(i)) {
      return view('operator', {
        key: 'reopened',
        label: '重新打开 · 待交付',
        tone: 'action',
        nextStep: null,
        detail: `${formatTaskDay(i.reopenedAt!, i.now)}重新打开，等专家再次交付`,
        stageLabel: '专家处理中',
        needsAction: false,
        readOnly: false,
      });
    }
    if (i.chargeStatus === 'awaiting_credits') {
      return view('operator', {
        key: 'delivered_locked',
        label: '已交付 · 等次数',
        tone: 'action',
        nextStep: null,
        detail: '次数用完，成果已编制好，等次数到账后放开',
        stageLabel: '已交付',
        needsAction: false,
        readOnly: true,
      });
    }
    return view('operator', {
      key: 'delivered',
      label: '已交付',
      tone: 'done',
      nextStep: null,
      detail: `${formatTaskDay(i.lastDelivery.at, i.now)}${i.lastDelivery.kind === 'update' ? '再次交付' : '交付'}`,
      stageLabel: '已交付',
      needsAction: false,
      readOnly: true,
    });
  }

  if (i.status === 'preparing') {
    let detail: string;
    if (i.flow === 'legacy') detail = '客户还没提交';
    else if (i.withdrawnBefore) detail = '客户撤回了，改好后再提交';
    else if (!i.tableUploaded) detail = '还没上传资料表格';
    else if (i.missingCount > 0) detail = `表格已上传，还差 ${i.missingCount} 项必填`;
    else detail = '必填都齐了，客户还没提交';
    return view('operator', {
      key: 'preparing',
      label: '资料准备',
      tone: 'progress',
      nextStep: null,
      detail,
      stageLabel: '资料准备',
      needsAction: false,
      readOnly: false,
    });
  }

  if (!i.assignedExpertId) {
    return view('operator', {
      key: 'to_assign',
      label: '待分配专家',
      tone: 'action',
      nextStep: null,
      detail: i.submittedAt ? `${formatTaskDayTime(i.submittedAt, i.now)} 提交` : '客户已提交',
      stageLabel: '待分配专家',
      needsAction: true,
      readOnly: false,
    });
  }

  if (i.flow === 'intake' && i.awaitingCustomerSince) {
    return view('operator', {
      key: 'awaiting_customer',
      label: '等客户补资料',
      tone: 'action',
      nextStep: null,
      detail: missingListLine(i),
      stageLabel: '等客户补资料',
      needsAction: true,
      readOnly: false,
    });
  }

  if (!i.snapshotAt) {
    return view('operator', {
      key: 'to_check',
      label: '待核对资料',
      tone: 'action',
      nextStep: null,
      detail: '已分配，专家还没开始',
      stageLabel: '专家处理中',
      needsAction: false,
      readOnly: false,
    });
  }

  if (i.draft === 'ready') {
    return view('operator', {
      key: 'draft_ready',
      label: '初稿已生成',
      tone: 'progress',
      nextStep: null,
      detail: '等专家核对定稿',
      stageLabel: '专家处理中',
      needsAction: false,
      readOnly: false,
    });
  }

  return view('operator', {
    key: 'checking',
    label: '核对中',
    tone: i.draft === 'failed' ? 'error' : 'progress',
    nextStep: null,
    detail: workingLine(i, '等专家重试'),
    stageLabel: '专家处理中',
    needsAction: false,
    readOnly: false,
  });
}

function missingListLine(i: TaskViewInput): string {
  const listed = `${formatTaskDay(i.awaitingCustomerSince!, i.now)}列出`;
  return i.awaitingCustomerItems ? `缺 ${i.awaitingCustomerItems} 项 · ${listed}` : `缺项清单 · ${listed}`;
}

function workingLine(i: TaskViewInput, retry: string): string {
  if (i.draft === 'ready') return '三份初稿已生成';
  if (i.draft === 'generating') return '初稿生成中';
  if (i.draft === 'failed') return `初稿生成失败，${retry}`;
  const done = Math.max(0, Math.min(WORKUP_STEP_COUNT, i.workupStepsDone));
  return `资料核对 ${done} / ${WORKUP_STEP_COUNT} 步`;
}
