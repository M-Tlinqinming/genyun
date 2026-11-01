import { DRAFT_KINDS, deliveryLabel, type DraftKind, type PublishView as View } from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Result } from 'antd';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { publicationKey, publish, queryPublication, usePublication } from '../../../api/publish';
import { ApiError } from '../../../api/request';
import { reviewKey } from '../../../api/review';
import { useSession } from '../../../auth/session';
import { Loading } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';
import { stamp } from './EditDialogs';

// 成果发布（15 页 R03 确认发布、R04 结果暂未确认、R04a 正在发布、R04b 发布失败）。
// 每次发布带页面生成的 publishId（存在 sessionStorage，刷新页面也还在）：
// 连接中断、超时时不知道后台有没有发布成功，只给「查询本次发布结果」，不直接重发；
// 查到后台没收到过，才用同一个 publishId 重新发布（后台按 publishId 只算一次）
const STEPS = ['资料核实', '专业编制', '审核与修订', '成果发布'];
const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const text13: CSSProperties = { fontSize: 13, lineHeight: '20px' };
const card: CSSProperties = { background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 };

interface Pending {
  publishId: string;
  at: string;
}
const storageKey = (taskId: string, batchId: string) => `genyun.publish.${taskId}.${batchId}`;
function readPending(key: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}
function writePending(key: string, p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(key, JSON.stringify(p));
    else sessionStorage.removeItem(key);
  } catch {
    // 无痕模式等存不了：只是刷新后不能接着查询，不影响发布本身
  }
}

// 发布请求没收到回复（断网、超时、网关出错）：结果不确定
const uncertain = (err: unknown) => !(err instanceof ApiError) || err.status === 0 || err.status >= 500;

export function PublishView({
  taskId,
  enterpriseName,
  taskNumber,
  onOpen,
  onEdit,
}: {
  taskId: string;
  enterpriseName: string;
  taskNumber: string;
  /** 打开某一份的 Word 预览 */
  onOpen: (kind: DraftKind) => void;
  /** 返回审核与修订 */
  onEdit: () => void;
}) {
  const publication = usePublication(taskId);
  const session = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  // sending = 发布请求还没回来；unknown = 没收到回复，结果暂未确认
  const [phase, setPhase] = useState<'idle' | 'sending' | 'unknown'>('idle');
  const [querying, setQuerying] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const v = publication.data;
  const key = v ? storageKey(taskId, v.batchId) : null;

  // 上次发布没收到结果就离开了：回来时接着按同一次发布查询
  useEffect(() => {
    if (!key || !v) return;
    const saved = readPending(key);
    if (!saved) return;
    if (v.attempt?.publishId === saved.publishId) {
      // 后台有这一次的记录：按后台结果显示，不用再记着
      writePending(key, null);
      return;
    }
    setPending(saved);
    setPhase((p) => (p === 'idle' ? 'unknown' : p));
    // 只在进页面时看一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shown = v ? screenOf(v, phase) : null;
  useEffect(() => {
    if (shown) titleRef.current?.focus();
  }, [shown]);

  if (publication.isLoading) return <Loading />;
  if (publication.isError) {
    return (
      <Result
        status="info"
        title="还不能发布"
        subTitle={publication.error.message}
        extra={
          <Link to={`/expert/tasks/${taskId}`}>
            <Button>返回生成进度</Button>
          </Link>
        }
      />
    );
  }
  const view = v!;
  const set = (next: View) => {
    client.setQueryData(publicationKey(taskId), next);
    void client.invalidateQueries({ queryKey: reviewKey(taskId) });
  };
  const versions = Object.fromEntries(view.docs.map((d) => [d.kind, d.version])) as Record<DraftKind, number>;

  const send = async (publishId: string) => {
    const p = { publishId, at: pending?.publishId === publishId ? pending.at : new Date().toISOString() };
    writePending(key!, p);
    setPending(p);
    setPhase('sending');
    try {
      const next = await publish(taskId, { publishId, batchId: view.batchId, versions });
      writePending(key!, null);
      set(next);
      setPhase('idle');
    } catch (err) {
      if (uncertain(err)) {
        setPhase('unknown');
        return;
      }
      // 后台明确拒绝了：这一次没有发布
      writePending(key!, null);
      setPhase('idle');
      const body = (err as ApiError).body as { view?: View } | null;
      if (body?.view) set(body.view);
      message.warning((err as Error).message);
    }
  };

  // 结果暂未确认时：按同一个 publishId 查询
  const check = async () => {
    if (!pending) return;
    setQuerying(true);
    try {
      const next = await queryPublication(taskId, pending.publishId);
      if (next.attempt?.publishId === pending.publishId) {
        writePending(key!, null);
        set(next);
        setPhase('idle');
      } else {
        // 后台没收到过这一次：可以放心重新发布（仍用同一个 publishId）
        set(next);
        setPhase('idle');
        message.info('后台没有收到这次发布，三份文稿还没有发布，可以重新发布');
      }
    } catch {
      message.error('还是连不上耕云，暂时查不到发布结果，请稍后再查询');
    } finally {
      setQuerying(false);
    }
  };

  const reviewer = view.review?.byName ?? session.data?.name ?? '';
  const latestSaved = view.docs.map((d) => d.savedAt).filter((x): x is string => !!x).sort().pop() ?? null;
  const savedLine = `${latestSaved ? stamp(latestSaved) : '—'} · 三份文稿`;
  const reviewLine = view.review ? `${stamp(view.review.at)} · ${view.review.byName}审核通过` : '还没有确认审核结论';
  const attempt = view.attempt;
  const back = () => navigate('/expert');

  // 发布中、结果未确认、失败、已交付：同一套页面结构（R04 / R04a / R04b）
  if (shown !== 'confirm') {
    const version = shown === 'unknown' || shown === 'sending' ? view.nextVersion : (attempt?.version ?? view.nextVersion);
    const submittedAt = shown === 'unknown' || shown === 'sending' ? pending?.at : attempt?.startedAt;
    const delivered = shown === 'done' ? view.deliveries.find((d) => d.version === attempt?.version) : undefined;
    const screen = {
      sending: {
        title: '正在发布三份文稿',
        tone: 'progress' as const,
        heading: '正在生成并存档三份 Word',
        lines: [
          '发布请求已受理。请勿重复提交，三份 Word 都存好后任务显示“已交付”。',
          `当前保存稿：${latestSaved ? stamp(latestSaved) : '—'} · 已审核通过。离开页面不会取消本次发布。`,
        ],
        access: '发布处理中 · 客户暂不能看到本次成果',
        aside: ['可以离开此页，稍后继续', '稍后返回时继续显示同一次发布的进度。', `长时间无进展？联系运营并提供任务编号 ${taskNumber}`],
      },
      publishing: {
        title: '正在发布三份文稿',
        tone: 'progress' as const,
        heading: '正在生成并存档三份 Word',
        lines: [
          '发布请求已受理。请勿重复提交，三份 Word 都存好后任务显示“已交付”。',
          `当前保存稿：${latestSaved ? stamp(latestSaved) : '—'} · 已审核通过。离开页面不会取消本次发布。`,
        ],
        access: '发布处理中 · 客户暂不能看到本次成果',
        aside: ['可以离开此页，稍后继续', '稍后返回时继续显示同一次发布的进度。', `长时间无进展？联系运营并提供任务编号 ${taskNumber}`],
      },
      unknown: {
        title: '发布结果暂未确认',
        tone: 'action' as const,
        heading: '连接中断，尚未收到发布结果',
        lines: ['后台可能仍在完成发布。请先查询本次结果，避免重复发布同一批文稿。', '三份保存稿与审核结论已保留，当前不需要重新编辑或再次审核。'],
        access: '待确认 · 只有发布成功且三份 Word 都存好，才显示“已交付”',
        aside: ['可以离开此页，稍后继续', '回到这一页时继续查询同一次发布，不会新建发布。', `持续无法确认？联系运营并附上任务编号 ${taskNumber}`],
      },
      failed: {
        title: '本次发布失败',
        tone: 'error' as const,
        heading: view.canPublish ? '已确认未形成交付，可重新发布' : '已确认未形成交付',
        lines: [`查询结果：${attempt?.error ?? '本次没有形成交付'}`, view.canPublish ? '三份保存稿与审核结论仍有效；重试将继续发布同一批文稿，不修改内容。' : (view.blocker ?? '')],
        access: `尚未交付 · 本次 ${deliveryLabel(version)} 未生效`,
        aside: ['重试前无需重新编制', '若需修改文稿，先返回审核与修订；修改后重新核对并审核，再发布。', `再次发布失败？联系运营 · ${taskNumber}`],
      },
      done: {
        title: `已发布为${deliveryLabel(version)}`,
        tone: 'done' as const,
        heading: '三份 Word 已定稿存档，任务已交付',
        lines: [
          `${attempt?.publishedAt ? stamp(attempt.publishedAt) : ''} 由${attempt?.byName ?? reviewer}发布。客户已收到站内提醒，任务显示“已交付”。`,
          '这批文稿已定稿，正文只读；需要更正请发起事实补件，重新生成后再发布为下一个交付版本。',
        ],
        access: '已交付 · 客户在任务里看到“已交付”',
        aside: null,
      },
    }[shown!];
    const tone = { progress: { color: gy.primary, bg: gy.selected }, action: stage.action, error: { color: gy.error, bg: stage.action.bg }, done: stage.done }[screen.tone];

    return (
      <div className="gy-publish-page" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Crumbs taskId={taskId} enterpriseName={enterpriseName} />
          <h1 ref={titleRef} tabIndex={-1} data-page-title style={{ margin: 0, fontSize: 28, fontWeight: 500, lineHeight: '40px', color: gy.text }}>
            {screen.title}
          </h1>
          <span style={{ ...text14, color: gy.text }}>
            {taskNumber} · 本次{shown === 'done' ? '' : '拟'}交付 V{version}
            {submittedAt ? ` · 已于 ${stamp(submittedAt)} 提交发布` : ''}
          </span>
        </header>

        <section
          aria-label="发布状态"
          role="status"
          style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 32, borderRadius: 8, background: tone.bg }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: '28px', color: tone.color }}>{screen.heading}</h2>
          {screen.lines.filter(Boolean).map((l) => (
            <p key={l} style={{ ...text14, margin: 0, color: gy.text }}>
              {l}
            </p>
          ))}
          <div style={{ display: 'flex', gap: 12, paddingTop: 8 }}>
            {shown === 'unknown' && (
              <Button type="primary" size="large" loading={querying} onClick={() => void check()}>
                查询本次发布结果
              </Button>
            )}
            {(shown === 'publishing' || shown === 'sending') && (
              <Button
                type="primary"
                size="large"
                loading={publication.isFetching}
                disabled={shown === 'sending'}
                onClick={() => void publication.refetch()}
              >
                刷新发布进度
              </Button>
            )}
            {shown === 'failed' && view.editable && (
              <Button type="primary" size="large" disabled={!view.canPublish} onClick={() => void send(crypto.randomUUID())}>
                重试发布三份 Word
              </Button>
            )}
            {shown === 'failed' && !view.canPublish && view.editable && <Button size="large" onClick={onEdit}>返回审核与修订</Button>}
            {shown === 'done' && (
              <Button type="primary" size="large" onClick={onEdit}>
                查看定稿正文
              </Button>
            )}
            <Button size="large" onClick={back}>
              返回任务中心
            </Button>
          </div>
        </section>

        <section aria-label="本次发布内容" style={{ ...card, display: 'flex', flexDirection: 'column', gap: 20, padding: 24 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '22px', color: gy.text }}>本次发布内容</h3>
          <Row label="对应保存稿" value={savedLine} />
          <Row label="审核结论" value={reviewLine} />
          {delivered && <Row label="交付文件" value={delivered.files.map((f) => f.name).join('、')} />}
          <Row label="客户访问" value={screen.access} />
        </section>

        {screen.aside && (
          <section aria-label={screen.aside[0]} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10, padding: 24 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '22px', color: gy.text }}>{screen.aside[0]}</h3>
            <p style={{ ...text14, margin: 0, color: gy.text }}>{screen.aside[1]}</p>
            <p style={{ ...text14, margin: 0, color: gy.primary }}>{screen.aside[2]}</p>
          </section>
        )}
      </div>
    );
  }

  // R03 确认发布
  const chip = view.canPublish ? { text: '审核通过 · 待发布', ...stage.done } : { text: '暂不能发布', ...stage.action };
  return (
    <div className="gy-publish-page" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Crumbs taskId={taskId} enterpriseName={enterpriseName} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 500, lineHeight: '40px', color: gy.text }}>{enterpriseName}</h1>
          <span style={{ flex: 1 }} />
          <span style={{ ...text13, padding: '2px 8px', borderRadius: 4, background: chip.bg, color: chip.color }}>{chip.text}</span>
        </div>
        <span style={{ ...text14, color: gy.secondary }}>
          {taskNumber} · 注安师：{reviewer}
        </span>
      </header>

      <ol aria-label="处理阶段" style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, margin: 0, padding: '20px 32px', listStyle: 'none' }}>
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === 3 ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: i < 3 ? 1 : undefined }}>
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                background: i === 3 ? gy.primary : gy.selected,
                color: i === 3 ? gy.surface : gy.primary,
              }}
            >
              {i === 3 ? 4 : '✓'}
            </span>
            <span style={{ ...text14, color: gy.text, whiteSpace: 'nowrap' }}>{s}</span>
            {i < 3 && <span aria-hidden style={{ flex: 1, height: 1, background: gy.primary, opacity: 0.6 }} />}
          </li>
        ))}
      </ol>

      <section aria-label="审核结论" style={{ ...card, display: 'flex', gap: 18, padding: '26px 28px' }}>
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: 15,
            border: `2px solid ${view.canPublish ? gy.primary : gy.warning}`,
            color: view.canPublish ? gy.primary : gy.warning,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {view.canPublish ? '✓' : '!'}
        </span>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 ref={titleRef} tabIndex={-1} data-page-title style={{ margin: 0, fontSize: 21, fontWeight: 500, lineHeight: '30px', color: gy.text }}>
            {view.canPublish ? '审核已通过，等待发布' : '还不能发布'}
          </h2>
          <p style={{ ...text14, margin: 0, color: gy.secondary }}>
            {view.canPublish
              ? `三份文稿已完成全文、企业事实与 Word 版式核对；本次将${view.nextVersion === 1 ? '首次' : ''}发布为${deliveryLabel(view.nextVersion)}。`
              : view.blocker}
          </p>
          {view.review && (
            <span style={{ ...text13, color: gy.secondary, display: 'flex', gap: 16 }}>
              <span>审核人　{view.review.byName}</span>
              <span>审核通过　{stamp(view.review.at)}</span>
              {latestSaved && <span>对应保存稿　{stamp(latestSaved)}</span>}
            </span>
          )}
        </div>
        <span style={{ ...text13, alignSelf: 'flex-start', padding: '1px 8px', borderRadius: 4, border: `1px solid ${gy.split}`, background: gy.neutralBg, color: gy.secondary }}>
          尚未交付
        </span>
      </section>

      <section aria-label="本次待发布文件" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>本次待发布文件</h2>
          <span style={{ ...text13, color: gy.secondary }}>{deliveryLabel(view.nextVersion)} · 同一批保存稿 · 三份齐全</span>
        </div>
        <div style={{ ...card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: gy.canvas }}>
                {['交付文件', '审核依据', '文件状态', '操作'].map((h) => (
                  <th key={h} scope="col" style={{ ...text14, fontWeight: 500, color: gy.text, textAlign: 'left', padding: '14px 16px', borderBottom: `1px solid ${gy.split}` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.docs.map((d, i) => {
                const cell: CSSProperties = { padding: '14px 16px', borderBottom: i === view.docs.length - 1 ? 'none' : `1px solid ${gy.split}`, verticalAlign: 'middle' };
                return (
                  <tr key={d.kind}>
                    <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 400 }}>
                      <div style={{ ...text14, fontWeight: 500, color: gy.text }}>{DRAFT_KINDS[d.kind]}.docx</div>
                      <div style={{ ...text13, color: gy.secondary }}>{d.name}</div>
                    </th>
                    <td style={cell}>
                      <div style={{ ...text14, color: gy.text }}>{d.version === 0 ? '生成稿（未修订）' : `修订后的保存稿 · ${d.savedAt ? stamp(d.savedAt) : ''}`}</div>
                      <div style={{ ...text13, color: gy.secondary }}>{reviewLine}</div>
                    </td>
                    <td style={cell}>
                      <span style={{ ...text13, padding: '2px 8px', borderRadius: 4, ...stage.done, background: stage.done.bg }}>Word 已就绪</span>
                    </td>
                    <td style={cell}>
                      <Button type="link" style={{ padding: 0 }} onClick={() => onOpen(d.kind)}>
                        预览 Word
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="发布后会发生什么" style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12, padding: '26px 27px' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>发布后会发生什么</h2>
        <p style={{ ...text14, lineHeight: '26px', margin: 0, color: '#525D70' }}>
          应急预案、风险评估报告和应急资源调查报告将一起定稿存档为{deliveryLabel(view.nextVersion)}。三份 Word 都存好后，任务才变为“已交付”，客户在任务里收到站内提醒。
        </p>
        <p style={{ ...text13, margin: 0, color: gy.secondary }}>
          发布后这批文稿只读；需要更正请发起事实补件，重新生成后再发布为下一个交付版本。Word 文件属性里记有“AI 辅助起草、注册安全工程师审核”和审核人。
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, paddingTop: 24, borderTop: `1px solid ${gy.split}` }}>
          <Button onClick={onEdit}>返回修改</Button>
          <span style={{ flex: 1 }} />
          <span style={{ ...text13, color: gy.secondary }}>
            {view.editable ? (view.canPublish ? '当前客户还不能下载本次稿件' : view.blocker) : '只有负责这个任务的注安师可以发布'}
          </span>
          {view.editable && (
            <Button type="primary" disabled={!view.canPublish} onClick={() => void send(pending?.publishId ?? crypto.randomUUID())}>
              发布三份 Word
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

type Screen = 'confirm' | 'sending' | 'unknown' | 'publishing' | 'failed' | 'done';

function screenOf(v: View, phase: 'idle' | 'sending' | 'unknown'): Screen {
  if (phase === 'sending') return 'sending';
  if (phase === 'unknown') return 'unknown';
  const a = v.attempt;
  if (a?.status === 'publishing') return 'publishing';
  if (a?.status === 'done') return 'done';
  if (a?.status === 'failed') return 'failed';
  return 'confirm';
}

function Crumbs({ taskId, enterpriseName }: { taskId: string; enterpriseName: string }) {
  return (
    <nav aria-label="面包屑" style={{ ...text14, color: gy.secondary }}>
      <Link to="/expert" style={{ color: gy.secondary }}>
        任务中心
      </Link>
      {' / '}
      <Link to={`/expert/tasks/${taskId}`} style={{ color: gy.secondary }}>
        {enterpriseName}
      </Link>
      {' / 成果发布'}
    </nav>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex' }}>
      <span style={{ ...text14, color: gy.secondary, width: 240, flexShrink: 0 }}>{label}</span>
      <span style={{ ...text14, color: gy.text }}>{value}</span>
    </div>
  );
}
