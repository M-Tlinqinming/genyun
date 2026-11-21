import { DRAFT_KIND_KEYS, DRAFT_KINDS, pendingCount, REVIEW_NOTE_MAX, reviewValid, type DraftKind, type ReviewView } from '@genyun/shared';
import { CloseCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Input } from 'antd';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePending } from '../../../api/editing';
import { ApiError } from '../../../api/request';
import { concludeReview, reviewKey } from '../../../api/review';
import { gy } from '../../../theme/tokens';
import { DeliverConfirm } from './DeliverDialogs';
import { when } from './EditDialogs';
import { Tag } from './ReviewParts';
import { useDeliver } from './useDeliver';

// 审核结论页签（E18-06、E18-06b）：三份都核对过以后写结论，点「定稿并交付」先记下结论，再原地弹出交付确认
// （15 页 R10 首次、R14 重新打开以后再次交付）。结论必填，不预填；以前写过的放回框里，文稿在那之后又改过就提示按改过的内容重写；
// 重新打开以后放回上一次的结论。交付没成功（R15）、结果没确认、正在交付时，底栏上方各出一条提示条

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const caption: CSSProperties = { fontSize: 12, lineHeight: '20px' };
// 底栏上方提示条的三种底色：红（R15）、琥珀（结果没确认）、浅蓝（正在交付）
const NOTICE_TONE: Record<'error' | 'warning' | 'progress', CSSProperties> = {
  error: { background: gy.errorBg, borderTop: '1px solid #FDA29B' },
  warning: { background: gy.warningBg, borderTop: `1px solid ${gy.split}` },
  progress: { background: gy.selected, borderTop: `1px solid ${gy.split}` },
};
// 表头上下 10、行上下 14、左右 24：照 E18-06 画板
const th: CSSProperties = { ...text14, color: gy.secondary, fontWeight: 600, padding: '10px 24px', textAlign: 'left', borderBottom: `1px solid ${gy.split}`, background: gy.canvas };
const td: CSSProperties = { ...text14, color: gy.text, padding: '14px 24px', textAlign: 'left', borderBottom: `1px solid ${gy.split}`, verticalAlign: 'middle' };

function PendingCell({ taskId, kind }: { taskId: string; kind: DraftKind }) {
  const pending = usePending(taskId, kind);
  if (!pending.data) return <span style={{ color: gy.tertiary }}>—</span>;
  const n = pendingCount(pending.data);
  return <span>{n ? `${n} 处留空` : '全部处理'}</span>;
}

export function ConclusionTab({
  taskId,
  review,
  reviewer,
  onDelivered,
}: {
  taskId: string;
  review: ReviewView;
  /** 当前账号的名字（底栏「审核人：…」） */
  reviewer: string;
  /** 交付成功以后去已交付页 */
  onDelivered: () => void;
}) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const reduce = useReducedMotion();
  const deliver = useDeliver(taskId);
  const status = deliver.status;
  const last = review.review;
  const valid = reviewValid(review);
  const [note, setNote] = useState(last?.note ?? review.previousNote ?? '');
  // 交付确认弹窗：带着这一次要用的 publishId
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // 正在交付、结果没确认时，后台交付好了自动去已交付页
  const waited = useRef(false);
  useEffect(() => {
    if (status === 'publishing' || status === 'sending' || status === 'unknown') waited.current = true;
    else if (status === 'done' && waited.current) {
      waited.current = false;
      onDelivered();
    }
  }, [status, onDelivered]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = review.editable && !review.published;
  // 上次的结论读到后放进框里（只放一次，之后不覆盖正在写的）
  const [filledFrom, setFilledFrom] = useState(last?.at ?? null);
  useEffect(() => {
    if (last && last.at !== filledFrom) {
      setFilledFrom(last.at);
      setNote(last.note);
    }
  }, [last, filledFrom]);
  // 写过结论、之后文稿又改过
  const changedSince = last !== null && !valid && review.docs.some((d) => last.versions[d.kind] !== d.version);

  const submit = async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setError('请写下审核结论再点「定稿并交付」，至少写一句您核对了什么。');
      document.getElementById('review-note')?.focus();
      return;
    }
    setSaving(true);
    try {
      const versions = Object.fromEntries(review.docs.map((d) => [d.kind, d.version])) as Record<DraftKind, number>;
      const view = await concludeReview(taskId, { note: trimmed, versions });
      client.setQueryData(reviewKey(taskId), view);
      // 结论记下了：原地弹交付确认（结果没确认、后台又没收到过的那一次，沿用同一个 publishId）
      setConfirming(deliver.pendingId ?? crypto.randomUUID());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { view?: ReviewView } | undefined;
        if (body?.view) client.setQueryData(reviewKey(taskId), body.view);
        message.warning(err.message);
      } else if (err instanceof ApiError && err.status === 400) {
        setError(err.message);
      } else {
        message.error('审核结论没有记下，请检查网络后重试');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirm = async (updateNote?: string) => {
    if (!confirming) return;
    setSending(true);
    const versions = Object.fromEntries(review.docs.map((d) => [d.kind, d.version])) as Record<DraftKind, number>;
    const outcome = await deliver.deliver({ publishId: confirming, versions, ...(review.reopened ? { updateNote } : {}) });
    setSending(false);
    setConfirming(null);
    void client.invalidateQueries({ queryKey: reviewKey(taskId) });
    if (outcome === 'done') onDelivered();
  };

  const who = editable ? reviewer : (last?.byName ?? '—');
  // 交付没成功、结果没确认、正在交付：底栏上方的提示条，「定稿并交付」禁用
  const blocked = editable && (status === 'failed' || status === 'unknown' || status === 'publishing' || status === 'sending');
  // 后台正在交付时文稿锁住（editable 为 false），刷新或换人打开也要看到「正在交付」；
  // 回复丢了但后台其实已交付时文稿也锁住了，「查询交付结果」仍要留着，查到后去已交付页
  const inFlight = status === 'publishing' || status === 'sending' || status === 'unknown';
  const notice: { tone: 'error' | 'warning' | 'progress'; icon: ReactNode; text: string; action?: ReactNode } | null = !editable && !inFlight
    ? null
    : status === 'failed'
      ? {
          tone: 'error',
          icon: <CloseCircleFilled aria-hidden style={{ fontSize: 16, color: gy.error }} />,
          text: '交付没有成功，三份文稿和审核结论都还在。请检查网络后重新交付。',
          action: (
            <Button danger onClick={() => setConfirming(crypto.randomUUID())}>
              重新交付
            </Button>
          ),
        }
      : status === 'unknown'
        ? {
            tone: 'warning',
            icon: <ExclamationCircleFilled aria-hidden style={{ fontSize: 16, color: gy.warning }} />,
            text: '还没确认交付成功没有，三份文稿和审核结论都还在。请先查询交付结果。',
            action: (
              <Button loading={deliver.querying} onClick={() => void deliver.check()}>
                查询交付结果
              </Button>
            ),
          }
        : status === 'publishing' || status === 'sending'
          ? {
              tone: 'progress',
              icon: <LoadingOutlined aria-hidden spin={!reduce} style={{ fontSize: 16, color: gy.primary }} />,
              text: '正在交付三份 Word，请稍等。',
            }
          : null;
  const reasonText =
    status === 'failed'
      ? '请用上方「重新交付」再试一次'
      : status === 'unknown'
        ? '请用上方「查询交付结果」确认'
        : status === 'publishing' || status === 'sending'
          ? '正在交付'
          : '点「定稿并交付」后，客户才能下载';
  const reason = error ? (
    <span style={{ ...text14, color: gy.error }}>审核结论还没写 · 写好后再点「定稿并交付」</span>
  ) : (
    <span style={{ ...text14, color: gy.tertiary }}>
      审核人：{who} · {editable || inFlight ? reasonText : '点「定稿并交付」后，客户才能下载'}
    </span>
  );

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: gy.canvas }}>
        <div style={{ maxWidth: 1144, margin: '0 auto', padding: '48px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 tabIndex={-1} data-page-title style={{ margin: 0, fontSize: 24, lineHeight: '32px', fontWeight: 600, color: gy.text }}>
              三份都已核对，写下审核结论
            </h2>
            <span style={{ ...text14, color: gy.secondary }}>
              写好后点「定稿并交付」，客户就能下载。交付前再改任何一份，这一份要重新核对，审核结论也要重写。
            </span>
          </div>

          <div style={{ background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, overflow: 'hidden' }}>
            <table aria-label="三份文稿" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>文稿</th>
                  <th style={th}>最后保存</th>
                  <th style={th}>核对</th>
                  <th style={{ ...th, textAlign: 'right' }}>待补充</th>
                </tr>
              </thead>
              <tbody>
                {DRAFT_KIND_KEYS.map((k, i) => {
                  const d = review.docs.find((x) => x.kind === k);
                  const last = i === DRAFT_KIND_KEYS.length - 1;
                  const cell = last ? { ...td, borderBottom: 'none' } : td;
                  return (
                    <tr key={k}>
                      <td style={cell}>
                        {DRAFT_KINDS[k]}
                        {d?.pages ? ` · ${d.pages} 页` : ''}
                      </td>
                      <td style={{ ...cell, color: gy.secondary }}>{d?.savedAt ? when(d.savedAt) : '—'}</td>
                      <td style={cell}>
                        {d?.check && d.check.version === d.version ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <Tag tone="done">已核对</Tag>
                            <span style={{ ...caption, color: gy.tertiary }}>
                              {d.check.byName} · {when(d.check.at)}
                            </span>
                          </span>
                        ) : (
                          <Tag tone="action">{d?.check ? '改过，待重新核对' : '待核对'}</Tag>
                        )}
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        <PendingCell taskId={taskId} kind={k} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section aria-label="审核结论" style={{ background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor="review-note" style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>
                审核结论
              </label>
              <span style={{ ...text14, color: gy.secondary }}>必填。写清楚您核对了什么、还有什么请客户注意，会写进处理记录。</span>
            </div>
            {changedSince && editable && <span style={{ ...caption, color: gy.warning }}>文稿在写结论之后又改过，请按改过的内容重写</span>}
            {editable ? (
              <>
                <Input.TextArea
                  id="review-note"
                  value={note}
                  maxLength={REVIEW_NOTE_MAX}
                  autoSize={{ minRows: 5, maxRows: 12 }}
                  status={error ? 'error' : undefined}
                  aria-describedby={error ? 'review-note-error' : undefined}
                  placeholder="例如：三份文稿已逐章核对，组织机构、联系人和物资数量与资料一致；风险评估报告「热处理炉设计温度」客户未提供，已留空。"
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (error) setError(null);
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {error && (
                    <span id="review-note-error" role="alert" style={{ ...caption, color: gy.error }}>
                      {error}
                    </span>
                  )}
                  <span style={{ ...caption, color: gy.tertiary, marginLeft: 'auto' }}>
                    {note.length} / {REVIEW_NOTE_MAX}
                  </span>
                </div>
              </>
            ) : (
              <p style={{ ...text14, color: last ? gy.text : gy.tertiary, margin: 0, whiteSpace: 'pre-wrap' }}>
                {last ? `${last.note}（${last.byName} · ${when(last.at)}）` : '负责专家还没写审核结论。'}
              </p>
            )}
          </section>
        </div>
      </div>
      {notice && (
        <div
          role={notice.tone === 'progress' ? 'status' : 'alert'}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '10px 32px',
            minHeight: 53,
            boxSizing: 'border-box',
            ...NOTICE_TONE[notice.tone],
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {notice.icon}
            <span style={{ ...text14, color: notice.tone === 'error' ? gy.error : gy.text }}>{notice.text}</span>
          </span>
          {notice.action}
        </div>
      )}
      <div style={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 32px', background: gy.surface, borderTop: `1px solid ${gy.split}` }}>
        <span role={error ? 'alert' : undefined} style={{ flex: 1, minWidth: 0 }}>
          {reason}
        </span>
        {editable &&
          (blocked ? (
            <Button disabled style={{ background: gy.neutralBg, border: 'none', fontWeight: 600, color: '#A8AEB8' }}>
              定稿并交付
            </Button>
          ) : (
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              定稿并交付
            </Button>
          ))}
      </div>
      <DeliverConfirm
        open={confirming !== null}
        again={review.reopened ? { deliveredAt: review.reopened.deliveredAt } : null}
        suggestedNote={review.reopened?.suggestedNote ?? ''}
        loading={sending}
        onCancel={() => setConfirming(null)}
        onOk={(n) => void confirm(n)}
      />
    </>
  );
}
