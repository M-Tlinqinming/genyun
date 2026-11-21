import { ArrowLeftOutlined } from '@ant-design/icons';
import {
  FACT_SECTIONS,
  workupStepsDone,
  riskRowValueOf,
  riskView,
  SCOPE_GROUP_KEYS,
  SCOPE_GROUPS,
  scopeView,
  workupFacts,
  workupGaps,
  workupProgress,
  workplacesOf,
  type ChecklistItemKey,
  type Fact,
  type FactSection,
  type FactValue,
  type RiskDimension,
  type RiskRowValue,
  type ScopeGroup,
  type ScopeKey,
} from '@genyun/shared';
import { App, Button, Result, Tooltip } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useGeneration } from '../../api/generation';
import { usePublication } from '../../api/publish';
import { ApiError } from '../../api/request';
import { useTask, useTaskCheck } from '../../api/tasks';
import { useSaveFact, useSaveRisk, useSaveScope, useWorkup, workupKey } from '../../api/workup';
import { linkButton, Loading } from '../../components/ui';
import { FadeSwap } from '../../theme/motion';
import { gy, stage } from '../../theme/tokens';
import { ConfirmView } from './workup/ConfirmView';
import { FactsPanel, SourceTag, type Editing } from './workup/FactsPanel';
import { DeliveredView } from './editing/DeliveredView';
import { ReviewWorkspace } from './editing/ReviewWorkspace';
import { GenerationPage } from './generation/GenerationPage';
import { GenerationView, phaseOf } from './workup/GenerationView';
import { originalTitle } from './workup/OriginalsPanel';
import { RiskBasisPanel, RiskPanel } from './workup/RiskPanel';
import { ScopePanel, ScopePreviewPanel } from './workup/ScopePanel';
import { WorkupWizard } from './workup/wizard/WorkupWizard';

const STAGES = ['资料核实', '专业编制', '审核与修订', '成果交付'];
// 原来整理页里属于向导第 1、2 步的几块
// 属地这一节仍在原来的整理页（第 1 步的弹窗只管应急管理、消防、街道 3 项）
const WIZARD_STEP_OF_SECTION: Partial<Record<FactSection, number>> = { basic: 1, contact: 1, organization: 2, compilation: 2 };
const WIZARD_AGENCY_KEYS = new Set(['agency.emergencyBureau', 'agency.fireDept', 'agency.streetOffice']);
// 生产设备与物料、图件、客户原件已搬到资料核对第 3、4 步：待确认的判断按清单去对应那一步
const WIZARD_STEP_OF_LIST: Record<string, number> = { buildings: 4, fire: 4, supplies: 4, firstAid: 4 };

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const text13: CSSProperties = { fontSize: 13, lineHeight: '22px' };

function clock(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

// I05 处理工作台 · 专业整理（14 页 E18-00A–D）：左栏整理模块、中栏企业事实 / 危险源辨识 / 适用范围、
// 右栏评价依据或生成结构预览（生产设备与物料、图件、客户原件已搬到资料核对第 3、4 步和右栏「客户原表」卡）。
// 整理完以后同一页切到确认采用资料（E18-01，?view=confirm）和三份草稿的生成进度（E18-02、E18-02b）：
// 生成过草稿就默认看进度，?view=workup 回到整理
export function ExpertTaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  const workup = useWorkup(taskId);
  const save = useSaveFact(taskId);
  const saveRisk = useSaveRisk(taskId);
  const saveScope = useSaveScope(taskId);
  const check = useTaskCheck(taskId);
  const generation = useGeneration(taskId);
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  // 已交付页的数据：三份初稿都生成完才问
  const generated = generation.data?.current ?? null;
  const publication = usePublication(taskId, !!generated && phaseOf(generated) === 'done');
  const delivered = publication.data?.delivered ?? null;
  const requestedView = params.get('view');
  // 没交付却带了 ?view=publish：去审核结论页签（不留历史）
  const notDelivered = requestedView === 'publish' && !!publication.data && !delivered;
  useEffect(() => {
    if (notDelivered) setParams({ view: 'edit', tab: 'conclusion' }, { replace: true });
  }, [notDelivered, setParams]);

  const [onlyMissing, setOnlyMissing] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<FactSection>('basic');
  // 中栏显示哪个模块：企业事实、危险源辨识或适用范围（生产设备与物料、图件已搬到资料核对第 3、4 步）
  const [module, setModule] = useState<'facts' | 'risks' | 'scope'>('facts');
  const [riskId, setRiskId] = useState<string | null>(null);
  const [dimension, setDimension] = useState<RiskDimension>('c');
  const [scopeGroup, setScopeGroup] = useState<ScopeGroup | null>(null);
  const [scopeKey, setScopeKey] = useState<ScopeKey | null>(null);
  const sections = useRef(new Map<FactSection, HTMLElement>());
  const rows = useRef(new Map<string, HTMLElement>());

  const facts = useMemo(
    () => (workup.data ? workupFacts(workup.data.snapshot, workup.data.data, workup.data.agencyDistricts) : []),
    [workup.data],
  );
  const progress = useMemo(() => workupProgress(facts), [facts]);
  const risks = useMemo(() => (workup.data ? riskView(workup.data.snapshot, workup.data.data) : null), [workup.data]);
  const scope = useMemo(() => (workup.data ? scopeView(workup.data.snapshot, workup.data.data) : null), [workup.data]);
  const selectedRisk = risks?.rows.find((r) => r.id === riskId) ?? risks?.rows[0];
  // 还差的项（底栏与「下一个缺失项」共用，确认生成时后台按同一规则再查一次）
  const { gaps, required } = useMemo(
    () => (workup.data ? workupGaps(workup.data.snapshot, workup.data.data, workup.data.agencyDistricts) : { gaps: [], required: 0 }),
    [workup.data],
  );
  const done = required - gaps.length;
  const originals = useMemo(() => workup.data?.originals ?? [], [workup.data]);
  const currentFile = originals.find((o) => o.fileId === fileId) ?? originals[0];
  // 客户请专家电话联系、还没问清的资料项
  const callItems = useMemo(
    () =>
      Object.entries(check.data?.items ?? {})
        .filter(([, s]) => s?.callRequested)
        .map(([k]) => k as ChecklistItemKey),
    [check.data],
  );

  // 资料核对第 5 步先用原来的整理页：?view=workup-old&module=… 直接打开对应模块
  const moduleParam = params.get('module');
  useEffect(() => {
    if (!moduleParam) return;
    if (moduleParam === 'risks' || moduleParam === 'scope') {
      setModule(moduleParam as typeof module);
    }
  }, [moduleParam]);

  const scrollTo = (el: HTMLElement | undefined) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // 企业基本信息、人员与应急组织已搬到资料核对第 1、2 步，原来整理页里点到这几处就去向导
  const goToSection = (section: FactSection) => {
    const step = WIZARD_STEP_OF_SECTION[section];
    if (step) {
      setParams({ view: 'workup', step: String(step) });
      return;
    }
    setModule('facts');
    setActiveSection(section);
    setOnlyMissing(false);
    // 从别的模块切回来时中栏要先渲染出来
    setTimeout(() => sections.current.get(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const showView = (view: 'workup' | 'confirm' | 'edit' | null) => {
    setParams(view ? { view } : {});
    window.scrollTo({ top: 0 });
  };

  // 原来的整理页里先轮流跳这页上的缺项；只剩向导第 1、2 步的缺项时回到向导那一步
  const goToNextMissing = () => {
    const wizardStepOf = (g: (typeof gaps)[number]) =>
      WIZARD_AGENCY_KEYS.has(g.key)
        ? 1
        : g.module !== 'facts' && g.module !== 'scope'
          ? (WIZARD_STEP_OF_LIST[g.module] ?? 3)
          : g.section
            ? WIZARD_STEP_OF_SECTION[g.section]
            : undefined;
    const here = gaps.filter((g) => !wizardStepOf(g));
    if (here.length === 0) {
      const step = gaps[0] && wizardStepOf(gaps[0]);
      if (step) setParams({ view: 'workup', step: String(step) });
      return;
    }
    const at = here.findIndex((g) => g.key === focusKey);
    const next = here[at + 1] ?? here[0]!;
    if (params.get('view') !== 'workup-old') setParams({ view: 'workup-old' });
    setFocusKey(next.key);
    setModule(next.module === 'scope' ? 'scope' : 'facts');
    if (next.section) setActiveSection(next.section);
    if (next.module === 'scope') setScopeGroup(null);
    setTimeout(() => scrollTo(rows.current.get(next.key)), 0);
  };

  const saveRiskRow = async (rowId: string, value: RiskRowValue | null) => {
    if (!workup.data) return false;
    try {
      await saveRisk.mutateAsync({ rowId, value, version: workup.data.version, fileId: currentFile?.fileId });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        message.warning(err.message);
        await client.invalidateQueries({ queryKey: workupKey(taskId) });
        return false;
      }
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
      return false;
    }
  };

  const saveSwitch = async (key: ScopeKey, value: boolean | null) => {
    if (!workup.data) return false;
    try {
      await saveScope.mutateAsync({ key, value, version: workup.data.version });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        message.warning(err.message);
        await client.invalidateQueries({ queryKey: workupKey(taskId) });
        return false;
      }
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
      return false;
    }
  };

  // 右栏点了某个开关或某份待定的预案：中栏显示全部并定位到这个开关
  const goToSwitch = (key: ScopeKey) => {
    setScopeGroup(null);
    setScopeKey(key);
    setTimeout(() => scrollTo(rows.current.get(`scope:${key}`)), 0);
  };

  // 点来源标签：右栏打开这一项对应的原件（记下的那份，或这类资料的第一份）
  const sourceHandler = useCallback(
    (fact: Fact) => {
      const target =
        originals.find((o) => o.fileId === fact.fileId) ??
        (fact.itemKey ? originals.find((o) => o.itemKeys.includes(fact.itemKey!)) : undefined);
      if (!target) return undefined;
      return () => {
        setFileId(target.fileId);
        setFocusKey(fact.key);
      };
    },
    [originals],
  );

  const saveFact = async (fact: Fact, value: FactValue | null, mode: Editing['mode']) => {
    if (!workup.data) return;
    try {
      await save.mutateAsync({
        version: workup.data.version,
        key: fact.key,
        value,
        source: mode,
        fileId: mode === 'expert' && value !== null ? currentFile?.fileId : undefined,
      });
      setEditing(null);
      setFocusKey(fact.key);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        message.warning(err.message);
        setEditing(null);
        await client.invalidateQueries({ queryKey: workupKey(taskId) });
        return;
      }
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    }
  };

  const back = (
    <button type="button" style={linkButton} onClick={() => navigate('/expert')}>
      <ArrowLeftOutlined /> 返回任务中心
    </button>
  );
  if (task.isPending || workup.isPending || generation.isPending || publication.isLoading) return <Loading rows={6} />;
  if (task.isError) {
    // 原负责专家打开旧链接：接口说明已改派给谁
    const moved = task.error.message.startsWith('这个任务已改派给');
    return moved ? (
      <Result status="info" title={task.error.message} subTitle="您不用再处理。已整理的内容都随任务交给了对方。" extra={back} />
    ) : (
      <Result status="404" title="找不到该任务" subTitle="任务不存在，或没有分配给您。" extra={back} />
    );
  }
  if (workup.isError) {
    return <Result status="info" title="还不能开始资料核对" subTitle={workup.error.message} extra={back} />;
  }

  const w = workup.data;
  const current = generation.data?.current ?? null;
  const requested = params.get('view');
  // workup = 资料核对向导；workup-old = 原来的整理页（向导第 5 步还在用）
  const view =
    requested === 'confirm'
      ? requested
      : requested === 'workup-old'
        ? 'workup'
        : requested !== 'workup' && current
          ? 'generation'
          : 'wizard';
  const phase = current ? phaseOf(current) : null;

  // 已交付（15 页 R11）：没带 view 或 ?view=publish 时看已交付页；看正文照样进核对定稿（只读）
  if (delivered && current && (requested === null || requested === 'publish')) {
    return <DeliveredView taskId={taskId} enterpriseName={task.data.enterpriseName} taskNumber={task.data.number} view={publication.data!} />;
  }
  if (notDelivered) return <Loading rows={6} />;

  // 核对定稿（E18-03 到 E18-15）：三份草稿都生成完才进得来；旧网址 ?view=review 打开审核结论页签
  if ((requested === 'edit' || requested === 'review') && current && phaseOf(current) === 'done') {
    return <ReviewWorkspace taskId={taskId} enterpriseName={task.data.enterpriseName} taskNumber={task.data.number} generation={current} />;
  }

  // 生成初稿（E18-02）：网址是 ?view=generation、并且有一批初稿时
  if (requested === 'generation' && current) {
    return (
      <GenerationPage
        taskId={taskId}
        enterpriseName={task.data.enterpriseName}
        taskNumber={task.data.number}
        generation={current}
        onStartReview={() => setParams({ view: 'edit' })}
      />
    );
  }

  if (view === 'wizard') {
    return <WorkupWizard taskId={taskId} enterpriseName={task.data.enterpriseName} workup={w} />;
  }

  if (view !== 'workup') {
    const chip =
      view === 'confirm'
        ? gaps.length
          ? { text: `整理中 · 必需项 ${done} / ${required}`, ...stage.action }
          : { text: '整理完成 · 待采用', ...stage.action }
        : phase === 'running'
          ? { text: '生成中', color: gy.primary, bg: gy.selected }
          : phase === 'failed'
            ? { text: '生成部分失败', ...stage.error }
            : { text: '草稿已生成', ...stage.done };
    return (
      <div className="gy-wide-workbench" style={{ display: 'flex', flexDirection: 'column', gap: 24, margin: '-16px 0 -24px', paddingBottom: 24 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <nav aria-label="面包屑" style={{ ...text14, color: gy.secondary }}>
            <Link to="/expert" style={{ color: gy.secondary }}>
              任务中心
            </Link>
            {`　/　${task.data.enterpriseName}　/　${view === 'confirm' ? '确认采用资料' : '生成草稿'}`}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, lineHeight: '32px', color: gy.text }}>{task.data.enterpriseName}</h1>
            <span style={{ ...text14, color: gy.secondary }}>{task.data.number}</span>
            <span style={{ flex: 1 }} />
            <span role="status" style={{ ...text14, padding: '2px 10px', borderRadius: 4, background: chip.bg, color: chip.color }}>
              {chip.text}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '0 0 12px', borderBottom: `1px solid ${gy.split}` }}>
            <ol aria-label="处理阶段" style={{ display: 'flex', gap: 28, flex: 1, margin: 0, padding: 0, listStyle: 'none' }}>
              {STAGES.map((s, i) => {
                const at = view === 'confirm' ? 0 : 1;
                return (
                  <li key={s} aria-current={i === at ? 'step' : undefined} style={{ ...text14, color: i === at ? gy.primary : gy.secondary }}>
                    {i + 1}　{s}
                  </li>
                );
              })}
            </ol>
          </div>
        </header>
        {view === 'confirm' ? (
          <ConfirmView
            taskId={taskId}
            workup={w}
            gaps={gaps}
            required={required}
            hasDrafts={current !== null}
            editedSections={current?.editedSections ?? 0}
            onBackToWorkup={() => showView('workup')}
            onNextMissing={goToNextMissing}
            onStarted={() => showView(null)}
          />
        ) : (
          <GenerationView
            taskId={taskId}
            taskNumber={task.data.number}
            generation={current!}
            onBackToCenter={() => navigate('/expert')}
            onBackToWorkup={() => showView('workup')}
            onEdit={() => showView('edit')}
          />
        )}
      </div>
    );
  }

  const saved = w.updatedByName ? `已自动保存 ${clock(w.updatedAt)}` : '还没有修改';
  // 适用范围的待确认开关、待采用的图在底栏各合成一条
  const scopeGaps = gaps.filter((g) => g.module === 'scope').length;
  const missingLabels = [
    ...gaps.filter((g) => g.module !== 'scope').map((g) => g.label),
    ...(scopeGaps ? [`适用范围（${scopeGaps} 个开关待确认）`] : []),
  ];
  const busy = save.isPending || saveRisk.isPending || saveScope.isPending;

  return (
    <div className="gy-wide-workbench" style={{ display: 'flex', flexDirection: 'column', gap: 16, margin: '-16px 0 -24px' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <nav aria-label="面包屑" style={{ ...text14, color: gy.secondary }}>
          <Link to="/expert" style={{ color: gy.secondary }}>
            任务中心
          </Link>
          {`　/　${task.data.enterpriseName}　/　资料核对`}
        </nav>
        <div
          role="note"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderRadius: 8, background: gy.selected, ...text14, color: gy.text }}
        >
          <span style={{ flex: 1 }}>资料核对第 5 步正在换新样式，这里是原来的整理页</span>
          <Link to={`?view=workup&step=${Math.min(Math.max(workupStepsDone(w.data) + 1, 3), 5)}`} style={{ color: gy.primary }}>
            回到资料核对
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, lineHeight: '32px', color: gy.text }}>{task.data.enterpriseName}</h1>
          <span style={{ ...text14, color: gy.secondary }}>{task.data.number}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...text14, padding: '2px 10px', borderRadius: 4, background: stage.action.bg, color: stage.action.color }}>
            整理中 · 必需项 {done} / {required}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '0 0 12px', borderBottom: `1px solid ${gy.split}` }}>
          <ol aria-label="处理阶段" style={{ display: 'flex', gap: 28, flex: 1, margin: 0, padding: 0, listStyle: 'none' }}>
            {STAGES.map((s, i) => (
              <li key={s} aria-current={i === 1 ? 'step' : undefined} style={{ ...text14, color: i === 1 ? gy.primary : gy.secondary }}>
                {i + 1}　{s}
              </li>
            ))}
          </ol>
          {callItems.length > 0 && <span style={{ ...text13, color: stage.action.color }}>客户请专家电话联系 {callItems.length} 项</span>}
        </div>
      </header>

      <div style={{ display: 'flex', gap: 16, height: 640 }}>
        <nav
          aria-label="整理模块"
          style={{
            width: 200,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '12px 8px',
            background: gy.surface,
            border: `1px solid ${gy.split}`,
            borderRadius: 8,
          }}
        >
          <div style={{ padding: '4px 12px 8px', fontSize: 13, lineHeight: '20px', color: gy.secondary }}>整理模块</div>
          <ModuleButton
            title="企业事实"
            sub="基本信息 · 属地 · 组织"
            active={module === 'facts'}
            count={`${progress.done} / ${progress.required}`}
            warn={progress.missing.length > 0}
            onClick={() => goToSection('basic')}
          />
          {module === 'facts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px 4px 24px' }}>
              {progress.sections.map((s) => (
                <button
                  key={s.section}
                  type="button"
                  onClick={() => goToSection(s.section)}
                  style={{ ...linkButton, display: 'flex', justifyContent: 'space-between', width: '100%', ...text13 }}
                >
                  <span style={{ color: s.section === activeSection ? gy.primary : gy.text }}>{FACT_SECTIONS[s.section]}</span>
                  <span style={{ color: s.missing ? stage.action.color : stage.done.color }}>{s.missing ? `缺 ${s.missing}` : '✓'}</span>
                </button>
              ))}
            </div>
          )}
          <ModuleButton
            title="危险源辨识"
            sub="LEC · LSR 法风险评价"
            active={module === 'risks'}
            count={`${risks?.rows.filter((r) => !r.excluded).length ?? 0} 项`}
            warn={false}
            onClick={() => setModule('risks')}
          />
          {module === 'risks' && risks && (
            <div role="list" aria-label="按作业场所" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px 4px 24px' }}>
              {risks.places.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  role="listitem"
                  onClick={() => {
                    const first = risks.rows.find((r) => !r.excluded && workplacesOf(r.workplace).includes(p.name));
                    if (!first) return;
                    setRiskId(first.id);
                    setTimeout(() => scrollTo(rows.current.get(first.id)), 0);
                  }}
                  style={{ ...linkButton, display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', ...text13 }}
                >
                  <span style={{ color: selectedRisk && workplacesOf(selectedRisk.workplace).includes(p.name) ? gy.primary : gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <span style={{ color: gy.secondary }}>{p.count}</span>
                </button>
              ))}
            </div>
          )}
          <ModuleButton
            title="适用范围"
            sub="决定预案章节"
            active={module === 'scope'}
            count={scope?.pending.length ? `待确认 ${scope.pending.length}` : '✓'}
            warn={Boolean(scope?.pending.length)}
            onClick={() => {
              setModule('scope');
              setScopeGroup(null);
            }}
          />
          {module === 'scope' && scope && (
            <div role="list" aria-label="适用范围分组" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px 4px 24px' }}>
              {SCOPE_GROUP_KEYS.map((g) => {
                const items = scope.switches.filter((s) => s.group === g);
                const waiting = items.filter((s) => s.status === 'pending').length;
                const answered = items.every((s) => s.suggestion.basis === 'answer' && !s.judged);
                return (
                  <button
                    key={g}
                    type="button"
                    role="listitem"
                    aria-current={scopeGroup === g ? 'true' : undefined}
                    onClick={() => setScopeGroup(scopeGroup === g ? null : g)}
                    style={{ ...linkButton, display: 'flex', justifyContent: 'space-between', width: '100%', ...text13 }}
                  >
                    <span style={{ color: scopeGroup === g ? gy.primary : gy.text }}>{SCOPE_GROUPS[g]}</span>
                    <span style={{ color: waiting ? stage.action.color : stage.done.color }}>
                      {waiting ? `${waiting} 待确认` : answered ? '客户已答' : '✓'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderTop: `1px solid ${gy.split}` }}>
            <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>来源图例</span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <SourceTag kind="original" />
              <SourceTag kind="expert" />
              <SourceTag kind="system" />
              <SourceTag kind="customer" />
            </span>
          </div>
        </nav>

        {module === 'scope' && scope ? (
          <ScopePanel
            view={scope}
            group={scopeGroup}
            onShowAll={() => setScopeGroup(null)}
            selectedKey={scopeKey}
            onSelect={setScopeKey}
            saving={saveScope.isPending}
            onSave={saveSwitch}
            registerRow={(key, el) => {
              if (el) rows.current.set(key, el);
              else rows.current.delete(key);
            }}
          />
        ) : module === 'risks' && risks ? (
          <RiskPanel
            view={risks}
            selectedId={selectedRisk?.id ?? null}
            onSelect={setRiskId}
            dimension={dimension}
            onDimension={setDimension}
            saving={saveRisk.isPending}
            onSave={saveRiskRow}
            registerRow={(key, el) => {
              if (el) rows.current.set(key, el);
              else rows.current.delete(key);
            }}
          />
        ) : (
        <FactsPanel
          facts={facts}
          onlyMissing={onlyMissing}
          onOnlyMissingChange={setOnlyMissing}
          focusKey={focusKey}
          editing={editing}
          onEdit={(key, mode) => {
            setEditing({ key, mode });
            setFocusKey(key);
          }}
          onCancelEdit={() => setEditing(null)}
          onSave={saveFact}
          onSourceClick={sourceHandler}
          originalName={currentFile ? originalTitle(currentFile) : undefined}
          saving={save.isPending}
          registerSection={(section, el) => {
            if (el) sections.current.set(section, el);
            else sections.current.delete(section);
          }}
          registerRow={(key, el) => {
            if (el) rows.current.set(key, el);
            else rows.current.delete(key);
          }}
        />
        )}

        {module === 'scope' && scope ? (
          <ScopePreviewPanel view={scope} onSelect={goToSwitch} />
        ) : module === 'risks' ? (
          <RiskBasisPanel
            row={selectedRisk}
            dimension={dimension}
            saving={saveRisk.isPending}
            onPick={(key, value) => {
              if (!selectedRisk) return;
              void saveRiskRow(selectedRisk.id, { ...riskRowValueOf(selectedRisk), [key]: value });
            }}
            onJump={(list) => setParams({ view: 'workup', step: String(WIZARD_STEP_OF_LIST[list] ?? 3) })}
            originals={originals}
          />
        ) : null}
      </div>

      <section
        aria-label="整理进度"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 20px',
          background: gy.surface,
          border: `1px solid ${gy.split}`,
          borderRadius: 8,
        }}
      >
        <span role="status" style={{ fontSize: 13, lineHeight: '20px', color: w.updatedByName ? stage.done.color : gy.secondary }}>
          <FadeSwap id={busy ? 'saving' : saved}>{busy ? '保存中…' : w.updatedByName ? `✓ ${saved}` : saved}</FadeSwap>
        </span>
        <span style={{ width: 1, height: 16, background: gy.split }} />
        <span style={{ flex: 1, minWidth: 0, ...text14, color: gy.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {gaps.length ? `还差 ${gaps.length} 项：${missingLabels.join(' · ')}` : '资料核对的必需项已齐'}
        </span>
        <Button onClick={goToNextMissing} disabled={gaps.length === 0}>
          下一个缺失项
        </Button>
        {current && phase !== 'done' ? (
          <Tooltip title="三份草稿正在生成或有失败的份，先去看生成进度">
            <Button type="primary" onClick={() => showView(null)}>
              查看生成进度
            </Button>
          </Tooltip>
        ) : (
          <Button type="primary" onClick={() => showView('confirm')}>
            完成整理，去核对
          </Button>
        )}
      </section>

    </div>
  );
}

// 左栏一个整理模块：名称、计数与一句说明
function ModuleButton({
  title,
  sub,
  active,
  count,
  warn,
  onClick,
}: {
  title: string;
  sub: string;
  active: boolean;
  count: string;
  warn: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      style={{
        ...linkButton,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 12px',
        borderRadius: 6,
        background: active ? gy.selected : 'none',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ ...text14, fontWeight: active ? 500 : 400, color: active ? gy.primary : gy.text }}>{title}</span>
        <span style={{ ...text13, color: warn ? stage.action.color : stage.done.color }}>{count}</span>
      </span>
      {active && <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>{sub}</span>}
    </button>
  );
}