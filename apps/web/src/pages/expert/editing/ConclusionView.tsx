import { checkedCount, checkValid, DRAFT_KINDS, REVIEW_NOTE_DEFAULT, REVIEW_NOTE_MAX, reviewValid, type DraftKind, type ReviewView } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Checkbox, Input, Result } from 'antd';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../../api/request';
import { concludeReview, reviewKey, useReview } from '../../../api/review';
import { useSession } from '../../../auth/session';
import { linkButton, Loading } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';
import { ContactRecords } from '../workup/ContactRecords';
import { stamp } from './EditDialogs';

// 审核结论（14 页 E18-06）：三份逐份核对过，确认本次审核结论。确认后任何一份再保存修订，结论失效，
// 要重新核对那一份、重新确认
const STAGES = ['资料核实', '专业编制', '审核与修订', '成果发布'];
const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const panel: CSSProperties = { background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 6 };
const cell: CSSProperties = { ...text14, padding: '22px 24px', textAlign: 'left', borderBottom: `1px solid ${gy.split}` };
const head: CSSProperties = { ...cell, padding: '14px 24px' };

export function ConclusionView({
  taskId,
  enterpriseName,
  taskNumber,
  onOpen,
  onPublish,
}: {
  taskId: string;
  enterpriseName: string;
  taskNumber: string;
  /** 回到某一份的 Word 预览 */
  onOpen: (kind: DraftKind) => void;
  /** 进入成果发布 */
  onPublish: () => void;
}) {
  const review = useReview(taskId);
  const session = useSession();
  const client = useQueryClient();
  const { message } = App.useApp();
  const [note, setNote] = useState(REVIEW_NOTE_DEFAULT);
  const [agreed, setAgreed] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  // 已有结论（包括失效的）时，结论框里放上次写的
  const lastNote = review.data?.review?.note;
  useEffect(() => {
    if (lastNote) setNote(lastNote);
  }, [lastNote]);

  // 进到这一页、确认审核通过以后：焦点放到标题上
  const passedNow = review.data ? reviewValid(review.data) : false;
  const loaded = review.data !== undefined;
  useEffect(() => {
    if (loaded) titleRef.current?.focus();
  }, [loaded, passedNow]);

  if (review.isLoading) return <Loading />;
  if (review.isError) {
    return (
      <Result
        status="info"
        title="还不能确认审核结论"
        subTitle={review.error.message}
        extra={
          <Link to={`/expert/tasks/${taskId}`}>
            <Button>返回生成进度</Button>
          </Link>
        }
      />
    );
  }
  const r = review.data!;
  const count = checkedCount(r.docs);
  const allChecked = count === r.docs.length;
  const passed = reviewValid(r);
  const pending = r.docs.filter((d) => !checkValid(d));
  // 结论确认过、但之后有文稿又保存了修订
  const lapsed = r.review !== null && !passed;
  const changedSince = lapsed ? r.docs.filter((d) => r.review!.versions[d.kind] !== d.version).map((d) => DRAFT_KINDS[d.kind]) : [];
  const chip = passed
    ? { text: '审核已通过', ...stage.done }
    : allChecked
      ? { text: '三份已核对 · 待审核', color: gy.primary, bg: gy.selected }
      : { text: '正在人工核对', color: gy.primary, bg: gy.selected };

  const submit = async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteError('请填写审核结论');
      noteRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const versions = Object.fromEntries(r.docs.map((d) => [d.kind, d.version])) as Record<DraftKind, number>;
      const view = await concludeReview(taskId, { note: trimmed, versions });
      client.setQueryData(reviewKey(taskId), view);
      setAgreed(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { view?: ReviewView } | undefined;
        if (body?.view) client.setQueryData(reviewKey(taskId), body.view);
        message.warning(err.message);
      } else if (err instanceof ApiError && err.status === 400) {
        setNoteError(err.message);
        noteRef.current?.focus();
      } else {
        message.error('审核结论没有记下，请检查网络后重试');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gy-review-page gy-wide-workbench" style={{ display: 'flex', flexDirection: 'column', gap: 24, margin: '-16px 0 -24px', paddingBottom: 24 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <nav aria-label="面包屑" style={{ ...text14, color: gy.secondary }}>
          <Link to="/expert" style={{ color: gy.secondary }}>
            任务中心
          </Link>
          {'　/　'}
          <Link to={`/expert/tasks/${taskId}`} style={{ color: gy.secondary }}>
            {enterpriseName}
          </Link>
          {'　/　审核与修订'}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, lineHeight: '32px', color: gy.text }}>{enterpriseName}</h1>
          <span style={{ ...text14, color: gy.secondary }}>{taskNumber}</span>
          <span style={{ flex: 1 }} />
          <span role="status" style={{ ...text14, padding: '3px 10px', borderRadius: 4, background: chip.bg, color: chip.color }}>
            {chip.text}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, paddingBottom: 12, borderBottom: `1px solid ${gy.split}` }}>
          <ol aria-label="处理阶段" style={{ display: 'flex', gap: 32, flex: 1, margin: 0, padding: 0, listStyle: 'none' }}>
            {STAGES.map((s, i) => (
              <li key={s} aria-current={i === 2 ? 'step' : undefined} style={{ ...text14, color: i === 2 ? gy.primary : gy.secondary }}>
                {i + 1}　{s}
              </li>
            ))}
          </ol>
          <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => setShowRecords(true)}>
            处理记录
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 ref={titleRef} tabIndex={-1} data-page-title style={{ margin: 0, fontSize: 24, lineHeight: '32px', fontWeight: 500, color: gy.text }}>
        {passed ? '本次审核已通过' : allChecked ? '三份文稿已核对，确认本次审核结论' : '还有文稿没有核对'}
      </h2>
      {passed ? (
        <Banner tone="done">
          ✓ 审核已通过 · {r.review!.byName} {stamp(r.review!.at)} · 结论对应三份当前保存稿
          {r.published ? ` · 已发布为交付 V${r.published.version}，这批文稿只读` : ''}
        </Banner>
      ) : r.factsChangedAt ? (
        <Banner tone="action">审核结论已失效：事实已更新，草稿还没有重新生成。请先按新事实重新生成三份草稿，再核对和确认审核结论。</Banner>
      ) : lapsed ? (
        <Banner tone="action">
          审核结论已失效：{changedSince.join('、')}在审核后又保存了修订。{pending.length ? '请重新核对后再确认审核结论。' : '请重新确认审核结论。'}
        </Banner>
      ) : allChecked ? (
        <Banner tone="done">✓ 人工核对 3 / 3 · 核对记录均对应当前保存稿。</Banner>
      ) : (
        <Banner tone="action">
          人工核对 {count} / 3 · {pending.map((d) => DRAFT_KINDS[d.kind]).join('、')}还没有核对当前稿，三份都核对后才能确认审核结论。
        </Banner>
      )}
      </div>

      <section aria-label="三份文稿的核对记录" style={{ ...panel, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: gy.canvas }}>
              {['文档', '本次保存稿', '人工核对记录', '操作'].map((h) => (
                <th key={h} scope="col" style={{ ...head, fontWeight: 500, color: gy.text }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.docs.map((d, i) => {
              const last = i === r.docs.length - 1 ? { borderBottom: 'none' } : {};
              const valid = checkValid(d);
              return (
                <tr key={d.kind}>
                  <th scope="row" style={{ ...cell, ...last, fontWeight: 500, color: gy.text }}>
                    {DRAFT_KINDS[d.kind]}
                  </th>
                  <td style={{ ...cell, ...last, color: gy.text }}>
                    {d.savedAt ? stamp(d.savedAt) : '—'}
                    {d.version === 0 && <span style={{ color: gy.secondary }}>（生成稿）</span>}
                  </td>
                  <td style={{ ...cell, ...last, color: valid ? gy.success : d.check ? gy.warning : gy.secondary }}>
                    {valid ? `✓ ${d.check!.byName} · ${stamp(d.check!.at)}` : d.check ? '核对后又保存了修订，需重新核对' : '待核对'}
                  </td>
                  <td style={{ ...cell, ...last }}>
                    <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => onOpen(d.kind)}>
                      {valid || !r.editable ? '查看文稿' : '去核对'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-label="本次审核结论" style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}>
        <label htmlFor="review-note" style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>
          审核结论
        </label>
        {passed || !r.editable ? (
          <p style={{ ...text14, margin: 0, color: gy.text, whiteSpace: 'pre-wrap' }}>{r.review?.note ?? '还没有确认审核结论'}</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Input.TextArea
                ref={(r) => {
                  noteRef.current = r?.resizableTextArea?.textArea ?? null;
                }}
                id="review-note"
                value={note}
                maxLength={REVIEW_NOTE_MAX}
                autoSize={{ minRows: 3, maxRows: 8 }}
                disabled={!allChecked}
                status={noteError ? 'error' : undefined}
                aria-describedby={noteError ? 'review-note-error' : undefined}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (noteError) setNoteError(null);
                }}
              />
              {noteError && (
                <span id="review-note-error" role="alert" style={{ fontSize: 13, lineHeight: '20px', color: gy.error }}>
                  {noteError}
                </span>
              )}
            </div>
            <Checkbox checked={agreed} disabled={!allChecked} onChange={(e) => setAgreed(e.target.checked)} style={text14}>
              确认以上结论对应当前保存稿，并记录为本次审核意见。
            </Checkbox>
          </>
        )}
        <span style={{ ...text14, color: gy.secondary }}>
          审核通过后进入成果发布；客户此时仍不能下载本次稿件。后续修改保存将使相应核对及审核结论失效。
        </span>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, ...text14, color: gy.secondary }}>
          {passed ? `审核人：${r.review!.byName}` : r.editable ? `审核人：${session.data?.name ?? ''}` : '只有负责这个任务的注安师可以确认审核结论'}
        </span>
        <Button onClick={() => onOpen(pending[0]?.kind ?? 'plan')}>返回检查文稿</Button>
        {passed ? (
          // 用不同的 key：确认成功后按钮换成这个，不能沿用上一个按钮的加载状态
          <Button key="publish" type="primary" onClick={onPublish}>
            {r.published ? '查看发布结果' : '进入发布'}
          </Button>
        ) : (
          r.editable && (
            <Button key="conclude" type="primary" disabled={!allChecked || !agreed || !!r.factsChangedAt} loading={saving} onClick={() => void submit()}>
              确认审核通过，进入发布
            </Button>
          )
        )}
      </div>
      <ContactRecords taskId={taskId} open={showRecords} onClose={() => setShowRecords(false)} />
    </div>
  );
}

function Banner({ tone, children }: { tone: 'done' | 'action'; children: React.ReactNode }) {
  const s = tone === 'done' ? stage.done : stage.action;
  return (
    <div role="status" style={{ ...text14, padding: '12px 16px', borderRadius: 6, background: s.bg, color: s.color }}>
      {children}
    </div>
  );
}
