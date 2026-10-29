import { CONTACT_METHODS, CONTACT_RESULTS, maskPhone, type ContactRecord } from '@genyun/shared';
import { Drawer, Empty } from 'antd';
import { useContacts } from '../../../api/contacts';
import { Loading } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';

// 北京时间 MM.DD HH:mm
function dateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

// 「处理记录」：这个任务所有的联系记录，新的在上；客户看不到
export function ContactRecords({ taskId, open, onClose }: { taskId: string; open: boolean; onClose: () => void }) {
  const contacts = useContacts(taskId);
  const records = [...(contacts.data ?? [])].reverse();
  return (
    <Drawer title="处理记录 · 联系客户" open={open} onClose={onClose} size={480}>
      {contacts.isPending ? (
        <Loading rows={4} />
      ) : records.length === 0 ? (
        <Empty description="还没有联系过客户" />
      ) : (
        <ol aria-label="联系记录" style={{ display: 'flex', flexDirection: 'column', gap: 16, margin: 0, padding: 0, listStyle: 'none' }}>
          {records.map((r) => (
            <RecordItem key={r.id} record={r} />
          ))}
        </ol>
      )}
    </Drawer>
  );
}

function RecordItem({ record: r }: { record: ContactRecord }) {
  const status =
    r.method === 'phone'
      ? { text: CONTACT_RESULTS[r.result!], tone: r.result === 'clarified' ? stage.done : stage.action }
      : r.answeredAt
        ? { text: `${r.answeredByName ?? '客户'} ${dateTime(r.answeredAt)} 回答`, tone: stage.done }
        : { text: '等客户回答', tone: stage.action };
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 8, border: `1px solid ${gy.split}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
        <span>{dateTime(r.createdAt)}</span>
        <span>
          {r.createdByName} · {CONTACT_METHODS[r.method]}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ padding: '0 8px', borderRadius: 4, color: status.tone.color, background: status.tone.bg }}>{status.text}</span>
      </div>
      {r.target && (
        <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
          拨打 {r.target.name}（{r.target.role}）{maskPhone(r.target.phone)}
        </span>
      )}
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
        {r.questions.map((q) => (
          <li key={q.id} style={{ display: 'flex', flexDirection: 'column', fontSize: 14, lineHeight: '22px' }}>
            <span style={{ color: gy.text }}>
              {q.label}：<span style={{ color: gy.secondary }}>{q.question}</span>
            </span>
            {(q.answer || q.fileIds?.length) && (
              <span style={{ color: gy.text }}>
                答：{q.answer}
                {q.fileIds?.length ? `${q.answer ? ' · ' : ''}附 ${q.fileIds.length} 个文件（见原件对照）` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}
