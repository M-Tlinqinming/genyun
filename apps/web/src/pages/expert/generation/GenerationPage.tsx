import type { DraftKind, GenerationProgress } from '@genyun/shared';
import { App, Button } from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { isDraftNotFailed, useRetryGeneration } from '../../../api/generation';
import { ApiError } from '../../../api/request';
import { linkButton } from '../../../components/ui';
import { WizardHeader } from '../../../components/WizardHeader';
import { EXPERT_STAGES } from '../../../layouts/WizardLayout';
import { gy, layout, type, weight } from '../../../theme/tokens';
import { HistoryDrawer } from '../editing/ReviewParts';
import { DraftRow } from './DraftRow';
import { footerText, generationSubtitle, generationTitle, orderedDrafts, queueNotice } from './generationText';
import { QueueNotice } from './QueueNotice';

// 「开始核对」没全好时的样子：只写在这个按钮上，不改全局主题
const startDisabled: CSSProperties = { background: gy.neutralBg, borderColor: gy.controlLine, color: gy.tertiary };

// 「现在」多久走一次：排队的分钟数、「今天 / 昨天」跟着变
const TICK_MS = 20_000;

// 生成初稿（E18-02 / 02b / 02c）：三份初稿各自的进度；失败的那份单独重新生成；三份都好了进核对定稿。
// 刷新靠 useGeneration：有排队或生成中的份时每 2 秒取一次
export function GenerationPage({
  taskId,
  enterpriseName,
  taskNumber,
  generation,
  onStartReview,
}: {
  taskId: string;
  enterpriseName: string;
  taskNumber: string;
  generation: GenerationProgress;
  /** 三份都好了，点「开始核对」 */
  onStartReview: () => void;
}) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const retry = useRetryGeneration(taskId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  const drafts = orderedDrafts(generation);
  const allDone = drafts.length > 0 && drafts.every((d) => d.status === 'done');
  const notice = queueNotice(generation, now, taskNumber);

  const redo = (kind: DraftKind) =>
    retry.mutate(kind, {
      onError: (err) => {
        // 这一份已经不是失败的：接口那句话由 useRetryGeneration 提示
        if (isDraftNotFailed(err)) return;
        message.error(err instanceof ApiError ? err.message : '没有提交成功，请检查网络后重试');
      },
    });

  return (
    <div className="gy-review-page" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: gy.canvas }}>
      <WizardHeader
        title="编制文稿"
        enterpriseName={`${enterpriseName} · ${taskNumber}`}
        stages={EXPERT_STAGES}
        current={1}
        sideWidth={280}
        stageNotes={{ 0: '5 步' }}
        stageLinks={{ 0: { to: `/expert/tasks/${taskId}?view=workup&step=5`, title: '回到资料核对' } }}
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button type="button" style={{ ...linkButton, ...type.body }} aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
              处理记录
            </button>
            <Button onClick={() => navigate('/expert')}>返回任务中心</Button>
          </div>
        }
      />
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div
            style={{
              width: layout.wizard,
              maxWidth: 'calc(100% - 48px)',
              margin: '0 auto',
              padding: '32px 0 48px',
              display: 'flex',
              flexDirection: 'column',
              gap: 24,
            }}
          >
            <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h1 style={{ margin: 0, ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>{generationTitle(generation)}</h1>
              <p style={{ margin: 0, ...type.body, color: gy.secondary }}>{generationSubtitle(generation, now)}</p>
            </header>
            {notice && <QueueNotice notice={notice} />}
            <ul
              aria-label="三份初稿"
              style={{ margin: 0, padding: '0 24px', listStyle: 'none', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}
            >
              {drafts.map((d, i) => (
                <DraftRow
                  key={d.kind}
                  draft={d}
                  generation={generation}
                  now={now}
                  last={i === drafts.length - 1}
                  retrying={retry.isPending && retry.variables === d.kind}
                  onRetry={() => redo(d.kind)}
                />
              ))}
            </ul>
          </div>
        </div>
        <div
          role="region"
          aria-label="页面操作"
          style={{
            height: 64,
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'center',
            padding: '0 24px',
            background: gy.surface,
            borderTop: `1px solid ${gy.split}`,
          }}
        >
          <div style={{ width: layout.wizard, maxWidth: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ ...type.body, color: gy.tertiary }}>{footerText(generation)}</span>
            <Button type="primary" disabled={!allDone} style={allDone ? undefined : startDisabled} onClick={onStartReview}>
              开始核对
            </Button>
          </div>
        </div>
        <HistoryDrawer taskId={taskId} open={historyOpen} onClose={() => setHistoryOpen(false)} top={0} />
      </div>
    </div>
  );
}
