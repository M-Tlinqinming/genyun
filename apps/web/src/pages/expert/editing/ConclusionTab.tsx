import { DRAFT_KIND_KEYS, DRAFT_KINDS, pendingCount, REVIEW_NOTE_MAX, reviewValid, type DraftKind, type ReviewView } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Input } from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import { usePending } from '../../../api/editing';
import { ApiError } from '../../../api/request';
import { concludeReview, reviewKey } from '../../../api/review';
import { gy } from '../../../theme/tokens';
import { when } from './EditDialogs';
import { Tag } from './ReviewParts';

// 审核结论页签（E18-06、E18-06b）：三份都核对过以后写结论，点「定稿并交付」去交付页。
// 结论必填，不预填；以前写过的放回框里，文稿在那之后又改过就提示按改过的内容重写

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const caption: CSSProperties = { fontSize: 12, lineHeight: '20px' };
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
  onPublished,
}: {
  taskId: string;
  review: ReviewView;
  /** 当前账号的名字（底栏「审核人：…」） */
  reviewer: string;
  /** 结论记下以后去交付页 */
  onPublished: () => void;
}) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const last = review.review;
  const valid = reviewValid(review);
  const [note, setNote] = useState(last?.note ?? '');
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
      onPublished();
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

  const reason = error ? (
    <span style={{ ...text14, color: gy.error }}>审核结论还没写 · 写好后再点「定稿并交付」</span>
  ) : (
    <span style={{ ...text14, color: gy.tertiary }}>审核人：{editable ? reviewer : (last?.byName ?? '—')} · 点「定稿并交付」后，客户才能下载</span>
  );

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: gy.canvas }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
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
      <div style={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 32px', background: gy.surface, borderTop: `1px solid ${gy.split}` }}>
        <span role={error ? 'alert' : undefined} style={{ flex: 1, minWidth: 0 }}>
          {reason}
        </span>
        {editable && (
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            定稿并交付
          </Button>
        )}
      </div>
    </>
  );
}
