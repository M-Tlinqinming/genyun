import { OPERATOR_NOTE_KINDS, OPERATOR_NOTE_MAX, maskPhone, waitingLine } from '@genyun/shared';
import { App, Button, Drawer, Input, Skeleton } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  useAddOperatorNote,
  useOperatorNotes,
  useOperatorTask,
  type OperatorTask,
  type OperatorTaskDetail,
} from '../../api/operator';
import { StatusTag } from '../../components/StatusTag';
import { Notice, linkButton } from '../../components/ui';
import { gy, type, weight } from '../../theme/tokens';
import { copyText } from '../expert/editing/EditDialogs';
import { MissingList } from './MissingList';
import { dayTime, monthDayTime } from './taskCenterText';

const body = { ...type.body, color: gy.text } as const;
const box = { border: `1px solid ${gy.split}`, borderRadius: 8, padding: '12px 16px' } as const;

function Block({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

const grayTag = (text: string) => (
  <span style={{ ...type.caption, color: gy.secondary, background: gy.neutralBg, borderRadius: 4, padding: '0 8px', height: 20 }}>
    {text}
  </span>
);

// 等了多久：警示底，左边「已等 N 天」，右边什么时候开始等
function WaitBlock({ t }: { t: OperatorTaskDetail }) {
  const since = t.waitingSince;
  if (!since) return null;
  const right =
    t.group === 'to_assign'
      ? `${monthDayTime(t.submittedAt ?? since)} 提交，客户没选专家`
      : `${monthDayTime(t.awaitingCustomerSince ?? since)} 列出缺项`;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 16px',
        borderRadius: 8,
        background: gy.warningBg,
      }}
    >
      <span style={{ ...type.body, fontWeight: weight.strong, color: gy.warning }}>{waitingLine(since)}</span>
      <span style={{ ...type.body, color: gy.secondary }}>{right}</span>
    </div>
  );
}

function Progress({ t }: { t: OperatorTaskDetail }) {
  return (
    <Block title="进度">
      <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <StatusTag tone={t.view.tone} note={t.view.detail ?? undefined}>
          {t.view.label}
        </StatusTag>
        <span style={{ ...type.caption, color: gy.tertiary }}>最近更新 {dayTime(t.activityAt)}</span>
      </div>
    </Block>
  );
}

// 客户联系人：「吴主任 · 139 **** 0817」+ 复制手机号；没登记手机号的给去组织详情的链接
function Contact({ t }: { t: OperatorTaskDetail }) {
  const { message } = App.useApp();
  if (!t.contactPhone) {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ ...type.body, color: gy.secondary }}>这家组织没有登记主联系人手机号</span>
        <Link to={`/operator/organizations/${t.orgId}`} style={type.body}>
          去组织详情
        </Link>
      </div>
    );
  }
  const phone = t.contactPhone;
  return (
    <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={body}>
          {t.contactName ?? '主联系人'} · {maskPhone(phone)}
        </span>
        <span style={{ ...type.caption, color: gy.tertiary }}>{t.orgName} · 主联系人</span>
      </span>
      <button
        type="button"
        style={{ ...linkButton, color: gy.primary, flexShrink: 0 }}
        onClick={() =>
          void copyText(phone).then((ok) => (ok ? message.success('已复制手机号') : message.warning(`没能复制，手机号是 ${phone}`)))
        }
      >
        复制手机号
      </button>
    </div>
  );
}

function BasicInfo({ t }: { t: OperatorTaskDetail }) {
  const rows: [string, ReactNode][] = [
    ['任务编号', t.number],
    ['企业', t.enterpriseName],
    ['客户组织', <Link to={`/operator/organizations/${t.orgId}`}>{t.orgName}</Link>],
    ['地区', t.region ?? '—'],
    ['提交时间', t.submittedAt ? monthDayTime(t.submittedAt) : '还没提交'],
    [
      '负责专家',
      t.assignedExpertName
        ? `${t.assignedExpertName}${t.assignedAt ? `（${monthDayTime(t.assignedAt)} 分配）` : ''}`
        : t.group === 'preparing'
          ? '提交后再分配'
          : '还没分配',
    ],
    [
      '客户联系人',
      t.contactPhone ? `${t.contactName ?? '主联系人'} · ${maskPhone(t.contactPhone)}` : (t.contactName ?? '没有登记'),
    ],
  ];
  return (
    <Block title="基本信息">
      <dl style={{ ...box, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 16 }}>
            <dt style={{ ...type.body, color: gy.tertiary, width: 72, flexShrink: 0 }}>{k}</dt>
            <dd style={{ ...body, margin: 0, minWidth: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

// 联系记录：只有运营看得到；改派等系统记下的几种前面写类型
function Notes({ taskId }: { taskId: string }) {
  const { message } = App.useApp();
  const notes = useOperatorNotes(taskId);
  const add = useAddOperatorNote(taskId);
  const [draft, setDraft] = useState('');
  const save = () =>
    add.mutate(
      { kind: 'note', body: draft.trim() },
      {
        onSuccess: () => {
          setDraft('');
          void message.success('已记下，客户看不到');
        },
        onError: (e) => void message.warning(e.message),
      },
    );
  return (
    <Block title="联系记录" extra={grayTag('客户不可见')}>
      {notes.isPending ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : notes.isError ? (
        <span style={{ ...type.caption, color: gy.tertiary }}>联系记录没有取到</span>
      ) : notes.data.length === 0 ? (
        <span style={{ ...type.body, color: gy.tertiary }}>还没有联系记录</span>
      ) : (
        <ul style={{ ...box, margin: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {notes.data.map((n) => (
            <li key={n.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ ...type.caption, color: gy.tertiary }}>
                {monthDayTime(n.createdAt)} · {n.createdByName}
              </span>
              <span style={{ ...body, whiteSpace: 'pre-wrap' }}>
                {n.kind === 'note' ? n.body : `${OPERATOR_NOTE_KINDS[n.kind]}：${n.body}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Input.TextArea
          aria-label="写一条联系记录"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={OPERATOR_NOTE_MAX}
          placeholder="写一条联系记录，比如客户答应哪天给"
          style={{ height: 64, resize: 'none', flex: 1 }}
        />
        <Button disabled={!draft.trim()} loading={add.isPending} onClick={save}>
          记下
        </Button>
      </div>
    </Block>
  );
}

function Footer({ t, onAssign, onClose }: { t: OperatorTaskDetail; onAssign: (t: OperatorTask) => void; onClose: () => void }) {
  const close = <Button onClick={onClose}>关闭</Button>;
  const reassign = t.canReassign && <Button onClick={() => onAssign(t)}>改派专家</Button>;
  const draft = t.hasDraft && (
    <Link to={`/operator/tasks/${t.id}`}>
      <Button>查看正文</Button>
    </Link>
  );
  let note: string | null = null;
  let buttons: ReactNode;
  switch (t.group) {
    case 'awaiting':
      note = '专家忙不过来时可以改派，已有的核对记录保留。';
      buttons = (
        <>
          {reassign}
          {close}
        </>
      );
      break;
    case 'to_assign':
      note = t.assignBlockedReason ?? '客户提交时没有选专家，由您指定。';
      buttons = (
        <>
          <Button type="primary" disabled={!!t.assignBlockedReason} onClick={() => onAssign(t)}>
            分配专家
          </Button>
          {close}
        </>
      );
      break;
    case 'working':
      buttons = (
        <>
          {reassign}
          {draft}
          {close}
        </>
      );
      break;
    case 'delivered':
      buttons = (
        <>
          {draft}
          {close}
        </>
      );
      break;
    default:
      buttons = close;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: note ? 'space-between' : 'flex-end', gap: 16 }}>
      {note && <span style={{ ...type.body, color: gy.secondary }}>{note}</span>}
      <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{buttons}</span>
    </div>
  );
}

// 任务抽屉（Paper 16 页 I04b，520 宽）：「查看」「查看缺项」、点整行、?task= 打开的都是它。
// 等客户补资料照画板；其余几种画板没画，按说明的分块：等了多久 / 进度、基本信息、联系记录
export function OperatorTaskDrawer({
  taskId,
  onClose,
  onAssign,
}: {
  taskId: string | null;
  onClose: () => void;
  onAssign: (t: OperatorTask) => void;
}) {
  const task = useOperatorTask(taskId);
  const t = task.data;
  return (
    <Drawer
      open={taskId !== null}
      onClose={onClose}
      size={520}
      closable={false}
      styles={{ header: { padding: '24px 24px 20px', borderBottom: `1px solid ${gy.split}` }, body: { padding: 24 }, footer: { padding: '16px 24px', borderTop: `1px solid ${gy.split}` } }}
      title={
        t ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ ...type.title, fontWeight: weight.strong, color: gy.text }}>{t.enterpriseName}</span>
                <StatusTag tone={t.view.tone}>{t.view.label}</StatusTag>
              </div>
              <span style={{ ...type.body, color: gy.secondary, fontWeight: weight.normal }}>
                {t.number} · {t.orgName} · {t.assignedExpertName ? `负责专家 ${t.assignedExpertName}` : '还没分配专家'}
              </span>
            </div>
            <button type="button" aria-label="关闭" onClick={onClose} style={{ ...linkButton, color: gy.secondary, fontSize: 20 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : (
          <span style={{ ...type.title, color: gy.text }}>任务</span>
        )
      }
      footer={t ? <Footer t={t} onAssign={onAssign} onClose={onClose} /> : undefined}
    >
      {task.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : task.isError || !t ? (
        <Notice
          tone="warning"
          title="这个任务没有打开"
          text={task.error?.message ?? '任务可能已被删除'}
          action={<Button onClick={() => void task.refetch()}>重新加载</Button>}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {t.group === 'awaiting' ? (
            <>
              <WaitBlock t={t} />
              <MissingList count={t.awaitingCustomerItems} />
              <Block title="找谁要资料">
                <Contact t={t} />
                <span style={{ ...type.body, color: gy.secondary }}>
                  客户把资料发来后，请转给{t.assignedExpertName ?? '负责专家'}，由专家代客户传上。传上后「等客户补资料」自动取消，这里不用再点什么。
                </span>
              </Block>
            </>
          ) : t.group === 'to_assign' ? (
            <>
              <WaitBlock t={t} />
              <BasicInfo t={t} />
            </>
          ) : (
            <>
              <Progress t={t} />
              <BasicInfo t={t} />
            </>
          )}
          <Notes key={t.id} taskId={t.id} />
        </div>
      )}
    </Drawer>
  );
}
