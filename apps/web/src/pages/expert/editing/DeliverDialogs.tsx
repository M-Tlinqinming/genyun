import { ExclamationCircleFilled } from '@ant-design/icons';
import { chinaToday, UPDATE_NOTE_MAX } from '@genyun/shared';
import { Button, Input, Modal } from 'antd';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { gy, type, weight } from '../../../theme/tokens';

// 15 页的三个确认弹窗：首次交付（R10）、再次交付（R14，多一个「这次更新了什么」）、重新打开（R12）。
// 三个共用一个外壳：宽 520、内边距 24、圆角 8、内部间距 16；左上警示图标，按钮靠右

const body: CSSProperties = { ...type.body, color: gy.secondary, margin: 0 };

/** 例：11 月 20 日（北京时间） */
export function monthDay(iso: string): string {
  const [, m, d] = chinaToday(new Date(iso)).split('-').map(Number);
  return `${m} 月 ${d} 日`;
}

function ConfirmShell({
  open,
  title,
  gap = 8,
  children,
  cancelText,
  okText,
  loading,
  onCancel,
  onOk,
}: {
  open: boolean;
  title: string;
  /** 标题和正文之间的间距（重新打开那个是 12） */
  gap?: number;
  children: ReactNode;
  cancelText: string;
  okText: string;
  loading: boolean;
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <Modal
      open={open}
      width={520}
      title={null}
      footer={null}
      closable={false}
      centered
      destroyOnHidden
      maskClosable={!loading}
      keyboard={!loading}
      onCancel={loading ? undefined : onCancel}
      styles={{ container: { padding: 24, borderRadius: 8, boxShadow: '#18243B2E 0 6px 24px' } }}
    >
      <div role="alertdialog" aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <ExclamationCircleFilled aria-hidden style={{ fontSize: 22, color: gy.warning, marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>
            <span style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{title}</span>
            {children}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
          <Button disabled={loading} onClick={onCancel}>
            {cancelText}
          </Button>
          <Button type="primary" loading={loading} onClick={onOk}>
            {okText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** 交付确认：reopened 给了上一次交付的时间就是再次交付（R14），否则首次（R10） */
export function DeliverConfirm({
  open,
  again,
  suggestedNote,
  loading,
  onCancel,
  onOk,
}: {
  open: boolean;
  /** 再次交付：上一次交付的时间 */
  again: { deliveredAt: string } | null;
  /** 系统先填好的「这次更新了什么」 */
  suggestedNote: string;
  loading: boolean;
  onCancel: () => void;
  /** 再次交付时带上「这次更新了什么」（去掉首尾空格） */
  onOk: (updateNote?: string) => void;
}) {
  const [note, setNote] = useState(suggestedNote);
  // 每次打开都从系统先填好的那句开始
  useEffect(() => {
    if (open) setNote(suggestedNote);
  }, [open, suggestedNote]);

  if (!again) {
    return (
      <ConfirmShell open={open} title="确认定稿并交付？" cancelText="再看看" okText="确认交付" loading={loading} onCancel={onCancel} onOk={() => onOk()}>
        <p style={body}>交付后，客户会收到一条站内提醒和一封邮件，登录就能下载三份 Word：应急预案、风险评估报告、应急资源调查报告。</p>
        <p style={body}>交付后任务变为只读。之后要改，可以在任务里「重新打开」。</p>
      </ConfirmShell>
    );
  }
  return (
    <ConfirmShell open={open} title="确认再次交付？" cancelText="再看看" okText="确认交付" loading={loading} onCancel={onCancel} onOk={() => onOk(note.trim())}>
      <p style={body}>
        交付后，客户会收到一条站内提醒和一封邮件，下载到的三份 Word 换成这一版。{monthDay(again.deliveredAt)}交付的那一版不再提供下载。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
        <label htmlFor="update-note" style={{ ...type.body, color: gy.text }}>
          这次更新了什么<span style={{ color: gy.tertiary }}>（选填）</span>
        </label>
        <Input id="update-note" value={note} maxLength={UPDATE_NOTE_MAX} disabled={loading} onChange={(e) => setNote(e.target.value)} />
        <span style={{ ...type.caption, color: gy.tertiary }}>
          系统按您改过的地方先填好了。会显示在客户的任务里和邮件里，例如「11 月 27 日更新：值班电话、通讯联络组组员」。
        </span>
      </div>
    </ConfirmShell>
  );
}

/** 重新打开确认（R12） */
export function ReopenConfirm({ open, loading, onCancel, onOk }: { open: boolean; loading: boolean; onCancel: () => void; onOk: () => void }) {
  return (
    <ConfirmShell open={open} title="重新打开这个任务？" gap={12} cancelText="取消" okText="重新打开" loading={loading} onCancel={onCancel} onOk={onOk}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={body}>· 打开后，您可以回资料核对改资料、重新生成，也可以直接改正文。</p>
        <p style={body}>· 改完要重新核对，再定稿并交付。</p>
        <p style={body}>· 在您再次交付之前，客户仍能下载现在这一版。</p>
        <p style={body}>· 再次交付后，客户看到的换成新的一版。</p>
      </div>
    </ConfirmShell>
  );
}
