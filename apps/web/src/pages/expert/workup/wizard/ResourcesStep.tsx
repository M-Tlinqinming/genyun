import { CloseOutlined } from '@ant-design/icons';
import {
  CUSTOMER_DRAWINGS,
  contactPhoneError,
  customerGapCount,
  customerGaps,
  DEFAULT_DUTY_HOURS,
  emptyProductionWorkup,
  emptyResourcesExtra,
  EXPERT_DRAWINGS,
  FIRE_GRADES,
  FIRE_RATINGS,
  newId,
  organizationStepView,
  productionStepView,
  QUARTER_KEYS,
  QUARTERS,
  resourcesStepView,
  STANDARD_FIRST_AID_KIT,
  standardFirstAidItems,
  SUPPLY_CATALOG,
  supplyFromCatalog,
  supplyKeysForSites,
  totalBuildingArea,
  workupFacts,
  YES_NO_UNKNOWN_LABELS,
  type DraftBuilding,
  type DraftFirstAidItem,
  type DraftSupply,
  type DrawingFileKey,
  type ExtraContact,
  type FireGrade,
  type ResourcesExtra,
  type ResourcesStep as Step,
  type SupplyKey,
  type YesNoUnknown,
} from '@genyun/shared';
import { Button, Checkbox, Input, InputNumber, Radio, Select } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useIntake } from '../../../../api/intake';
import { useSaveFact, useSaveProduction, useSaveResourcesStep, type Workup } from '../../../../api/workup';
import { SourceTag } from '../../../../components/SourceTag';
import { gy, source as sourceColor, type, weight } from '../../../../theme/tokens';
import { chooseFile, fileInfo, UploadedFile, UploadProgress, useExpertUpload, usePreview, type ExpertUploads, type PreviewFile } from './ExpertFiles';
import { DrawingPagesLink } from './DrawingPages';
import { CompareBar, compareSheets, CompareSheets, type CompareMode } from './OriginalCompare';
import { OriginalSheetCard } from './OriginalSheetCard';
import { caption, Card, link14, softLine, StepTitle, UseCard } from './parts';
import type { StepProps } from './types';

// 资料核对第 4 步「应急资源与图纸」（13 页 E2-4、S03、S05）：物资、药箱与消防水池、厂区建筑、外部应急联系方式、
// 厂区图纸（代客户上传、专家的三张图）、厂区四邻、相邻企业与两项协议。
// 物资、药箱、水池、建筑、就近医院、相邻企业存进专家那份（resourcesStep），派出所、专职消防队、值守时间、四邻存在 resourcesExtra，
// 两样一起存；耐火等级是专家的判断（data.production.fireRatings），应急管理局、消防、街道和两项协议是属地部门的事实（agency.*），
// 和第 1 步改的是同一份。这几样排在同一个自动保存里依次存

const SHEETS = ['应急资源', '建筑与场所'];
const head: CSSProperties = { ...type.caption, color: gy.tertiary };
const H36: CSSProperties = { height: 36 };
const VISIBLE_CHIPS = 5;
const AGENCY_ROWS = [
  ['emergencyBureau', 'agency.emergencyBureau', '区应急管理局'],
  ['fireDept', 'agency.fireDept', '消防救援大队'],
  ['streetOffice', 'agency.streetOffice', '街道办事处'],
] as const;
type AgencyRow = (typeof AGENCY_ROWS)[number][0];

const splitAgency = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  const [name, ...rest] = s ? s.split(' · ') : [''];
  return { name: name!.trim(), phone: rest.join(' · ').trim() };
};
const joinAgency = (name: string, phone: string) => [name.trim(), phone.trim()].filter(Boolean).join(' · ');
const agreementText = (answer: YesNoUnknown, parties?: string) =>
  answer === 'yes' ? [YES_NO_UNKNOWN_LABELS.yes, parties?.trim()].filter(Boolean).join(' · ') : YES_NO_UNKNOWN_LABELS[answer];
const parseAgreement = (v: unknown): { answer?: YesNoUnknown; parties?: string } | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return undefined;
  const [h, ...rest] = s.split(' · ');
  const answer = (Object.keys(YES_NO_UNKNOWN_LABELS) as YesNoUnknown[]).find((k) => YES_NO_UNKNOWN_LABELS[k] === h);
  return answer ? { answer, parties: rest.join(' · ') || undefined } : { answer: 'yes', parties: s };
};

export function ResourcesStep({ taskId, workup, autosave, customerText, frame, onGo, latestVersion }: StepProps) {
  const saveStep = useSaveResourcesStep(taskId);
  const saveJudge = useSaveProduction(taskId);
  const saveFact = useSaveFact(taskId);
  const intake = useIntake(taskId, workup.flow === 'intake');
  const client = useQueryClient();
  const [step, setStep] = useState<Step>(() => resourcesStepView(workup.snapshot, workup.data));
  const [extra, setExtra] = useState<ResourcesExtra>(() => workup.data.resourcesExtra ?? emptyResourcesExtra());
  const ref = useRef({ step, extra });
  const saved = useRef({ step, extra });
  const queue = useRef(new Map<string, () => Promise<unknown>>());
  const [ratings, setRatings] = useState<Record<string, FireGrade | undefined>>(() =>
    Object.fromEntries(Object.entries((workup.data.production ?? emptyProductionWorkup()).fireRatings).map(([k, v]) => [k, v.value])),
  );
  const [mode, setMode] = useState<CompareMode>('items');
  const preview = usePreview();
  const facts = workupFacts(workup.snapshot, workup.data, workup.agencyDistricts);

  const run = async () => {
    const cur = ref.current;
    if (JSON.stringify(cur) !== JSON.stringify(saved.current)) {
      await saveStep.mutateAsync({ version: latestVersion(), step: cur.step, extra: cur.extra });
      saved.current = cur;
    }
    for (const [key, task] of [...queue.current]) {
      await task();
      if (queue.current.get(key) === task) queue.current.delete(key);
    }
  };
  const change = (next: Step) => {
    ref.current = { ...ref.current, step: next };
    setStep(next);
    autosave.schedule(run);
  };
  const changeExtra = (next: ResourcesExtra) => {
    ref.current = { ...ref.current, extra: next };
    setExtra(next);
    autosave.schedule(run);
  };
  const enqueue = (key: string, task: () => Promise<unknown>, now = true) => {
    queue.current.set(key, task);
    if (now) return autosave.flush(run);
    autosave.schedule(run);
    return Promise.resolve(true);
  };
  const rate = (rowId: string, value: FireGrade | null) => {
    setRatings((r) => ({ ...r, [rowId]: value ?? undefined }));
    void enqueue(`fireRating:${rowId}`, () => saveJudge.mutateAsync({ version: latestVersion(), kind: 'fireRating', rowId, value }));
  };
  const setFact = (key: string, value: string | null, now = true) =>
    enqueue(`fact:${key}`, () => saveFact.mutateAsync({ version: latestVersion(), key, value, source: 'expert' }), now);

  const uploads = useExpertUpload({
    taskId,
    autosave: { ...autosave, flush: (task) => autosave.flush(task ?? run) },
    latestVersion,
    onDone: (w) => {
      const s = resourcesStepView(w.snapshot, w.data);
      const e = w.data.resourcesExtra ?? emptyResourcesExtra();
      const put = (cur: { step: Step; extra: ResourcesExtra }) => ({
        step: { ...cur.step, drawings: s.drawings, msds: s.msds, firstAidKit: { ...cur.step.firstAidKit, photoFileIds: s.firstAidKit.photoFileIds } },
        extra: { ...cur.extra, drawings: e.drawings },
      });
      saved.current = put(saved.current);
      ref.current = put(ref.current);
      setStep(ref.current.step);
      setExtra(ref.current.extra);
      void client.invalidateQueries({ queryKey: ['tasks', taskId, 'drawings'] });
    },
  });

  const go = async (n: number, p?: number, stepsDone?: number) => {
    const ok = await autosave.flush(async () => {
      await run();
      if (stepsDone && (workup.data.stepsDone ?? 0) < stepsDone) {
        await saveStep.mutateAsync({ version: latestVersion(), step: ref.current.step, extra: ref.current.extra, stepsDone });
      }
    });
    if (ok) onGo(n, p);
  };

  // 底栏
  const data = { ...workup.data, profile: { ...workup.data.profile, resourcesStep: { step } } };
  const gaps = customerGapCount(customerGaps(workup.snapshot, data, workup.drawings), 4);
  const has = (k: DrawingFileKey) => workup.drawings.some((d) => d.key === k);
  const missingDrawings = (['site_plan', 'evacuation_plan'] as const).filter((k) => !has(k)).map((k) => (k === 'site_plan' ? '总平面图' : '疏散图'));
  const supplies = step.supplies.filter((s) => s.name.trim()).length;
  const note = [
    `${supplies} 项物资`,
    missingDrawings.length ? `缺${missingDrawings.join('、')}` : null,
    gaps ? `${gaps} 项客户未填` : null,
  ]
    .filter(Boolean)
    .join('，');

  const sheets = compareSheets(
    Object.fromEntries(Object.entries(workup.sources).filter(([k]) => k.startsWith('resources.'))),
    { resources: { original: workup.snapshot.profile.resourcesStep?.step, current: step } },
  );

  return frame({
    main: (
      <>
        <StepTitle
          title="核对应急资源与图纸"
          sub="已按客户表格「应急资源」预填。数量明显不合理的请客服核实；耐火等级和危化品判定由您确认。"
          customerText={customerText}
          expertOnly
        />
        {workup.flow === 'intake' && <CompareBar summary="客户表格里这一步用到的：「应急资源」「建筑与场所」" mode={mode} onChange={setMode} />}
        {mode === 'sheet' ? (
          <CompareSheets taskId={taskId} workup={workup} sheets={sheets} />
        ) : (
          <>
            <SuppliesCard workup={workup} step={step} change={change} customerText={customerText} onCompare={workup.flow === 'intake' ? () => setMode('sheet') : undefined} />
            <KitCard workup={workup} step={step} change={change} customerText={customerText} uploads={uploads} preview={preview.open} />
            <BuildingsCard workup={workup} step={step} change={change} customerText={customerText} ratings={ratings} rate={rate} preview={preview.open} />
            <ContactsCard workup={workup} step={step} extra={extra} facts={facts} change={change} changeExtra={changeExtra} setFact={setFact} />
            <DrawingsCard
              taskId={taskId}
              latestVersion={latestVersion}
              workup={workup}
              extra={extra}
              customerText={customerText}
              noEvacuation={Boolean(intake.data?.submission?.noEvacuationMap ?? intake.data?.noEvacuationMap)}
              uploads={uploads}
              preview={preview.open}
            />
            <QuartersCard extra={extra} changeExtra={changeExtra} />
            <NeighborsCard workup={workup} step={step} facts={facts} change={change} customerText={customerText} setFact={setFact} />
          </>
        )}
        {preview.node}
      </>
    ),
    side: (
      <>
        <OriginalSheetCard taskId={taskId} workup={workup} sheets={SHEETS} />
        <UseCard
          lines={[
            '应急资源调查报告要逐项列出物资、数量、位置和保管人；平面图和疏散图是预案必附的图纸。',
            '总平面图和疏散图缺一张都不能生成，发现缺了请客服尽早向客户要。',
          ]}
        />
      </>
    ),
    note: `第 4 步，共 5 步 · ${note}`,
    actions: (
      <>
        <Button onClick={() => void go(3, 2)}>上一步</Button>
        <Button type="primary" loading={saveStep.isPending} onClick={() => void go(5, undefined, 4)}>
          下一步：核对并生成
        </Button>
      </>
    ),
  });
}

// ── 应急物资 ──

function SuppliesCard({ workup, step, change, customerText, onCompare }: { workup: Workup; step: Step; change: (s: Step) => void; customerText: string; onCompare?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const sites = productionStepView(workup.snapshot, workup.data).sites;
  const picked = new Set(step.supplies.map((s) => s.catalogKey).filter(Boolean));
  const unchecked = supplyKeysForSites(sites).filter((k) => !picked.has(k));
  const shown = expanded ? unchecked : unchecked.slice(0, VISIBLE_CHIPS);
  const people = (() => {
    const org = organizationStepView(workup.snapshot, workup.data);
    return [org.commander, ...org.deputies, ...org.groups.flatMap((g) => [g.leader, ...g.members])].filter((p): p is NonNullable<typeof p> => Boolean(p?.name.trim()));
  })();
  const seen = new Set<string>();
  const options = people
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ value: p.id, label: [p.name, p.phone].filter(Boolean).join(' · ') }));
  const setRow = (id: string, patch: Partial<DraftSupply>) => change({ ...step, supplies: step.supplies.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const customerCount = (workup.snapshot.profile.resourcesStep?.step.supplies ?? []).filter((s) => s.name.trim()).length;
  const chip: CSSProperties = {
    height: 28,
    padding: '0 10px',
    borderRadius: 4,
    border: `1px solid ${gy.border}`,
    background: gy.surface,
    color: gy.text,
    ...type.body,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
  return (
    <Card
      title="应急物资与消防设施"
      tag={<SourceTag kind="customer" text={customerText} />}
      extra={onCompare && <Button onClick={onCompare}>对照客户原表</Button>}
      hint={`客户勾了 ${customerCount} 项并填了数量。按所选场所常用的共 ${Object.keys(SUPPLY_CATALOG).length} 项，没勾的视为没有。`}
      gap={12}
    >
      <div role="row" style={{ display: 'flex', gap: 8, paddingLeft: 30 }}>
        <span style={{ ...head, flex: 1 }}>物资名称</span>
        <span style={{ ...head, width: 96 }}>数量</span>
        <span style={{ ...head, width: 200 }}>位置</span>
      </div>
      <div role="table" aria-label="应急物资" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {step.supplies.map((s) => (
          <div key={s.id} role="row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Checkbox
              checked
              aria-label={`去掉「${s.name || '这项物资'}」`}
              onChange={() => change({ ...step, supplies: step.supplies.filter((x) => x.id !== s.id) })}
              style={{ width: 22 }}
            />
            {s.catalogKey ? (
              <span style={{ flex: 1, minWidth: 0, ...type.body, color: gy.text, paddingLeft: 8 }}>{s.name}</span>
            ) : (
              <Input aria-label="物资名称" value={s.name} maxLength={50} placeholder="物资名称" onChange={(e) => setRow(s.id, { name: e.target.value })} style={{ ...H36, flex: 1 }} />
            )}
            <InputNumber
              aria-label={`${s.name}数量`}
              value={s.quantity}
              min={0}
              max={100000}
              precision={0}
              suffix={s.unit}
              onChange={(v) => setRow(s.id, { quantity: v ?? undefined })}
              style={{ width: 96 }}
            />
            <Input aria-label={`${s.name}位置`} value={s.location ?? ''} maxLength={50} onChange={(e) => setRow(s.id, { location: e.target.value })} style={{ ...H36, width: 200 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingLeft: 30 }}>
        {unchecked.length > 0 && <span style={caption}>未勾选：</span>}
        {shown.map((key: SupplyKey) => (
          <button key={key} type="button" style={chip} onClick={() => change({ ...step, supplies: [...step.supplies, supplyFromCatalog(key)] })}>
            {SUPPLY_CATALOG[key].name}
          </button>
        ))}
        {!expanded && unchecked.length > VISIBLE_CHIPS && (
          <button type="button" style={link14} onClick={() => setExpanded(true)}>
            展开其余 {unchecked.length - VISIBLE_CHIPS} 项
          </button>
        )}
        {(expanded || unchecked.length <= VISIBLE_CHIPS) && step.supplies.length < 100 && (
          <button type="button" style={link14} onClick={() => change({ ...step, supplies: [...step.supplies, { id: newId('x'), name: '', unit: '个' }] })}>
            + 其他物资
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 6, background: gy.canvas }}>
        <span style={{ ...type.body, color: gy.text, flexShrink: 0 }}>统一保管人</span>
        <Select
          aria-label="统一保管人"
          allowClear
          placeholder={options.length ? '请选择' : '第 2 步还没有人员'}
          disabled={!options.length}
          value={options.some((o) => o.value === step.custodianId) ? step.custodianId : undefined}
          options={options}
          onChange={(custodianId?: string) => change({ ...step, custodianId })}
          style={{ width: 240 }}
        />
        <span style={caption}>{step.custodianId ? '电话随人员自动带出' : '从第 2 步的人员里选，电话自动带出'}</span>
      </div>
    </Card>
  );
}

// ── 急救药箱与消防水池 ──

const yesNo = (label: string, value: 'yes' | 'no' | undefined, onChange: (v: 'yes' | 'no') => void) => (
  <Radio.Group
    aria-label={label}
    optionType="button"
    buttonStyle="solid"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    options={[
      { value: 'yes', label: '有' },
      { value: 'no', label: '没有' },
    ]}
    style={{ flexShrink: 0, display: 'flex' }}
  />
);
const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', border: `1px solid ${gy.split}`, borderRadius: 6 };

function KitCard({
  workup,
  step,
  change,
  customerText,
  uploads,
  preview,
}: {
  workup: Workup;
  step: Step;
  change: (s: Step) => void;
  customerText: string;
  uploads: ExpertUploads;
  preview: (title: string, files: PreviewFile[], index?: number) => unknown;
}) {
  const [editing, setEditing] = useState(false);
  const kit = step.firstAidKit;
  const pool = step.firePool;
  const setKit = (patch: Partial<Step['firstAidKit']>) => change({ ...step, firstAidKit: { ...kit, ...patch } });
  const setPool = (patch: Partial<Step['firePool']>) => change({ ...step, firePool: { ...pool, ...patch } });
  const items = kit.items.length ? kit.items : kit.mode === 'standard' ? standardFirstAidItems() : [];
  const setItem = (id: string, patch: Partial<DraftFirstAidItem>) => setKit({ items: items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const photos = kit.photoFileIds.map((id) => fileInfo(workup, id, '药箱照片'));
  const slot = uploads.slots.firstAid;
  const modeChip = (on: boolean): CSSProperties => ({
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
  return (
    <Card title="急救药箱与消防水池" tag={<SourceTag kind="customer" text={customerText} />} gap={12}>
      <div role="group" aria-label="急救药箱" style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ flex: 1, ...type.body, fontWeight: weight.strong, color: gy.text }}>急救药箱</span>
          {yesNo('有没有急救药箱', kit.answer, (answer) => setKit({ answer, items: answer === 'yes' && !kit.items.length && kit.mode === 'standard' ? standardFirstAidItems() : kit.items }))}
        </div>
        {kit.answer === 'yes' && (
          <>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" aria-pressed={kit.mode === 'standard'} style={modeChip(kit.mode === 'standard')} onClick={() => setKit({ mode: 'standard', items: standardFirstAidItems() })}>
                按常规配置
              </button>
              <button type="button" aria-pressed={kit.mode === 'manual'} style={modeChip(kit.mode === 'manual')} onClick={() => setKit({ mode: 'manual' })}>
                逐项列出
              </button>
            </span>
            {kit.mode === 'standard' && !editing ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <span style={{ flex: 1, ...type.body, color: gy.text }}>{items.map((i) => `${i.name} ${i.quantity ?? ''} ${i.unit ?? ''}`.trim()).join(' · ')}</span>
                <button type="button" style={{ ...link14, flexShrink: 0 }} onClick={() => setEditing(true)}>
                  改数量
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {kit.mode === 'standard' ? (
                      <span style={{ flex: 1, ...type.body, color: gy.text }}>{i.name}</span>
                    ) : (
                      <Input aria-label="药品名称" value={i.name} maxLength={30} placeholder="药品名称" onChange={(e) => setItem(i.id, { name: e.target.value })} style={{ ...H36, flex: 1 }} />
                    )}
                    <InputNumber aria-label={`${i.name || '药品'}数量`} value={i.quantity} min={0} max={100000} precision={0} onChange={(v) => setItem(i.id, { quantity: v ?? undefined })} style={{ width: 88 }} />
                    <Input aria-label={`${i.name || '药品'}单位`} value={i.unit ?? ''} maxLength={10} placeholder="单位" onChange={(e) => setItem(i.id, { unit: e.target.value })} style={{ ...H36, width: 64 }} />
                    {kit.mode === 'manual' && (
                      <button type="button" aria-label="删掉这一项" style={{ ...link14, color: gy.tertiary }} onClick={() => setKit({ items: items.filter((x) => x.id !== i.id) })}>
                        <CloseOutlined style={{ fontSize: 12 }} />
                      </button>
                    )}
                  </div>
                ))}
                <span style={{ display: 'flex', gap: 16 }}>
                  {kit.mode === 'manual' && items.length < 50 && (
                    <button type="button" style={link14} onClick={() => setKit({ items: [...items, { id: newId('x'), name: '' }] })}>
                      + 添加药品
                    </button>
                  )}
                  {kit.mode === 'standard' && (
                    <button type="button" style={link14} onClick={() => setEditing(false)}>
                      改好了
                    </button>
                  )}
                </span>
                {kit.mode === 'manual' && !items.some((i) => i.name.trim()) && (
                  <span style={caption}>常规配置是 {STANDARD_FIRST_AID_KIT.map(([n]) => n).join('、')}。</span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ flex: 1, ...caption }}>
                {photos.length
                  ? `药箱照片：${photos.some((p) => !p.byExpert) ? '客户' : '您'}附了 ${photos.length} 张，可对照上面的药品清单核对`
                  : '药箱照片：客户没附，有的话可以代客户上传'}
              </span>
              {slot ? (
                <span style={{ width: 200 }}>
                  <UploadProgress state={slot} onCancel={() => uploads.cancel('firstAid')} onRetry={() => uploads.retry('firstAid')} onRemove={() => uploads.remove('firstAid')} />
                </span>
              ) : (
                <>
                  {photos.length > 0 && (
                    <Button style={{ borderStyle: 'dashed', color: gy.primary }} onClick={() => preview('急救药箱照片', photos)}>
                      查看照片
                    </Button>
                  )}
                  <button type="button" style={link14} onClick={() => chooseFile('firstAid', (f) => uploads.start('firstAid', f))}>
                    {photos.length ? '再传一张' : '代客户上传'}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div role="group" aria-label="消防水池" style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>消防水池</span>
            <span style={caption}>园区共用的也算</span>
          </span>
          {yesNo('有没有消防水池', pool.answer, (answer) => setPool({ answer }))}
        </div>
        {pool.answer === 'yes' && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 140 }}>
              <span style={head}>数量</span>
              <InputNumber aria-label="消防水池数量" value={pool.count} min={1} max={100} precision={0} suffix="个" onChange={(v) => setPool({ count: v ?? undefined })} style={{ width: '100%' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <span style={head}>容积</span>
              <InputNumber
                aria-label="消防水池容积"
                value={pool.volumeLater ? undefined : pool.volumeM3}
                disabled={pool.volumeLater}
                placeholder="容积"
                min={0}
                max={10000000}
                suffix="m³"
                onChange={(v) => setPool({ volumeM3: v ?? undefined })}
                style={{ width: '100%' }}
              />
            </label>
            <Checkbox checked={pool.volumeLater} onChange={(e) => setPool({ volumeLater: e.target.checked })} style={{ lineHeight: '36px', whiteSpace: 'nowrap' }}>
              先留空，文稿标「待补充」
            </Checkbox>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── 厂区建筑 ──

function BuildingsCard({
  workup,
  step,
  change,
  customerText,
  ratings,
  rate,
  preview,
}: {
  workup: Workup;
  step: Step;
  change: (s: Step) => void;
  customerText: string;
  ratings: Record<string, FireGrade | undefined>;
  rate: (rowId: string, v: FireGrade | null) => void;
  preview: (title: string, files: PreviewFile[], index?: number) => unknown;
}) {
  const setRow = (id: string, patch: Partial<DraftBuilding>) => change({ ...step, buildings: step.buildings.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const customerCount = (workup.snapshot.profile.resourcesStep?.step.buildings ?? []).filter((b) => b.name.trim()).length;
  const total = totalBuildingArea(step.buildings);
  const acceptance = step.fireAcceptanceFileIds.map((id) => fileInfo(workup, id, '消防验收资料'));
  return (
    <Card title="厂区建筑" tag={<SourceTag kind="customer" text={customerText} />} hint={`客户填了 ${customerCount} 栋。耐火等级客户不填，由您按消防验收资料或建筑结构判断。`} gap={12}>
      <div role="row" style={{ display: 'flex', gap: 8, paddingRight: 24 }}>
        <span style={{ ...head, flex: 1 }}>建筑名称</span>
        <span style={{ ...head, width: 120 }}>耐火等级</span>
        <span style={{ ...head, width: 80 }}>层数</span>
        <span style={{ ...head, width: 120 }}>建筑面积</span>
      </div>
      <div role="table" aria-label="厂区建筑" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {step.buildings.map((b) => {
          const value = ratings[b.id] ?? (b.fireRating !== 'expert' ? b.fireRating : undefined);
          const missing = !value && b.name.trim();
          return (
            <div key={b.id} role="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input aria-label="建筑名称" value={b.name} maxLength={50} onChange={(e) => setRow(b.id, { name: e.target.value })} style={{ ...H36, flex: 1 }} />
              <Select<FireGrade>
                aria-label={`${b.name || '建筑'}耐火等级`}
                value={value}
                placeholder="待您补充"
                allowClear={Boolean(ratings[b.id])}
                options={FIRE_GRADES.map((g) => ({ value: g, label: FIRE_RATINGS[g] }))}
                onChange={(v) => rate(b.id, v ?? null)}
                className={missing ? 'gy-expert-pending' : undefined}
                style={{ width: 120, height: 36 }}
                styles={missing ? { root: { background: sourceColor.expert.bg, borderColor: '#D6D0F2' } } : undefined}
              />
              <InputNumber aria-label={`${b.name || '建筑'}层数`} value={b.floors} min={1} max={200} precision={0} onChange={(v) => setRow(b.id, { floors: v ?? undefined })} style={{ width: 80 }} />
              <InputNumber aria-label={`${b.name || '建筑'}面积`} value={b.areaM2} min={0} max={10000000} suffix="m²" onChange={(v) => setRow(b.id, { areaM2: v ?? undefined })} style={{ width: 120 }} />
              <button
                type="button"
                aria-label={`删掉建筑「${b.name || '未命名'}」`}
                style={{ ...link14, width: 16, color: gy.tertiary }}
                onClick={() => change({ ...step, buildings: step.buildings.filter((x) => x.id !== b.id) })}
              >
                <CloseOutlined style={{ fontSize: 12 }} />
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {step.buildings.length < 50 && (
          <button type="button" style={link14} onClick={() => change({ ...step, buildings: [...step.buildings, { id: newId('x'), name: '', fireRating: 'expert' }] })}>
            + 添加建筑
          </button>
        )}
        {acceptance.length > 0 && (
          <button type="button" style={link14} onClick={() => preview('消防验收资料', acceptance)}>
            查看消防验收资料
          </button>
        )}
        <span style={{ flex: 1 }} />
        {total > 0 && <span style={{ ...type.caption, color: gy.secondary }}>合计 {total} m²，已回填到第 1 步「总建筑面积」</span>}
      </div>
    </Card>
  );
}

// ── 外部应急联系方式（S05：点「修改」就地展开成表单） ──

interface ContactForm {
  agency: Record<AgencyRow, { name: string; phone: string; hours: string }>;
  police: ExtraContact;
  brigade: ExtraContact & { none: boolean };
  hospital: { name: string; phone: string; hours: string };
}

function ContactsCard({
  workup,
  step,
  extra,
  facts,
  change,
  changeExtra,
  setFact,
}: {
  workup: Workup;
  step: Step;
  extra: ResourcesExtra;
  facts: ReturnType<typeof workupFacts>;
  change: (s: Step) => void;
  changeExtra: (e: ResourcesExtra) => void;
  setFact: (key: string, value: string | null, now?: boolean) => Promise<boolean>;
}) {
  const [form, setForm] = useState<ContactForm | null>(null);
  const [tried, setTried] = useState(false);
  const agencyOf = (key: string) => {
    const f = facts.find((x) => x.key === key);
    return { ...splitAgency(f?.value), byExpert: Boolean(f?.override) };
  };
  const hours = (h: string | undefined) => h?.trim() || DEFAULT_DUTY_HOURS;
  const neighbours = step.neighbors.answer === 'has' ? step.neighbors.items.filter((n) => n.name.trim()).length : 0;
  const pending = <span style={{ ...type.body, color: gy.warning }}>待您补充</span>;
  const tagText = (text: string, color: string = sourceColor.expert.color) => <span style={{ color }}> · {text}</span>;

  const open = () => {
    setTried(false);
    setForm({
      agency: Object.fromEntries(
        AGENCY_ROWS.map(([row, key]) => {
          const a = agencyOf(key);
          return [row, { name: a.name, phone: a.phone, hours: extra.hours[row] ?? '' }];
        }),
      ) as ContactForm['agency'],
      police: { ...extra.police },
      brigade: { none: false, ...extra.brigade },
      hospital: { name: step.hospital?.name ?? '', phone: step.hospital?.phone ?? '', hours: extra.hours.hospital ?? '' },
    });
  };
  const errors = (f: ContactForm) => [
    ...AGENCY_ROWS.map(([row]) => contactPhoneError(f.agency[row].phone)),
    contactPhoneError(f.police.phone),
    f.brigade.none ? null : contactPhoneError(f.brigade.phone),
    contactPhoneError(f.hospital.phone),
  ];
  const submit = async () => {
    if (!form) return;
    setTried(true);
    if (errors(form).some(Boolean)) return;
    const hoursOf = (h: string) => (h.trim() && h.trim() !== DEFAULT_DUTY_HOURS ? h.trim() : undefined);
    const nextHours = Object.fromEntries(
      [...AGENCY_ROWS.map(([row]) => [row, hoursOf(form.agency[row].hours)] as const), ['hospital', hoursOf(form.hospital.hours)] as const].filter(([, v]) => v),
    );
    const trim = (c: ExtraContact) => ({ name: c.name?.trim() || undefined, phone: c.phone?.trim() || undefined, hours: hoursOf(c.hours ?? '') });
    changeExtra({ ...extra, police: trim(form.police), brigade: { ...trim(form.brigade), none: form.brigade.none }, hours: nextHours });
    const h = form.hospital;
    const before = step.hospital ?? {};
    if ((before.name ?? '') !== h.name.trim() || (before.phone ?? '') !== h.phone.trim()) {
      change({ ...step, hospital: { ...before, name: h.name.trim() || undefined, phone: h.phone.trim() || undefined } });
    }
    let last: Promise<boolean> = Promise.resolve(true);
    for (const [row, key] of AGENCY_ROWS) {
      const a = agencyOf(key);
      const next = form.agency[row];
      if (a.name === next.name.trim() && a.phone === next.phone.trim()) continue;
      last = setFact(key, joinAgency(next.name, next.phone) || null, false);
    }
    void last;
    setForm(null);
  };

  if (form) {
    const err = tried ? errors(form) : [];
    const cell = (label: string, value: string, onChange: (v: string) => void, opts: { error?: string | null; placeholder?: string; max?: number; disabled?: boolean } = {}) => (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <Input
          aria-label={label}
          value={value}
          maxLength={opts.max ?? 30}
          placeholder={opts.placeholder}
          disabled={opts.disabled}
          status={opts.error ? 'error' : undefined}
          onChange={(e) => onChange(e.target.value)}
          style={H36}
        />
        {opts.error && <span style={{ ...type.caption, color: gy.error }}>{opts.error}</span>}
      </span>
    );
    const row = (unit: ReactNode, phone: ReactNode, hoursNode: ReactNode, key: string) => (
      <div key={key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 288, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>{unit}</span>
        <span style={{ width: 200, flexShrink: 0, display: 'flex' }}>{phone}</span>
        <span style={{ flex: 1, display: 'flex' }}>{hoursNode}</span>
      </div>
    );
    const setAgency = (r: AgencyRow, patch: Partial<ContactForm['agency'][AgencyRow]>) => setForm({ ...form, agency: { ...form.agency, [r]: { ...form.agency[r], ...patch } } });
    return (
      <Card title="外部应急联系方式" hint="号码不对可以直接改。值守时间不写默认「24 小时」。" gap={16}>
        <div style={{ display: 'flex', gap: 12, paddingBottom: 8, borderBottom: `1px solid ${softLine}` }}>
          <span style={{ ...head, width: 288 }}>单位</span>
          <span style={{ ...head, width: 200 }}>电话</span>
          <span style={head}>值守时间</span>
        </div>
        {AGENCY_ROWS.map(([r, , label], i) =>
          row(
            <>
              {cell(`${label}名称`, form.agency[r].name, (v) => setAgency(r, { name: v }), { placeholder: label, max: 50 })}
              <span style={{ ...type.caption, color: sourceColor.system.color }}>按地址带出</span>
            </>,
            cell(`${label}电话`, form.agency[r].phone, (v) => setAgency(r, { phone: v }), { error: err[i] }),
            cell(`${label}值守时间`, form.agency[r].hours, (v) => setAgency(r, { hours: v }), { placeholder: DEFAULT_DUTY_HOURS, max: 20 }),
            r,
          ),
        )}
        {row(
          <>
            {cell('派出所名称', form.police.name ?? '', (v) => setForm({ ...form, police: { ...form.police, name: v } }), { placeholder: '派出所', max: 50 })}
            <span style={{ ...type.caption, color: sourceColor.expert.color }}>由您填写</span>
          </>,
          cell('派出所电话', form.police.phone ?? '', (v) => setForm({ ...form, police: { ...form.police, phone: v } }), { error: err[3] }),
          cell('派出所值守时间', form.police.hours ?? '', (v) => setForm({ ...form, police: { ...form.police, hours: v } }), { placeholder: DEFAULT_DUTY_HOURS, max: 20 }),
          'police',
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 288, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {cell('专职消防队名称', form.brigade.none ? '' : (form.brigade.name ?? ''), (v) => setForm({ ...form, brigade: { ...form.brigade, name: v } }), {
              placeholder: '专职消防队',
              max: 50,
              disabled: form.brigade.none,
            })}
            {!form.brigade.none && <span style={{ ...type.caption, color: sourceColor.expert.color }}>由您填写，没有可不填</span>}
          </span>
          {form.brigade.none ? (
            <Checkbox checked onChange={() => setForm({ ...form, brigade: { ...form.brigade, none: false } })} style={{ lineHeight: '36px' }}>
              附近没有专职消防队，预案里不写这一行
            </Checkbox>
          ) : (
            <>
              <span style={{ width: 200, flexShrink: 0, display: 'flex' }}>
                {cell('专职消防队电话', form.brigade.phone ?? '', (v) => setForm({ ...form, brigade: { ...form.brigade, phone: v } }), { error: err[4] })}
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cell('专职消防队值守时间', form.brigade.hours ?? '', (v) => setForm({ ...form, brigade: { ...form.brigade, hours: v } }), { placeholder: DEFAULT_DUTY_HOURS, max: 20 })}
                <Checkbox checked={false} onChange={() => setForm({ ...form, brigade: { ...form.brigade, none: true } })}>
                  附近没有
                </Checkbox>
              </span>
            </>
          )}
        </div>
        {row(
          <>
            {cell('就近医院名称', form.hospital.name, (v) => setForm({ ...form, hospital: { ...form.hospital, name: v } }), { placeholder: '就近医院', max: 50 })}
            <span style={{ ...type.caption, color: sourceColor.customer.color }}>{workup.flow === 'intake' ? '客户表格' : '客户填写'}，请您核对</span>
          </>,
          cell('就近医院电话', form.hospital.phone, (v) => setForm({ ...form, hospital: { ...form.hospital, phone: v } }), { error: err[5] }),
          cell('就近医院值守时间', form.hospital.hours, (v) => setForm({ ...form, hospital: { ...form.hospital, hours: v } }), { placeholder: DEFAULT_DUTY_HOURS, max: 20 }),
          'hospital',
        )}
        <span style={caption}>110 / 119 / 120 / 122 和客户填的相邻企业照常写进预案，这里不用改。</span>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 16, borderTop: `1px solid ${softLine}` }}>
          <Button onClick={() => setForm(null)}>取消</Button>
          <Button type="primary" onClick={() => void submit()}>
            保存
          </Button>
        </div>
      </Card>
    );
  }

  const line = (key: string, unit: ReactNode, phone: ReactNode, h: string | undefined) => (
    <div key={key} role="row" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 26 }}>
      <span style={{ flex: 1, minWidth: 0, ...type.body, color: gy.text }}>{unit}</span>
      <span style={{ width: 140, ...type.body, color: gy.text }}>{phone}</span>
      <span style={{ width: 56, ...type.caption, color: gy.tertiary, textAlign: 'right' }}>{h}</span>
    </div>
  );
  const hosp = step.hospital;
  return (
    <Card
      title="外部应急联系方式"
      tag={<SourceTag kind="system" text="属地部门按地址带出" />}
      extra={
        <button type="button" style={link14} onClick={open}>
          修改
        </button>
      }
      hint="写进预案的外部通讯录。应急管理局、消防、街道按地址带出；派出所、专职消防队由您填写；就近医院来自客户表格，请您核对，客户没填的由您填。号码不对可以直接改。"
      gap={10}
    >
      <div role="table" aria-label="外部应急联系方式" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {AGENCY_ROWS.map(([r, key, label]) => {
          const a = agencyOf(key);
          return line(r, a.name || <>{label}{tagText('没匹配到，请您填写', gy.warning)}</>, a.phone || pending, hours(extra.hours[r]))}
        )}
        {line(
          'police',
          extra.police?.name?.trim() ? extra.police.name : <>派出所{tagText('由您填写')}</>,
          extra.police?.phone?.trim() || pending,
          hours(extra.police?.hours),
        )}
        {extra.brigade?.none
          ? line('brigade', <>专职消防队{tagText('附近没有专职消防队，预案里不写这一行', gy.tertiary)}</>, null, undefined)
          : line(
              'brigade',
              extra.brigade?.name?.trim() ? extra.brigade.name : <>专职消防队{tagText('由您填写，没有可不填')}</>,
              extra.brigade?.phone?.trim() || pending,
              hours(extra.brigade?.hours),
            )}
        {line(
          'hospital',
          <>
            就近医院{hosp?.name?.trim() ? ` · ${hosp.name}` : ''}
            {tagText(hosp?.name?.trim() ? `${workup.flow === 'intake' ? '客户表格' : '客户填写'}，请您核对` : '客户没填，由您填写', sourceColor.customer.color)}
          </>,
          hosp?.phone?.trim() || pending,
          hours(extra.hours.hospital),
        )}
      </div>
      <span style={caption}>另含 110 / 120 / 122 等公共电话{neighbours ? `，以及客户填的相邻企业 ${neighbours} 家` : ''}</span>
    </Card>
  );
}

// ── 厂区图纸 ──

const DRAWING_HINTS: Record<DrawingFileKey, string> = {
  site_plan: '',
  evacuation_plan: '车间墙上张贴的疏散图拍照即可，请客服向客户要。',
  fire_facility_plan: '客户未附，选填。没有的话，文稿里不放这张图',
  surroundings_map: '标出厂区四邻。请在地图上截图后上传；暂时没有的，文稿里标「待补充」。',
  hospital_route: '按上方「外部应急联系方式」里核对后的就近医院，在地图上截取路线后上传；暂时没有的，文稿里标「待补充」。',
  traffic_map: '在地图上截取厂区到周边主要道路的范围后上传；暂时没有的，文稿里标「待补充」。',
};

function DrawingsCard({
  taskId,
  latestVersion,
  workup,
  extra,
  customerText,
  noEvacuation,
  uploads,
  preview,
}: {
  taskId: string;
  latestVersion: () => number;
  workup: Workup;
  extra: ResourcesExtra;
  customerText: string;
  noEvacuation: boolean;
  uploads: ExpertUploads;
  preview: (title: string, files: PreviewFile[], index?: number) => unknown;
}) {
  void extra;
  const labels: Record<DrawingFileKey, string> = { ...CUSTOMER_DRAWINGS, ...EXPERT_DRAWINGS };
  const tile = (key: DrawingFileKey) => {
    const target = `drawing:${key}`;
    const slot = uploads.slots[target];
    const files = workup.drawings.filter((d) => d.key === key).map((d) => ({ ...fileInfo(workup, d.fileId, d.name), contentType: d.contentType }));
    const expertKey = key in EXPERT_DRAWINGS;
    const required = key === 'site_plan' || key === 'evacuation_plan';
    const done = files.length > 0;
    const view = (i: number) => preview(labels[key], files as PreviewFile[], i);
    const pick = (replace?: string) => chooseFile(target, (f) => uploads.start(target, f, replace));
    const failed = slot?.kind === 'failed';
    const style: CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: 16,
      minHeight: 148,
      borderRadius: 6,
      border: `1px ${done || failed ? 'solid' : 'dashed'} ${failed ? gy.error : done ? '#B7E1C6' : gy.controlLine}`,
      background: done && !slot ? gy.successBg : gy.surface,
    };
    return (
      <div key={key} role="group" aria-label={labels[key]} style={style}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{labels[key]}</span>
          {expertKey ? (
            <SourceTag kind="expert" text="由您上传" />
          ) : required ? (
            <span style={{ ...type.caption, color: gy.error }}>必需</span>
          ) : (
            <span style={{ ...type.caption, color: gy.tertiary }}>选填</span>
          )}
        </span>
        {slot ? (
          <UploadProgress state={slot} onCancel={() => uploads.cancel(target)} onRetry={() => uploads.retry(target)} onRemove={() => uploads.remove(target)} />
        ) : done ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {files.map((f, i) => (
              <div key={f.fileId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <UploadedFile
                  file={f}
                  onView={() => view(i)}
                  onReplace={f.byExpert ? () => pick(f.fileId) : undefined}
                  extra={
                    i === files.length - 1 && (
                      <button type="button" style={link14} onClick={() => pick()}>
                        再传一张
                      </button>
                    )
                  }
                />
                {f.contentType === 'application/pdf' && <DrawingPagesLink taskId={taskId} workup={workup} fileId={f.fileId} latestVersion={latestVersion} />}
              </div>
            ))}
          </div>
        ) : (
          <>
            {key === 'evacuation_plan' && noEvacuation && (
              <span style={{ alignSelf: 'flex-start', padding: '0 8px', borderRadius: 4, background: gy.warningBg, ...type.caption, color: gy.warning }}>客户说明没有</span>
            )}
            <span style={{ ...type.body, color: gy.secondary }}>
              {key === 'site_plan'
                ? '客户没传总平面图，缺了不能生成，请客服向客户要。'
                : key === 'evacuation_plan'
                  ? `${noEvacuation ? '客户提交时说明没有这张图。' : '客户没传这张图。'}${DRAWING_HINTS.evacuation_plan}`
                  : DRAWING_HINTS[key]}
            </span>
            <button type="button" style={{ ...link14, alignSelf: 'flex-start' }} onClick={() => pick()}>
              {expertKey ? '上传' : '代客户上传'}
            </button>
          </>
        )}
      </div>
    );
  };
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 };
  return (
    <Card
      title="厂区图纸"
      tag={<SourceTag kind="customer" text={customerText} />}
      hint="前三张是客户随表格附的图纸。周边环境图、到医院路线图、公司外部交通图这一期由您上传，系统不生成。"
      gap={12}
    >
      <div style={grid}>{(Object.keys(CUSTOMER_DRAWINGS) as DrawingFileKey[]).map(tile)}</div>
      <div style={grid}>{(Object.keys(EXPERT_DRAWINGS) as DrawingFileKey[]).map(tile)}</div>
      <span style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderRadius: 6, background: gy.canvas, ...type.body, color: gy.secondary }}>
        缺图纸或看不清的，请客服用企业微信向客户要。
      </span>
    </Card>
  );
}

// ── 厂区四邻 ──

function QuartersCard({ extra, changeExtra }: { extra: ResourcesExtra; changeExtra: (e: ResourcesExtra) => void }) {
  return (
    <Card
      title="厂区四邻"
      tag={
        <>
          <SourceTag kind="expert" text="只有专家能填" />
          <span style={{ padding: '0 8px', borderRadius: 4, background: gy.neutralBg, ...type.caption, color: gy.secondary }}>选填</span>
        </>
      }
      hint="东南西北各挨着什么，写进预案正文的地理位置一段（「东临××、南临××」）。对照周边环境图或地图填写，可以是企业、道路、河道、空地；不填的方向正文里不写。"
      gap={12}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {QUARTER_KEYS.map((k) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...type.body, color: gy.text }}>{QUARTERS[k]}</span>
            <Input
              aria-label={`${QUARTERS[k]}邻`}
              value={extra.quarters[k] ?? ''}
              maxLength={50}
              placeholder="例如：空地、河道、××公司"
              onChange={(e) => changeExtra({ ...extra, quarters: { ...extra.quarters, [k]: e.target.value } })}
              style={H36}
            />
          </label>
        ))}
      </div>
    </Card>
  );
}

// ── 相邻企业与两项协议 ──

function NeighborsCard({
  workup,
  step,
  facts,
  change,
  customerText,
  setFact,
}: {
  workup: Workup;
  step: Step;
  facts: ReturnType<typeof workupFacts>;
  change: (s: Step) => void;
  customerText: string;
  setFact: (key: string, value: string | null, now?: boolean) => Promise<boolean>;
}) {
  const n = step.neighbors;
  const setN = (patch: Partial<Step['neighbors']>) => change({ ...step, neighbors: { ...n, ...patch } });
  const items = n.answer === 'has' || (n.answer === undefined && n.items.length) ? n.items : [];
  const setItem = (id: string, patch: Partial<Step['neighbors']['items'][number]>) => setN({ items: items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const word = (on: boolean): CSSProperties => ({ ...link14, color: on ? gy.primary : gy.secondary, fontWeight: on ? weight.strong : undefined });
  return (
    <Card
      title="相邻企业"
      tag={
        <>
          <SourceTag kind="customer" text={customerText} />
          <span style={{ padding: '0 8px', borderRadius: 4, background: gy.neutralBg, ...type.caption, color: gy.secondary }}>选填</span>
        </>
      }
      hint="发生事故时需要互相通知。应急管理局、消防、街道的电话系统已按地址带出；就近医院来自客户表格，在本步「外部应急联系方式」里由您核对。"
      gap={12}
    >
      {items.map((x) => (
        <div key={x.id} role="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input aria-label="相邻企业名称" value={x.name} maxLength={50} placeholder="企业名称" onChange={(e) => setItem(x.id, { name: e.target.value })} style={{ ...H36, flex: 1.6 }} />
          <Input aria-label="相邻企业联系方式" value={x.contact ?? ''} maxLength={50} placeholder="门卫、保安室电话" onChange={(e) => setItem(x.id, { contact: e.target.value })} style={{ ...H36, flex: 1 }} />
          <button
            type="button"
            aria-label={`删掉「${x.name || '这家'}」`}
            style={{ ...link14, color: gy.tertiary }}
            onClick={() => {
              const rest = items.filter((y) => y.id !== x.id);
              setN({ items: rest, answer: rest.length ? 'has' : undefined });
            }}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>
      ))}
      <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {items.length < 20 && (
          <button type="button" style={link14} onClick={() => setN({ answer: 'has', items: [...items, { id: newId('x'), name: '' }] })}>
            + 添加
          </button>
        )}
        <button type="button" aria-pressed={n.answer === 'none'} style={word(n.answer === 'none')} onClick={() => setN({ answer: 'none', items: [] })}>
          没有相邻企业
        </button>
        <button type="button" aria-pressed={n.answer === 'unknown'} style={word(n.answer === 'unknown')} onClick={() => setN({ answer: 'unknown', items: [] })}>
          不清楚
        </button>
      </span>
      <span aria-hidden style={{ height: 1, background: softLine }} />
      <Agreement
        label="与医院、消防或专业救援队伍签订的救援协议"
        factKey="agency.rescueAgreement"
        stored={workup.snapshot.profile.resourcesStep?.step.rescueAgreement}
        facts={facts}
        setFact={setFact}
      />
      <Agreement label="与相邻企业签订的应急互助协议" factKey="agency.mutualAid" stored={workup.snapshot.profile.resourcesStep?.step.mutualAid} facts={facts} setFact={setFact} />
    </Card>
  );
}

function Agreement({
  label,
  factKey,
  stored,
  facts,
  setFact,
}: {
  label: string;
  factKey: string;
  stored: { answer?: YesNoUnknown; parties?: string } | undefined;
  facts: ReturnType<typeof workupFacts>;
  setFact: (key: string, value: string | null, now?: boolean) => Promise<boolean>;
}) {
  const override = facts.find((f) => f.key === factKey)?.override;
  const [value, setValue] = useState(() => parseAgreement(override?.value) ?? stored ?? {});
  const save = (next: { answer?: YesNoUnknown; parties?: string }, now: boolean) => {
    setValue(next);
    if (!next.answer) return;
    const text = agreementText(next.answer, next.parties);
    const same = stored?.answer === next.answer && (stored.parties ?? '') === (next.parties ?? '').trim();
    void setFact(factKey, same ? null : text, now);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ flex: 1, ...type.body, color: gy.text }}>{label}</span>
        {override && <SourceTag kind="expert" text="您已修改" />}
        <Radio.Group
          aria-label={label}
          optionType="button"
          buttonStyle="solid"
          value={value.answer}
          onChange={(e) => save({ ...value, answer: e.target.value }, true)}
          options={(Object.keys(YES_NO_UNKNOWN_LABELS) as YesNoUnknown[]).map((k) => ({ value: k, label: YES_NO_UNKNOWN_LABELS[k] }))}
          style={{ flexShrink: 0, display: 'flex' }}
        />
      </div>
      {value.answer === 'yes' && (
        <Input aria-label={`${label}签订对象`} value={value.parties ?? ''} maxLength={100} placeholder="签订对象，如 ××医院" onChange={(e) => save({ ...value, parties: e.target.value }, false)} style={H36} />
      )}
    </div>
  );
}
