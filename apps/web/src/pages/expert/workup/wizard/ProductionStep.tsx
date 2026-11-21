import { CameraOutlined, CheckOutlined, CloseOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
import {
  BOILER_TYPES,
  customerGapCount,
  customerGaps,
  effectiveSnapshot,
  emptyProductionWorkup,
  EQUIPMENT_CONDITION_OPTIONS,
  figuresView,
  msdsHintOf,
  msdsNeedOf,
  newId,
  PER_ROW_OPTIONS,
  BRANCH_KINDS,
  pressureVolumeOf,
  processFlowSvg,
  productionStepView,
  productionView,
  resourcesStepView,
  SITE_TYPES,
  sitesFromBusinessScope,
  SPECIAL_CATEGORY_KEYS,
  SPECIAL_LABELS,
  stepsFromDescription,
  type BranchKind,
  type DraftEquipment,
  type DraftMaterial,
  type DraftProcessStep,
  type ProcessBranch,
  type ProcessFigureSettings,
  type ProductionSave,
  type ProductionStep as Step,
  type ProductionWorkup,
  type SiteType,
  type SpecialCategory,
  type SpecialJudgement,
} from '@genyun/shared';
import { App, AutoComplete, Button, Input, InputNumber, Modal, Radio, Select } from 'antd';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError } from '../../../../api/request';
import { useSaveFigures, useSaveProduction, useSaveProductionStep, type Workup } from '../../../../api/workup';
import { SourceTag } from '../../../../components/SourceTag';
import { gy, source as sourceColor, type, weight } from '../../../../theme/tokens';
import { chooseFile, fileInfo, useExpertUpload, usePreview, type ExpertUploads, type PreviewFile } from './ExpertFiles';
import { CompareBar, compareSheets, CompareSheets, type CompareMode } from './OriginalCompare';
import { OriginalSheetCard } from './OriginalSheetCard';
import { caption, Card, link14, softLine, StepTitle, UseCard } from './parts';
import type { StepProps } from './types';

// 资料核对第 3 步「生产情况」（13 页 E2-3a、E2-3b、S06 ② ⑤）：
// 第 1 页场所、特种设备、设备与物料、MSDS、分租与运输；第 2 页工艺流程。
// 场所、设备、物料、工艺整步存进专家那份（productionStep）；特种设备判定、是否危化品照旧是专家的判断（data.production），
// 和整步保存排在同一个自动保存里依次存；流程图的排版（每行几道、支路）存在图件画法里

const PAGE_SHEETS = [['建筑与场所', '生产与设备', '原辅料与危化品'], ['生产与设备']];
const head: CSSProperties = { ...type.caption, color: gy.tertiary };
const H36: CSSProperties = { height: 36 };
// 页面预览缩小后宋体太细，换成界面字体；Word 里的图仍是宋体
const svgUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/font-family="[^"]*"/, `font-family="'Microsoft YaHei', 'Noto Sans SC', sans-serif"`))}`;

type JudgeSave = Omit<Extract<ProductionSave, { kind: 'special' }>, 'version'> | Omit<Extract<ProductionSave, { kind: 'hazardous' }>, 'version'>;
const FAKE_STAMP = { by: '', byName: '', at: '' };

/** 第 3 步第一次打开时：客户只写了一句话、没拆工序的，按原话拆好 */
export function initialProductionStep(workup: Workup): Step {
  const step = productionStepView(workup.snapshot, workup.data);
  if (step.process.steps.length === 0 && step.process.description?.trim()) {
    step.process.steps = stepsFromDescription(step.process.description, () => newId('x'));
  }
  return step;
}

export function ProductionStep({ taskId, workup, autosave, customerText, frame, onGo, latestVersion, page }: StepProps) {
  const saveStep = useSaveProductionStep(taskId);
  const saveJudge = useSaveProduction(taskId);
  const saveFigures = useSaveFigures(taskId);
  const [initial] = useState(() => initialProductionStep(workup));
  const [step, setStep] = useState<Step>(initial);
  const stepRef = useRef(step);
  // 没拆过工序的，第一次进来就算有改动（拆好的工序要存）
  const saved = useRef<Step>(productionStepView(workup.snapshot, workup.data));
  const queue = useRef(new Map<string, JudgeSave>());
  // 页面上的判定（存上之前先按页面显示）
  const [judge, setJudge] = useState<Pick<ProductionWorkup, 'special' | 'hazardous'>>(() => {
    const w = workup.data.production ?? emptyProductionWorkup();
    return { special: { ...w.special }, hazardous: { ...w.hazardous } };
  });
  const [mode, setMode] = useState<CompareMode>('items');
  const preview = usePreview();

  const data = {
    ...workup.data,
    production: { ...(workup.data.production ?? emptyProductionWorkup()), equipment: {}, materials: {}, ...judge },
    profile: { ...workup.data.profile, productionStep: { step } },
  };
  const view = productionView(workup.snapshot, data);
  const resources = resourcesStepView(workup.snapshot, workup.data);
  const gaps = customerGapCount(customerGaps(workup.snapshot, data, workup.drawings), 3);

  const run = async () => {
    const s = stepRef.current;
    if (JSON.stringify(s) !== JSON.stringify(saved.current)) {
      await saveStep.mutateAsync({ version: latestVersion(), step: s });
      saved.current = s;
    }
    for (const [key, save] of [...queue.current]) {
      await saveJudge.mutateAsync({ ...save, version: latestVersion() } as ProductionSave);
      if (queue.current.get(key) === save) queue.current.delete(key);
    }
  };
  const change = (next: Step) => {
    stepRef.current = next;
    setStep(next);
    autosave.schedule(run);
  };
  const judgeSpecial = (category: SpecialCategory, value: SpecialJudgement | null, now = true) => {
    setJudge((j) => {
      const special = { ...j.special };
      if (value) special[category] = { ...FAKE_STAMP, value };
      else delete special[category];
      return { ...j, special };
    });
    queue.current.set(`special:${category}`, { kind: 'special', category, value });
    if (now) void autosave.flush(run);
    else autosave.schedule(run);
  };
  const judgeHazard = (rowId: string, value: boolean | null) => {
    setJudge((j) => {
      const hazardous = { ...j.hazardous };
      if (value === null) delete hazardous[rowId];
      else hazardous[rowId] = { ...FAKE_STAMP, value };
      return { ...j, hazardous };
    });
    queue.current.set(`hazardous:${rowId}`, { kind: 'hazardous', rowId, value });
    void autosave.flush(run);
  };

  const uploads = useExpertUpload({
    taskId,
    autosave: { ...autosave, flush: (task) => autosave.flush(task ?? run) },
    latestVersion,
    onDone: (savedWorkup, target) => {
      if (!target.startsWith('label:')) return;
      const id = target.slice('label:'.length);
      const fileIds = productionStepView(savedWorkup.snapshot, savedWorkup.data).materials.find((m) => m.id === id)?.labelPhotoFileIds ?? [];
      const put = (s: Step): Step => ({ ...s, materials: s.materials.map((m) => (m.id === id ? { ...m, labelPhotoFileIds: fileIds } : m)) });
      saved.current = put(saved.current);
      const next = put(stepRef.current);
      stepRef.current = next;
      setStep(next);
    },
  });

  const go = async (n: number, p?: number, stepsDone?: number) => {
    const ok = await autosave.flush(async () => {
      await run();
      if (stepsDone) await saveStep.mutateAsync({ version: latestVersion(), step: stepRef.current, stepsDone });
    });
    if (ok) onGo(n, p);
  };

  const sheets = compareSheets(
    Object.fromEntries(Object.entries(workup.sources).filter(([k]) => k.startsWith('production.') && (page === 2 ? k.startsWith('production.process') : true))),
    { production: { original: workup.snapshot.profile.productionStep?.step, current: step } },
  );
  const compare =
    workup.flow === 'intake' ? (
      <CompareBar
        summary={`客户表格里这一步用到的：${PAGE_SHEETS[page - 1]!.map((s) => `「${s}」`).join('')}`}
        mode={mode}
        onChange={setMode}
      />
    ) : null;

  const side = (
    <>
      <OriginalSheetCard taskId={taskId} workup={workup} sheets={PAGE_SHEETS[page - 1]!} />
      <UseCard
        lines={
          page === 1
            ? [
                '不同场所对应不同的事故类型：喷涂对应火灾爆炸，配电房对应触电，有限空间对应中毒窒息。系统据此决定要编写哪些专项预案和现场处置方案。',
                '危化品和特种设备客户判断不了：表格只收名称、数量和照片，是否属于目录、要不要填参数由您确认。',
              ]
            : [
                '工序决定风险辨识从哪里入手：喷涂、烘干对应火灾爆炸，焊接对应灼烫和触电，冲压对应机械伤害。',
                '流程图放进预案附图，事故风险描述按工序顺序写。',
              ]
        }
      />
    </>
  );

  if (page === 2) {
    const process = <ProcessPage taskId={taskId} workup={workup} step={step} data={data} change={change} autosave={autosave} run={run} latestVersion={latestVersion} saveFigures={saveFigures} />;
    const count = step.process.steps.filter((s) => s.name.trim()).length;
    return frame({
      main: (
        <>
          <StepTitle
            title="核对工艺流程"
            sub="客户在表格里用一句话写了生产过程，系统已按原话拆成工序。请对照客户原话增删，流程图会自动生成。"
            customerText={customerText}
          />
          {compare}
          {mode === 'sheet' ? <CompareSheets taskId={taskId} workup={workup} sheets={sheets} /> : process}
        </>
      ),
      side,
      note: `第 3 步，共 5 步（第 2 页）· ${count} 道工序${step.process.description?.trim() ? '，按客户原话拆出' : ''}`,
      actions: (
        <>
          <Button onClick={() => void go(3, 1)}>上一页</Button>
          <Button type="primary" loading={saveStep.isPending} onClick={() => void go(4, undefined, 3)}>
            下一步：应急资源与图纸
          </Button>
        </>
      ),
    });
  }

  const sites = step.sites.length + step.customSites.length;
  const specialDone = view.special.filter((s) => s.answer === 'yes' && s.items.length > 0).length;
  const labelMissing = step.materials.filter((m) => msdsHintOf(m) === 'label_needed').length;
  const note = [
    `${sites} 个场所`,
    specialDone ? `${specialDone} 类特种设备已补参数` : null,
    labelMissing ? `${labelMissing} 种物料缺包装标签` : null,
    gaps ? `${gaps} 项客户未填` : null,
  ]
    .filter(Boolean)
    .join('，');

  return frame({
    main: (
      <>
        <StepTitle
          title="核对场所、设备与物料"
          sub="已按客户表格预填。场所决定要写哪些专项预案；特种设备参数和危化品判定客户不填，由您补齐。"
          customerText={customerText}
          expertOnly
        />
        {compare}
        {mode === 'sheet' ? (
          <CompareSheets taskId={taskId} workup={workup} sheets={sheets} />
        ) : (
          <>
            <SitesCard workup={workup} step={step} change={change} customerText={customerText} />
            <SpecialCard workup={workup} view={view.special} step={step} judgeSpecial={judgeSpecial} preview={preview.open} />
            <TablesCard
              workup={workup}
              step={step}
              change={change}
              customerText={customerText}
              uploads={uploads}
              onCompare={workup.flow === 'intake' ? () => setMode('sheet') : undefined}
              preview={preview.open}
            />
            <MsdsCard
              workup={workup}
              step={step}
              hazards={new Map(view.materials.map((m) => [m.id, m.hazard]))}
              msds={resources.msds}
              judgeHazard={judgeHazard}
              uploads={uploads}
              preview={preview.open}
            />
            <LeaseCard step={step} change={change} customerText={customerText} />
          </>
        )}
        {preview.node}
      </>
    ),
    side,
    note: `第 3 步，共 5 步（第 1 页）· ${note}`,
    actions: (
      <>
        <Button onClick={() => void go(2)}>上一步</Button>
        <Button type="primary" onClick={() => void go(3, 2)}>
          下一页：工艺流程
        </Button>
      </>
    ),
  });
}

// ── 场所 ──

function SitesCard({ workup, step, change, customerText }: { workup: Workup; step: Step; change: (s: Step) => void; customerText: string }) {
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState('');
  const scope = effectiveSnapshot(workup.snapshot, workup.data).profile.basicStep?.basic.businessScope;
  const fromScope = sitesFromBusinessScope(scope);
  const customerSites = workup.snapshot.profile.productionStep?.step.sites ?? [];
  const matched = fromScope.filter((s) => customerSites.includes(s));
  const toggle = (s: SiteType) => change({ ...step, sites: step.sites.includes(s) ? step.sites.filter((x) => x !== s) : [...step.sites, s] });
  const addCustom = () => {
    const v = custom.trim().slice(0, 20);
    if (v && !step.customSites.includes(v) && step.customSites.length < 10) change({ ...step, customSites: [...step.customSites, v] });
    setCustom('');
    setAdding(false);
  };
  const chip = (on: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 14px',
    borderRadius: 16,
    border: `1px solid ${on ? gy.primary : gy.controlLine}`,
    background: on ? gy.selected : gy.surface,
    color: on ? gy.primary : gy.text,
    ...type.body,
    cursor: 'pointer',
    fontFamily: 'inherit',
  });
  const hint = workup.snapshot.profile.productionStep
    ? `客户勾了 ${customerSites.length} 处${matched.length ? `，与经营范围里的${matched.map((s) => `「${SITE_TYPES[s].replace(/（.*/, '')}」`).join('')}对得上` : ''}。漏勾的由您补选。`
    : '客户没勾场所，请按经营范围和现场情况补选。';
  return (
    <Card title="厂区里的场所" tag={<SourceTag kind="customer" text={customerText} />} hint={hint} gap={16}>
      <div role="group" aria-label="场所" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {(Object.keys(SITE_TYPES) as SiteType[]).map((s) => {
          const on = step.sites.includes(s);
          return (
            <button key={s} type="button" aria-pressed={on} style={chip(on)} onClick={() => toggle(s)}>
              {on && <CheckOutlined aria-hidden style={{ fontSize: 12 }} />}
              {SITE_TYPES[s]}
            </button>
          );
        })}
        {step.customSites.map((c) => (
          <span key={c} style={chip(true)}>
            <CheckOutlined aria-hidden style={{ fontSize: 12 }} />
            {c}
            <button
              type="button"
              aria-label={`去掉「${c}」`}
              style={{ ...link14, color: gy.tertiary }}
              onClick={() => change({ ...step, customSites: step.customSites.filter((x) => x !== c) })}
            >
              <CloseOutlined style={{ fontSize: 12 }} />
            </button>
          </span>
        ))}
        {adding ? (
          <Input
            autoFocus
            aria-label="其他场所名称"
            value={custom}
            maxLength={20}
            placeholder="场所名称，回车添加"
            onChange={(e) => setCustom(e.target.value)}
            onPressEnter={addCustom}
            onBlur={addCustom}
            style={{ width: 200, height: 32, borderRadius: 16 }}
          />
        ) : (
          step.customSites.length < 10 && (
            <button type="button" style={{ ...chip(false), borderStyle: 'dashed', color: gy.secondary }} onClick={() => setAdding(true)}>
              + 其他
            </button>
          )
        )}
      </div>
    </Card>
  );
}

// ── 特种设备与储存设施 ──

type Item = Record<string, unknown> & { id: string };
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

function SpecialCard({
  workup,
  view,
  step,
  judgeSpecial,
  preview,
}: {
  workup: Workup;
  view: ReturnType<typeof productionView>['special'];
  step: Step;
  judgeSpecial: (c: SpecialCategory, v: SpecialJudgement | null, now?: boolean) => void;
  preview: (title: string, files: PreviewFile[], index?: number) => unknown;
}) {
  const others = step.otherSpecialEquipment ?? [];
  return (
    <Card
      title="特种设备与储存设施"
      tag={<SourceTag kind="expert" text="只有专家能填" />}
      hint="客户只答了有没有。参数由您对照铭牌照片或现场核实后填写；拿不准的先标「待补充」，不影响生成。"
      gap={16}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SPECIAL_CATEGORY_KEYS.map((c) => {
          const row = view.find((r) => r.category === c)!;
          return <SpecialBox key={c} workup={workup} row={row} judgeSpecial={judgeSpecial} preview={preview} />;
        })}
      </div>
      {others.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 16px', borderRadius: 6, background: gy.canvas }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>客户另写的特种设备</span>
          {others.map((o) => (
            <span key={o.id} style={{ ...type.body, color: gy.secondary, overflowWrap: 'anywhere' }}>
              {o.description}
            </span>
          ))}
          <span style={caption}>这几项不在上面四类里（如电梯、起重机械、叉车），文稿按客户原话写，需要时在第 5 步补充说明。</span>
        </div>
      )}
      <span style={caption}>拿不准的先标「待补充」，不影响生成，文稿里这一类写「（待补充）」。</span>
    </Card>
  );
}

function SpecialBox({
  workup,
  row,
  judgeSpecial,
  preview,
}: {
  workup: Workup;
  row: ReturnType<typeof productionView>['special'][number];
  judgeSpecial: (c: SpecialCategory, v: SpecialJudgement | null, now?: boolean) => void;
  preview: (title: string, files: PreviewFile[], index?: number) => unknown;
}) {
  const c = row.category;
  const value = row.later ? 'later' : row.answer;
  const items = row.items as Item[];
  const setItems = (next: Item[]) => judgeSpecial(c, { answer: 'yes', items: next }, false);
  const setItem = (id: string, patch: Record<string, unknown>) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const customerSaid =
    row.customer === 'yes' ? '客户答「有」' : row.customer === 'no' ? '客户答「没有」' : row.customer === 'photo' ? '客户拍了照片，请您判断' : '客户没答';
  const photos = row.photoFileIds.map((id) => ({ ...fileInfo(workup, id, '铭牌照片'), note: '客户上传的铭牌照片' }));
  const field = (label: string, node: ReactNode, flex: number | string = 1) => (
    <label style={{ flex, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={head}>{label}</span>
      {node}
    </label>
  );
  const remove = (id: string) => (
    <button type="button" aria-label="删掉这一台" style={{ ...link14, color: gy.tertiary, alignSelf: 'flex-end', lineHeight: '36px' }} onClick={() => setItems(items.filter((i) => i.id !== id))}>
      <CloseOutlined style={{ fontSize: 12 }} />
    </button>
  );
  const rowOf = (i: Item) => {
    if (c === 'pressureVessels') {
      const pv = pressureVolumeOf({ maxWorkingPressureMPa: num(i.maxWorkingPressureMPa), volumeM3: num(i.volumeM3) });
      return (
        <>
          {field('介质', <Input aria-label="介质" value={str(i.medium)} maxLength={30} onChange={(e) => setItem(i.id, { medium: e.target.value })} style={H36} />)}
          {field(
            '最高工作压力',
            <InputNumber
              aria-label="最高工作压力"
              value={num(i.maxWorkingPressureMPa)}
              min={0}
              max={1000}
              suffix="MPa"
              onChange={(v) => setItem(i.id, { maxWorkingPressureMPa: v ?? undefined })}
              style={{ width: '100%' }}
            />,
          )}
          {field(
            '容积',
            <InputNumber aria-label="容积" value={num(i.volumeM3)} min={0} max={100000} suffix="m³" onChange={(v) => setItem(i.id, { volumeM3: v ?? undefined })} style={{ width: '100%' }} />,
          )}
          {field(
            'PV 值 · 自动算',
            <span style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 12px', borderRadius: 6, background: gy.neutralBg, ...type.body, color: gy.text }}>
              {pv !== undefined ? `${pv} MPa · m³` : '—'}
            </span>,
          )}
        </>
      );
    }
    if (c === 'boilers') {
      return (
        <>
          {field(
            '类型',
            <Select
              aria-label="锅炉类型"
              value={str(i.type) || undefined}
              placeholder="选择"
              options={Object.entries(BOILER_TYPES).map(([value, label]) => ({ value, label }))}
              onChange={(v) => setItem(i.id, { type: v })}
              style={{ width: '100%', height: 36 }}
            />,
          )}
          {field('额定参数', <Input aria-label="额定参数" value={str(i.ratedParams)} maxLength={50} placeholder="如 2 t/h，1.25 MPa" onChange={(e) => setItem(i.id, { ratedParams: e.target.value })} style={H36} />, 2)}
        </>
      );
    }
    if (c === 'pressurePipelines') {
      return (
        <>
          {field('介质', <Input aria-label="介质" value={str(i.medium)} maxLength={30} onChange={(e) => setItem(i.id, { medium: e.target.value })} style={H36} />)}
          {field('公称直径', <Input aria-label="公称直径" value={str(i.nominalDiameter)} maxLength={20} placeholder="如 DN50" onChange={(e) => setItem(i.id, { nominalDiameter: e.target.value })} style={H36} />)}
        </>
      );
    }
    return (
      <>
        {field('储存物', <Input aria-label="储存物" value={str(i.substance)} maxLength={30} onChange={(e) => setItem(i.id, { substance: e.target.value })} style={H36} />)}
        {field('储存量', <Input aria-label="储存量" value={str(i.capacity)} maxLength={20} placeholder="如 10 m³" onChange={(e) => setItem(i.id, { capacity: e.target.value })} style={H36} />)}
      </>
    );
  };

  return (
    <div
      role="group"
      aria-label={row.label}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', border: `1px solid ${gy.split}`, borderRadius: 6 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{SPECIAL_LABELS[c]}</span>
          {(value === 'yes' || row.customer !== 'no') && <span style={caption}>{customerSaid}</span>}
        </div>
        <Radio.Group
          aria-label={`${row.label}有没有`}
          optionType="button"
          buttonStyle="solid"
          value={value}
          onChange={(e) => {
            const v = e.target.value as SpecialJudgement['answer'];
            judgeSpecial(c, { answer: v, items: v === 'yes' ? (items.length ? items : [{ id: newId('x') }]) : items });
          }}
          options={[
            { value: 'yes', label: '有' },
            { value: 'no', label: '没有' },
            { value: 'later', label: '待补充' },
          ]}
          style={{ flexShrink: 0 }}
        />
      </div>
      {value === 'yes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((i) => (
            <div key={i.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              {rowOf(i)}
              {items.length > 1 && remove(i.id)}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {items.length < 20 && (
              <button type="button" style={link14} onClick={() => setItems([...items, { id: newId('x') }])}>
                <PlusOutlined /> 再加一台
              </button>
            )}
            <span style={{ flex: 1 }} />
            {photos.length > 0 && (
              <button type="button" style={link14} onClick={() => preview(`${row.label} · 铭牌照片`, photos)}>
                看铭牌照片
              </button>
            )}
          </div>
        </div>
      )}
      {value !== 'yes' && photos.length > 0 && (
        <button type="button" style={{ ...link14, alignSelf: 'flex-start' }} onClick={() => preview(`${row.label} · 铭牌照片`, photos)}>
          看铭牌照片（{photos.length} 张）
        </button>
      )}
    </div>
  );
}

// ── 设备与物料 ──

function TablesCard({
  workup,
  step,
  change,
  customerText,
  uploads,
  onCompare,
  preview,
}: {
  workup: Workup;
  step: Step;
  change: (s: Step) => void;
  customerText: string;
  uploads: ExpertUploads;
  onCompare?: () => void;
  preview: (title: string, files: PreviewFile[], index?: number) => unknown;
}) {
  const original = workup.snapshot.profile.productionStep?.step;
  const customerIds = new Set([...(original?.equipment ?? []).map((e) => e.id), ...(original?.materials ?? []).map((m) => m.id)]);
  const setEq = (id: string, patch: Partial<DraftEquipment>) => change({ ...step, equipment: step.equipment.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const setMat = (id: string, patch: Partial<DraftMaterial>) => change({ ...step, materials: step.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const eqCount = (original?.equipment ?? []).filter((e) => e.name.trim()).length;
  const matCount = (original?.materials ?? []).filter((m) => m.name.trim()).length;
  const added = (id: string) => (customerIds.has(id) ? undefined : <SourceTag kind="expert" text="您添加" />);
  const removeBtn = (label: string, onClick: () => void) => (
    <button type="button" aria-label={label} style={{ ...link14, width: 16, color: gy.tertiary, lineHeight: '36px', flexShrink: 0 }} onClick={onClick}>
      <CloseOutlined style={{ fontSize: 12 }} />
    </button>
  );
  const text = (label: string, value: string | undefined, max: number, onChange: (v: string) => void, extra?: { placeholder?: string; suffix?: ReactNode; width?: number | string }) => (
    <Input
      aria-label={label}
      value={value ?? ''}
      maxLength={max}
      placeholder={extra?.placeholder}
      suffix={extra?.suffix}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...H36, flex: extra?.width === undefined ? 1 : undefined, width: extra?.width, minWidth: 0 }}
    />
  );
  const missing = (v: string | undefined, fromCustomer: boolean) => (!v?.trim() && fromCustomer ? '客户未填' : undefined);

  return (
    <Card
      title="主要设备与原辅材料"
      tag={<SourceTag kind="customer" text={customerText} />}
      extra={onCompare && <Button onClick={onCompare}>对照客户原表</Button>}
      hint={`客户填了 ${eqCount} 台设备、${matCount} 种物料。规格型号没填的可留空；年用量没填的，文稿里会标「待补充」。`}
      gap={16}
    >
      <div role="table" aria-label="设备" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>设备</span>
        <div role="row" style={{ display: 'flex', gap: 8, paddingRight: 24 }}>
          <span style={{ ...head, flex: 2 }}>名称</span>
          <span style={{ ...head, flex: 1.4 }}>规格型号</span>
          <span style={{ ...head, width: 72 }}>数量</span>
          <span style={{ ...head, flex: 1.4 }}>使用部门 / 地点</span>
          <span style={{ ...head, width: 104 }}>使用状况</span>
        </div>
        {step.equipment.map((e) => (
          <div key={e.id} role="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ flex: 2, minWidth: 0, display: 'flex' }}>{text('设备名称', e.name, 50, (v) => setEq(e.id, { name: v }), { suffix: added(e.id) })}</span>
            <span style={{ flex: 1.4, minWidth: 0, display: 'flex' }}>{text('规格型号', e.spec, 50, (v) => setEq(e.id, { spec: v }), { placeholder: '可留空' })}</span>
            <span style={{ width: 72, display: 'flex' }}>
              {text('数量', e.quantity, 20, (v) => setEq(e.id, { quantity: v }), { placeholder: missing(e.quantity, customerIds.has(e.id)) })}
            </span>
            <span style={{ flex: 1.4, minWidth: 0, display: 'flex' }}>{text('使用部门 / 地点', e.location, 50, (v) => setEq(e.id, { location: v }))}</span>
            <AutoComplete
              aria-label="使用状况"
              value={e.condition ?? ''}
              options={EQUIPMENT_CONDITION_OPTIONS.map((value) => ({ value }))}
              onChange={(v) => setEq(e.id, { condition: v.slice(0, 20) })}
              style={{ width: 104, height: 36 }}
            />
            {removeBtn(`删掉设备「${e.name || '未命名'}」`, () => change({ ...step, equipment: step.equipment.filter((x) => x.id !== e.id) }))}
          </div>
        ))}
        {step.equipment.length < 200 && (
          <button type="button" style={{ ...link14, alignSelf: 'flex-start' }} onClick={() => change({ ...step, equipment: [...step.equipment, { id: newId('x'), name: '' }] })}>
            + 添加设备
          </button>
        )}
      </div>
      <span aria-hidden style={{ height: 1, background: softLine }} />
      <div role="table" aria-label="原辅材料" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>原辅材料（含气瓶）</span>
        <div role="row" style={{ display: 'flex', gap: 8, paddingRight: 24 }}>
          <span style={{ ...head, flex: 2 }}>名称</span>
          <span style={{ ...head, width: 84 }}>年用量</span>
          <span style={{ ...head, width: 84 }}>最大存放量</span>
          <span style={{ ...head, flex: 1.2 }}>存放位置</span>
          <span style={{ ...head, width: 160 }}>包装标签</span>
        </div>
        {step.materials.map((m) => (
          <div key={m.id} role="row" aria-label={m.name || '新物料'} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ flex: 2, minWidth: 0, display: 'flex', gap: 6 }}>
              {text(m.kind === 'cylinder' ? '气瓶名称' : '物料名称', m.name, 50, (v) => setMat(m.id, { name: v }), { suffix: added(m.id) })}
              {m.kind === 'cylinder' && text('气瓶规格', m.cylinderSpec, 20, (v) => setMat(m.id, { cylinderSpec: v }), { placeholder: '规格', width: 64 })}
            </span>
            <span style={{ width: 84, display: 'flex' }}>
              {text('年用量', m.annualUsage, 20, (v) => setMat(m.id, { annualUsage: v }), { placeholder: missing(m.annualUsage, customerIds.has(m.id)) })}
            </span>
            <span style={{ width: 84, display: 'flex' }}>
              {text('最大存放量', m.maxStorage, 20, (v) => setMat(m.id, { maxStorage: v }), { placeholder: missing(m.maxStorage, customerIds.has(m.id)) })}
            </span>
            <span style={{ flex: 1.2, minWidth: 0, display: 'flex' }}>{text('存放位置', m.storageLocation, 50, (v) => setMat(m.id, { storageLocation: v }))}</span>
            <span style={{ width: 160, flexShrink: 0 }}>
              <LabelCell workup={workup} material={m} uploads={uploads} preview={preview} />
            </span>
            {removeBtn(`删掉物料「${m.name || '未命名'}」`, () => change({ ...step, materials: step.materials.filter((x) => x.id !== m.id) }))}
          </div>
        ))}
        {step.materials.length < 200 && (
          <span style={{ display: 'flex', gap: 16 }}>
            <button
              type="button"
              style={link14}
              onClick={() => change({ ...step, materials: [...step.materials, { id: newId('x'), kind: 'material', name: '', labelPhotoFileIds: [] }] })}
            >
              + 添加物料
            </button>
            <button
              type="button"
              style={link14}
              onClick={() => change({ ...step, materials: [...step.materials, { id: newId('x'), kind: 'cylinder', name: '', labelPhotoFileIds: [] }] })}
            >
              + 添加气瓶
            </button>
          </span>
        )}
      </div>
    </Card>
  );
}

const pill = (color: string, bg: string, dashed = false): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 10px',
  borderRadius: 6,
  border: `1px ${dashed ? 'dashed' : 'solid'} ${dashed ? gy.controlLine : bg}`,
  background: dashed ? gy.surface : bg,
  color,
  ...type.caption,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  cursor: 'pointer',
  fontFamily: 'inherit',
  width: '100%',
});

// 包装标签一栏：已有 / 缺（代客户上传）/ 纯物质资料库补全 / 一般原料不需要
function LabelCell({ workup, material, uploads, preview }: { workup: Workup; material: DraftMaterial; uploads: ExpertUploads; preview: (title: string, files: PreviewFile[], index?: number) => unknown }) {
  const target = `label:${material.id}`;
  const slot = uploads.slots[target];
  const hint = msdsHintOf(material);
  if (slot?.kind === 'uploading') {
    return (
      <span style={{ ...pill(gy.secondary, gy.neutralBg), cursor: 'default' }}>
        上传中…
        <button type="button" style={{ ...link14, ...type.caption }} onClick={() => uploads.cancel(target)}>
          取消
        </button>
      </span>
    );
  }
  if (slot?.kind === 'failed') {
    return (
      <span role="alert" style={{ ...pill(gy.error, gy.errorBg), cursor: 'default' }}>
        没传上
        <button type="button" style={{ ...link14, ...type.caption }} onClick={() => uploads.retry(target)}>
          重试
        </button>
        <button type="button" style={{ ...link14, ...type.caption }} onClick={() => uploads.remove(target)}>
          移除
        </button>
      </span>
    );
  }
  if (hint === 'label_done') {
    const files = material.labelPhotoFileIds.map((id) => fileInfo(workup, id, '包装标签照片'));
    return (
      <button type="button" style={pill(gy.success, gy.successBg)} onClick={() => preview(`${material.name} · 包装标签`, files)}>
        <CheckOutlined aria-hidden /> 已有包装标签{files.some((f) => f.byExpert) ? ' · 您代传' : ''}
      </button>
    );
  }
  if (hint === 'label_needed') {
    return (
      <button type="button" style={pill(gy.primary, gy.surface, true)} onClick={() => chooseFile(target, (f) => uploads.start(target, f))}>
        <CameraOutlined aria-hidden /> 缺包装标签 · 代客户上传
      </button>
    );
  }
  if (hint === 'knowledge_base') return <span style={{ ...pill(sourceColor.system.color, sourceColor.system.bg), cursor: 'default' }}>纯物质 · 资料库补全</span>;
  if (hint === 'not_needed') return <span style={{ ...type.caption, color: gy.tertiary, lineHeight: '36px' }}>一般原料 · 不需要</span>;
  return null;
}

// ── MSDS ──

function MsdsCard({
  workup,
  step,
  hazards,
  msds,
  judgeHazard,
  uploads,
  preview,
}: {
  workup: Workup;
  step: Step;
  hazards: Map<string, ReturnType<typeof productionView>['materials'][number]['hazard']>;
  msds: Record<string, { fileIds: string[]; later: boolean }>;
  judgeHazard: (rowId: string, v: boolean | null) => void;
  uploads: ExpertUploads;
  preview: (title: string, files: PreviewFile[], index?: number) => unknown;
}) {
  const rows = step.materials.filter((m) => m.name.trim());
  return (
    <Card
      title="化学品安全技术说明书（MSDS）"
      tag={<SourceTag kind="expert" text="只有专家能填" />}
      hint="按上面的原辅材料自动列出，是不是危化品由您按名称和包装标签判断。不是危化品的不需要；纯物质由资料库补全；混合物客户没给的，请客服用企业微信向客户要。"
      gap={16}
    >
      {rows.length === 0 ? (
        <span style={{ ...type.body, color: gy.secondary }}>还没有物料。</span>
      ) : (
        <div style={{ border: `1px solid ${gy.split}`, borderRadius: 6 }}>
          {rows.map((m, i) => {
            const hazard = hazards.get(m.id);
            const need = msdsNeedOf(m);
            const judged = hazard?.decidedBy === 'expert' ? hazard.value : undefined;
            const files = (msds[m.id]?.fileIds ?? []).map((id) => fileInfo(workup, id, 'MSDS'));
            const target = `msds:${m.id}`;
            const slot = uploads.slots[target];
            const general = hazard?.decidedBy === 'system';
            const status: { text: string; color: string; upload?: boolean } =
              judged === false || general
                ? { text: general ? '一般原料 · 不需要' : '不是危化品 · 不需要', color: gy.tertiary }
                : need === 'knowledge_base'
                  ? { text: '纯物质 · 资料库补全，无需上传', color: sourceColor.system.color }
                  : need === 'supplier' || judged === true
                    ? { text: '混合物 · 需供应商提供', color: gy.secondary, upload: true }
                    : { text: '待您补充：是否危化品', color: gy.warning };
            return (
              <div
                key={m.id}
                role="row"
                aria-label={`${m.name} 的 MSDS`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? `1px solid ${softLine}` : undefined, minHeight: 56 }}
              >
                <span style={{ width: 104, flexShrink: 0, ...type.body, color: general ? gy.tertiary : gy.text, overflowWrap: 'anywhere' }}>{m.name}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...type.body, color: status.color }}>{status.text}</span>
                  {status.upload && slot && (
                    <span style={{ ...type.caption, color: slot.kind === 'failed' ? gy.error : gy.secondary }}>
                      {slot.kind === 'uploading' ? `${slot.name} 上传中…` : `${slot.name} 没传上`}{' '}
                      {slot.kind === 'uploading' ? (
                        <button type="button" style={{ ...link14, ...type.caption }} onClick={() => uploads.cancel(target)}>
                          取消
                        </button>
                      ) : (
                        <>
                          <button type="button" style={{ ...link14, ...type.caption }} onClick={() => uploads.retry(target)}>
                            重试
                          </button>{' '}
                          <button type="button" style={{ ...link14, ...type.caption }} onClick={() => uploads.remove(target)}>
                            移除
                          </button>
                        </>
                      )}
                    </span>
                  )}
                  {hazard?.suggestion && judged === undefined && !general && <span style={caption}>系统建议：{hazard.suggestion.reason}</span>}
                </span>
                {!general && (
                  <Select<'yes' | 'no'>
                    aria-label={`${m.name}是否危化品`}
                    size="middle"
                    allowClear
                    value={judged === undefined ? undefined : judged ? 'yes' : 'no'}
                    placeholder={hazard?.suggestion ? `建议：${hazard.suggestion.value ? '是危化品' : '不是'}` : '是否危化品'}
                    options={[
                      { value: 'yes', label: '是危化品' },
                      { value: 'no', label: '不是危化品' },
                    ]}
                    onChange={(v) => judgeHazard(m.id, v === undefined ? null : v === 'yes')}
                    style={{ width: 128, flexShrink: 0 }}
                  />
                )}
                {status.upload && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {files.length > 0 && (
                      <button type="button" style={link14} onClick={() => preview(`${m.name} · MSDS`, files)}>
                        查看 {files.length} 份
                      </button>
                    )}
                    {files.some((f) => f.byExpert) && <SourceTag kind="expert" text="您代传" />}
                    <Button size="middle" disabled={slot?.kind === 'uploading'} onClick={() => chooseFile(target, (f) => uploads.start(target, f))}>
                      {files.length ? '再传一份' : '代客户上传'}
                    </Button>
                    {files.length === 0 && <span style={{ ...type.caption, color: gy.tertiary }}>客户未填</span>}
                  </span>
                )}
                {!status.upload && need === 'knowledge_base' && <CheckOutlined aria-hidden style={{ color: gy.success }} />}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 分租与运输 ──

function LeaseCard({ step, change, customerText }: { step: Step; change: (s: Step) => void; customerText: string }) {
  const yesNo = (label: string, sub: string, value: boolean | undefined, onChange: (v: boolean) => void, more?: ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...type.body, color: gy.text }}>{label}</span>
          <span style={caption}>{sub}</span>
        </div>
        <Radio.Group
          aria-label={label}
          optionType="button"
          buttonStyle="solid"
          value={value === undefined ? undefined : value ? 'yes' : 'no'}
          onChange={(e) => onChange(e.target.value === 'yes')}
          options={[
            { value: 'yes', label: '是' },
            { value: 'no', label: '否' },
          ]}
          style={{ flexShrink: 0 }}
        />
      </div>
      {more}
    </div>
  );
  const v = step.vehicles ?? {};
  const setV = (patch: Partial<NonNullable<Step['vehicles']>>) => change({ ...step, vehicles: { ...v, ...patch } });
  return (
    <Card title="分租与运输" tag={<SourceTag kind="customer" text={customerText} />} gap={16}>
      {yesNo(
        '是否把厂房分租给其他企业（厂中厂）',
        '有分租的，预案需写明与承租方的应急协作。',
        step.leasesPremises,
        (x) => change({ ...step, leasesPremises: x }),
        step.leasesPremises && (
          <Select
            aria-label="承租企业"
            mode="tags"
            value={step.tenants ?? []}
            placeholder="承租企业名称，回车添加"
            maxCount={20}
            onChange={(list: string[]) => change({ ...step, tenants: list.map((t) => t.trim().slice(0, 100)).filter(Boolean) })}
            style={{ width: '100%' }}
            open={false}
          />
        ),
      )}
      <span aria-hidden style={{ height: 1, background: softLine }} />
      {yesNo(
        '有没有自有车辆运输货物',
        '有自有车辆的，需增加道路运输事故的处置内容。',
        step.ownVehicles,
        (x) => change({ ...step, ownVehicles: x }),
        step.ownVehicles && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Input aria-label="车辆数量" value={v.count ?? ''} maxLength={20} placeholder="数量，如 2 辆" onChange={(e) => setV({ count: e.target.value })} style={H36} />
            <Input aria-label="停放位置" value={v.location ?? ''} maxLength={50} placeholder="停放位置" onChange={(e) => setV({ location: e.target.value })} style={H36} />
            <Input aria-label="车辆联系人" value={v.contact ?? ''} maxLength={50} placeholder="联系人" onChange={(e) => setV({ contact: e.target.value })} style={H36} />
            <Input aria-label="联系人电话" value={v.contactPhone ?? ''} maxLength={30} placeholder="电话" onChange={(e) => setV({ contactPhone: e.target.value })} style={H36} />
          </div>
        ),
      )}
    </Card>
  );
}

// ── 第 2 页：工艺 ──

function ProcessPage({
  taskId: _taskId,
  workup,
  step,
  data,
  change,
  autosave,
  run,
  latestVersion,
  saveFigures,
}: {
  taskId: string;
  workup: Workup;
  step: Step;
  data: Workup['data'];
  change: (s: Step) => void;
  autosave: StepProps['autosave'];
  run: () => Promise<void>;
  latestVersion: () => number;
  saveFigures: ReturnType<typeof useSaveFigures>;
}) {
  const { message } = App.useApp();
  const [dragging, setDragging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [undo, setUndo] = useState<{ rowId: string; label: string; before: DraftEquipment[] }[]>([]);
  const [layout, setLayout] = useState<ProcessFigureSettings>(() => workup.data.figures?.process ?? {});
  const [branch, setBranch] = useState<{ from?: string; to?: string; kind: BranchKind } | null>(null);
  const steps = step.process.steps;
  const setSteps = (next: DraftProcessStep[]) => change({ ...step, process: { ...step.process, steps: next } });
  const fig = figuresView(workup.snapshot, { ...data, figures: { ...workup.data.figures, process: layout } }).process;
  const { svg } = processFlowSvg(fig.steps, { perRow: fig.perRow, branches: fig.flowBranches });
  const names = steps.map((s) => s.name.trim()).filter(Boolean);
  const description = step.process.description?.trim();

  const saveLayout = async (next: ProcessFigureSettings) => {
    setLayout(next);
    try {
      await autosave.flush(run);
      const clean = { perRow: next.perRow, branches: next.branches?.length ? next.branches : undefined };
      await saveFigures.mutateAsync({ version: latestVersion(), process: clean.perRow === undefined && !clean.branches ? null : clean });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        message.warning(err.message);
        await autosave.stale();
        return;
      }
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    }
  };

  const moveBefore = (dragId: string, targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const moving = steps.find((s) => s.id === dragId);
    if (!moving) return;
    const after = steps.findIndex((s) => s.id === dragId) < steps.findIndex((s) => s.id === targetId);
    const rest = steps.filter((s) => s.id !== dragId);
    rest.splice(rest.findIndex((s) => s.id === targetId) + (after ? 1 : 0), 0, moving);
    setSteps(rest);
  };

  // 工序用到的设备和设备表核对（名称互相包含就算同一种）
  const rows = step.equipment.filter((e) => e.name.trim());
  const matchOf = (n: string) => rows.find((e) => e.name.includes(n) || n.includes(e.name.trim()));
  const checks = steps.flatMap((s) => (s.name.trim() ? s.equipment.map((eq) => ({ step: s.name, eq, row: matchOf(eq) })) : []));
  const linked = checks.filter((c) => c.row);
  const missing = checks.filter((c, i) => !c.row && checks.findIndex((x) => !x.row && x.eq === c.eq) === i);
  const addEquipment = (eq: string) => {
    const row: DraftEquipment = { id: newId('x'), name: eq.slice(0, 50), quantity: '1 台' };
    setUndo((u) => [...u, { rowId: row.id, label: `${row.name} 1 台`, before: step.equipment }]);
    change({ ...step, equipment: [...step.equipment, row] });
  };
  const undoAdd = (rowId: string) => {
    setUndo((u) => u.filter((x) => x.rowId !== rowId));
    change({ ...step, equipment: step.equipment.filter((e) => e.id !== rowId) });
  };
  const shownUndo = undo.filter((u) => step.equipment.some((e) => e.id === u.rowId));

  const branches = layout.branches ?? [];
  const perRow = layout.perRow ?? 5;

  return (
    <>
      <Card title="按客户原话拆出的工序" hint="对照原话调整：拖动调整先后，点 × 删除不做的工序，名称可直接改。" gap={16}>
        {description && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 16px', borderRadius: 6, background: gy.canvas }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...type.caption, color: gy.secondary }}>客户原话</span>
              <SourceTag kind="customer" text={workup.flow === 'intake' ? '客户表格 · 生产与设备' : '客户填写'} />
            </span>
            <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>「{description}」</span>
          </div>
        )}
        <div role="list" aria-label="工序" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {steps.map((s, i) => (
            <div
              key={s.id}
              role="listitem"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', s.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragging(s.id);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                moveBefore(e.dataTransfer.getData('text/plain') || dragging || '', s.id);
                setDragging(null);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 36,
                padding: '0 8px 0 6px',
                borderRadius: 6,
                border: `1px ${dragging && dragging !== s.id ? 'dashed' : 'solid'} ${dragging && dragging !== s.id ? gy.primary : gy.controlLine}`,
                background: gy.surface,
                opacity: dragging === s.id ? 0.4 : 1,
              }}
            >
              <HolderOutlined aria-hidden style={{ color: gy.tertiary, cursor: 'grab' }} />
              <span style={{ ...type.caption, color: gy.tertiary }}>{i + 1}</span>
              <Input
                aria-label={`第 ${i + 1} 道工序名称`}
                variant="borderless"
                value={s.name}
                maxLength={20}
                status={s.name.trim() ? undefined : 'error'}
                onChange={(e) => setSteps(steps.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                style={{ width: Math.max(3, [...s.name].length) * 14 + 16, padding: '0 2px', ...type.body }}
              />
              <button type="button" aria-label={`删掉工序「${s.name}」`} style={{ ...link14, color: gy.tertiary }} onClick={() => setSteps(steps.filter((x) => x.id !== s.id))}>
                <CloseOutlined style={{ fontSize: 12 }} />
              </button>
            </div>
          ))}
          {steps.length < 40 && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              style={{ height: 36, padding: '0 14px', borderRadius: 6, border: `1px dashed ${gy.controlLine}`, background: gy.surface, color: gy.primary, ...type.body, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              + 添加工序
            </button>
          )}
        </div>
        {steps.length === 0 && <span style={{ ...type.body, color: gy.warning }}>还没有工序。客户没写生产过程的，请按现场情况添加。</span>}
        {(linked.length > 0 || missing.length > 0 || shownUndo.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', borderRadius: 6, background: sourceColor.system.bg }}>
            <span style={{ ...type.caption, color: sourceColor.system.color }}>系统提示</span>
            {linked.length > 0 && (
              <span style={{ ...type.body, color: gy.text }}>
                {linked.map((c) => `「${c.step}」已对上设备表里的「${c.row!.name}${c.row!.quantity ? ` ${c.row!.quantity}` : ''}」`).join('；')}
              </span>
            )}
            {missing.map((c) => (
              <span key={c.eq} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 6, background: gy.warningBg }}>
                <span style={{ flex: 1, ...type.body, color: gy.warning }}>
                  「{c.step}」要用的{c.eq}不在客户的设备表里
                </span>
                <button type="button" style={link14} onClick={() => addEquipment(c.eq)}>
                  加到设备表
                </button>
              </span>
            ))}
            {shownUndo.map((u) => (
              <span key={u.rowId} role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 6, background: gy.successBg }}>
                <span style={{ flex: 1, ...type.body, color: gy.success }}>已把「{u.label}」加到设备表，来源记为「您」</span>
                <button type="button" style={link14} onClick={() => undoAdd(u.rowId)}>
                  撤销
                </button>
              </span>
            ))}
            {shownUndo.length > 0 && <span style={caption}>型号、功率留空，到设备表里可以再补。点「撤销」恢复成点之前的样子。</span>}
          </div>
        )}
      </Card>

      <Card
        title="自动生成的工艺流程图"
        extra={
          names.length > 0 && (
            <button type="button" style={link14} onClick={() => setZoom(true)}>
              放大预览
            </button>
          )
        }
        hint="改动工序后实时更新，默认直接放进预案附图；想调每行几道、加支路，在图下面调。"
        gap={16}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: 16, borderRadius: 6, background: gy.canvas, overflowX: 'auto' }}>
          {names.length ? <img src={svgUrl(svg)} alt="工艺流程图" style={{ maxWidth: '100%' }} /> : <span style={{ ...type.body, color: gy.tertiary }}>有了工序就会画出流程图。</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4, borderTop: `1px solid ${softLine}` }}>
          <span style={{ ...type.caption, color: gy.secondary, paddingTop: 12 }}>想调排版才调</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ width: 84, ...type.body, color: gy.text }}>每行工序数</span>
            <Radio.Group
              aria-label="每行工序数"
              optionType="button"
              value={perRow}
              onChange={(e) => void saveLayout({ ...layout, perRow: e.target.value === 5 ? undefined : e.target.value })}
              options={PER_ROW_OPTIONS.map((n) => ({ value: n, label: n === 0 ? '单行' : String(n) }))}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <span style={{ width: 84, ...type.body, color: gy.text, lineHeight: '32px' }}>支路</span>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {branches.length === 0 && !branch && <span style={{ ...type.body, color: gy.secondary, lineHeight: '32px' }}>没有</span>}
              {branches.map((b) => {
                const valid = b.from !== b.to && names.includes(b.from) && names.includes(b.to);
                return (
                  <span key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, ...type.body, color: valid ? gy.text : gy.tertiary }}>
                    {BRANCH_KINDS[b.kind]}：{b.from} → {b.to}
                    {!valid && <span style={{ ...type.caption, color: gy.warning }}>工序改名或删掉了，这条不画</span>}
                    <button
                      type="button"
                      aria-label="删掉这条支路"
                      style={{ ...link14, color: gy.tertiary }}
                      onClick={() => void saveLayout({ ...layout, branches: branches.filter((x) => x.id !== b.id) })}
                    >
                      <CloseOutlined style={{ fontSize: 12 }} />
                    </button>
                  </span>
                );
              })}
              {branch ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Select aria-label="支路类型" value={branch.kind} options={Object.entries(BRANCH_KINDS).map(([value, label]) => ({ value, label }))} onChange={(kind) => setBranch({ ...branch, kind })} style={{ width: 88 }} />
                  <Select aria-label="从哪道工序" placeholder="从" value={branch.from} options={names.map((value) => ({ value }))} onChange={(from) => setBranch({ ...branch, from })} style={{ width: 140 }} />
                  <span style={{ color: gy.tertiary }}>→</span>
                  <Select aria-label="回到哪道工序" placeholder="回到" value={branch.to} options={names.map((value) => ({ value }))} onChange={(to) => setBranch({ ...branch, to })} style={{ width: 140 }} />
                  <Button
                    type="primary"
                    disabled={!branch.from || !branch.to || branch.from === branch.to}
                    onClick={() => {
                      const b: ProcessBranch = { id: newId('b'), from: branch.from!, to: branch.to!, kind: branch.kind };
                      setBranch(null);
                      void saveLayout({ ...layout, branches: [...branches, b] });
                    }}
                  >
                    添加
                  </Button>
                  <Button onClick={() => setBranch(null)}>取消</Button>
                </span>
              ) : (
                branches.length < 10 &&
                names.length >= 2 && (
                  <button type="button" style={{ ...link14, alignSelf: 'flex-start', lineHeight: '32px' }} onClick={() => setBranch({ kind: 'rework' })}>
                    + 添加返工 / 回用
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </Card>

      <AddStepModal
        open={adding}
        steps={steps}
        equipment={step.equipment.filter((e) => e.name.trim()).map((e) => e.name)}
        onCancel={() => setAdding(false)}
        onAdd={(s, afterId) => {
          setAdding(false);
          const at = afterId === '' ? 0 : steps.findIndex((x) => x.id === afterId) + 1;
          const next = [...steps];
          next.splice(at, 0, s);
          setSteps(next);
        }}
      />
      <Modal title="工艺流程图" open={zoom} footer={null} width={1080} onCancel={() => setZoom(false)} destroyOnHidden>
        <div style={{ display: 'flex', justifyContent: 'center', overflow: 'auto', maxHeight: '70vh' }}>
          <img src={svgUrl(svg)} alt="工艺流程图（放大）" style={{ minWidth: '100%' }} />
        </div>
      </Modal>
    </>
  );
}

// S06 ②：添加工序
function AddStepModal({
  open,
  steps,
  equipment,
  onCancel,
  onAdd,
}: {
  open: boolean;
  steps: DraftProcessStep[];
  equipment: string[];
  onCancel: () => void;
  onAdd: (s: DraftProcessStep, afterId: string) => void;
}) {
  const [name, setName] = useState('');
  const [after, setAfter] = useState('');
  const [eq, setEq] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  return (
    <Modal
      title="添加工序"
      open={open}
      width={480}
      okText="添加"
      cancelText="取消"
      onCancel={onCancel}
      afterOpenChange={(o) => {
        if (!o) return;
        setName('');
        setAfter(steps.at(-1)?.id ?? '');
        setEq([]);
        setTried(false);
      }}
      onOk={() => {
        if (!name.trim()) {
          setTried(true);
          return;
        }
        onAdd({ id: newId('x'), name: name.trim().slice(0, 20), equipment: eq.map((e) => e.trim().slice(0, 50)).filter(Boolean).slice(0, 10) }, after);
      }}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={type.body}>工序名称</span>
          <Input autoFocus value={name} maxLength={20} status={tried && !name.trim() ? 'error' : undefined} placeholder="如：烘干固化" onChange={(e) => setName(e.target.value)} style={H36} />
          {tried && !name.trim() && <span style={{ ...type.caption, color: gy.error }}>请填工序名称</span>}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={type.body}>放在哪道工序后面</span>
          <Select
            aria-label="放在哪道工序后面"
            value={after}
            onChange={setAfter}
            options={[{ value: '', label: '放在最前面' }, ...steps.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.name || '（未命名）'}` }))]}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={type.body}>用到的设备（从设备表里选，可多选）</span>
          <Select aria-label="用到的设备" mode="tags" value={eq} onChange={setEq} maxCount={10} options={equipment.map((value) => ({ value }))} placeholder="不在设备表里的可以直接输入" />
          <span style={caption}>设备表里没有的，添加后会提示您加到设备表。</span>
        </label>
      </div>
    </Modal>
  );
}
