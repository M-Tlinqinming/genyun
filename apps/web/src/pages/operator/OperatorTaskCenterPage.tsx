import { OPERATOR_TASK_STAGES, type OperatorTaskStage } from '@genyun/shared';
import { Button, Empty, Input, Skeleton } from 'antd';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useOperatorTask, useOperatorTasks, type OperatorTask } from '../../api/operator';
import { PageHeader } from '../../components/PageHeader';
import { Loading, Notice, panel } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';
import { AssignExpertModal } from './AssignExpertModal';
import { businessShort, monthDay, monthDayTime, submittedLine, taskTitle } from './taskCenterText';

type Tab = 'unassigned' | 'all';

const body = { fontSize: 14, lineHeight: '22px', color: gy.text } as const;
const small = { fontSize: 12, lineHeight: '20px', color: gy.tertiary } as const;
const caption = { fontSize: 13, lineHeight: '20px', color: gy.tertiary } as const;

const STAGE_TONE: Record<OperatorTaskStage, { color: string; bg: string }> = {
  preparing: stage.progress,
  unassigned: stage.error,
  drafting: stage.action,
  delivered: stage.done,
};

function Pill({ tone, children }: { tone: { color: string; bg: string }; children: ReactNode }) {
  return (
    <span style={{ ...small, color: tone.color, background: tone.bg, borderRadius: 4, padding: '0 8px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

const stageLabel = (t: OperatorTask) => (t.needsAssignment ? '待分派' : OPERATOR_TASK_STAGES[t.stage]);

// 列表第二行：「编制应急预案 · 新提交 · 未分派专家」「编制应急预案 · 负责专家 周工」
function rowLine(t: OperatorTask): string {
  const who = t.assignedExpertName ? `负责专家 ${t.assignedExpertName}` : t.needsAssignment ? '新提交 · 未分派专家' : '客户准备资料中';
  return `${businessShort(t)} · ${who}`;
}

function TaskRow({ task: t, selected, onSelect }: { task: OperatorTask; selected: boolean; onSelect: () => void }) {
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
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <span style={{ ...body, fontWeight: selected ? 500 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.enterpriseName}
          </span>
          <span style={{ ...small, flexShrink: 0 }}>{t.submittedAt ? monthDayTime(t.submittedAt) : `${monthDay(t.createdAt)} 创建`}</span>
        </span>
        <span style={{ ...caption, color: gy.secondary }}>{rowLine(t)}</span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill tone={STAGE_TONE[t.needsAssignment ? 'unassigned' : t.stage]}>{stageLabel(t)}</Pill>
          <Pill tone={stage.progress}>{t.orgName}</Pill>
        </span>
      </button>
    </li>
  );
}

function Section({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px 0', ...style }}>
      <h3 style={{ ...caption, margin: 0, fontWeight: 400 }}>{title}</h3>
      {children}
    </section>
  );
}

function Reason({ title, text, tone = 'warning' }: { title: ReactNode; text: ReactNode; tone?: 'warning' | 'neutral' }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '14px 16px',
        borderRadius: 8,
        background: tone === 'warning' ? gy.warningBg : gy.neutralBg,
      }}
    >
      <span style={{ ...body, fontWeight: 500 }}>{title}</span>
      <span style={{ ...caption, color: gy.secondary }}>{text}</span>
    </div>
  );
}

// 右侧：选中任务的情况和操作（Paper I04 右栏；分派用同一个面板）
function TaskPanel({ taskId, onAssign }: { taskId: string; onAssign: (t: OperatorTask) => void }) {
  const detail = useOperatorTask(taskId);
  if (detail.isPending) {
    return (
      <div style={{ ...panel, padding: 24 }} aria-busy="true" aria-label="正在加载">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div style={{ ...panel, padding: 24 }}>
        <Notice
          tone="warning"
          title="这个任务暂时打不开"
          text={detail.error.message}
          action={<Button onClick={() => void detail.refetch()}>重新加载</Button>}
        />
      </div>
    );
  }
  const t = detail.data;
  const canAssign = t.assignBlockedReason === null;
  return (
    <section aria-label="任务详情" style={{ ...panel, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: '20px 24px',
          borderBottom: `1px solid ${gy.split}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <h2 style={{ fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.text, margin: 0 }}>{taskTitle(t)}</h2>
          <span style={small}>
            {t.number} · {t.assignedExpertName ? `负责专家 ${t.assignedExpertName}` : '未分派专家'} · 客户组织：
            <Link to={`/operator/organizations/${t.orgId}`} style={{ color: gy.tertiary, textDecoration: 'underline' }}>
              {t.orgName}
            </Link>
          </span>
        </div>
        <Pill tone={STAGE_TONE[t.needsAssignment ? 'unassigned' : t.stage]}>{stageLabel(t)}</Pill>
      </header>

      {t.needsAssignment ? (
        <Section title="为什么出现在这里">
          <Reason
            title={`客户 ${t.submittedAt ? monthDay(t.submittedAt) : ''} 提交了资料，还没有负责专家`}
            text="分派后，任务进入专家的任务中心，专家从专业整理开始；客户在任务页看到负责专家。"
          />
        </Section>
      ) : t.assignedExpertName ? (
        <Section title="当前负责">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              aria-hidden
              style={{ width: 32, height: 32, borderRadius: 16, background: '#F2F4F7', textAlign: 'center', ...body, color: gy.secondary, lineHeight: '32px' }}
            >
              {t.assignedExpertName.slice(0, 1)}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={body}>{t.assignedExpertName}</span>
              <span style={{ ...small, color: gy.secondary }}>
                专业整理{t.workupStartedAt ? `已开始（${monthDay(t.workupStartedAt)} 更新）` : '还没开始'} · 联系记录 {t.contactCount} 条
              </span>
            </span>
          </div>
          {canAssign && (
            <span style={{ ...caption, color: gy.secondary }}>
              专家请假或忙不过来时可以改派：已整理内容和联系记录全部带给新专家，客户页面自动换成新负责人。
            </span>
          )}
        </Section>
      ) : null}

      {!canAssign && (
        <Section title="现在不用分派">
          <Reason tone="neutral" title={t.assignBlockedReason} text={t.stage === 'preparing' ? '客户提交资料后，任务会出现在「待分派」。' : '已交付的任务保留原负责专家。'} />
        </Section>
      )}

      <Section title="基本信息" style={{ paddingBottom: 24 }}>
        <dl style={{ display: 'grid', gridTemplateColumns: '96px 1fr', rowGap: 8, margin: 0, ...caption, color: gy.secondary }}>
          <dt>任务</dt>
          <dd style={{ margin: 0, color: gy.text }}>{t.name}</dd>
          <dt>所在地区</dt>
          <dd style={{ margin: 0, color: gy.text }}>{t.orgRegion ?? '—'}</dd>
          <dt>提交资料</dt>
          <dd style={{ margin: 0, color: gy.text }}>{t.submittedAt ? monthDayTime(t.submittedAt) : '还没提交'}</dd>
        </dl>
      </Section>

      {canAssign && (
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 24px', borderTop: `1px solid ${gy.split}`, marginTop: 'auto' }}>
          <Button type="primary" onClick={() => onAssign(t)}>
            {t.assignedExpertId ? '改派其他专家' : '分配专业人员'}
          </Button>
        </footer>
      )}
    </section>
  );
}

// 运营任务中心（Paper 16 页「I04 任务中心 · 运营」）：这一项做「待分派」「全部任务」；超时兜底、上门工单在第 4 项
export function OperatorTaskCenterPage() {
  const tasks = useOperatorTasks();
  const [params, setParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [assigning, setAssigning] = useState<OperatorTask | null>(null);
  const linked = params.get('task');

  const unassigned = useMemo(() => (tasks.data ?? []).filter((t) => t.needsAssignment), [tasks.data]);
  // 从组织详情点进来带着任务时，直接看全部任务；否则有待分派就先看待分派
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const tab: Tab = tabChoice ?? (linked && !unassigned.some((t) => t.id === linked) ? 'all' : unassigned.length > 0 || !tasks.data ? 'unassigned' : 'all');

  const shown = useMemo(() => {
    const list = tab === 'unassigned' ? unassigned : (tasks.data ?? []);
    const k = keyword.trim().toLowerCase();
    if (!k) return list;
    return list.filter((t) => [t.enterpriseName, t.number, t.orgName].some((s) => s.toLowerCase().includes(k)));
  }, [tab, unassigned, tasks.data, keyword]);

  const selectedId = shown.some((t) => t.id === linked) ? linked : (shown[0]?.id ?? null);
  const select = (id: string) => setParams({ task: id }, { replace: true });

  const header = (
    <PageHeader
      eyebrow="耕云运营 / 任务中心"
      title="任务中心"
      description="运营只做三件事：分派负责专家、处理上门工单、兜底超时任务。客户补充由负责专家直接联系，不经运营转话。"
    />
  );

  if (tasks.isPending) {
    return (
      <>
        {header}
        <Loading rows={6} />
      </>
    );
  }
  if (tasks.isError) {
    return (
      <>
        {header}
        <Notice
          tone="warning"
          title="任务列表暂时打不开"
          text={tasks.error.message}
          action={<Button onClick={() => void tasks.refetch()}>重新加载</Button>}
        />
      </>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'unassigned', label: `待分派 ${unassigned.length}` },
    { key: 'all', label: '全部任务' },
  ];

  return (
    <>
      {header}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
        <div style={{ ...panel, width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div role="tablist" aria-label="任务分类" style={{ display: 'flex', gap: 24, padding: '0 20px', borderBottom: `1px solid ${gy.split}` }}>
            {tabs.map(({ key, label }) => {
              const on = key === tab;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTabChoice(key)}
                  style={{
                    ...body,
                    color: on ? gy.primary : gy.secondary,
                    fontWeight: on ? 500 : 400,
                    padding: on ? '12px 0 10px' : '12px 0',
                    border: 'none',
                    borderBottom: on ? `2px solid ${gy.primary}` : 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {tab === 'all' && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #EEF0F3' }}>
              <Input.Search allowClear placeholder="企业 / 任务编号 / 客户组织" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
          )}
          {shown.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ padding: '24px 20px' }}
              description={
                keyword.trim() && tab === 'all'
                  ? '没有符合条件的任务'
                  : tab === 'unassigned'
                    ? '现在没有待分派的任务。客户提交资料后会出现在这里。'
                    : '还没有客户任务'
              }
            />
          ) : (
            <ul role="tabpanel" aria-label={tab === 'unassigned' ? '待分派' : '全部任务'} style={{ margin: 0, padding: 0, maxHeight: 640, overflowY: 'auto' }}>
              {shown.map((t) => (
                <TaskRow key={t.id} task={t} selected={t.id === selectedId} onSelect={() => select(t.id)} />
              ))}
            </ul>
          )}
          <p style={{ ...small, margin: 0, padding: '14px 20px' }}>
            只列需要运营介入的任务；正常进行中的客户沟通由专家自己处理，运营不经手。
          </p>
        </div>
        {selectedId ? (
          <TaskPanel key={selectedId} taskId={selectedId} onAssign={setAssigning} />
        ) : (
          <div style={{ ...panel, flex: 1, padding: 48, textAlign: 'center', ...caption }}>从左侧选一个任务查看</div>
        )}
      </div>
      {assigning && <AssignExpertModal task={assigning} onClose={() => setAssigning(null)} />}
    </>
  );
}
