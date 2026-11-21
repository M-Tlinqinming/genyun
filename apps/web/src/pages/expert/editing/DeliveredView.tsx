import { FileWordOutlined, ReloadOutlined } from '@ant-design/icons';
import { DRAFT_KINDS, type PublishView } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button } from 'antd';
import { useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { downloadWord } from '../../../api/deliveries';
import { publicationKey, reopenTask } from '../../../api/publish';
import { ApiError } from '../../../api/request';
import { reviewKey } from '../../../api/review';
import { linkButton } from '../../../components/ui';
import { WizardHeader } from '../../../components/WizardHeader';
import { EXPERT_STAGES } from '../../../layouts/WizardLayout';
import { gy, stage, type, weight } from '../../../theme/tokens';
import { ReopenConfirm } from './DeliverDialogs';
import { HistoryDrawer } from './ReviewParts';

// 已交付页（15 页 R11）：任务已交付、没重新打开时，专家打开任务看到的就是这一页，整页只读。
// 三份 Word 可以看正文、下载；要修改先点「重新打开」（R12 确认）

const text14: CSSProperties = { ...type.body };
const rowLine = '1px solid #EEF0F3';

/** 例：2026 年 11 月 20 日 10:50（北京时间） */
export function deliveredAt(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日 ${parts.hour}:${parts.minute}`;
}

export function DeliveredView({
  taskId,
  enterpriseName,
  taskNumber,
  view,
}: {
  taskId: string;
  enterpriseName: string;
  taskNumber: string;
  view: PublishView;
}) {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const client = useQueryClient();
  const { message } = App.useApp();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reopening, setReopening] = useState(false);
  const d = view.delivered!;

  const reopen = async () => {
    setReopening(true);
    const done = async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: publicationKey(taskId) }),
        client.invalidateQueries({ queryKey: reviewKey(taskId) }),
        client.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
      setAsking(false);
      setParams({ view: 'edit' });
    };
    try {
      await reopenTask(taskId);
      await done();
    } catch (err) {
      const reason = err instanceof ApiError ? (err.body as { reason?: string } | null)?.reason : undefined;
      if (reason === 'already_reopened') {
        // 别人（或另一个窗口）刚重新打开过：结果一样，直接进去
        await done();
      } else if (err instanceof ApiError && err.status > 0 && err.status < 500) {
        setAsking(false);
        message.warning(err.message);
        void client.invalidateQueries({ queryKey: publicationKey(taskId) });
      } else {
        message.error('没有重新打开，请检查网络后重试');
      }
    } finally {
      setReopening(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: gy.canvas }}>
      <WizardHeader
        title="编制文稿"
        enterpriseName={`${enterpriseName} · ${taskNumber}`}
        stages={EXPERT_STAGES}
        current={EXPERT_STAGES.length}
        stageNotes={{ 0: '5 步' }}
        stageLastStrong
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button type="button" style={{ ...linkButton, ...text14 }} aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
              处理记录
            </button>
            <Button onClick={() => navigate('/expert')}>返回任务中心</Button>
          </div>
        }
      />
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '32px 32px 48px' }}>
          <main style={{ width: 1080, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <h1 style={{ ...type.pageTitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>已交付给客户</h1>
                  <span style={{ ...type.caption, color: stage.done.color, background: stage.done.bg, borderRadius: 4, padding: '0 8px' }}>已交付</span>
                </div>
                <span style={{ ...text14, color: gy.secondary }}>客户已收到站内提醒和邮件，现在可以下载这三份 Word。任务已变为只读。</span>
              </div>
              {view.editable && (
                <Button icon={<ReloadOutlined />} onClick={() => setAsking(true)}>
                  重新打开
                </Button>
              )}
            </header>

            <section aria-label="交付的文稿" style={{ background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '10px 24px',
                  background: gy.canvas,
                  borderBottom: `1px solid ${gy.split}`,
                  borderRadius: '8px 8px 0 0',
                  ...text14,
                  fontWeight: weight.strong,
                  color: gy.secondary,
                }}
              >
                <span style={{ width: 420, flexShrink: 0 }}>交付的文稿</span>
                <span style={{ flex: 1 }}>页数</span>
                <span style={{ width: 200, flexShrink: 0, textAlign: 'right' }}>操作</span>
              </div>
              {d.files.map((f, i) => (
                <div
                  key={f.kind}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: i < d.files.length - 1 ? rowLine : 'none' }}
                >
                  <span style={{ width: 420, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <FileWordOutlined aria-hidden style={{ fontSize: 20, color: gy.secondary }} />
                    <span style={{ ...text14, color: gy.text, overflowWrap: 'anywhere' }}>{f.name}</span>
                  </span>
                  <span style={{ ...text14, flex: 1, color: gy.secondary }}>{f.pages ? `${f.pages} 页` : '—'}</span>
                  <span style={{ width: 200, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
                    <button
                      type="button"
                      aria-label={`看正文 ${DRAFT_KINDS[f.kind]}`}
                      style={{ ...linkButton, ...text14 }}
                      onClick={() => setParams({ view: 'edit', doc: f.kind })}
                    >
                      看正文
                    </button>
                    <button
                      type="button"
                      aria-label={`下载 Word ${DRAFT_KINDS[f.kind]}`}
                      style={{ ...linkButton, ...text14 }}
                      onClick={() => void downloadWord(f.fileId, f.name).catch(() => message.error('没有下载成功，请检查网络后重试'))}
                    >
                      下载 Word
                    </button>
                  </span>
                </div>
              ))}
            </section>

            <section
              aria-label="交付信息"
              style={{ background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px' }}
            >
              <h2 style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>交付信息</h2>
              {(
                [
                  ['交付时间', deliveredAt(d.at)],
                  ['审核人', d.reviewerName],
                  ['审核结论', d.note],
                ] as const
              ).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', gap: 16 }}>
                  <span style={{ ...text14, width: 120, flexShrink: 0, color: gy.tertiary }}>{label}</span>
                  <span style={{ ...text14, flex: 1, minWidth: 0, color: gy.text, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{value}</span>
                </div>
              ))}
            </section>
          </main>
        </div>
        <HistoryDrawer taskId={taskId} open={historyOpen} onClose={() => setHistoryOpen(false)} top={0} />
      </div>
      <ReopenConfirm open={asking} loading={reopening} onCancel={() => setAsking(false)} onOk={() => void reopen()} />
    </div>
  );
}
