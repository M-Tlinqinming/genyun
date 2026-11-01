import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_NOTE_MAX,
  FEEDBACK_REPLY_MAX,
  FEEDBACK_SOURCE_LABELS,
  FEEDBACK_STATUS_LABELS,
  type FeedbackAction,
  type FeedbackCategory,
  type FeedbackStatus,
  type OperatorFeedback,
} from '@genyun/shared';
import { App, Button, Input, Tooltip } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { openFile } from '../../api/documents';
import { useFeedbackAction, useOperatorFeedback } from '../../api/feedback';
import { ApiError } from '../../api/request';
import { PageHeader } from '../../components/PageHeader';
import { Loading, Notice } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';

// 反馈受理（Paper 16 页「反馈受理」）：左侧按状态分的反馈列表，右侧选中的一条：意见原文、关联成果、
// 反馈类型、回复客户、内部备注；受理 / 转给注安师 / 回复并关闭。与编制交付分开：不改任务状态、不改已交付版本。
// ?id= 打开某一条（概览「今天先处理」和站内提醒从这里进来）

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const small: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary };
const label: CSSProperties = { ...text14, color: gy.text };
const card: CSSProperties = { background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 };

type Tab = FeedbackStatus | 'all';
const TABS: Tab[] = ['new', 'processing', 'closed', 'all'];

const STATUS_TONE: Record<FeedbackStatus, { color: string; bg: string }> = {
  new: stage.action,
  processing: stage.progress,
  closed: stage.done,
};

// 北京时间「MM.DD」「MM.DD HH:mm」
function beijing(iso: string) {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}`;
  return { day, full: `${day} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}` };
}

function Tag({ tone, children }: { tone: { color: string; bg: string }; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-block', padding: '0 8px', borderRadius: 4, fontSize: 12, lineHeight: '22px', color: tone.color, background: tone.bg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function StatusTag({ item }: { item: OperatorFeedback }) {
  const text = item.status === 'processing' && item.handlerName ? `处理中 · ${item.handlerName}` : FEEDBACK_STATUS_LABELS[item.status];
  return <Tag tone={STATUS_TONE[item.status]}>{text}</Tag>;
}

const who = (f: OperatorFeedback) =>
  [f.orgName, f.createdByName, f.enterpriseName ? `${f.enterpriseName}${f.taskNumber ? ` ${f.taskNumber}` : ''}` : null].filter(Boolean).join(' · ');

export function FeedbackPage() {
  const query = useOperatorFeedback();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const [tabChoice, setTab] = useState<Tab | null>(null);

  const header = (
    <PageHeader
      eyebrow="耕云运营 / 反馈受理"
      title="反馈受理"
      description="客户对平台或成果的意见。受理与编制交付分开：不会改动已交付版本，需要重新编制时另建任务。"
    />
  );
  if (query.isPending) {
    return (
      <>
        {header}
        <Loading rows={8} />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {header}
        <Notice tone="warning" title="反馈列表暂时打不开" text={query.error.message} action={<Button onClick={() => void query.refetch()}>重新加载</Button>} />
      </>
    );
  }
  const { items, counts } = query.data;
  const fromLink = selectedId ? items.find((f) => f.id === selectedId) : undefined;
  // 没手动切过页签时：从链接打开的那一条所在的页签，否则「待受理」
  const tab: Tab = tabChoice ?? fromLink?.status ?? 'new';
  const shown = tab === 'all' ? items : items.filter((f) => f.status === tab);
  const selected = (selectedId && shown.find((f) => f.id === selectedId)) || shown[0];
  const select = (id: string) => setParams({ id }, { replace: true });

  return (
    <>
      {header}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginTop: -8 }}>
        <section aria-label="反馈列表" style={{ ...card, width: 420, flexShrink: 0, overflow: 'hidden' }}>
          <div role="tablist" style={{ display: 'flex', gap: 24, padding: '0 20px', borderBottom: `1px solid ${gy.split}` }}>
            {TABS.map((t) => {
              const active = t === tab;
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    ...text14,
                    padding: '12px 0',
                    color: active ? gy.primary : gy.text,
                    borderBottom: `2px solid ${active ? gy.primary : 'transparent'}`,
                    marginBottom: -1,
                  }}
                >
                  {t === 'all' ? '全部' : `${FEEDBACK_STATUS_LABELS[t]} ${counts[t]}`}
                </button>
              );
            })}
          </div>
          {shown.length === 0 ? (
            <p style={{ ...text14, color: gy.secondary, margin: 0, padding: '32px 20px', textAlign: 'center' }}>
              {tab === 'new' ? '没有待受理的反馈。' : tab === 'processing' ? '没有处理中的反馈。' : tab === 'closed' ? '还没有关闭的反馈。' : '还没有客户提交反馈。'}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 640, overflowY: 'auto' }}>
              {shown.map((f) => (
                <ListItem key={f.id} item={f} selected={f.id === selected?.id} onSelect={() => select(f.id)} />
              ))}
            </ul>
          )}
        </section>
        {selected ? (
          <Detail key={selected.id} item={selected} />
        ) : (
          <section style={{ ...card, flex: 1, minWidth: 0, padding: '48px 24px', ...text14, color: gy.secondary, textAlign: 'center' }}>
            在左侧选一条反馈查看。
          </section>
        )}
      </div>
    </>
  );
}

function ListItem({ item: f, selected, onSelect }: { item: OperatorFeedback; selected: boolean; onSelect: () => void }) {
  const closed = f.status === 'closed';
  return (
    <li style={{ borderBottom: `1px solid ${gy.split}` }}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          cursor: 'pointer',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '16px 20px',
          paddingLeft: selected ? 20 : 23,
          background: selected ? '#F7F9FF' : undefined,
          borderLeft: selected ? `3px solid ${gy.primary}` : 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span
            style={{
              ...text14,
              fontWeight: selected ? 500 : 400,
              color: closed ? gy.secondary : gy.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {f.title}
          </span>
          <span style={{ ...small, flexShrink: 0 }}>{beijing(f.createdAt).day}</span>
        </span>
        <span style={{ ...small, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who(f)}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <StatusTag item={f} />
          <Tag tone={{ color: gy.secondary, bg: gy.neutralBg }}>{FEEDBACK_CATEGORY_LABELS[f.category]}</Tag>
        </span>
      </button>
    </li>
  );
}

function Detail({ item: f }: { item: OperatorFeedback }) {
  const { message } = App.useApp();
  const act = useFeedbackAction();
  const [category, setCategory] = useState<FeedbackCategory>(f.category);
  const [reply, setReply] = useState(f.reply ?? '');
  const [note, setNote] = useState(f.internalNote ?? '');
  const [pending, setPending] = useState<FeedbackAction | null>(null);
  const closed = f.status === 'closed';
  const version = f.deliveryVersion ? `V${f.deliveryVersion}` : null;

  const run = (action: FeedbackAction, done: string) => {
    if (action === 'close' && !reply.trim()) {
      message.warning('请先写给客户的回复');
      return;
    }
    setPending(action);
    act.mutate(
      { id: f.id, action, category, reply, internalNote: note },
      {
        onSuccess: () => message.success(done),
        onError: (err) => message.error(err instanceof ApiError ? err.message : '没能保存，请稍后重试'),
        onSettled: () => setPending(null),
      },
    );
  };

  const canForward = category === 'content' && Boolean(f.taskId && f.taskExpertName);
  const forwardHint = !f.taskId
    ? '这条反馈没有关联任务，不能转给注安师'
    : !f.taskExpertName
      ? '关联的任务还没有分派注安师'
      : category !== 'content'
        ? '选「成果内容」后才能转给注安师'
        : `站内提醒 ${f.taskExpertName}，由其决定是否另建修订任务`;

  return (
    <section aria-label="反馈详情" style={{ ...card, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '20px 24px', borderBottom: `1px solid ${gy.split}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.text }}>{f.title}</h2>
          <span style={small}>
            {f.createdByName} · {f.orgName} · {beijing(f.createdAt).full} · {FEEDBACK_SOURCE_LABELS[f.source]}
          </span>
        </div>
        <StatusTag item={f} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '20px 24px' }}>
        <div style={{ ...text14, color: gy.text, background: '#FAFAFB', border: `1px solid ${gy.split}`, borderRadius: 6, padding: '12px 16px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {f.content}
        </div>
        {f.files.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={small}>附件</span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {f.files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  style={{ all: 'unset', cursor: 'pointer', ...text14, color: gy.primary }}
                  onClick={() => openFile(file.id).catch((err: Error) => message.error(err.message))}
                >
                  {file.name}
                </button>
              ))}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={small}>关联成果</span>
            {f.taskId ? (
              <Link to={`/operator/tasks/${f.taskId}`} style={{ ...text14, color: gy.primary }}>
                {[f.enterpriseName, f.taskNumber, version].filter(Boolean).join(' · ')}
              </Link>
            ) : (
              <span style={{ ...text14, color: gy.text }}>未关联任务</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={small}>对已交付成果的影响</span>
            <span style={{ ...text14, color: gy.text }}>{version ? `无，${version} 保持不变` : '无'}</span>
          </div>
          {f.forwardedToName && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={small}>已转给注安师</span>
              <span style={{ ...text14, color: gy.text }}>
                {f.forwardedToName}
                {f.forwardedAt && ` · ${beijing(f.forwardedAt).full}`}
              </span>
            </div>
          )}
        </div>

        <div style={{ height: 1, background: gy.split }} />

        {closed ? (
          <>
            <Field title="反馈类型">
              <span style={{ ...text14, color: gy.text }}>{FEEDBACK_CATEGORY_LABELS[f.category]}</span>
            </Field>
            <Field title="给客户的回复" hint={f.closedAt ? `${f.closedByName ?? '耕云运营'} · ${beijing(f.closedAt).full} 回复并关闭` : undefined}>
              <span style={{ ...text14, color: gy.text, whiteSpace: 'pre-wrap' }}>{f.reply}</span>
            </Field>
            {f.internalNote && (
              <Field title="内部备注（客户不可见）">
                <span style={{ ...text14, color: gy.text, whiteSpace: 'pre-wrap' }}>{f.internalNote}</span>
              </Field>
            )}
          </>
        ) : (
          <>
            <Field title="反馈类型" hint="选「成果内容」时可转给原任务的注安师，由其决定是否另建修订任务。">
              <div role="radiogroup" aria-label="反馈类型" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {FEEDBACK_CATEGORIES.map((c) => {
                  const on = c === category;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setCategory(c)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        boxSizing: 'border-box',
                        height: 32,
                        padding: '0 15px',
                        borderRadius: 6,
                        ...text14,
                        lineHeight: '30px',
                        border: `1px solid ${on ? gy.primary : '#D9D9D9'}`,
                        background: on ? gy.selected : gy.surface,
                        color: on ? gy.primary : gy.text,
                      }}
                    >
                      {FEEDBACK_CATEGORY_LABELS[c]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field title="回复客户" hint="客户会在通知中看到这段回复。">
              <Input.TextArea
                aria-label="回复客户"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                maxLength={FEEDBACK_REPLY_MAX}
                style={{ height: 88, resize: 'none' }}
              />
            </Field>
            <Field title="内部备注（客户不可见）">
              <Input.TextArea
                aria-label="内部备注"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={FEEDBACK_NOTE_MAX}
                placeholder="记录处理过程，便于交接"
                style={{ height: 56, resize: 'none' }}
              />
            </Field>
          </>
        )}
      </div>

      {!closed && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: `1px solid ${gy.split}` }}>
          <Tooltip title={forwardHint}>
            <Button disabled={!canForward || pending !== null} loading={pending === 'forward'} onClick={() => run('forward', `已转给 ${f.taskExpertName}`)}>
              {f.forwardedToName ? '再次转给注安师' : '转给注安师'}
            </Button>
          </Tooltip>
          {f.status === 'new' ? (
            <Button disabled={pending !== null} loading={pending === 'accept'} onClick={() => run('accept', '已受理，客户会收到站内提醒')}>
              受理，稍后回复
            </Button>
          ) : (
            <Button disabled={pending !== null} loading={pending === 'save'} onClick={() => run('save', '已保存')}>
              保存
            </Button>
          )}
          <Button type="primary" disabled={pending !== null} loading={pending === 'close'} onClick={() => run('close', '已回复客户并关闭')}>
            回复并关闭
          </Button>
        </div>
      )}
    </section>
  );
}

function Field({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={label}>{title}</span>
      {children}
      {hint && <span style={small}>{hint}</span>}
    </div>
  );
}
