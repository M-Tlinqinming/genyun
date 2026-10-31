import { ArrowLeftOutlined } from '@ant-design/icons';
import {
  awaitingAdoption,
  FACT_SECTIONS,
  figuresView,
  listCounts,
  PRODUCTION_LIST_KEYS,
  PRODUCTION_LISTS,
  productionView,
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
  type ProductionList,
  type RiskRowValue,
  type ScopeGroup,
  type ScopeKey,
} from '@genyun/shared';
import { App, Button, Result, Tooltip } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useContacts } from '../../api/contacts';
import { useGeneration } from '../../api/generation';
import { ApiError } from '../../api/request';
import { useTask, useTaskCheck } from '../../api/tasks';
import { useSaveFact, useSaveFigures, useSaveProduction, useSaveRisk, useSaveScope, useWorkup, workupKey } from '../../api/workup';
import { linkButton, Loading } from '../../components/ui';
import { FadeSwap } from '../../theme/motion';
import { gy, stage } from '../../theme/tokens';
import { ContactDialog, type AskItem } from './workup/ContactDialog';
import { ConfirmView } from './workup/ConfirmView';
import { ContactRecords } from './workup/ContactRecords';
import { FactsPanel, SourceTag, type Editing } from './workup/FactsPanel';
import { FiguresPanel, type FiguresSaveInput } from './workup/FiguresPanel';
import { GenerationView, phaseOf } from './workup/GenerationView';
import { OriginalsPanel, originalTitle } from './workup/OriginalsPanel';
import { ProductionPanel, type ProductionSaveInput } from './workup/ProductionPanel';
import { RiskBasisPanel, RiskPanel } from './workup/RiskPanel';
import { ScopePanel, ScopePreviewPanel } from './workup/ScopePanel';

const STAGES = ['资料核实', '专业编制', '审核与修订', '成果发布'];

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const text13: CSSProperties = { fontSize: 13, lineHeight: '22px' };

function clock(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

// I05 处理工作台 · 专业整理（14 页 E18-00A–D、E18-00F）：左栏整理模块、中栏企业事实 / 生产设备与物料 / 危险源辨识 / 适用范围、
// 右栏原件对照、评价依据或生成结构预览；图件的两张图占中栏和右栏。
// 整理完以后同一页切到确认采用资料（E18-01，?view=confirm）和三份草稿的生成进度（E18-02、E18-02b）：
// 生成过草稿就默认看进度，?view=workup 回到整理
export function ExpertTaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  const workup = useWorkup(taskId);
  const save = useSaveFact(taskId);
  const saveProduction = useSaveProduction(taskId);
  const saveRisk = useSaveRisk(taskId);
  const saveScope = useSaveScope(taskId);
  const saveFigures = useSaveFigures(taskId);
  const contacts = useContacts(taskId);
  const check = useTaskCheck(taskId);
  const generation = useGeneration(taskId);
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [onlyMissing, setOnlyMissing] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // 联系客户对话框：从顶部打开带全部缺失项和客户请求电话联系的项，从某一项「发起补件」只带这一项；
  // 生产设备与物料里的「联系客户」带一个资料项的问题
  const [contact, setContact] = useState<{ keys: string[]; withCalls: boolean; ask?: AskItem } | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<FactSection>('basic');
  // 中栏显示哪个模块：企业事实、生产设备与物料的某一类清单、危险源辨识、适用范围或图件
  const [module, setModule] = useState<'facts' | 'risks' | 'scope' | 'figures' | ProductionList>('facts');
  const [riskId, setRiskId] = useState<string | null>(null);
  const [dimension, setDimension] = useState<RiskDimension>('c');
  const [scopeGroup, setScopeGroup] = useState<ScopeGroup | null>(null);
  const [scopeKey, setScopeKey] = useState<ScopeKey | null>(null);
  const sections = useRef(new Map<FactSection, HTMLElement>());
  const rows = useRef(new Map<string, HTMLElement>());

  const facts = useMemo(
    () => (workup.data ? workupFacts(workup.data.snapshot, workup.data.data) : []),
    [workup.data],
  );
  const progress = useMemo(() => workupProgress(facts), [facts]);
  const production = useMemo(() => (workup.data ? productionView(workup.data.snapshot, workup.data.data) : null), [workup.data]);
  const counts = useMemo(() => (production ? listCounts(production) : null), [production]);
  const risks = useMemo(() => (workup.data ? riskView(workup.data.snapshot, workup.data.data) : null), [workup.data]);
  const scope = useMemo(() => (workup.data ? scopeView(workup.data.snapshot, workup.data.data) : null), [workup.data]);
  const figures = useMemo(() => (workup.data ? figuresView(workup.data.snapshot, workup.data.data) : null), [workup.data]);
  const selectedRisk = risks?.rows.find((r) => r.id === riskId) ?? risks?.rows[0];
  const inProduction = module !== 'facts' && module !== 'risks' && module !== 'scope' && module !== 'figures';
  // 还差的项（底栏与「下一个缺失项」共用，确认生成时后台按同一规则再查一次）
  const { gaps, required } = useMemo(
    () => (workup.data ? workupGaps(workup.data.snapshot, workup.data.data) : { gaps: [], required: 0 }),
    [workup.data],
  );
  const done = required - gaps.length;
  const originals = useMemo(() => workup.data?.originals ?? [], [workup.data]);
  const currentFile = originals.find((o) => o.fileId === fileId) ?? originals[0];
  const awaiting = useMemo(
    () => (workup.data && contacts.data ? awaitingAdoption(contacts.data, workup.data.data) : new Map()),
    [workup.data, contacts.data],
  );
  // 客户请专家电话联系、还没问清的资料项
  const callItems = useMemo(
    () =>
      Object.entries(check.data?.items ?? {})
        .filter(([, s]) => s?.callRequested)
        .map(([k]) => k as ChecklistItemKey),
    [check.data],
  );

  const scrollTo = (el: HTMLElement | undefined) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const goToSection = (section: FactSection) => {
    setModule('facts');
    setActiveSection(section);
    setOnlyMissing(false);
    // 从别的模块切回来时中栏要先渲染出来
    setTimeout(() => sections.current.get(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const showView = (view: 'workup' | 'confirm' | null) => {
    setParams(view ? { view } : {});
    window.scrollTo({ top: 0 });
  };

  const goToNextMissing = () => {
    if (gaps.length === 0) return;
    if (params.get('view')) setParams({});
    const at = gaps.findIndex((g) => g.key === focusKey);
    const next = gaps[at + 1] ?? gaps[0]!;
    setFocusKey(next.key);
    setModule(next.module);
    if (next.section) setActiveSection(next.section);
    if (next.module === 'scope') setScopeGroup(null);
    setTimeout(() => scrollTo(rows.current.get(next.key)), 0);
  };

  const saveJudgement = async (input: ProductionSaveInput) => {
    if (!workup.data) return false;
    try {
      await saveProduction.mutateAsync({ ...input, version: workup.data.version, fileId: currentFile?.fileId } as Parameters<typeof saveProduction.mutateAsync>[0]);
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

  const saveFigureLayout = async (input: FiguresSaveInput) => {
    if (!workup.data) return false;
    try {
      await saveFigures.mutateAsync({ ...input, version: workup.data.version });
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

  const saveFact = async (fact: Fact, value: FactValue | null, mode: Editing['mode'], contactId?: string) => {
    if (!workup.data) return;
    try {
      await save.mutateAsync({
        version: workup.data.version,
        key: fact.key,
        value,
        source: mode,
        fileId: mode === 'expert' && value !== null ? currentFile?.fileId : undefined,
        contactId: value !== null ? contactId : undefined,
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
  if (task.isPending || workup.isPending || generation.isPending) return <Loading rows={6} />;
  if (task.isError) {
    return <Result status="404" title="找不到该任务" subTitle="任务不存在，或没有分派给您。" extra={back} />;
  }
  if (workup.isError) {
    return <Result status="info" title="还不能开始整理" subTitle={workup.error.message} extra={back} />;
  }

  const w = workup.data;
  const current = generation.data?.current ?? null;
  const requested = params.get('view');
  const view = requested === 'confirm' ? 'confirm' : requested !== 'workup' && current ? 'generation' : 'workup';
  const phase = current ? phaseOf(current) : null;

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, margin: '-16px 0 -24px', paddingBottom: 24 }}>
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
            <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => setShowRecords(true)}>
              处理记录{contacts.data?.length ? `（${contacts.data.length}）` : ''}
            </button>
          </div>
        </header>
        {view === 'confirm' ? (
          <ConfirmView
            taskId={taskId}
            workup={w}
            gaps={gaps}
            required={required}
            hasDrafts={current !== null}
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
          />
        )}
        <ContactRecords taskId={taskId} open={showRecords} onClose={() => setShowRecords(false)} />
      </div>
    );
  }

  const saved = w.updatedByName ? `已自动保存 ${clock(w.updatedAt)}` : '还没有修改';
  // 适用范围的待确认开关、待采用的图在底栏各合成一条
  const scopeGaps = gaps.filter((g) => g.module === 'scope').length;
  const figureGaps = gaps.filter((g) => g.module === 'figures').length;
  const missingLabels = [
    ...gaps.filter((g) => g.module !== 'scope' && g.module !== 'figures').map((g) => g.label),
    ...(scopeGaps ? [`适用范围（${scopeGaps} 个开关待确认）`] : []),
    ...(figureGaps ? [`图件（${figureGaps} 张待采用）`] : []),
  ];
  const busy = save.isPending || saveProduction.isPending || saveRisk.isPending || saveScope.isPending || saveFigures.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, margin: '-16px 0 -24px' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <nav aria-label="面包屑" style={{ ...text14, color: gy.secondary }}>
          <Link to="/expert" style={{ color: gy.secondary }}>
            任务中心
          </Link>
          {`　/　${task.data.enterpriseName}　/　专业整理`}
        </nav>
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
          <button
            type="button"
            style={{ ...linkButton, ...text14 }}
            onClick={() => setContact({ keys: progress.missing.map((f) => f.key), withCalls: true })}
          >
            联系客户
          </button>
          <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => setShowRecords(true)}>
            处理记录{contacts.data?.length ? `（${contacts.data.length}）` : ''}
          </button>
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
            title="生产设备与物料"
            sub="8 类清单"
            active={inProduction}
            count={production?.pending.length ? `${production.pending.length} 待确认` : '✓'}
            warn={Boolean(production?.pending.length)}
            onClick={() => setModule('equipment')}
          />
          {inProduction && counts && (
            <div role="list" aria-label="生产设备与物料清单" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px 4px 24px' }}>
              {PRODUCTION_LIST_KEYS.map((key) => {
                const c = counts[key];
                return (
                  <button
                    key={key}
                    type="button"
                    role="listitem"
                    aria-current={module === key ? 'true' : undefined}
                    onClick={() => setModule(key)}
                    style={{ ...linkButton, display: 'flex', justifyContent: 'space-between', width: '100%', ...text13 }}
                  >
                    <span style={{ color: module === key ? gy.primary : gy.text }}>{PRODUCTION_LISTS[key]}</span>
                    <span style={{ color: c.pending ? stage.action.color : gy.secondary }}>{c.pending ? `${c.pending} 待确认` : c.count || '—'}</span>
                  </button>
                );
              })}
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
          <ModuleButton
            title="图件"
            sub="体系图 · 工艺流程图"
            active={module === 'figures'}
            count={figures?.pending.length ? `待采用 ${figures.pending.length}` : '✓'}
            warn={Boolean(figures?.pending.length)}
            onClick={() => setModule('figures')}
          />
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

        {module === 'figures' && figures ? (
          <FiguresPanel
            taskId={taskId}
            view={figures}
            settings={w.data.figures ?? {}}
            saving={saveFigures.isPending}
            onSave={saveFigureLayout}
            onGoOrganization={() => goToSection('organization')}
            onGoProcess={() => setModule('process')}
            registerRow={(key, el) => {
              if (el) rows.current.set(key, el);
              else rows.current.delete(key);
            }}
          />
        ) : module === 'scope' && scope ? (
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
        ) : inProduction ? (
          <ProductionPanel
            snapshot={w.snapshot}
            data={w.data}
            list={module as ProductionList}
            focusKey={focusKey}
            saving={saveProduction.isPending}
            onSave={saveJudgement}
            onOpenFile={setFileId}
            onOpenItem={(itemKey) => {
              const target = originals.find((o) => o.itemKeys.includes(itemKey));
              return target ? () => setFileId(target.fileId) : undefined;
            }}
            onAsk={(ask) => setContact({ keys: [], withCalls: false, ask })}
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
          onEdit={(key, mode, adopt) => {
            setEditing({ key, mode, adopt });
            setFocusKey(key);
          }}
          awaiting={awaiting}
          onContact={(key) => setContact({ keys: [key], withCalls: false })}
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

        {module === 'figures' ? null : module === 'scope' && scope ? (
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
            onJump={setModule}
            originals={originals}
          />
        ) : (
          <OriginalsPanel originals={originals} selectedId={currentFile?.fileId ?? null} onSelect={setFileId} />
        )}
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
          {gaps.length ? `还差 ${gaps.length} 项：${missingLabels.join(' · ')}` : '专业整理的必需项已齐'}
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

      <ContactDialog
        taskId={taskId}
        open={contact !== null}
        onClose={() => setContact(null)}
        facts={facts}
        initialKeys={contact?.keys ?? []}
        callItems={contact?.withCalls ? callItems : []}
        askItems={contact?.ask ? [contact.ask] : []}
      />
      <ContactRecords taskId={taskId} open={showRecords} onClose={() => setShowRecords(false)} />
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