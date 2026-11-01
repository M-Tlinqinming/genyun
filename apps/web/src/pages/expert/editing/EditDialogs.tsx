import { blocksText, type EditBlock, type SectionView } from '@genyun/shared';
import { Button, Modal } from 'antd';
import type { CSSProperties } from 'react';
import { linkButton } from '../../../components/ui';
import { gy } from '../../../theme/tokens';

// E18-07 编辑中的恢复状态：离开前保存、别人刚保存过（冲突）；以及「帮我改写这段」的改写前后对照

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };

export function stamp(iso: string): string {
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

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function LeaveDialog({
  open,
  where,
  saving,
  onStay,
  onDiscard,
  onSave,
  afterClose,
}: {
  open: boolean;
  afterClose?: () => void;
  /** 如「应急预案「附件 · 应急通讯录」」 */
  where: string;
  saving: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      open={open}
      title="离开前保存修改？"
      focusTriggerAfterClose={false}
      afterClose={afterClose}
      onCancel={onStay}
      width={560}
      footer={[
        <Button key="stay" onClick={onStay}>
          继续编辑
        </Button>,
        <Button key="discard" danger onClick={onDiscard}>
          不保存并离开
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={onSave}>
          保存并离开
        </Button>,
      ]}
    >
      <p style={{ ...text14, color: gy.text, margin: '8px 0 16px' }}>{where}有未保存修订。不保存就离开，本次输入会丢弃；已保存稿不变。</p>
    </Modal>
  );
}

/** 两边逐行对照：对方没有的行标出来（整段比对，不做字级差异） */
function Lines({ lines, other, mark }: { lines: string[]; other: Set<string>; mark: string }) {
  return (
    <div style={{ ...text14, color: gy.text, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {lines.map((l, i) =>
        other.has(l) ? (
          <span key={i} style={{ whiteSpace: 'pre-wrap', padding: '0 4px' }}>
            {l || ' '}
          </span>
        ) : (
          <mark key={i} aria-label={mark} style={{ whiteSpace: 'pre-wrap', padding: '0 4px', background: gy.warningBg, color: gy.text, borderLeft: `2px solid ${gy.warning}` }}>
            {l || ' '}
          </mark>
        ),
      )}
    </div>
  );
}

export function ConflictDialog({
  open,
  mine,
  latest,
  onBack,
  onOpenLatest,
  onCopyMine,
}: {
  open: boolean;
  mine: EditBlock[];
  latest: SectionView | null;
  onBack: () => void;
  onOpenLatest: () => void;
  onCopyMine: () => void;
}) {
  const box: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 16,
    borderRadius: 6,
    border: `1px solid ${gy.split}`,
  };
  const mineLines = blocksText(mine).split('\n');
  const latestLines = latest ? blocksText(latest.blocks).split('\n') : [];
  return (
    <Modal
      open={open}
      title="当前稿件已被更新，请先对照变更"
      onCancel={onBack}
      width={960}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, ...text14, color: gy.secondary, textAlign: 'left' }}>保留你的输入。打开最新稿后逐项合并，不自动覆盖任何一方。</span>
          <Button onClick={onBack}>返回继续编辑</Button>
          <Button type="primary" onClick={onOpenLatest}>
            保留输入并打开最新稿
          </Button>
        </div>
      }
    >
      <p style={{ ...text14, color: gy.text, margin: '8px 0 16px' }}>
        你的修改尚未保存。其他人已保存了更新版本，直接保存会覆盖新内容；请对照后再提交修订。两边不同的段落已标出。
      </p>
      <div style={{ display: 'flex', gap: 24 }}>
        <section aria-label="你的未保存内容" style={box}>
          <span style={{ ...text14, color: gy.text }}>你的未保存内容</span>
          <Lines lines={mineLines} other={new Set(latestLines)} mark="与最新稿不同" />
          <button type="button" style={{ ...linkButton, ...text14, alignSelf: 'flex-start' }} onClick={onCopyMine}>
            复制我的内容
          </button>
        </section>
        <section aria-label="最新保存稿" style={box}>
          <span style={{ ...text14, color: gy.text }}>最新保存稿{latest?.saved ? `　·　${stamp(latest.saved.at)}` : ''}</span>
          <Lines lines={latestLines} other={new Set(mineLines)} mark="与你的内容不同" />
          {latest?.saved && (
            <span style={{ ...text14, color: gy.secondary }}>
              更新人：{latest.saved.byName}　·　修订说明：{latest.saved.note}
            </span>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** 「帮我改写这段」：先给专家看改写前后，点「采用」才换进正文 */
export function RewriteDialog({
  preview,
  onAdopt,
  onReject,
}: {
  preview: { before: string; after: string; note: string } | null;
  onAdopt: () => void;
  onReject: () => void;
}) {
  const box: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 6, border: `1px solid ${gy.split}` };
  return (
    <Modal
      open={preview !== null}
      title="改写这一段"
      onCancel={onReject}
      width={860}
      footer={[
        <Button key="reject" onClick={onReject}>
          不采用
        </Button>,
        <Button key="adopt" type="primary" onClick={onAdopt}>
          采用
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', gap: 24, margin: '8px 0 12px' }}>
        <section aria-label="改写前" style={box}>
          <span style={{ ...text14, color: gy.secondary }}>改写前</span>
          <p style={{ ...text14, color: gy.text, whiteSpace: 'pre-wrap', margin: 0 }}>{preview?.before}</p>
        </section>
        <section aria-label="改写后" style={{ ...box, borderColor: gy.primary }}>
          <span style={{ ...text14, color: gy.primary }}>改写后</span>
          <p style={{ ...text14, color: gy.text, whiteSpace: 'pre-wrap', margin: 0 }}>{preview?.after}</p>
        </section>
      </div>
      <span style={{ ...text14, color: gy.secondary }}>{preview?.note}。采用后仍可点「撤销」恢复原文。</span>
    </Modal>
  );
}
