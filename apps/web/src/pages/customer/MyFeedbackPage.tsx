import { FEEDBACK_CUSTOMER_STATUS_LABELS, type CustomerFeedback, type FeedbackStatus } from '@genyun/shared';
import { App, Button } from 'antd';
import { useEffect, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { openFile } from '../../api/documents';
import { useMyFeedback } from '../../api/feedback';
import { FeedbackModal } from '../../components/FeedbackModal';
import { PageHeader } from '../../components/PageHeader';
import { Loading, Notice, panel } from '../../components/ui';
import { useWorkspace } from '../../layouts/workspace';
import { gy, stage } from '../../theme/tokens';

// 我的反馈：客户提交过的意见、耕云的处理状态和回复（处理结果同时在站内提醒里告诉客户，不发邮件）。
// 成员看自己提交的，机构管理员看本组织全部。?id= 定位到某一条（站内提醒点进来）

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const small: CSSProperties = { fontSize: 12, lineHeight: '20px', color: gy.secondary };

const TONE: Record<FeedbackStatus, { color: string; bg: string }> = { new: stage.action, processing: stage.progress, closed: stage.done };

function day(iso: string) {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}`;
}

export function MyFeedbackPage() {
  const { orgId, role } = useWorkspace();
  const query = useMyFeedback(orgId);
  const [params] = useSearchParams();
  const focus = params.get('id');

  useEffect(() => {
    if (focus && query.data) document.getElementById(`feedback-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus, query.data]);

  const header = (
    <PageHeader
      eyebrow="客户工作台 / 我的反馈"
      title="我的反馈"
      description={
        role === 'customer_admin'
          ? '本组织提交给耕云的意见和处理结果。反馈与编制交付分开处理，不影响已交付成果的查看和下载。'
          : '您提交给耕云的意见和处理结果。反馈与编制交付分开处理，不影响已交付成果的查看和下载。'
      }
      extra={
        <FeedbackModal
          orgId={orgId}
          trigger={(open) => (
            <Button type="primary" onClick={open}>
              提交新的反馈
            </Button>
          )}
        />
      }
    />
  );
  if (query.isPending) {
    return (
      <>
        {header}
        <Loading rows={4} />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {header}
        <Notice tone="warning" title="反馈暂时打不开" text={query.error.message} action={<Button onClick={() => void query.refetch()}>重新加载</Button>} />
      </>
    );
  }
  return (
    <>
      {header}
      {query.data.length === 0 ? (
        <section style={{ ...panel, padding: '48px 24px', ...text14, color: gy.secondary, textAlign: 'center' }}>
          还没有提交过反馈。使用中有不便，或发现成果文稿有问题，都可以告诉耕云。
        </section>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {query.data.map((f) => (
            <Item key={f.id} item={f} focused={f.id === focus} />
          ))}
        </ul>
      )}
    </>
  );
}

function Item({ item: f, focused }: { item: CustomerFeedback; focused: boolean }) {
  const { message } = App.useApp();
  const tone = TONE[f.status];
  return (
    <li
      id={`feedback-${f.id}`}
      style={{ ...panel, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, borderColor: focused ? gy.primary : gy.split }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ ...text14, fontWeight: 500, color: gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
        <span style={{ padding: '0 8px', borderRadius: 4, fontSize: 12, lineHeight: '22px', color: tone.color, background: tone.bg, flexShrink: 0 }}>
          {FEEDBACK_CUSTOMER_STATUS_LABELS[f.status]}
        </span>
      </div>
      <span style={small}>
        {day(f.createdAt)} · {f.createdByName} 提交
        {f.taskId && f.enterpriseName && (
          <>
            {' · 关于 '}
            <Link to={`/customer/documents/${f.taskId}${f.deliveryVersion ? `?v=${f.deliveryVersion}` : ''}`} style={{ color: gy.primary }}>
              {f.enterpriseName} {f.taskNumber}
              {f.deliveryVersion ? ` 交付 V${f.deliveryVersion}` : ''}
            </Link>
          </>
        )}
      </span>
      <div style={{ ...text14, color: gy.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.content}</div>
      {f.files.length > 0 && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
          {f.files.map((file) => (
            <button
              key={file.id}
              type="button"
              style={{ all: 'unset', cursor: 'pointer', fontSize: 13, lineHeight: '20px', color: gy.primary }}
              onClick={() => openFile(file.id).catch((err: Error) => message.error(err.message))}
            >
              {file.name}
            </button>
          ))}
        </span>
      )}
      {f.status === 'closed' && f.reply ? (
        <div style={{ background: gy.canvas, borderRadius: 6, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={small}>耕云回复{f.closedAt ? ` · ${day(f.closedAt)}` : ''}</span>
          <span style={{ ...text14, color: gy.text, whiteSpace: 'pre-wrap' }}>{f.reply}</span>
        </div>
      ) : (
        <span style={small}>{f.status === 'new' ? '耕云会尽快查看，受理后会通过站内提醒告诉您。' : '耕云已受理，处理结果会通过站内提醒告诉您。'}</span>
      )}
    </li>
  );
}
