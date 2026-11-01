import { CALL_TIMES, type OnSiteStatus } from '@genyun/shared';
import { App, Button, Input } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';
import { useUpdateOnSiteOrder, type OnSiteOrder } from '../../api/operator';
import { panel } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';
import { monthDayTime } from './taskCenterText';

const body = { fontSize: 14, lineHeight: '22px', color: gy.text } as const;
const small = { fontSize: 12, lineHeight: '20px', color: gy.tertiary } as const;
const caption = { fontSize: 13, lineHeight: '20px', color: gy.tertiary } as const;

export const ON_SITE_STATUS_LABEL: Record<OnSiteStatus, string> = { new: '新工单', handed_over: '已转交公司', closed: '已关闭' };
const STATUS_TONE: Record<OnSiteStatus, { color: string; bg: string }> = {
  new: stage.error,
  handed_over: stage.action,
  closed: stage.done,
};

export function OnSiteRow({ order: o, selected, onSelect }: { order: OnSiteOrder; selected: boolean; onSelect: () => void }) {
  return (
    <li style={{ listStyle: 'none' }}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          width: '100%',
          padding: selected ? '16px 20px 16px 17px' : '16px 20px',
          border: 'none',
          borderBottom: '1px solid #EEF0F3',
          borderLeft: selected ? `3px solid ${gy.primary}` : 'none',
          background: selected ? gy.selected : 'transparent',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <span style={{ ...body, fontWeight: selected ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {o.enterpriseName}
          </span>
          <span style={{ ...small, flexShrink: 0 }}>{monthDayTime(o.createdAt)}</span>
        </span>
        <span style={{ ...caption, color: gy.secondary }}>
          上门需求 · {o.contactName} {o.contactPhone}
        </span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...small, color: STATUS_TONE[o.status].color, background: STATUS_TONE[o.status].bg, borderRadius: 4, padding: '0 8px' }}>
            {ON_SITE_STATUS_LABEL[o.status]}
          </span>
          <span style={{ ...small, color: stage.progress.color, background: stage.progress.bg, borderRadius: 4, padding: '0 8px' }}>{o.orgName}</span>
        </span>
      </button>
    </li>
  );
}

// 右栏：上门工单详情。报价、排期、现场交接都在线下，这里只记内部备注、标记转交和关闭
export function OnSitePanel({ order: o }: { order: OnSiteOrder }) {
  const { message } = App.useApp();
  const update = useUpdateOnSiteOrder(o.id);
  const [note, setNote] = useState(o.internalNote ?? '');
  const save = (input: { status?: OnSiteStatus; internalNote?: string }, done: string) =>
    update.mutate(input, { onSuccess: () => void message.success(done), onError: (e) => void message.error(e.message) });
  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt>{label}</dt>
      <dd style={{ margin: 0, color: gy.text }}>{value}</dd>
    </>
  );
  return (
    <section aria-label="上门工单详情" style={{ ...panel, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '20px 24px', borderBottom: `1px solid ${gy.split}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.text, margin: 0 }}>{o.enterpriseName} · 上门需求</h2>
          <span style={small}>
            {monthDayTime(o.createdAt)} 提交 · 客户组织：
            <Link to={`/operator/organizations/${o.orgId}`} style={{ color: gy.tertiary, textDecoration: 'underline' }}>
              {o.orgName}
            </Link>
            {o.taskId && (
              <>
                {' · 任务 '}
                <Link to={`/operator/tasks?task=${o.taskId}`} style={{ color: gy.tertiary, textDecoration: 'underline' }}>
                  {o.taskNumber}
                </Link>
              </>
            )}
          </span>
        </div>
        <span style={{ ...small, color: STATUS_TONE[o.status].color, background: STATUS_TONE[o.status].bg, borderRadius: 4, padding: '0 8px', alignSelf: 'flex-start' }}>
          {ON_SITE_STATUS_LABEL[o.status]}
        </span>
      </header>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px 0' }}>
        <h3 style={{ ...caption, margin: 0, fontWeight: 400 }}>客户留的信息</h3>
        <dl style={{ display: 'grid', gridTemplateColumns: '96px 1fr', rowGap: 8, margin: 0, ...caption, color: gy.secondary }}>
          {row('联系人', `${o.contactName} ${o.contactPhone}`)}
          {row('方便接电话', o.callTime ? CALL_TIMES[o.callTime] : '没选')}
          {row('需要帮忙', o.helpItems.length ? o.helpItems.join('、') : '没写')}
          {row('备注', o.note ?? '—')}
        </dl>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px 24px' }}>
        <h3 style={{ ...caption, margin: 0, fontWeight: 400 }}>内部备注（客户看不到）</h3>
        <Input.TextArea
          aria-label="上门工单内部备注"
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="如：已约周三上门、转交给某某公司"
        />
        <div>
          <Button disabled={note.trim() === (o.internalNote ?? '')} loading={update.isPending} onClick={() => save({ internalNote: note.trim() }, '内部备注已保存')}>
            保存备注
          </Button>
        </div>
      </section>
      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 24px', borderTop: `1px solid ${gy.split}`, marginTop: 'auto' }}>
        {o.status === 'new' && (
          <Button onClick={() => save({ status: 'handed_over' }, '已标记为转交公司')} loading={update.isPending}>
            标记已转交公司
          </Button>
        )}
        {o.status !== 'closed' ? (
          <Button type="primary" onClick={() => save({ status: 'closed' }, '工单已关闭')} loading={update.isPending}>
            关闭工单
          </Button>
        ) : (
          <Button onClick={() => save({ status: 'new' }, '工单已重新打开')} loading={update.isPending}>
            重新打开
          </Button>
        )}
      </footer>
    </section>
  );
}
