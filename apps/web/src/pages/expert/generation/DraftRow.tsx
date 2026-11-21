import { ExclamationCircleFilled, FileTextOutlined, LoadingOutlined } from '@ant-design/icons';
import { DRAFT_KINDS, type DraftProgress, type GenerationProgress } from '@genyun/shared';
import { useReducedMotion } from 'motion/react';
import { StatusTag } from '../../../components/StatusTag';
import { linkButton } from '../../../components/ui';
import { gy, type, weight } from '../../../theme/tokens';
import { draftLine, progressRatio } from './generationText';

// 行和行之间的分隔线比卡片边框再浅一档（设计稿 #EEF0F3，令牌里没有这一档）
const ROW_LINE = '#EEF0F3';

// 生成初稿卡片里的一行：图标、名称和一句现状（生成中多一根进度条）、操作（只有失败的有）、状态标签
export function DraftRow({
  draft,
  generation,
  now,
  last,
  retrying,
  onRetry,
}: {
  draft: DraftProgress;
  generation: GenerationProgress;
  now: Date;
  /** 最后一行不画分隔线 */
  last: boolean;
  /** 这一行正在提交重新生成 */
  retrying: boolean;
  onRetry: () => void;
}) {
  const reduce = useReducedMotion();
  const name = DRAFT_KINDS[draft.kind];
  const line = draftLine(draft, generation, now);
  const ratio = progressRatio(draft.progress);
  const icon =
    draft.status === 'done'
      ? { bg: gy.selected, node: <FileTextOutlined style={{ fontSize: 18, color: gy.primary }} /> }
      : draft.status === 'failed'
        ? { bg: gy.errorBg, node: <ExclamationCircleFilled style={{ fontSize: 18, color: gy.error }} /> }
        : { bg: gy.neutralBg, node: <FileTextOutlined style={{ fontSize: 18, color: gy.tertiary }} /> };

  return (
    <li
      aria-label={name}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '16px 0',
        borderBottom: last ? undefined : `1px solid ${ROW_LINE}`,
      }}
    >
      <span
        aria-hidden
        style={{ width: 36, height: 36, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: icon.bg }}
      >
        {icon.node}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{name}</span>
          <span style={{ ...type.caption, color: line.error ? gy.error : gy.tertiary }}>{line.text}</span>
        </div>
        {draft.status === 'running' && (
          <div
            role="progressbar"
            aria-label={`${name}进度`}
            aria-valuemin={0}
            aria-valuemax={draft.progress?.total ?? 1}
            aria-valuenow={draft.progress?.done ?? 0}
            style={{ width: 360, maxWidth: '100%', height: 4, borderRadius: 2, background: gy.neutralBg, overflow: 'hidden' }}
          >
            <div
              style={{
                width: `${ratio * 100}%`,
                height: 4,
                borderRadius: 2,
                background: gy.primary,
                transition: reduce ? undefined : 'width 300ms cubic-bezier(0.2, 0, 0, 1)',
              }}
            />
          </div>
        )}
      </div>
      <div style={{ width: 120, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        {draft.status === 'failed' && (
          <button
            type="button"
            disabled={retrying}
            onClick={onRetry}
            style={{ ...linkButton, ...type.body, whiteSpace: 'nowrap', ...(retrying ? { color: gy.tertiary, cursor: 'default' } : {}) }}
          >
            重新生成这一份
          </button>
        )}
      </div>
      <div style={{ width: 96, flexShrink: 0, display: 'flex' }}>
        {draft.status === 'done' && <StatusTag tone="done">已生成</StatusTag>}
        {draft.status === 'running' && (
          <StatusTag tone="progress">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <LoadingOutlined spin={!reduce} style={{ fontSize: 12 }} />
              生成中
            </span>
          </StatusTag>
        )}
        {draft.status === 'queued' && <StatusTag tone="progress">排队中</StatusTag>}
        {draft.status === 'failed' && <StatusTag tone="error">生成失败</StatusTag>}
      </div>
    </li>
  );
}
