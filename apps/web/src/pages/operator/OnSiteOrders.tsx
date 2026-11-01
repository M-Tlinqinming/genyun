import { CALL_TIMES, ON_SITE_NOTE_MAX, ON_SITE_STATUS_LABELS, maskPhone, type OnSiteStatus, type OnSiteUpdateInput } from '@genyun/shared';
import { App, Button, Input } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useUpdateOnSiteOrder, type OnSiteOrder } from '../../api/operator';
import { panel } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';
import { monthDay, monthDayTime } from './taskCenterText';

const body = { fontSize: 14, lineHeight: '22px', color: gy.text } as const;
const caption = { fontSize: 13, lineHeight: '20px', color: gy.secondary } as const;

// 新工单要运营处理（橙）；已转交、已关闭只是记录（灰）
const STATUS_TONE: Record<OnSiteStatus, { color: string; bg: string }> = {
  new: stage.action,
  handed_over: stage.progress,
  closed: stage.progress,
};

// 「新工单」「已转交公司 · 10.24」「已关闭 · 10.25」
export function onSiteStatusText(o: Pick<OnSiteOrder, 'status' | 'handedOverAt' | 'closedAt'>): string {
  const at = o.status === 'handed_over' ? o.handedOverAt : o.status === 'closed' ? o.closedAt : null;
  return at ? `${ON_SITE_STATUS_LABELS[o.status]} · ${monthDay(at)}` : ON_SITE_STATUS_LABELS[o.status];
}

function StatusPill({ order }: { order: OnSiteOrder }) {
  const tone = STATUS_TONE[order.status];
  return (
    <span style={{ fontSize: 12, lineHeight: '22px', color: tone.color, background: tone.bg, borderRadius: 4, padding: '0 8px', whiteSpace: 'nowrap' }}>
      {onSiteStatusText(order)}
    </span>
  );
}

// 列表第二行：「需要帮忙 9 项 · 林晓 136 **** 3340」
function rowLine(o: OnSiteOrder): string {
  return [o.helpItems.length > 0 ? `需要帮忙 ${o.helpItems.length} 项` : null, `${o.contactName} ${maskPhone(o.contactPhone)}`]
    .filter(Boolean)
    .join(' · ');
}

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
          gap: 6,
          width: '100%',
          padding: selected ? '16px 20px 16px 17px' : '16px 20px',
          border: 'none',
          borderBottom: `1px solid ${gy.split}`,
          borderLeft: selected ? `3px solid ${gy.primary}` : 'none',
          background: selected ? gy.selected : 'transparent',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
          <span style={{ ...body, flex: 1, minWidth: 0, fontWeight: selected ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {o.enterpriseName}
          </span>
          <span style={{ fontSize: 12, lineHeight: '18px', color: gy.tertiary, flexShrink: 0 }}>{monthDayTime(o.createdAt)}</span>
        </span>
        <span style={caption}>{rowLine(o)}</span>
        <span style={{ display: 'flex' }}>
          <StatusPill order={o} />
        </span>
      </button>
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <dt style={{ ...body, color: gy.secondary, width: 108, flexShrink: 0 }}>{label}</dt>
      <dd style={{ ...body, margin: 0, flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>{children}</dd>
    </div>
  );
}

// 右栏：上门工单详情（Paper 16 页 I04「上门工单」）。报价、排期、现场交接都在线下，这里只记内部备注、标记转交和关闭。
// 内部备注随按钮一起保存；只改备注时底栏多一个「保存备注」
export function OnSitePanel({ order: o }: { order: OnSiteOrder }) {
  const { message } = App.useApp();
  const update = useUpdateOnSiteOrder(o.id);
  const [note, setNote] = useState(o.internalNote ?? '');
  const noteChanged = note.trim() !== (o.internalNote ?? '');
  const save = (status: OnSiteStatus | undefined, done: string) => {
    const input: OnSiteUpdateInput = { ...(status && { status }), ...(noteChanged && { internalNote: note.trim() }) };
    update.mutate(input, { onSuccess: () => void message.success(done), onError: (e) => void message.error(e.message) });
  };
  const copy = () =>
    navigator.clipboard
      .writeText(o.contactPhone)
      .then(() => void message.success('号码已复制'))
      .catch(() => void message.error(`没复制成功，号码是 ${o.contactPhone}`));

  return (
    <section aria-label="上门工单详情" style={{ ...panel, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 24px', borderBottom: `1px solid ${gy.split}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600, color: gy.text, margin: 0 }}>上门工单 · {o.enterpriseName}</h2>
          <span style={caption}>
            {monthDayTime(o.createdAt)} 提交 · 客户组织：
            <Link to={`/operator/organizations/${o.orgId}`} style={{ color: gy.secondary, textDecoration: 'underline' }}>
              {o.orgName}
            </Link>
            {o.taskId && (
              <>
                {' · 关联任务 '}
                <Link to={`/operator/tasks?task=${o.taskId}`} style={{ color: gy.secondary, textDecoration: 'underline' }}>
                  {o.taskName ?? o.taskNumber}
                </Link>
              </>
            )}
          </span>
        </div>
        <StatusPill order={o} />
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px' }}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ ...caption, margin: 0, fontWeight: 400 }}>客户填写</h3>
          <dl style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0 }}>
            <Field label="联系人">{o.contactName}</Field>
            <Field label="联系电话">
              <span>{maskPhone(o.contactPhone)}</span>
              <Button type="link" size="small" onClick={() => void copy()} style={{ padding: 0, height: 20, fontSize: 13 }}>
                复制号码
              </Button>
            </Field>
            <Field label="方便联系">{o.callTime ? CALL_TIMES[o.callTime] : '没选'}</Field>
            <Field label="需要帮忙">{o.helpItems.length ? o.helpItems.join('、') : '没写'}</Field>
            <Field label="客户备注">{o.note ?? '—'}</Field>
          </dl>
        </section>
        <div aria-hidden style={{ height: 1, background: gy.split }} />
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ ...caption, margin: 0, fontWeight: 400 }}>内部备注 · 客户不可见</h3>
          <Input.TextArea
            aria-label="上门工单内部备注"
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={ON_SITE_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="如：已转给某同事 / 公司联系结果"
          />
        </section>
        <p style={{ ...caption, margin: 0, padding: '12px 14px', borderRadius: 6, background: gy.canvas }}>
          报价、排期、现场交接都在线下进行，系统不记录。客户在任务页看到「已收到上门需求，耕云会电话联系您」。
        </p>
      </div>

      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${gy.split}`, marginTop: 'auto' }}>
        {noteChanged && (
          <Button style={{ height: 36 }} loading={update.isPending} onClick={() => save(undefined, '内部备注已保存')}>
            保存备注
          </Button>
        )}
        {o.status === 'closed' ? (
          <Button style={{ height: 36 }} loading={update.isPending} onClick={() => save('new', '工单已重新打开')}>
            重新打开
          </Button>
        ) : (
          <>
            <Button style={{ height: 36 }} loading={update.isPending} onClick={() => save('closed', '工单已关闭')}>
              关闭工单
            </Button>
            {o.status === 'new' && (
              <Button style={{ height: 36 }} type="primary" loading={update.isPending} onClick={() => save('handed_over', '已标记为转交公司')}>
                标记已转交公司
              </Button>
            )}
          </>
        )}
      </footer>
    </section>
  );
}
