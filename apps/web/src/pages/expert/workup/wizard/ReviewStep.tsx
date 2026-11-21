import { ExclamationCircleFilled, PlusOutlined } from '@ant-design/icons';
import {
  basicStepView,
  currentGaps,
  customerGapCount,
  customerGaps,
  expertEditCounts,
  LEC_KEYS,
  LEC_OPTIONS,
  majorHazardFinal,
  majorHazardOverrideSchema,
  missingContactOf,
  missingItemsOf,
  organizationStepView,
  productionView,
  resourcesStepView,
  reviewPeopleOf,
  reviewSchema,
  riskLevel,
  riskRowValueOf,
  riskScore,
  riskView,
  scopeGroupsOf,
  systemMajorHazard,
  companyNameInputOf,
  workupGaps,
  type MajorHazardOverride,
  type ReviewData,
  type RiskRow,
  type RiskRowValue,
  type ScopeKey,
  type ScopeSwitch,
} from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, AutoComplete, Button, Input, Modal, Select } from 'antd';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { generationKey, materialsKey, useConfirmGeneration, useGeneration, useMaterials } from '../../../../api/generation';
import { useIntake } from '../../../../api/intake';
import { ApiError } from '../../../../api/request';
import { useCopyMissingList, useSaveReviewStep, useSaveRisk, useSaveScope, workupKey, type Workup } from '../../../../api/workup';
import { SourceTag } from '../../../../components/SourceTag';
import { linkButton } from '../../../../components/ui';
import { useMissingCopy } from '../../../../components/useMissingCopy';
import { gy, source, stage, type, weight } from '../../../../theme/tokens';
import { MissingDrawer } from '../MissingList';
import { Card, caption, clockOf, dayOf, Field, LockNote, MissingTag, Row, SideCard, StepTitle, UseCard } from './parts';
import type { StepProps } from './types';

// 资料核对第 5 步「核对并生成」（Paper 13 页 E2-5a、E2-5b、E2-5c）：
// 第 1 页补上只有专家能定的专业项（预案编号与经费、适用范围、危险源辨识、重大危险源），都不挡生成；
// 第 2 页核对四步的摘要，门槛齐了才能「确认资料并生成初稿」，缺的可以复制缺项清单发给客服。

export function ReviewStep(props: StepProps) {
  return props.page === 2 ? <ReviewPage2 {...props} /> : <ReviewPage1 {...props} />;
}

const btnOn = (on: boolean): CSSProperties =>
  on ? { background: gy.primary, borderColor: gy.primary, color: gy.surface } : { background: gy.surface, color: gy.text };

// ---------- 第 1 页 ----------

function ReviewPage1({ taskId, workup, autosave, customerText, frame, onGo, latestVersion }: StepProps) {
  const { message } = App.useApp();
  const saveReview = useSaveReviewStep(taskId);
  const saveScope = useSaveScope(taskId);
  const saveRisk = useSaveRisk(taskId);
  const people = useMemo(() => reviewPeopleOf(workup.snapshot, workup.data), [workup.snapshot, workup.data]);
  const system = useMemo(() => systemMajorHazard(workup.snapshot, workup.data), [workup.snapshot, workup.data]);
  const saved = workup.data.review ?? {};
  // 预案编号没填过：用系统建议预填（存的时候一起存上）
  const [form, setForm] = useState<ReviewData>(() => ({ ...saved, planCode: saved.planCode ?? (workup.planCodeSuggestion || undefined) }));
  // 重大危险源：没改过时跟着系统算的
  const [hazard, setHazard] = useState<MajorHazardOverride | null>(() => saved.majorHazard ?? null);
  const ref = useRef({ form, hazard });
  const savedRef = useRef<string>('');

  const hazardError = (h: MajorHazardOverride | null): string | null => {
    if (!h || h.value === system.conclusion) return null;
    const r = majorHazardOverrideSchema.safeParse(h);
    return r.success ? null : (r.error.issues[0]?.message ?? '内容不正确');
  };
  const payload = () => {
    const { form: f, hazard: h } = ref.current;
    const review: ReviewData = { ...f };
    if (h && h.value !== system.conclusion && !hazardError(h)) review.majorHazard = h;
    else if (h && h.value !== system.conclusion && saved.majorHazard) review.majorHazard = saved.majorHazard;
    else delete review.majorHazard;
    return review;
  };
  const run = async (stepsDone?: number) => {
    const review = payload();
    const parsed = reviewSchema.safeParse(review);
    if (!parsed.success) return;
    const sig = JSON.stringify(review);
    if (sig === savedRef.current && !stepsDone) return;
    await saveReview.mutateAsync({ version: latestVersion(), review, ...(stepsDone ? { stepsDone } : {}) });
    savedRef.current = sig;
  };
  const change = (patch: Partial<ReviewData>) => {
    const next = { ...ref.current.form, ...patch };
    ref.current = { ...ref.current, form: next };
    setForm(next);
    autosave.schedule(() => run());
  };
  const changeHazard = (h: MajorHazardOverride | null) => {
    ref.current = { ...ref.current, hazard: h };
    setHazard(h);
    autosave.schedule(() => run());
  };

  const enqueue = (task: () => Promise<unknown>) =>
    autosave.flush(async () => {
      await run();
      await task();
    });

  const next = async () => {
    const err = hazardError(ref.current.hazard);
    if (err) {
      message.warning(`重大危险源：${err}`);
      return;
    }
    const fieldErr = reviewSchema.safeParse(payload());
    if (!fieldErr.success) {
      message.warning(fieldErr.error.issues[0]?.message ?? '内容不正确');
      return;
    }
    const ok = await autosave.flush(() => run((workup.data.stepsDone ?? 0) < 5 ? 5 : undefined));
    if (ok) onGo(5, 2);
  };

  const planSource = (key: keyof ReviewData, value: string | undefined) =>
    !value ? <MissingTag /> : key === 'planCode' && value === workup.planCodeSuggestion && !saved.planCode ? <SourceTag kind="system" text="系统带出" /> : <SourceTag kind="expert" text="您已填写" />;
  const personOptions = people.map((p) => ({ value: p.id, label: [p.name, p.position].filter(Boolean).join(' · ') }));
  const fieldError = (k: keyof ReviewData) => {
    const r = reviewSchema.shape[k].safeParse(form[k]);
    return r.success ? null : (r.error.issues[0]?.message ?? null);
  };

  const main = (
    <>
      <StepTitle
        title="补上只有您能定的专业项"
        sub="预案编号、应急经费和责任人、适用范围、危险源辨识，客户填不了。系统已按前四步的资料预填，请您逐项确认；第 3 步已经答过的判断这里直接带入，不再问一遍。确认完进最后一页核对并生成。"
        customerText={customerText}
        expertOnly
      />
      <Card title="预案编号与应急经费" tag={<SourceTag kind="expert" text="只有专家能填" />} hint="写在预案封面和「应急保障」一节，客户表格里不收这几项。">
        <Row>
          <Field label="预案编号" tag={planSource('planCode', form.planCode)} hint="按「字号拼音首字母 + 编制年份」预填，可直接改" error={fieldError('planCode')}>
            <Input aria-label="预案编号" value={form.planCode ?? ''} maxLength={30} onChange={(e) => change({ planCode: e.target.value })} />
          </Field>
          <Field label="应急经费（每年）" tag={planSource('emergencyBudget', form.emergencyBudget)} hint="由您填写，系统不预填" error={fieldError('emergencyBudget')}>
            <Input aria-label="应急经费（每年）" suffix="万元" value={form.emergencyBudget ?? ''} onChange={(e) => change({ emergencyBudget: e.target.value })} />
          </Field>
        </Row>
        <Row>
          <Field label="经费牵头部门" tag={planSource('fundingDepartment', form.fundingDepartment)} hint="负责申请和安排应急经费的部门" error={fieldError('fundingDepartment')}>
            <Input aria-label="经费牵头部门" value={form.fundingDepartment ?? ''} maxLength={30} onChange={(e) => change({ fundingDepartment: e.target.value })} />
          </Field>
          <Field label="培训演练经费（每年）" tag={planSource('trainingBudget', form.trainingBudget)} hint="应急经费里用于培训和演练的那部分" error={fieldError('trainingBudget')}>
            <Input aria-label="培训演练经费（每年）" suffix="万元" value={form.trainingBudget ?? ''} onChange={(e) => change({ trainingBudget: e.target.value })} />
          </Field>
        </Row>
        <Row>
          <Field label="经费台账负责人" tag={planSource('ledgerOwnerId', form.ledgerOwnerId)} hint="从第 2 步的人员里选">
            <Select
              aria-label="经费台账负责人"
              allowClear
              placeholder="选择人员"
              options={personOptions}
              value={people.some((p) => p.id === form.ledgerOwnerId) ? form.ledgerOwnerId : undefined}
              onChange={(v) => change({ ledgerOwnerId: v ?? undefined })}
              style={{ width: '100%' }}
            />
          </Field>
          <Field label="培训档案归档人" tag={planSource('archiverId', form.archiverId)} hint="从第 2 步的人员里选">
            <Select
              aria-label="培训档案归档人"
              allowClear
              placeholder="选择人员"
              options={personOptions}
              value={people.some((p) => p.id === form.archiverId) ? form.archiverId : undefined}
              onChange={(v) => change({ archiverId: v ?? undefined })}
              style={{ width: '100%' }}
            />
          </Field>
        </Row>
      </Card>
      <ScopeCard workup={workup} onGo={onGo} save={(key, value) => enqueue(() => saveScope.mutateAsync({ version: latestVersion(), key, value }))} />
      <RiskCard workup={workup} save={(rowId, value) => enqueue(() => saveRisk.mutateAsync({ version: latestVersion(), rowId, value }))} />
      <HazardCard workup={workup} hazard={hazard} onChange={changeHazard} error={hazardError(hazard)} />
    </>
  );

  return frame({
    main,
    side: (
      <UseCard
        lines={[
          '预案编号和应急经费写在应急预案的封面与「应急保障」；适用范围决定写哪些专项预案和现场处置方案；危险源辨识是风险评估报告的主体。',
          '这三组不在客户表格里。系统预填的只是起点，以您的判断为准。',
        ]}
      />
    ),
    note: '第 5 步，共 5 步（第 1 页）· 专业项确认完，再去核对并生成',
    actions: (
      <>
        <Button onClick={() => void autosave.flush(() => run()).then((ok) => ok && onGo(4))}>上一步</Button>
        <Button type="primary" loading={saveReview.isPending} onClick={() => void next()}>
          下一页：核对并生成
        </Button>
      </>
    ),
  });
}

// 适用范围三组：要您确认的这次访问里不挪位置（点任一边都算确认）；第 3 步答过的只读；其余已确定的列名称
function ScopeCard({ workup, onGo, save }: { workup: Workup; onGo: StepProps['onGo']; save: (key: ScopeKey, value: boolean) => Promise<boolean> }) {
  const groups = scopeGroupsOf(workup.snapshot, workup.data);
  const all = [...groups.confirm, ...groups.step3, ...groups.settled];
  // 进页面时要确认的那几项，确认后也留在原位
  const [confirmKeys] = useState(() => groups.confirm.map((s) => s.key));
  const byKey = new Map<ScopeKey, ScopeSwitch>([...groups.confirm, ...groups.settled].map((s) => [s.key, s]));
  const confirm = confirmKeys.map((k) => byKey.get(k)).filter((s): s is ScopeSwitch => !!s);
  const settled = groups.settled.filter((s) => !confirmKeys.includes(s.key));
  const on = settled.filter((s) => s.value);
  const off = settled.filter((s) => !s.value);
  const subTitle = (text: string, color: string = gy.text) => <span style={{ ...type.body, fontWeight: weight.strong, color }}>{text}</span>;

  return (
    <Card
      title="适用范围"
      tag={<SourceTag kind="expert" text="只有专家能填" />}
      extra={<span style={caption}>共 {all.length} 项</span>}
      hint="决定要写哪些专项预案和现场处置方案。系统按场所、设备、物料预设开关，由您确认。"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, border: `1px solid ${gy.split}`, borderRadius: 8 }}>
        {confirm.length > 0 && (
          <section aria-label="要您确认" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {subTitle(`要您确认 ${confirm.length} 项 · 系统已预设`, stage.action.color)}
            {confirm.map((s) => (
              <div key={s.key} data-scope={s.key} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ ...type.body, color: gy.text }}>{s.label}</span>
                  <span style={caption}>{s.suggestion.reason}</span>
                </span>
                <span style={{ ...type.caption, color: s.status === 'confirmed' ? source.expert.color : source.system.color, width: 80, flexShrink: 0 }}>
                  {s.status === 'confirmed' ? '您已确认' : `系统预设：${s.suggestion.value ? '开' : '关'}`}
                </span>
                <span role="group" aria-label={s.label} style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {[true, false].map((v) => (
                    <Button
                      key={String(v)}
                      size="small"
                      aria-pressed={s.status === 'confirmed' && s.value === v}
                      style={btnOn(s.status === 'confirmed' && s.value === v)}
                      onClick={() => void save(s.key, v)}
                    >
                      {v ? '开启' : '关闭'}
                    </Button>
                  ))}
                </span>
              </div>
            ))}
          </section>
        )}
        <section aria-label="第 3 步已经答过" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {subTitle(`第 3 步已经答过 ${groups.step3.length} 项`)}
            <SourceTag kind="system" text="来自第 3 步 · 只读" />
            <span style={{ flex: 1 }} />
            <button type="button" style={{ ...linkButton, ...type.body }} onClick={() => onGo(3)}>
              去第 3 步修改
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', borderRadius: 6, background: gy.canvas }}>
            {groups.step3.map((s) => (
              <div key={s.key} data-scope={s.key} style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                <span style={{ ...type.body, color: gy.text, width: 160, flexShrink: 0 }}>{s.label}</span>
                <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text, width: 40, flexShrink: 0 }}>{s.value ? '开启' : '关闭'}</span>
                <span style={{ ...caption, flex: 1, minWidth: 0 }}>
                  {s.suggestion.reason}
                  {s.step3Pending && <span style={{ color: stage.action.color }}>　第 3 步还标着「待补充」，文稿里写待补充</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section aria-label="其余已确定" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {subTitle(`其余已确定 ${settled.length} 项`)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', borderRadius: 6, background: gy.canvas }}>
            <span style={{ display: 'flex', gap: 16 }}>
              <span style={{ ...caption, width: 64, flexShrink: 0 }}>已开启 {on.length}</span>
              <span style={{ ...type.body, color: gy.text }}>{on.map((s) => s.label).join('、') || '—'}</span>
            </span>
            <span style={{ display: 'flex', gap: 16 }}>
              <span style={{ ...caption, width: 64, flexShrink: 0 }}>已关闭 {off.length}</span>
              <span style={{ ...type.body, color: gy.text }}>{off.map((s) => s.label).join('、') || '—'}</span>
            </span>
          </div>
        </section>
      </div>
    </Card>
  );
}

const LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  稍有危险: stage.progress,
  一般危险: stage.progress,
  显著危险: stage.action,
  高度危险: stage.error,
  极其危险: stage.error,
};

function LevelTag({ level }: { level: string }) {
  const s = LEVEL_STYLE[level] ?? stage.progress;
  return <span style={{ padding: '0 6px', borderRadius: 4, ...type.caption, color: s.color, background: s.bg, whiteSpace: 'nowrap' }}>{level}</span>;
}

const lecCol: CSSProperties = { width: 40, flexShrink: 0, textAlign: 'center' };

// 危险源辨识：D = L × E × C；改分值要写一句理由（存在行的说明里），行下显示「C 15 → 40 理由 · 您 · 时间」
function RiskCard({ workup, save }: { workup: Workup; save: (rowId: string, value: RiskRowValue | null) => Promise<boolean> }) {
  const view = riskView(workup.snapshot, workup.data);
  const rows = view.rows.filter((r) => !r.excluded);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const count = (level: string) => rows.filter((r) => r.level === level).length;
  const notable = rows.filter((r) => r.level !== '一般危险' && r.level !== '稍有危险').length;

  return (
    <Card
      title="危险源辨识"
      tag={<SourceTag kind="expert" text="只有专家能填" />}
      extra={
        <button type="button" style={{ ...linkButton, ...type.body }} onClick={() => setAdding(true)}>
          <PlusOutlined /> 手动新增
        </button>
      }
      hint="候选由第 3 步的设备、物料和工序推导，D = L × E × C。改分值时写一句理由，会进处理记录。"
    >
      <div role="table" aria-label="危险源" style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${gy.split}`, borderRadius: 8, overflow: 'hidden' }}>
        <div role="row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', ...caption }}>
          <span style={{ flex: 1 }}>危险有害因素 · 作业场所</span>
          <span style={lecCol}>L</span>
          <span style={lecCol}>E</span>
          <span style={lecCol}>C</span>
          <span style={{ ...lecCol, width: 48 }}>D</span>
          <span style={{ width: 72, flexShrink: 0 }}>等级</span>
          <span style={{ width: 40, flexShrink: 0, textAlign: 'right' }}>来源</span>
        </div>
        {rows.map((r) =>
          editing === r.id ? (
            <RiskEditor key={r.id} row={r} onCancel={() => setEditing(null)} onSave={async (v) => (await save(r.id, v)) && setEditing(null)} />
          ) : (
            <RiskLine key={r.id} row={r} onEdit={() => setEditing(r.id)} />
          ),
        )}
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${gy.split}`, ...caption }}>
          显著危险及以上 {notable} · 一般危险 {count('一般危险') + count('稍有危险')}　结果写入风险评估报告 表 2-1
        </div>
      </div>
      {adding && <AddRiskModal places={view.placeOptions} onCancel={() => setAdding(false)} onSave={async (v) => (await save(`x${Date.now().toString(36)}`, v)) && setAdding(false)} />}
    </Card>
  );
}

function RiskLine({ row, onEdit }: { row: RiskRow; onEdit: () => void }) {
  const changed = row.changes.length > 0 || row.added;
  return (
    <div role="row" data-risk={row.id} style={{ borderTop: `1px solid ${gy.split}`, background: changed ? gy.selected : gy.surface }}>
      <button
        type="button"
        aria-label={`改「${row.factor}」的分值`}
        onClick={onEdit}
        style={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ ...type.body, color: gy.text }}>{row.factor}</span>
          <span style={caption}>{[row.workplace, row.item].filter(Boolean).join(' · ')}</span>
        </span>
        <span style={{ ...lecCol, ...type.body }}>{row.l}</span>
        <span style={{ ...lecCol, ...type.body }}>{row.e}</span>
        <span style={{ ...lecCol, ...type.body }}>{row.c}</span>
        <span style={{ ...lecCol, width: 48, ...type.body, fontWeight: weight.strong }}>{row.d}</span>
        <span style={{ width: 72, flexShrink: 0 }}>
          <LevelTag level={row.level} />
        </span>
        <span style={{ width: 40, flexShrink: 0, textAlign: 'right', ...type.caption, color: row.source === 'expert' ? source.expert.color : source.system.color }}>
          {row.source === 'expert' ? '您' : '系统'}
        </span>
      </button>
      {changed && (row.note || row.changes.length > 0) && (
        <div style={{ margin: '0 16px 10px', padding: '6px 12px', borderRadius: 6, border: `1px solid ${gy.split}`, background: gy.surface, ...type.caption, color: gy.text }}>
          {row.changes.length > 0 && <span style={{ color: gy.primary }}>{row.changes.join('，')}　</span>}
          {row.note}
          {row.edited && <span style={{ color: gy.tertiary }}>　您 · {dayOf(row.edited.at, true)}</span>}
        </div>
      )}
    </div>
  );
}

function LecSelects({ value, onChange }: { value: Pick<RiskRowValue, 'l' | 'e' | 'c'>; onChange: (v: Pick<RiskRowValue, 'l' | 'e' | 'c'>) => void }) {
  return (
    <>
      {LEC_KEYS.map((k) => (
        <Select
          key={k}
          aria-label={k.toUpperCase()}
          size="small"
          value={value[k]}
          popupMatchSelectWidth={false}
          options={LEC_OPTIONS[k].map((o) => ({ value: o.value, label: `${o.value}　${o.label}` }))}
          labelRender={(o) => String(o.value)}
          onChange={(v) => onChange({ ...value, [k]: v })}
          style={{ width: 72 }}
        />
      ))}
    </>
  );
}

function RiskEditor({ row, onCancel, onSave }: { row: RiskRow; onCancel: () => void; onSave: (v: RiskRowValue | null) => Promise<unknown> }) {
  const [value, setValue] = useState<RiskRowValue>(() => riskRowValueOf(row));
  const [error, setError] = useState<string | null>(null);
  const d = riskScore(value);
  const s = row.suggested;
  const changed = s ? value.l !== s.l || value.e !== s.e || value.c !== s.c : true;
  const submit = () => {
    if (changed && s && !value.note?.trim()) {
      setError('改了分值，请写一句理由');
      return;
    }
    void onSave({ ...value, note: value.note?.trim() || undefined });
  };
  return (
    <div role="row" data-risk={row.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', borderTop: `1px solid ${gy.split}`, background: gy.selected }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{row.factor}</span>
          <span style={caption}>{row.workplace}</span>
        </span>
        <LecSelects value={value} onChange={(v) => setValue({ ...value, ...v })} />
        <span style={{ ...type.body, fontWeight: weight.strong, width: 48, textAlign: 'center' }}>{d}</span>
        <LevelTag level={riskLevel(d) ?? '—'} />
      </div>
      <Input
        aria-label="改分值的理由"
        placeholder={changed && s ? '写一句理由，如：气瓶间紧邻焊接区，爆炸可致数人伤亡' : '说明（选填）'}
        value={value.note ?? ''}
        maxLength={200}
        status={error ? 'error' : undefined}
        onChange={(e) => {
          setError(null);
          setValue({ ...value, note: e.target.value });
        }}
      />
      {error && (
        <span role="alert" style={{ ...type.caption, color: gy.error }}>
          {error}
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {(row.edited || row.added) && (
          <Button size="small" onClick={() => void onSave(null)}>
            {row.added ? '删除这一行' : '恢复系统推荐'}
          </Button>
        )}
        {!row.added && (
          <Button size="small" onClick={() => void onSave({ ...riskRowValueOf(row), excluded: true })}>
            不适用
          </Button>
        )}
        <Button size="small" onClick={onCancel}>
          取消
        </Button>
        <Button size="small" type="primary" onClick={submit}>
          保存
        </Button>
      </div>
    </div>
  );
}

const FACTORS = ['机械伤害', '物体打击', '车辆伤害', '起重伤害', '触电', '灼烫', '火灾', '高处坠落', '坍塌', '容器爆炸', '其他爆炸', '中毒和窒息', '其他伤害'];

// S06 ③ 手动新增危险源
function AddRiskModal({ places, onCancel, onSave }: { places: string[]; onCancel: () => void; onSave: (v: RiskRowValue) => Promise<unknown> }) {
  const [value, setValue] = useState<RiskRowValue>({ factor: '', workplace: '', l: 3, e: 6, c: 7 });
  const [error, setError] = useState<string | null>(null);
  const d = riskScore(value);
  const submit = () => {
    if (!value.factor.trim()) return setError('请填写危险有害因素');
    if (!value.workplace.trim()) return setError('请填写作业场所');
    void onSave({ ...value, note: value.note?.trim() || undefined });
  };
  return (
    <Modal open title="手动新增危险源" okText="添加" cancelText="取消" onOk={submit} onCancel={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="危险有害因素">
          <AutoComplete
            aria-label="危险有害因素"
            value={value.factor}
            options={FACTORS.map((f) => ({ value: f }))}
            onChange={(v) => setValue({ ...value, factor: v })}
            placeholder="如：容器爆炸"
          />
        </Field>
        <Field label="作业场所">
          <AutoComplete aria-label="作业场所" value={value.workplace} options={places.map((p) => ({ value: p }))} onChange={(v) => setValue({ ...value, workplace: v })} placeholder="如：气瓶间" />
        </Field>
        <Field label="分值" hint={`D = ${d}，${riskLevel(d)}`}>
          <div style={{ display: 'flex', gap: 8 }}>
            <LecSelects value={value} onChange={(v) => setValue({ ...value, ...v })} />
          </div>
        </Field>
        <Field label="说明（选填）">
          <Input aria-label="说明" value={value.note ?? ''} maxLength={200} onChange={(e) => setValue({ ...value, note: e.target.value })} />
        </Field>
        {error && (
          <span role="alert" style={{ ...type.caption, color: gy.error }}>
            {error}
          </span>
        )}
      </div>
    </Modal>
  );
}

// 是否构成重大危险源：系统按第 3 步的最大存放量算；改了要写理由，选「构成」还要填物质和储存量
function HazardCard({
  workup,
  hazard,
  error,
  onChange,
}: {
  workup: Workup;
  hazard: MajorHazardOverride | null;
  error: string | null;
  onChange: (h: MajorHazardOverride | null) => void;
}) {
  const system = systemMajorHazard(workup.snapshot, workup.data);
  const value = hazard?.value ?? system.conclusion;
  const overridden = value !== system.conclusion;
  const counted = system.rows.filter((r) => r.ratio !== undefined);
  const pick = (v: '构成' | '不构成') => {
    if (v === system.conclusion) onChange(null);
    else onChange({ value: v, reason: hazard?.reason ?? '', ...(v === '构成' ? { substances: hazard?.substances?.length ? hazard.substances : [{ name: '', storage: '' }] } : {}) });
  };
  const subs = hazard?.substances ?? [];
  const setSubs = (next: { name: string; storage: string }[]) => hazard && onChange({ ...hazard, substances: next });
  const final = majorHazardFinal(system, overridden && hazard ? hazard : undefined);

  return (
    <section aria-label="是否构成重大危险源" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24, background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>是否构成重大危险源</h2>
        {overridden ? <SourceTag kind="expert" text="您已修改" /> : <SourceTag kind="system" text="系统带出" />}
        <span style={{ flex: 1 }} />
        <span role="group" aria-label="重大危险源" style={{ display: 'flex', gap: 4 }}>
          {(['不构成', '构成'] as const).map((v) => (
            <Button key={v} size="small" aria-pressed={final.value === v} style={btnOn(final.value === v)} onClick={() => pick(v)}>
              {v}
            </Button>
          ))}
        </span>
      </div>
      <span style={{ ...type.body, color: gy.secondary }}>
        系统按第 3 步的最大存放量算出：{system.conclusion}。
        {counted.length ? `算进去 ${counted.length} 种：${counted.map((r) => `${r.name} ${r.storage}`).join('、')}。` : '没有判定为危化品、能算进去的物料。'}
        {system.complete && counted.length ? `∑q/Q = ${system.sumText}。` : ''}
      </span>
      {(system.unconvertible.length > 0 || system.noCritical.length > 0) && (
        <div role="note" style={{ display: 'flex', gap: 8, padding: '10px 16px', borderRadius: 6, background: stage.action.bg, border: `1px solid ${gy.warningBg}` }}>
          <ExclamationCircleFilled style={{ color: stage.action.color, marginTop: 4 }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ ...type.body, fontWeight: weight.strong, color: stage.action.color }}>
              有 {system.unconvertible.length + system.noCritical.length} 种物料没能算进去，请您判断
            </span>
            {system.unconvertible.map((u) => (
              <span key={u.name} style={{ ...type.body, color: gy.text }}>
                {u.name}：客户填「{u.qty}{u.unit}」，系统换算不成重量，没有算进去。
              </span>
            ))}
            {system.noCritical.map((n) => (
              <span key={n} style={{ ...type.body, color: gy.text }}>
                {n}：系统里没有它的临界量，没有算进去。
              </span>
            ))}
          </span>
        </div>
      )}
      {overridden && hazard && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="为什么和系统算的不同" error={error && !hazard.reason.trim() ? error : null}>
            <Input aria-label="重大危险源理由" value={hazard.reason} maxLength={200} placeholder="写一句理由，写进风险评估报告" onChange={(e) => onChange({ ...hazard, reason: e.target.value })} />
          </Field>
          {hazard.value === '构成' && (
            <Field label="构成的物质和储存量" error={error && hazard.reason.trim() ? error : null}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {subs.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8 }}>
                    <Input aria-label={`物质名称 ${i + 1}`} placeholder="物质名称" value={s.name} maxLength={50} onChange={(e) => setSubs(subs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <Input aria-label={`储存量 ${i + 1}`} placeholder="储存量，如 6 t" value={s.storage} maxLength={30} onChange={(e) => setSubs(subs.map((x, j) => (j === i ? { ...x, storage: e.target.value } : x)))} />
                    {subs.length > 1 && (
                      <Button onClick={() => setSubs(subs.filter((_, j) => j !== i))}>删除</Button>
                    )}
                  </div>
                ))}
                <button type="button" style={{ ...linkButton, ...type.body, alignSelf: 'flex-start' }} onClick={() => setSubs([...subs, { name: '', storage: '' }])}>
                  <PlusOutlined /> 再加一种
                </button>
              </div>
            </Field>
          )}
        </div>
      )}
      <span style={caption}>您可以改系统算的结果，改了要写一句理由；选「构成」还要填物质名称和储存量，写进风险评估报告。</span>
    </section>
  );
}

// ---------- 第 2 页 ----------

// 「下一个缺失项」在四步之间轮着走（门槛缺的在前）
let nextMissingIndex = 0;

const STEP_NAMES = ['企业基本信息', '人员与应急组织', '生产情况', '应急资源与图纸'] as const;

function ReviewPage2({ taskId, workup, frame, onGo }: StepProps) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [, setParams] = useSearchParams();
  const confirm = useConfirmGeneration(taskId);
  const materials = useMaterials(taskId, true);
  const generation = useGeneration(taskId);
  const record = useCopyMissingList(taskId);
  const intake = useIntake(taskId, workup.flow === 'intake');
  const { copy, node } = useMissingCopy();
  const [drawer, setDrawer] = useState(false);
  const w = workup;

  const gate = workupGaps(w.snapshot, w.data, w.agencyDistricts, w.drawings);
  const customer = customerGaps(w.snapshot, w.data, w.drawings);
  const gateKeys = new Set(gate.gaps.map((g) => g.key));
  const customerOnly = customer.filter((g) => !gateKeys.has(g.key));
  const all = currentGaps(w.snapshot, w.data, w.agencyDistricts, w.drawings);
  const blocked = gate.gaps.length > 0;
  const noEvacuation = Boolean(intake.data?.submission?.noEvacuationMap ?? intake.data?.noEvacuationMap);

  const summaries = useMemo(() => stepSummaries(w), [w]);
  const professional = useMemo(() => professionalItems(w), [w]);
  const edits = expertEditCounts(w.snapshot, w.data);
  const sheet = w.intakeFiles.find((f) => f.slot === 'data_sheet');

  const copyList = async () => {
    const items = missingItemsOf(all);
    const name = companyNameInputOf(w.snapshot, w.data);
    // 已经生成过：只复制文字，不调接口、不标任务（免得盖掉核对文稿的状态）
    const generated = Boolean(generation.data?.current);
    const ok = await copy(
      { companyName: name.name, addresses: name.addresses, contact: missingContactOf(w.snapshot, w.data), items },
      generated ? `已复制 ${items.length} 项缺项，粘贴到企业微信发给客户` : undefined,
    );
    if (!ok || w.flow !== 'intake' || generated) return;
    try {
      await record.mutateAsync({ version: w.version });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '没能把任务标为「等客户补资料」，请稍后再试');
    }
  };

  const goNextMissing = () => {
    if (!all.length) return;
    const g = all[nextMissingIndex % all.length]!;
    nextMissingIndex += 1;
    onGo(g.step);
  };

  // 已经生成过、草稿里有人工修订：先提醒
  const generate = () => {
    const edited = generation.data?.current?.editedSections ?? 0;
    if (!edited) return void submit();
    Modal.confirm({
      title: '重新生成三份草稿？',
      content: `已有 ${edited} 节人工修订。重新生成后，这些修订需要在新稿里重新对照。`,
      okText: '确认重新生成',
      cancelText: '先不生成',
      onOk: () => submit(),
    });
  };
  const submit = async () => {
    if (!materials.data) return;
    try {
      await confirm.mutateAsync({ version: w.version, materials: materials.data.fingerprint });
      await client.invalidateQueries({ queryKey: workupKey(taskId) });
      await client.invalidateQueries({ queryKey: generationKey(taskId) });
      setParams({});
    } catch (err) {
      if (err instanceof ApiError && err.body?.reason === 'materials') {
        client.setQueryData(materialsKey(taskId), err.body.materials);
        message.warning('客户刚更新了资料，请看过后再确认生成');
        return;
      }
      if (err instanceof ApiError && (err.body?.reason === 'stale' || err.body?.reason === 'gaps')) {
        message.warning(err.message);
        await client.invalidateQueries({ queryKey: workupKey(taskId) });
        return;
      }
      message.error(err instanceof ApiError ? err.message : '没有提交成功，请检查网络后重试');
    }
  };

  const main = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>
          {blocked ? `还差 ${gate.gaps.length} 项必填资料，暂时不能生成` : '核对无误，就可以生成初稿'}
        </h1>
        <span style={{ ...type.body, color: gy.secondary }}>
          {blocked
            ? '下面标「!」的是生成必备的资料，补齐后才能生成。客户未填的项不影响生成，文稿里会标「待补充」。'
            : '必填资料已齐，可以生成。客户未填的项不影响生成，文稿里会标「待补充」；专业项已由您在上一页确认。'}
        </span>
      </div>
      <section aria-label="四步摘要" style={{ display: 'flex', flexDirection: 'column', padding: '0 24px', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}>
        {summaries.map((s, i) => {
          const step = (i + 1) as 1 | 2 | 3 | 4;
          const missing = gate.gaps.filter((g) => g.step === step);
          const n = customerGapCount(customerOnly, step);
          return (
            <div key={step} data-step={step} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderTop: i ? `1px solid ${gy.split}` : undefined }}>
              <span
                aria-hidden
                style={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  borderRadius: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...type.caption,
                  fontWeight: weight.strong,
                  color: missing.length ? stage.action.color : stage.done.color,
                  background: missing.length ? stage.action.bg : stage.done.bg,
                }}
              >
                {missing.length ? '!' : '✓'}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{STEP_NAMES[i]}</span>
                {missing.length ? (
                  <span style={{ ...type.body, color: stage.action.color }}>还缺：{missing.map((g) => g.label).join('、')}</span>
                ) : (
                  <span style={{ ...type.body, color: gy.secondary }}>{s}</span>
                )}
              </span>
              {n > 0 && <span style={{ padding: '0 8px', borderRadius: 4, ...type.caption, color: gy.secondary, background: gy.neutralBg }}>{n} 项客户未填</span>}
              <button type="button" style={{ ...linkButton, ...type.body }} onClick={() => onGo(step)}>
                {missing.length ? '去补充' : '修改'}
              </button>
            </div>
          );
        })}
      </section>
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        <section aria-label="专业项" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 20, borderRadius: 8, background: source.expert.bg, border: `1px solid ${gy.split}` }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>专业项 · 您已确认</span>
          <span style={caption}>在第 3、4 步和上一页完成，可以回去改</span>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {professional.map((p) => (
              <li key={p.text} style={{ ...type.body, color: p.empty ? stage.action.color : gy.text }}>
                {p.text}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="客户未填" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 20, borderRadius: 8, background: gy.surface, border: `1px solid ${gy.split}` }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>客户未填 · {customerOnly.length} 项</span>
          <span style={caption}>不影响生成，文稿里标「待补充」</span>
          {customerOnly.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {customerOnly.slice(0, 8).map((g) => (
                <li key={g.key} style={{ ...type.body, color: gy.text }}>
                  {g.label}
                </li>
              ))}
              {customerOnly.length > 8 && <li style={{ ...type.body, color: gy.secondary }}>还有 {customerOnly.length - 8} 项</li>}
            </ul>
          ) : (
            <span style={{ ...type.body, color: gy.secondary }}>客户的资料都填齐了。</span>
          )}
        </section>
      </div>
      {blocked ? (
        <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderRadius: 8, background: stage.action.bg }}>
          <span style={{ flex: 1, ...type.body, color: gy.text }}>
            {noEvacuation && gate.gaps.some((g) => g.key === 'drawing:evacuation_plan')
              ? '客户说没有紧急疏散示意图：请您按总平面图画一张疏散示意图，在第 4 步上传后就能生成。其余缺的资料点「复制缺项清单」发给客服。'
              : generation.data?.current
                ? '缺的资料要向客户要的，点「复制缺项清单」发给客户。'
                : '缺的资料要向客户要的，点「复制缺项清单」发给客服；任务同时标为「等客户补资料」。'}
            <button type="button" style={{ ...linkButton, ...type.body, marginLeft: 8 }} onClick={goNextMissing}>
              下一个缺失项
            </button>
          </span>
          <Button onClick={() => void copyList()} loading={record.isPending}>
            复制缺项清单
          </Button>
        </div>
      ) : (
        customerOnly.length > 0 && (
          <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderRadius: 8, background: stage.action.bg }}>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>有 {customerOnly.length} 项客户没填，要不要先补齐？</span>
              <span style={{ ...type.body, color: gy.secondary }}>
                {generation.data?.current
                  ? '可以先生成，缺的内容在文稿里标「待补充」；也可以点「复制缺项清单」发给客户。'
                  : '可以先生成，缺的内容在文稿里标「待补充」；也可以点「复制缺项清单」发给客服，任务会同时标为「等客户补资料」。'}
                <button type="button" style={{ ...linkButton, ...type.body, marginLeft: 8 }} onClick={goNextMissing}>
                  下一个缺失项
                </button>
              </span>
            </span>
            <Button onClick={() => void copyList()} loading={record.isPending}>
              复制缺项清单
            </Button>
          </div>
        )
      )}
      {w.data.missingList && (
        <button type="button" style={{ ...linkButton, ...type.body, alignSelf: 'flex-start' }} onClick={() => setDrawer(true)}>
          查看缺项清单（{dayOf(w.data.missingList.at)}复制）
        </button>
      )}
      <Card title="生成以后">
        <ol aria-label="生成以后" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', gap: 16 }}>
          {[
            ['系统生成三份初稿', '应急预案、风险评估报告、应急资源调查报告'],
            ['您逐份核对、修改', '标「待补充」的地方逐一处理，可直接在文稿里改'],
            ['定稿并交付', '您定稿并交付后，客户才能下载；之后需要改，可以重新打开'],
            ['客户下载', '客户在「成果文档」下载全套 Word'],
          ].map(([t, d], i) => (
            <li key={t} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: i === 3 ? gy.success : gy.primary }} />
              <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{t}</span>
              <span style={caption}>{d}</span>
            </li>
          ))}
        </ol>
      </Card>
      {node}
      {drawer && <MissingDrawer taskId={taskId} onClose={() => setDrawer(false)} onGoStep={(n) => { setDrawer(false); onGo(n); }} />}
    </>
  );

  const versionText =
    w.flow === 'intake' && sheet
      ? `客户表格 ${dayOf(sheet.uploadedAt)} ${clockOf(sheet.uploadedAt)} 上传。您修改 ${edits.modified} 处、补充 ${edits.supplemented} 项，客户原表保持不变。`
      : `客户在线填写，${dayOf(w.submittedAt ?? w.snapshotAt)}提交。您修改 ${edits.modified} 处、补充 ${edits.supplemented} 项，客户原来填的保持不变。`;

  return frame({
    main,
    side: (
      <>
        <SideCard title="资料版本">
          <span style={{ ...type.body, color: gy.secondary }}>{versionText}</span>
          <span style={{ ...type.body, color: gy.secondary }}>确认后，这一版作为本次生成的依据。</span>
        </SideCard>
        <LockNote />
      </>
    ),
    note: blocked
      ? `还差 ${gate.gaps.length} 项必填资料，补齐后才能生成`
      : `第 5 步，共 5 步（第 2 页）· 必填资料已齐${customerOnly.length ? `，${customerOnly.length} 项客户未填不影响生成` : ''}`,
    actions: (
      <>
        <Button onClick={() => onGo(5, 1)}>上一页</Button>
        <Button type="primary" disabled={blocked || !materials.data} loading={confirm.isPending} onClick={generate}>
          确认资料并生成初稿
        </Button>
      </>
    ),
  });
}

// 四步各一句摘要
function stepSummaries(w: Workup): string[] {
  const basic = basicStepView(w.snapshot, w.data);
  const org = organizationStepView(w.snapshot, w.data);
  const prod = productionView(w.snapshot, w.data);
  const res = resourcesStepView(w.snapshot, w.data);
  const has = (k: string) => w.drawings.some((d) => d.key === k);
  const join = (xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' · ');
  return [
    join([basic.identity.name, basic.basic.employeeCount !== undefined && `${basic.basic.employeeCount} 人`, basic.basic.contactPerson && `联系人 ${basic.basic.contactPerson}`]),
    join([org.commander?.name && '总指挥', org.deputies.length > 0 && '副总指挥', `应急小组 ${org.groups.length} 个`, org.dutyPhone && '值班电话']),
    join([
      `${prod.equipment.length} 类设备`,
      `${prod.materials.length} 种物料`,
      prod.process.steps.length > 0 && `${prod.process.steps.length} 道工序`,
      `${prod.buildings.length} 栋建筑`,
    ]),
    join([
      `${res.supplies.filter((s) => s.name.trim()).length} 项应急物资`,
      has('site_plan') && has('evacuation_plan') ? '平面图、疏散图已上传' : has('site_plan') ? '平面图已上传' : has('evacuation_plan') ? '疏散图已上传' : '图纸还没上传',
    ]),
  ];
}

// 专业项 · 您已确认：空着的标琥珀色
function professionalItems(w: Workup): { text: string; empty?: boolean }[] {
  const r = w.data.review ?? {};
  const risks = riskView(w.snapshot, w.data).rows.filter((x) => !x.excluded).length;
  const scope = scopeGroupsOf(w.snapshot, w.data);
  const scopeCount = scope.confirm.length + scope.step3.length + scope.settled.length;
  const unconfirmed = scope.confirm.filter((s) => s.status !== 'confirmed').length;
  const system = systemMajorHazard(w.snapshot, w.data);
  const hazard = majorHazardFinal(system, r.majorHazard);
  const people = reviewPeopleOf(w.snapshot, w.data);
  const named = (id?: string) => people.find((p) => p.id === id)?.name;
  const out: { text: string; empty?: boolean }[] = [
    { text: `适用范围 ${scopeCount} 项${unconfirmed ? `（${unconfirmed} 项按系统预设，没有确认）` : ''}`, empty: unconfirmed > 0 },
    { text: `危险源 ${risks} 项（${hazard.value}重大危险源${hazard.overridden ? '，您已改' : ''}）` },
    { text: r.planCode ? `预案编号 ${r.planCode}` : '预案编号没填，文稿写「待补充」', empty: !r.planCode },
    {
      text: r.emergencyBudget ? `应急经费 ${r.emergencyBudget} 万元/年${r.fundingDepartment ? `，${r.fundingDepartment}牵头` : ''}` : '应急经费没填，文稿写「待补充」',
      empty: !r.emergencyBudget,
    },
    {
      text: named(r.ledgerOwnerId) && named(r.archiverId) ? `台账 ${named(r.ledgerOwnerId)}、归档 ${named(r.archiverId)}` : '经费台账负责人或归档人没选',
      empty: !(named(r.ledgerOwnerId) && named(r.archiverId)),
    },
  ];
  return out;
}

