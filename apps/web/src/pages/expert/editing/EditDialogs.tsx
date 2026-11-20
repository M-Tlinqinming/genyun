import { blocksText, type EditBlock, type SectionView } from '@genyun/shared';
import { ExclamationCircleFilled } from '@ant-design/icons';
import { Button, Modal } from 'antd';
import type { CSSProperties } from 'react';
import { linkButton } from '../../../components/ui';
import { gy } from '../../../theme/tokens';

// 核对定稿页的弹窗：离开前保存（E18-07）、别人刚保存过（冲突）、「帮我改写这段」的改写前后对照；以及时间的写法

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

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);

/** 按天说：今天、昨天、11 月 16 日 */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const k = dayKey(d);
  if (k === dayKey(now)) return '今天';
  if (k === dayKey(new Date(now.getTime() - DAY))) return '昨天';
  const [, m, day] = k.split('-');
  return `${Number(m)} 月 ${Number(day)} 日`;
}

/** 几点几分（北京时间） */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** 「今天 16:20」「昨天 16:50」「11 月 16 日 09:30」 */
export const when = (iso: string) => `${dayLabel(iso)} ${clock(iso)}`;

/** 节标题前的编号当简称：「2.3 应急小组及职责」→「2.3 节」；没有编号的用书名号括起来 */
export function sectionShort(title: string): string {
  const m = /^(\d+(?:\.\d+)+|\d+)[.、]?\s/.exec(title);
  return m ? `${m[1]} 节` : `「${title}」`;
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
  section,
  target,
  saving,
  keptOnly = false,
  onStay,
  onDiscard,
  onSave,
  afterClose,
}: {
  open: boolean;
  afterClose?: () => void;
  /** 正在改的节的简称，如「2.3 节」 */
  section: string;
  /** 要去哪里，如「3 风险描述」「Word 预览」 */
  target: string;
  saving: boolean;
  /** 编辑区没有改动、只有冲突前的输入没合并：没有可保存的，只能继续合并或放弃 */
  keptOnly?: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const title = keptOnly ? `${section}还有内容没合并` : `${section}改的内容还没保存`;
  const body = keptOnly
    ? `您要去「${target}」。编辑框下面还留着您冲突前写的内容，离开后就找不回来了。`
    : `您要去「${target}」。不保存的话，刚才在 ${section}写的内容会丢掉。`;
  return (
    <Modal
      open={open}
      title={null}
      closable={false}
      focusTriggerAfterClose={false}
      afterClose={afterClose}
      onCancel={onStay}
      width={520}
      footer={null}
    >
      <div role="alertdialog" aria-label={title} style={{ display: 'flex', gap: 12 }}>
        <ExclamationCircleFilled aria-hidden style={{ color: gy.warning, fontSize: 20, marginTop: 2 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>{title}</span>
          <span style={{ ...text14, color: gy.secondary }}>{body}</span>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={onStay}>{keptOnly ? '继续合并' : `留在 ${section}`}</Button>
            <Button danger onClick={onDiscard}>
              {keptOnly ? '放弃并离开' : '不保存，直接离开'}
            </Button>
            {!keptOnly && (
              <Button type="primary" loading={saving} onClick={onSave}>
                保存并离开
              </Button>
            )}
          </div>
        </div>
      </div>
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
      title="这一节刚被别人保存过，请先对照"
      onCancel={onBack}
      width={960}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, ...text14, color: gy.secondary, textAlign: 'left' }}>您的输入会留着。打开最新的内容后逐项合并，不会自动覆盖任何一方。</span>
          <Button onClick={onBack}>返回继续编辑</Button>
          <Button type="primary" onClick={onOpenLatest}>
            留着我的输入，打开最新的
          </Button>
        </div>
      }
    >
      <p style={{ ...text14, color: gy.text, margin: '8px 0 16px' }}>
        您的修改还没保存。别人刚保存了这一节，直接保存会盖掉对方的内容；请对照后再保存。两边不同的段落已标出。
      </p>
      <div style={{ display: 'flex', gap: 24 }}>
        <section aria-label="您没保存的内容" style={box}>
          <span style={{ ...text14, color: gy.text }}>您没保存的内容</span>
          <Lines lines={mineLines} other={new Set(latestLines)} mark="和最新的不同" />
          <button type="button" style={{ ...linkButton, ...text14, alignSelf: 'flex-start' }} onClick={onCopyMine}>
            复制我的内容
          </button>
        </section>
        <section aria-label="最新保存的内容" style={box}>
          <span style={{ ...text14, color: gy.text }}>最新保存的内容{latest?.saved ? `　·　${stamp(latest.saved.at)}` : ''}</span>
          <Lines lines={latestLines} other={new Set(mineLines)} mark="和您的内容不同" />
          {latest?.saved && (
            <span style={{ ...text14, color: gy.secondary }}>
              保存人：{latest.saved.byName}
              {latest.saved.note.trim() ? `　·　修改说明：${latest.saved.note}` : ''}
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
      <span style={{ ...text14, color: gy.secondary }}>{preview?.note}。采用后还可以点「撤销」恢复原文。</span>
    </Modal>
  );
}
