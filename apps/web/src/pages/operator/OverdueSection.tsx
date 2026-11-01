import { CONTACT_RESULTS, OPERATOR_NOTE_KINDS, OPERATOR_NOTE_MAX } from '@genyun/shared';
import { App, Button, Input } from 'antd';
import { useState } from 'react';
import { useAddOperatorNote, useOperatorNotes, useRemindExpert, type OverdueTask } from '../../api/operator';
import { gy } from '../../theme/tokens';
import { monthDayTime } from './taskCenterText';

const body = { fontSize: 14, lineHeight: '22px', color: gy.text } as const;
const caption = { fontSize: 13, lineHeight: '20px', color: gy.tertiary } as const;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px 0' }}>
      <h3 style={{ ...caption, margin: 0, fontWeight: 400 }}>{title}</h3>
      {children}
    </section>
  );
}

// 超时兜底（16 页 I04）：为什么超时、注安师的联系记录、提醒注安师。改派用任务面板底部的「改派注安师」
export function OverdueReason({ task: t }: { task: OverdueTask }) {
  const { message } = App.useApp();
  const remind = useRemindExpert(t.id);
  const [said, setSaid] = useState('');
  const phones = t.contacts.filter((c) => c.method === 'phone');
  return (
    <>
      <Block title="为什么出现在这里">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 8, background: gy.warningBg }}>
          <span style={{ ...body, fontWeight: 500 }}>
            客户 {monthDayTime(t.request.requestedAt)} 请电话联系，{monthDayTime(t.request.deadline)} 前没有联系上
          </span>
          <span style={{ ...caption, color: gy.secondary }}>
            {t.reason}。要问的：{t.request.labels.join('、')}。
          </span>
        </div>
      </Block>
      <Block title={`联系记录 ${phones.length} 条`}>
        {phones.length === 0 ? (
          <span style={{ ...caption, color: gy.secondary }}>负责注安师还没有打过电话。</span>
        ) : (
          <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {phones.map((c) => (
              <li key={c.createdAt} style={{ listStyle: 'none', ...caption, color: gy.secondary }}>
                {monthDayTime(c.createdAt)} · {c.createdByName}打电话 · {c.result ? CONTACT_RESULTS[c.result] : '没填结果'}
              </li>
            ))}
          </ul>
        )}
        {t.assignedExpertName && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              aria-label="给注安师的话（选填）"
              placeholder="给注安师的话（选填），会写在提醒第一句"
              maxLength={200}
              value={said}
              onChange={(e) => setSaid(e.target.value)}
            />
            <Button
              loading={remind.isPending}
              onClick={() =>
                remind.mutate(said.trim() || undefined, {
                  onSuccess: () => {
                    setSaid('');
                    void message.success(`已提醒${t.assignedExpertName}`);
                  },
                  onError: (e) => void message.error(e.message),
                })
              }
            >
              提醒注安师
            </Button>
          </div>
        )}
      </Block>
    </>
  );
}

// 运营在任务上的记录：内部备注、提醒注安师、改派。客户、注安师都看不到
export function OperatorNotes({ taskId }: { taskId: string }) {
  const { message } = App.useApp();
  const notes = useOperatorNotes(taskId);
  const add = useAddOperatorNote(taskId);
  const [draft, setDraft] = useState('');
  return (
    <Block title="运营记录（客户、注安师看不到）">
      {notes.data && notes.data.length > 0 && (
        <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notes.data.map((n) => (
            <li key={n.id} style={{ listStyle: 'none', ...caption, color: gy.secondary }}>
              {monthDayTime(n.createdAt)} · {n.createdByName} · {OPERATOR_NOTE_KINDS[n.kind]}
              {n.body ? `：${n.body}` : ''}
            </li>
          ))}
        </ul>
      )}
      {notes.isError && <span style={{ ...caption, color: gy.secondary }}>运营记录暂时读不出来：{notes.error.message}</span>}
      <Input.TextArea
        aria-label="内部备注"
        placeholder="写内部备注，只有运营看得到"
        autoSize={{ minRows: 2, maxRows: 4 }}
        maxLength={OPERATOR_NOTE_MAX}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div>
        <Button
          disabled={!draft.trim()}
          loading={add.isPending}
          onClick={() =>
            add.mutate(draft.trim(), {
              onSuccess: () => setDraft(''),
              onError: (e) => void message.error(e.message),
            })
          }
        >
          保存备注
        </Button>
      </div>
    </Block>
  );
}
