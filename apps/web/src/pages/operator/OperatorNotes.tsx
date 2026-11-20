import { OPERATOR_NOTE_KINDS, OPERATOR_NOTE_MAX } from '@genyun/shared';
import { App, Button, Input, Modal } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useAddOperatorNote, useOperatorNotes } from '../../api/operator';
import { gy } from '../../theme/tokens';
import { monthDayTime } from './taskCenterText';

const caption = { fontSize: 13, lineHeight: '20px', color: gy.secondary } as const;

function Section({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px 0', ...style }}>
      <h3 style={{ ...caption, color: gy.tertiary, margin: 0, fontWeight: 400 }}>{title}</h3>
      {children}
    </section>
  );
}

// 写内部备注：只有运营看得到，记在任务的运营记录里
export function NoteModal({ taskId, open, onClose }: { taskId: string; open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const add = useAddOperatorNote(taskId);
  const [note, setNote] = useState('');
  const save = () =>
    add.mutate(
      { kind: 'note', body: note.trim() },
      {
        onSuccess: () => {
          setNote('');
          void message.success('内部备注已记下，客户和专家看不到');
          onClose();
        },
      },
    );
  return (
    <Modal
      open={open}
      title="写内部备注"
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="ok" type="primary" disabled={!note.trim()} loading={add.isPending} onClick={save}>
          保存备注
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={caption}>记在任务的运营记录里，只有运营能看到，客户和专家都看不到。</span>
        <Input.TextArea
          aria-label="内部备注"
          autoSize={{ minRows: 3, maxRows: 6 }}
          maxLength={OPERATOR_NOTE_MAX}
          showCount
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如：周工本周在外地，已约客户周三上午回电"
        />
        {add.isError && <span style={{ ...caption, color: gy.error }}>{add.error.message}</span>}
      </div>
    </Modal>
  );
}

// 任务详情里：运营记录（改派、提醒、备注），有记录才显示，客户、专家看不到
export function OperatorNotes({ taskId }: { taskId: string }) {
  const notes = useOperatorNotes(taskId);
  if (!notes.data || notes.data.length === 0) return null;
  return (
    <Section title="运营记录 · 客户、专家不可见">
      <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {notes.data.map((n) => (
          <li key={n.id} style={{ listStyle: 'none', ...caption }}>
            {monthDayTime(n.createdAt)} · {n.createdByName} · {OPERATOR_NOTE_KINDS[n.kind]}
            {n.body ? `：${n.body}` : ''}
          </li>
        ))}
      </ul>
    </Section>
  );
}
