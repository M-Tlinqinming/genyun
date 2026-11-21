import type { DraftKind, DraftProgress, DraftStepProgress, GenerationProgress } from '@genyun/shared';
import { describe, expect, it } from 'vitest';
import { draftLine, footerText, generationSubtitle, generationTitle, phaseOf, progressRatio, queueNotice, waitedText } from './generationText';

// 北京时间 2026-11-21 15:40
const NOW = new Date('2026-11-21T07:40:00.000Z');
const TODAY_1525 = '2026-11-21T07:25:00.000Z';
const NOV16_0930 = '2026-11-16T01:30:00.000Z';
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function draft(kind: DraftKind, status: DraftProgress['status'], extra: Partial<DraftProgress> = {}): DraftProgress {
  return {
    kind,
    status,
    attempts: 1,
    wordFileId: null,
    pdfFileId: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    progress: null,
    queuedAt: TODAY_1525,
    pages: null,
    pendingCount: null,
    ...extra,
  };
}
function gen(drafts: DraftProgress[], extra: Partial<GenerationProgress> = {}): GenerationProgress {
  return {
    id: 'b',
    workupVersion: 1,
    snapshotAt: TODAY_1525,
    materials: [],
    createdAt: TODAY_1525,
    createdByName: '周工',
    editedSections: 0,
    drafts,
    queueAhead: null,
    ...extra,
  };
}
const S = (kind: DraftKind, s: DraftProgress['status'], extra?: Partial<DraftProgress>) => draft(kind, s, extra);
const done3 = gen([S('plan', 'done'), S('risk', 'done'), S('resource', 'done')]);
const queued3 = gen([S('plan', 'queued'), S('risk', 'queued'), S('resource', 'queued')], { queueAhead: 2 });
const running = gen([S('plan', 'done'), S('risk', 'running'), S('resource', 'queued')], { queueAhead: 0 });
const runningNone = gen([S('plan', 'running'), S('risk', 'queued'), S('resource', 'queued')], { queueAhead: 0 });
const fail1 = gen([S('plan', 'done'), S('risk', 'done'), S('resource', 'failed')]);
const fail2 = gen([S('plan', 'failed'), S('risk', 'done'), S('resource', 'failed')]);
const fail3 = gen([S('plan', 'failed'), S('risk', 'failed'), S('resource', 'failed')]);

describe('标题', () => {
  it('六种情况', () => {
    expect(generationTitle(done3)).toBe('三份初稿都已生成');
    expect(generationTitle(queued3)).toBe('还在排队，三份初稿都没开始生成');
    expect(generationTitle(running)).toBe('正在生成三份初稿，已好 1 份');
    expect(generationTitle(runningNone)).toBe('正在生成三份初稿');
    expect(generationTitle(fail1)).toBe('两份已生成，应急资源调查报告没生成成功');
    expect(generationTitle(fail2)).toBe('一份已生成，应急预案和应急资源调查报告没生成成功');
    expect(generationTitle(fail3)).toBe('三份初稿都没生成成功');
  });

  it('一份失败、另一份还在重新生成：仍是正在生成', () => {
    expect(generationTitle(gen([S('plan', 'failed'), S('risk', 'queued'), S('resource', 'done')]))).toBe('正在生成三份初稿，已好 1 份');
    expect(phaseOf(fail1)).toBe('failed');
    expect(phaseOf(running)).toBe('running');
    expect(phaseOf(done3)).toBe('done');
  });
});

describe('副标题', () => {
  it('六种情况', () => {
    expect(generationSubtitle(done3, NOW)).toBe('按您今天 15:25 确认的资料生成。三份逐份核对后，就可以定稿并交付。');
    expect(generationSubtitle(queued3, NOW)).toBe('按您今天 15:25 确认的资料生成。离开这一页不会中断，好了以后在任务中心点「核对文稿」接着做。');
    expect(generationSubtitle(running, NOW)).toBe(
      '按您今天 15:25 确认的资料生成，一般要 3 到 5 分钟。离开这一页不会中断，好了以后在任务中心点「核对文稿」接着做。',
    );
    expect(generationSubtitle(fail1, NOW)).toBe('已生成的两份不受影响。重新生成只重做失败的这一份，大约 2 分钟。');
    expect(generationSubtitle(fail2, NOW)).toBe('已生成的一份不受影响。重新生成只重做失败的两份，每份大约 2 分钟。');
    expect(generationSubtitle(fail3, NOW)).toBe('三份都要重新生成，每份大约 2 分钟。');
  });

  it('时间以数字开头时，前面加空格', () => {
    expect(generationSubtitle({ ...done3, createdAt: NOV16_0930 }, NOW)).toBe('按您 11 月 16 日 09:30 确认的资料生成。三份逐份核对后，就可以定稿并交付。');
    expect(generationSubtitle({ ...done3, createdAt: '2026-11-20T08:50:00.000Z' }, NOW)).toMatch(/^按您昨天 16:50 确认/);
  });
});

describe('已生成的行', () => {
  it('有页数、没页数、待补充是 0、待补充是空的', () => {
    const line = (extra: Partial<DraftProgress>) => draftLine(S('plan', 'done', { finishedAt: '2026-11-21T07:27:00.000Z', ...extra }), done3, NOW);
    expect(line({ pages: 28, pendingCount: 6 })).toEqual({ text: '今天 15:27 生成 · 28 页 · 6 处待补充' });
    expect(line({ pendingCount: 6 }).text).toBe('今天 15:27 生成 · 6 处待补充');
    expect(line({ pages: 12, pendingCount: 0 }).text).toBe('今天 15:27 生成 · 12 页 · 没有待补充');
    expect(line({}).text).toBe('今天 15:27 生成');
  });
});

describe('生成中的行', () => {
  const line = (progress: DraftStepProgress | null) => draftLine(S('risk', 'running', { progress }), running, NOW).text;
  it('五种 step 和刚开始', () => {
    expect(line({ done: 2, total: 9, step: 'write', title: '危险化学品泄漏专项应急预案' })).toBe('正在写「危险化学品泄漏专项应急预案」');
    expect(line({ done: 7, total: 9, step: 'risk' })).toBe('正在写现场处置方案的风险描述');
    expect(line({ done: 0, total: 3, step: 'content' })).toBe('正在整理内容');
    expect(line({ done: 1, total: 3, step: 'layout' })).toBe('正在排版');
    expect(line({ done: 2, total: 3, step: 'pdf' })).toBe('正在转成 PDF');
    expect(line(null)).toBe('刚开始生成');
  });
  it('进度条：done ÷ total，空的为 0', () => {
    expect(progressRatio({ done: 1, total: 4, step: 'layout' })).toBe(0.25);
    expect(progressRatio(null)).toBe(0);
  });
});

describe('排队中的行', () => {
  it('第一份带人数、人数是 0；后面的份「…好了就开始」', () => {
    const g = gen([S('plan', 'queued'), S('risk', 'queued'), S('resource', 'queued')], { queueAhead: 2 });
    expect(draftLine(g.drafts[0]!, g, NOW).text).toBe('今天 15:25 进入队列 · 前面还有 2 个任务');
    expect(draftLine(g.drafts[1]!, g, NOW).text).toBe('应急预案好了就开始');
    expect(draftLine(g.drafts[2]!, g, NOW).text).toBe('风险评估报告好了就开始');
    const zero = { ...g, queueAhead: 0 };
    expect(draftLine(zero.drafts[0]!, zero, NOW).text).toBe('今天 15:25 进入队列 · 马上开始');
  });

  it('我这一批有在生成的：第一份排队的接在它后面', () => {
    expect(draftLine(running.drafts[2]!, running, NOW).text).toBe('风险评估报告好了就开始');
  });

  it('重新生成的那份进队列晚，排在后面', () => {
    const g = gen([S('plan', 'queued', { queuedAt: minutesAgo(1) }), S('risk', 'queued', { queuedAt: NOV16_0930 }), S('resource', 'done')], {
      queueAhead: 1,
    });
    expect(draftLine(g.drafts[1]!, g, NOW).text).toBe('11 月 16 日 09:30 进入队列 · 前面还有 1 个任务');
    expect(draftLine(g.drafts[0]!, g, NOW).text).toBe('风险评估报告好了就开始');
  });
});

describe('失败的行', () => {
  const at = '2026-11-21T07:31:00.000Z';
  const line = (extra: Partial<DraftProgress>) => draftLine(S('resource', 'failed', { startedAt: at, finishedAt: at, ...extra }), fail1, NOW);
  it('有 progress：每种 step', () => {
    expect(line({ progress: { done: 1, total: 9, step: 'write', title: '综合应急预案' } })).toEqual({
      text: '今天 15:31 写「综合应急预案」时中断，已生成的部分没有保留',
      error: true,
    });
    expect(line({ progress: { done: 8, total: 9, step: 'risk' } }).text).toBe('今天 15:31 写现场处置方案的风险描述时中断，已生成的部分没有保留');
    expect(line({ progress: { done: 0, total: 3, step: 'content' } }).text).toBe('今天 15:31 整理内容时中断，已生成的部分没有保留');
    expect(line({ progress: { done: 1, total: 3, step: 'layout' } }).text).toBe('今天 15:31 排版时中断，已生成的部分没有保留');
    expect(line({ progress: { done: 2, total: 3, step: 'pdf' } }).text).toBe('今天 15:31 转成 PDF 时中断，已生成的部分没有保留');
  });
  it('没 progress、没开始过、没有失败时间', () => {
    expect(line({}).text).toBe('今天 15:31 生成时中断，已生成的部分没有保留');
    expect(line({ startedAt: null }).text).toBe('今天 15:31 排队时中断，还没有开始生成');
    expect(line({ finishedAt: null }).text).toBe('生成时中断，已生成的部分没有保留');
    expect(line({ finishedAt: null, progress: { done: 1, total: 3, step: 'layout' } }).text).toBe('排版时中断，已生成的部分没有保留');
  });
});

describe('琥珀提示', () => {
  const waiting = (m: number, queueAhead = 2) =>
    gen([S('plan', 'queued', { queuedAt: minutesAgo(m) }), S('risk', 'queued', { queuedAt: minutesAgo(m) }), S('resource', 'queued', { queuedAt: minutesAgo(m) })], {
      queueAhead,
    });
  it('9 分钟不出', () => {
    expect(queueNotice(waiting(9), NOW, 'GY-2026-001')).toBeNull();
  });
  it('12 分钟：前面有人、前面没人', () => {
    expect(queueNotice(waiting(12), NOW, 'GY-2026-001')).toEqual({
      contact: false,
      title: '已经等了 12 分钟，比平时慢',
      body: '现在生成的任务比较多，前面还有 2 个。您可以先去做别的，好了任务中心会显示「三份初稿已生成」。超过 30 分钟还没开始，请联系耕云客服。',
    });
    expect(queueNotice(waiting(12, 0), NOW, 'GY-2026-001')!.body).toBe(
      '您可以先去做别的，好了任务中心会显示「三份初稿已生成」。超过 30 分钟还没开始，请联系耕云客服。',
    );
  });
  it('30 分钟：请联系耕云客服并告诉任务编号', () => {
    expect(queueNotice(waiting(30), NOW, 'GY-2026-001')).toEqual({
      contact: true,
      title: '已经等了 30 分钟，比平时慢',
      body: '现在生成的任务比较多，前面还有 2 个。请联系耕云客服，告诉客服任务编号 GY-2026-001。',
    });
    expect(queueNotice(waiting(45, 0), NOW, 'GY-2026-001')!.body).toBe('请联系耕云客服，告诉客服任务编号 GY-2026-001。');
  });
  it('65 分钟、120 分钟', () => {
    expect(queueNotice(waiting(65), NOW, 'GY-2026-001')!.title).toBe('已经等了 1 小时 5 分钟，比平时慢');
    expect(queueNotice(waiting(120), NOW, 'GY-2026-001')!.title).toBe('已经等了 2 小时，比平时慢');
    expect(waitedText(59)).toBe('59 分钟');
  });
  it('我这一批有在生成的时候不出；没有排队的也不出', () => {
    const g = waiting(40);
    expect(queueNotice({ ...g, drafts: [S('plan', 'running'), ...g.drafts.slice(1)] }, NOW, 'GY-2026-001')).toBeNull();
    expect(queueNotice(done3, NOW, 'GY-2026-001')).toBeNull();
  });
  it('只看最早进队列的那一份', () => {
    const g = gen([S('plan', 'done'), S('risk', 'queued', { queuedAt: minutesAgo(3) }), S('resource', 'queued', { queuedAt: minutesAgo(11) })]);
    expect(queueNotice(g, NOW, 'GY-2026-001')!.title).toBe('已经等了 11 分钟，比平时慢');
  });
});

describe('底栏', () => {
  it('两种', () => {
    expect(footerText(running)).toBe('已好 1 份，共 3 份 · 三份都好了才能开始核对');
    expect(footerText(done3)).toBe('三份都好了，可以开始核对');
  });
});
