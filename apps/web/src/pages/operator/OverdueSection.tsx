import { CONTACT_RESULTS, CONTACT_WORKING_DAYS, OPERATOR_NOTE_KINDS, OPERATOR_NOTE_MAX, type OperatorNote } from '@genyun/shared';
import { App, Button, Input, Modal } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useAddOperatorNote, useOperatorNotes, useRemindExpert, type OverdueTask } from '../../api/operator';
import { gy, stage } from '../../theme/tokens';
import { monthDay, monthDayTime } from './taskCenterText';

const body = { fontSize: 14, lineHeight: '22px', color: gy.text } as const;
const caption = { fontSize: 13, lineHeight: '20px', color: gy.secondary } as const;

// 列表第二行用：「客户申请电话联系后 2 个工作日未联系上」
export const OVERDUE_LINE = `客户申请电话联系后 ${CONTACT_WORKING_DAYS} 个工作日未联系上`;
// 右栏标题旁的标签：「超时 2 个工作日」，当天刚过期限写「今天超时」
export const overdueBadge = (t: Pick<OverdueTask, 'overdueDays'>) => (t.overdueDays > 0 ? `超时 ${t.overdueDays} 个工作日` : '今天超时');

type Choice = 'remind' | 'reassign' | 'call';

function Section({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px 0', ...style }}>
      <h3 style={{ ...caption, color: gy.tertiary, margin: 0, fontWeight: 400 }}>{title}</h3>
      {children}
    </section>
  );
}

function ChoiceCard({ on, title, text, onClick }: { on: boolean; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        padding: '12px 16px',
        borderRadius: 8,
        border: `1px solid ${on ? gy.primary : gy.split}`,
        background: on ? gy.selected : gy.surface,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ ...body, fontWeight: 500, color: on ? gy.primary : gy.text }}>{title}</span>
      <span style={caption}>{text}</span>
    </button>
  );
}

interface Entry {
  at: string;
  line: string;
  detail: string | null;
  system?: boolean;
}

// 任务联系记录（客户不可见）：客户请求、超时、注安师的联系、运营的处理，新的在前
function timeline(t: OverdueTask, notes: readonly OperatorNote[]): Entry[] {
  const entries: Entry[] = [
    { at: t.request.requestedAt, line: `客户 ${t.request.requestedBy} · 请注安师电话联系`, detail: t.request.labels.join('、') },
    {
      at: t.request.deadline,
      line: `系统 · 超过 ${CONTACT_WORKING_DAYS} 个工作日未联系上，转运营兜底`,
      detail: null,
      system: true,
    },
    ...t.contacts.map((c) => ({
      at: c.createdAt,
      line:
        c.method === 'phone'
          ? `注安师 ${c.createdByName} · 电话联系 · ${c.result ? CONTACT_RESULTS[c.result] : '没填结果'}`
          : `注安师 ${c.createdByName} · 请客户在任务里补充`,
      detail: null,
    })),
    ...notes.map((n) => ({ at: n.createdAt, line: `运营 ${n.createdByName} · ${OPERATOR_NOTE_KINDS[n.kind]}`, detail: n.body || null })),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

function Timeline({ entries }: { entries: Entry[] }) {
  return (
    <ol aria-label="任务联系记录" style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: 0, padding: 0, listStyle: 'none' }}>
      {entries.map((e, i) => (
        <li key={i} style={{ display: 'flex', gap: 12 }}>
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, flexShrink: 0, background: e.system ? stage.action.color : gy.border }}
          />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={body}>
              {monthDayTime(e.at)} · {e.line}
            </span>
            {e.detail && <span style={{ ...caption, color: gy.tertiary }}>{e.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
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
          void message.success('内部备注已记下，客户和注安师看不到');
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
        <span style={caption}>记在任务的运营记录里，只有运营能看到，客户和注安师都看不到。</span>
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

// 超时兜底的右栏（Paper 16 页 I04「超时兜底」）：为什么出现在这里、怎么处理（三选一）、任务联系记录，底栏写内部备注和主操作
export function OverdueSections({ task: t, onReassign }: { task: OverdueTask; onReassign: () => void }) {
  const { message } = App.useApp();
  const notes = useOperatorNotes(t.id);
  const remind = useRemindExpert(t.id);
  const called = useAddOperatorNote(t.id);
  const [choice, setChoice] = useState<Choice>('remind');
  const [noting, setNoting] = useState(false);
  const expert = t.assignedExpertName ?? '负责注安师';
  const failed = (e: Error) => void message.error(e.message);

  const run = () => {
    if (choice === 'reassign') return onReassign();
    if (choice === 'remind') {
      remind.mutate(undefined, { onSuccess: () => void message.success(`已提醒${expert}，记在联系记录里`), onError: failed });
      return;
    }
    called.mutate({ kind: 'called_customer' }, { onSuccess: () => void message.success('已记下：运营已致电客户安抚'), onError: failed });
  };
  const pending = choice === 'remind' ? remind.isPending : choice === 'call' ? called.isPending : false;
  const primary = choice === 'remind' ? `提醒${expert}` : choice === 'reassign' ? '改派其他注安师' : '记下已致电客户';
  // 原因：「还没有联系过客户」或「打过 N 次电话都没接通」
  const unreachable = t.contacts.some((c) => c.method === 'phone' && c.result === 'unreachable' && c.createdAt >= t.request.requestedAt);

  return (
    <>
      <Section title="为什么出现在这里">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 8, background: gy.warningBg }}>
          <span style={{ ...body, fontWeight: 500 }}>
            客户 {monthDay(t.request.requestedAt)} 点了「请专家电话联系」，{expert}
            {unreachable ? t.reason : '至今没有联系记录'}
          </span>
          <span style={caption}>
            涉及 {t.request.labels.length} 项：{t.request.labels.join('、')}。任务停在「专业整理」，客户已等待 {t.waitedDays} 个工作日。
          </span>
        </div>
      </Section>

      <Section title="怎么处理（三选一）" style={{ paddingTop: 24 }}>
        <div role="radiogroup" aria-label="怎么处理" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ChoiceCard
            on={choice === 'remind'}
            onClick={() => setChoice('remind')}
            title={`提醒${expert}`}
            text="站内提醒注安师今天处理；多数情况这样就够了。"
          />
          <ChoiceCard
            on={choice === 'reassign'}
            onClick={() => setChoice('reassign')}
            title="改派其他注安师"
            text="注安师请假或忙不过来时使用；已整理内容和联系记录全部带给新注安师，客户页面自动换成新负责人。"
          />
          <ChoiceCard
            on={choice === 'call'}
            onClick={() => setChoice('call')}
            title="我先打给客户安抚"
            text="只说明进度和预计联系时间，不代注安师问专业问题。打完点「记下已致电客户」。"
          />
        </div>
      </Section>

      <Section title="任务联系记录 · 客户不可见" style={{ padding: 24 }}>
        <Timeline entries={timeline(t, notes.data ?? [])} />
        {notes.isError && <span style={{ ...caption, color: gy.tertiary }}>运营记录暂时读不出来：{notes.error.message}</span>}
      </Section>

      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 24px', borderTop: `1px solid ${gy.split}`, marginTop: 'auto' }}>
        <Button onClick={() => setNoting(true)}>写内部备注</Button>
        {/* 换一种处理就换一个按钮：转圈只跟当前这种处理走 */}
        <Button key={choice} type="primary" loading={pending} onClick={run}>
          {primary}
        </Button>
      </footer>
      <NoteModal taskId={t.id} open={noting} onClose={() => setNoting(false)} />
    </>
  );
}

// 其他页签的任务详情里：运营记录（改派、提醒、备注），有记录才显示，客户、注安师看不到
export function OperatorNotes({ taskId }: { taskId: string }) {
  const notes = useOperatorNotes(taskId);
  if (!notes.data || notes.data.length === 0) return null;
  return (
    <Section title="运营记录 · 客户、注安师不可见">
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
