import { blocksText, type EditBlock, type SectionView } from '@genyun/shared';
import { Button, Modal } from 'antd';
import type { CSSProperties } from 'react';
import { linkButton } from '../../../components/ui';
import { gy } from '../../../theme/tokens';

// E18-07 编辑中的恢复状态：离开前保存、保存失败、别人刚保存过（冲突）

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
}: {
  open: boolean;
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
      <p style={{ ...text14, color: gy.text, margin: '8px 0 16px' }}>{where}有未保存修订。离开后，本次输入将被丢弃，已保存稿不会改变。</p>
    </Modal>
  );
}

export function SaveFailed({ checking, onCopy, onRetry }: { checking: boolean; onCopy: () => void; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '16px 20px',
        borderRadius: 6,
        border: `1px solid ${gy.error}`,
        background: gy.surface,
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.error }}>修订未保存成功</span>
        <span style={{ ...text14, color: gy.text }}>连接中断。当前输入仍保留在编辑区，已保存稿没有改变。请保持此页打开并重试。</span>
      </div>
      <Button onClick={onCopy}>复制本节内容</Button>
      <Button type="primary" loading={checking} onClick={onRetry}>
        重试保存
      </Button>
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
  const body: CSSProperties = { ...text14, color: gy.text, whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto', margin: 0 };
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
      <p style={{ ...text14, color: gy.text, margin: '8px 0 16px' }}>你的修改尚未保存。其他人已保存了更新版本，直接保存会覆盖新内容；请对照后再提交修订。</p>
      <div style={{ display: 'flex', gap: 24 }}>
        <section aria-label="你的未保存内容" style={box}>
          <span style={{ ...text14, color: gy.text }}>你的未保存内容</span>
          <p style={body}>{blocksText(mine)}</p>
          <button type="button" style={{ ...linkButton, ...text14 }} onClick={onCopyMine}>
            复制我的内容
          </button>
        </section>
        <section aria-label="最新保存稿" style={box}>
          <span style={{ ...text14, color: gy.text }}>最新保存稿{latest?.saved ? `　·　${stamp(latest.saved.at)}` : ''}</span>
          <p style={body}>{latest ? blocksText(latest.blocks) : ''}</p>
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
