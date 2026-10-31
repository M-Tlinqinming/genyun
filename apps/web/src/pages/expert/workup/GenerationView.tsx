import { LoadingOutlined } from '@ant-design/icons';
import { draftActive, DRAFT_KINDS, type DraftProgress, type GenerationProgress } from '@genyun/shared';
import { App, Button } from 'antd';
import type { CSSProperties } from 'react';
import { openFile } from '../../../api/documents';
import { useRetryGeneration } from '../../../api/generation';
import { ApiError } from '../../../api/request';
import { linkButton } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };

function stamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('month')}.${p('day')} ${p('hour')}:${p('minute')}`;
}

export type GenerationPhase = 'running' | 'failed' | 'done';

export function phaseOf(g: GenerationProgress): GenerationPhase {
  if (g.drafts.some(draftActive)) return 'running';
  return g.drafts.some((d) => d.status === 'failed') ? 'failed' : 'done';
}

// I05 · E18-02 正在生成三份草稿 / E18-02b 生成部分失败：三份各自的进度，失败的只重试那一份
export function GenerationView({
  taskId,
  taskNumber,
  generation,
  onBackToCenter,
  onBackToWorkup,
  onEdit,
}: {
  taskId: string;
  taskNumber: string;
  generation: GenerationProgress;
  onBackToCenter: () => void;
  onBackToWorkup: () => void;
  onEdit: () => void;
}) {
  const retry = useRetryGeneration(taskId);
  const { message } = App.useApp();
  const phase = phaseOf(generation);
  const done = generation.drafts.filter((d) => d.status === 'done').length;
  const failed = generation.drafts.filter((d) => d.status === 'failed');
  const files = generation.materials.length;

  const title =
    phase === 'running' ? '正在生成三份草稿' : phase === 'failed' ? `${done} 份已生成，${failed.length} 份需要重试` : '三份草稿已生成';
  const basis = `已采用 ${files} 份客户资料与专业整理　·　开始于 ${stamp(generation.createdAt)}`;

  const doRetry = async () => {
    try {
      await retry.mutateAsync();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '没有提交成功，请检查网络后重试');
    }
  };

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(taskNumber);
      message.success(`已复制任务编号 ${taskNumber}`);
    } catch {
      message.info(`任务编号：${taskNumber}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 24, lineHeight: '32px', fontWeight: 500, color: gy.text }}>{title}</h2>
        <span style={{ ...text14, color: gy.secondary }}>
          {phase === 'failed' ? `${basis}　·　已生成的内容和本次资料依据均已保留` : basis}
        </span>
        {phase === 'running' && (
          <div style={{ ...text14, color: gy.text, padding: '12px 16px', borderRadius: 6, background: gy.selected, marginTop: 4 }}>
            可以返回任务中心处理其他工作；回来后继续查看进度。生成结果仍需专家逐份编辑、核对与审核。
          </div>
        )}
        {phase === 'failed' && (
          <div
            role="alert"
            style={{ ...text14, color: gy.error, padding: '12px 16px', borderRadius: 6, background: gy.surface, border: `1px solid ${gy.error}`, marginTop: 4 }}
          >
            {failed.map((d) => DRAFT_KINDS[d.kind]).join('、')}生成中断。当前还不能进入正文编辑；请重试失败项。
          </div>
        )}
      </div>

      <ul role="list" aria-label="三份草稿" style={{ margin: 0, padding: 0, listStyle: 'none', background: gy.surface, border: `1px solid ${gy.split}` }}>
        {generation.drafts.map((d, i) => (
          <DraftLine key={d.kind} draft={d} first={i === 0} />
        ))}
      </ul>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 20 }}>
        <span style={{ flex: 1, ...text14, color: gy.secondary }}>
          {phase === 'running'
            ? `${done} / 3 已生成　·　页面刷新不会重复发起生成`
            : phase === 'failed'
              ? '重试只处理失败的份，不清除已生成的草稿。'
              : '三份草稿已保存，下一步逐份编辑、核对与审核。'}
        </span>
        {phase === 'done' && <Button onClick={onBackToWorkup}>查看专业整理</Button>}
        <Button onClick={onBackToCenter}>返回任务中心</Button>
        {phase === 'failed' && (
          <Button type="primary" loading={retry.isPending} onClick={() => void doRetry()}>
            {failed.length === 1 ? `重试${DRAFT_KINDS[failed[0]!.kind]}` : `重试失败的 ${failed.length} 份`}
          </Button>
        )}
        {phase === 'done' && (
          <Button type="primary" onClick={onEdit}>
            进入正文编辑
          </Button>
        )}
      </div>

      {phase === 'failed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, ...text14, color: gy.secondary, paddingTop: 24 }}>
          <span>持续失败时，可携任务编号联系耕云技术支持。</span>
          <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => void copyNumber()}>
            复制任务编号
          </button>
        </div>
      )}
    </div>
  );
}

function DraftLine({ draft, first }: { draft: DraftProgress; first: boolean }) {
  const { message } = App.useApp();
  const open = (fileId: string) => openFile(fileId).catch(() => message.error('打不开这份文件，请稍后重试'));
  const status =
    draft.status === 'done' ? (
      <span style={{ color: stage.done.color }}>✓ 已生成</span>
    ) : draft.status === 'running' ? (
      <span style={{ color: gy.primary }}>
        <LoadingOutlined style={{ marginRight: 6 }} />
        正在生成
      </span>
    ) : draft.status === 'queued' ? (
      <span style={{ color: gy.secondary }}>等待生成</span>
    ) : (
      <span style={{ color: gy.error }}>生成失败</span>
    );
  const detail =
    draft.status === 'done' ? (
      <span style={{ display: 'flex', gap: 16 }}>
        <span style={{ color: gy.secondary }}>待人工核对</span>
        <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => void open(draft.wordFileId!)}>
          下载 Word
        </button>
        {draft.pdfFileId && (
          <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => void open(draft.pdfFileId!)}>
            查看 PDF
          </button>
        )}
      </span>
    ) : draft.status === 'running' ? (
      '正在整理文稿内容'
    ) : draft.status === 'queued' ? (
      '排队中，前一份生成完就开始'
    ) : (
      `${(draft.error ?? '').replace(/^生成没有完成：/, '') || '生成没有完成'}　·　可重试`
    );

  return (
    <li
      aria-label={DRAFT_KINDS[draft.kind]}
      data-status={draft.status}
      style={{ display: 'flex', alignItems: 'center', padding: '28px 24px', borderTop: first ? undefined : `1px solid ${gy.split}`, ...text14 }}
    >
      <span style={{ width: 420, flexShrink: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>{DRAFT_KINDS[draft.kind]}</span>
      <span style={{ width: 280, flexShrink: 0 }}>{status}</span>
      <span style={{ flex: 1, minWidth: 0, color: gy.secondary }}>{detail}</span>
    </li>
  );
}
