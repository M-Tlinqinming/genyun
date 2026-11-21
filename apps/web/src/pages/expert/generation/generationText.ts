import { draftActive, DRAFT_KIND_KEYS, DRAFT_KINDS, type DraftProgress, type DraftStepProgress, type GenerationProgress } from '@genyun/shared';
import { clock, dayLabel } from '../editing/EditDialogs';

// 生成初稿页上的所有文字：都由这里按进度和「现在」算出来，页面只管摆

export type GenerationPhase = 'running' | 'failed' | 'done';

export function phaseOf(g: GenerationProgress): GenerationPhase {
  if (g.drafts.some(draftActive)) return 'running';
  return g.drafts.some((d) => d.status === 'failed') ? 'failed' : 'done';
}

/** 三份固定按应急预案、风险评估报告、应急资源调查报告排 */
export function orderedDrafts(g: GenerationProgress): DraftProgress[] {
  return DRAFT_KIND_KEYS.flatMap((k) => g.drafts.filter((d) => d.kind === k));
}

const nameOf = (d: Pick<DraftProgress, 'kind'>) => DRAFT_KINDS[d.kind];

/** 「今天 15:25」「昨天 16:50」「11 月 16 日 09:30」（北京时间） */
export const timeOf = (iso: string, now: Date) => `${dayLabel(iso, now)} ${clock(iso)}`;

/** 时间接在汉字后面：以数字开头的前面加一个空格，「今天」「昨天」开头的不加 */
const afterHan = (time: string) => (/^\d/.test(time) ? ` ${time}` : time);

const counts = (g: GenerationProgress) => ({
  done: g.drafts.filter((d) => d.status === 'done').length,
  failed: orderedDrafts(g).filter((d) => d.status === 'failed'),
  active: g.drafts.some(draftActive),
  allQueued: g.drafts.length > 0 && g.drafts.every((d) => d.status === 'queued'),
});

export function generationTitle(g: GenerationProgress): string {
  const { done, failed, active, allQueued } = counts(g);
  if (allQueued) return '还在排队，三份初稿都没开始生成';
  if (active) return done > 0 ? `正在生成三份初稿，已好 ${done} 份` : '正在生成三份初稿';
  if (failed.length === 0) return '三份初稿都已生成';
  if (failed.length === 1) return `两份已生成，${nameOf(failed[0]!)}没生成成功`;
  if (failed.length === 2) return `一份已生成，${nameOf(failed[0]!)}和${nameOf(failed[1]!)}没生成成功`;
  return '三份初稿都没生成成功';
}

const LEAVE = '离开这一页不会中断，好了以后在任务中心点「核对文稿」接着做。';

export function generationSubtitle(g: GenerationProgress, now: Date): string {
  const { failed, active, allQueued } = counts(g);
  const basis = `按您${afterHan(timeOf(g.createdAt, now))} 确认的资料生成`;
  if (allQueued) return `${basis}。${LEAVE}`;
  if (active) return `${basis}，一般要 3 到 5 分钟。${LEAVE}`;
  if (failed.length === 0) return `${basis}。三份逐份核对后，就可以定稿并交付。`;
  if (failed.length === 1) return '已生成的两份不受影响。重新生成只重做失败的这一份，大约 2 分钟。';
  if (failed.length === 2) return '已生成的一份不受影响。重新生成只重做失败的两份，每份大约 2 分钟。';
  return '三份都要重新生成，每份大约 2 分钟。';
}

/** 生成中那一行：在做哪一步 */
export function runningLine(p: DraftStepProgress | null): string {
  if (!p) return '刚开始生成';
  switch (p.step) {
    case 'write':
      return p.title ? `正在写「${p.title}」` : '正在写正文';
    case 'risk':
      return '正在写现场处置方案的风险描述';
    case 'content':
      return '正在整理内容';
    case 'layout':
      return '正在排版';
    case 'pdf':
      return '正在转成 PDF';
  }
}

/** 进度条填充，0 到 1 */
export const progressRatio = (p: DraftStepProgress | null) => (p && p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0);

// 失败时中断在哪一步（接在「时中断」前面）
function brokeAt(p: DraftStepProgress): string {
  switch (p.step) {
    case 'write':
      return p.title ? `写「${p.title}」` : '生成';
    case 'risk':
      return '写现场处置方案的风险描述';
    case 'content':
      return '整理内容';
    case 'layout':
      return '排版';
    case 'pdf':
      return '转成 PDF';
  }
}

export type RowLine = { text: string; error?: boolean };

/** 卡片里每一行名称下面那句 */
export function draftLine(d: DraftProgress, g: GenerationProgress, now: Date): RowLine {
  switch (d.status) {
    case 'done': {
      const parts = [
        d.finishedAt ? `${timeOf(d.finishedAt, now)} 生成` : null,
        d.pages !== null ? `${d.pages} 页` : null,
        d.pendingCount === null ? null : d.pendingCount === 0 ? '没有待补充' : `${d.pendingCount} 处待补充`,
      ].filter(Boolean);
      return { text: parts.join(' · ') };
    }
    case 'running':
      return { text: runningLine(d.progress) };
    case 'queued':
      return { text: queuedLine(d, g, now) };
    case 'failed': {
      const t = d.finishedAt ? `${timeOf(d.finishedAt, now)} ` : '';
      if (d.progress) {
        const verb = brokeAt(d.progress);
        // 「转成 PDF 时中断」：英文字母和汉字之间空一格
        return { text: `${t}${verb}${/[A-Za-z0-9]$/.test(verb) ? ' ' : ''}时中断，已生成的部分没有保留`, error: true };
      }
      if (d.startedAt) return { text: `${t}生成时中断，已生成的部分没有保留`, error: true };
      return { text: `${t}排队时中断，还没有开始生成`, error: true };
    }
  }
}

// 排队的先后：我这一批正在生成的放最前；排队的按进队列时间，同时进的按固定顺序
function lineUp(g: GenerationProgress): DraftProgress[] {
  const ordered = orderedDrafts(g);
  const running = ordered.filter((d) => d.status === 'running');
  const queued = ordered
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.status === 'queued')
    .sort((a, b) => Date.parse(a.d.queuedAt) - Date.parse(b.d.queuedAt) || a.i - b.i)
    .map(({ d }) => d);
  return [...running, ...queued];
}

function queuedLine(d: DraftProgress, g: GenerationProgress, now: Date): string {
  const line = lineUp(g);
  const at = line.findIndex((x) => x.kind === d.kind);
  if (at <= 0) {
    const n = g.queueAhead ?? 0;
    return `${timeOf(d.queuedAt, now)} 进入队列 · ${n > 0 ? `前面还有 ${n} 个任务` : '马上开始'}`;
  }
  return `${nameOf(line[at - 1]!)}好了就开始`;
}

/** 等了多久：「14 分钟」「1 小时 5 分钟」「2 小时」 */
export function waitedText(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分钟`;
}

export type QueueNoticeText = { contact: boolean; title: string; body: string };

/** 琥珀提示：我这一批没有在生成的、有排队的，最早进队列的满 10 分钟才出；满 30 分钟改成请联系客服 */
export function queueNotice(g: GenerationProgress, now: Date, taskNumber: string): QueueNoticeText | null {
  if (g.drafts.some((d) => d.status === 'running')) return null;
  const queued = g.drafts.filter((d) => d.status === 'queued');
  if (queued.length === 0) return null;
  const since = Math.min(...queued.map((d) => Date.parse(d.queuedAt)));
  const minutes = Math.floor((now.getTime() - since) / 60_000);
  if (minutes < 10) return null;
  const n = g.queueAhead ?? 0;
  const busy = n > 0 ? `现在生成的任务比较多，前面还有 ${n} 个。` : '';
  const title = `已经等了 ${waitedText(minutes)}，比平时慢`;
  if (minutes >= 30) return { contact: true, title, body: `${busy}请联系耕云客服，告诉客服任务编号 ${taskNumber}。` };
  return {
    contact: false,
    title,
    body: `${busy}您可以先去做别的，好了任务中心会显示「三份初稿已生成」。超过 30 分钟还没开始，请联系耕云客服。`,
  };
}

/** 底栏左边那句 */
export function footerText(g: GenerationProgress): string {
  const done = g.drafts.filter((d) => d.status === 'done').length;
  return done === g.drafts.length && done > 0 ? '三份都好了，可以开始核对' : `已好 ${done} 份，共 3 份 · 三份都好了才能开始核对`;
}
