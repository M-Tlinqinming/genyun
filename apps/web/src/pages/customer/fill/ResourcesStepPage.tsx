import { CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import {
  buildingsForSites,
  buildingsReady,
  DRAWING_KEYS,
  DRAWINGS,
  FIRE_RATINGS,
  msdsNeedOf,
  neighborsReady,
  newId,
  standardFirstAidItems,
  SUPPLY_CATALOG,
  supplyFromCatalog,
  supplyKeysForSites,
  totalBuildingArea,
  type DraftBuilding,
  type DraftFirstAidItem,
  type DraftMaterial,
  type DraftPerson,
  type DraftSupply,
  type DrawingKey,
  type FireRating,
  type FirstAidMode,
  type ResourcesStep,
  type SiteType,
} from '@genyun/shared';
import { Button, Input, InputNumber, Select, Upload } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Task } from '../../../api/tasks';
import { gy, source } from '../../../theme/tokens';
import { OnSiteDialog } from '../OnSiteVisit';
import { AFTER_FILLING, FillCard, FillFrame, SidePanel, StepTitle } from './FillFrame';
import {
  AnswerSwitch,
  CardHeading,
  FileChip,
  IMAGE_ACCEPT,
  MATERIAL_ACCEPT,
  PhotoRow,
  RemoveButton,
} from './ProductionStepPage';
import { useResourcesDraft } from './useProductionDraft';
import { Loading } from '../../../components/ui';
import { useListMotion } from '../../../theme/motion';

type Change = (s: ResourcesStep) => void;

const muted = { fontSize: 12, lineHeight: '18px', color: gy.tertiary } as const;
const hint = { fontSize: 12, lineHeight: '18px', color: '#8A93A3' } as const;
const body = { fontSize: 13, lineHeight: '20px', color: '#3F4A5C' } as const;
const grow = (n: number): CSSProperties => ({ flex: `${n} 1 0`, minWidth: 0 });
const fixed = (w: number): CSSProperties => ({ width: w, flexShrink: 0 });

const YES_NO = [
  { value: 'yes', label: '有' },
  { value: 'no', label: '没有' },
] as const;

// 未勾的常用物资先露出 5 项，其余收起
const VISIBLE_CHIPS = 5;

// S04 企业自填第 4 步「应急资源与图纸」：边填边自动保存
export function ResourcesStepPage({ task }: { task: Task }) {
  const { step, saved, fileNames, uploading, leaving, autosave, update, leave, upload, removeLinked } =
    useResourcesDraft(task);
  const [booking, setBooking] = useState(false);
  const view = saved.current;

  const missingDrawings = step
    ? DRAWING_KEYS.filter((k) => DRAWINGS[k].required && step.drawings[k].length === 0).map((k) => DRAWINGS[k].short)
    : [];
  const laterCount = step
    ? [
        !buildingsReady(step),
        step.drawings.fire_facility_plan.length === 0,
        !neighborsReady(step.neighbors),
        ...(view?.materials ?? []).map((m) => msdsNeedOf(m) === 'supplier' && !step.msds[m.id]?.fileIds.length),
      ].filter(Boolean).length
    : 0;
  const summary = step
    ? [
        `已勾 ${step.supplies.length} 项物资`,
        ...(missingDrawings.length > 0 ? [`缺${missingDrawings.join('、')}`] : []),
        ...(laterCount > 0 ? [`${laterCount} 项可稍后补`] : []),
      ].join('，')
    : '';

  const footer = (
    <>
      <span style={{ fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>
        第 4 步，共 5 步{summary && ` · ${summary}`}
      </span>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button
          size="large"
          disabled={leaving}
          onClick={() => void leave(`/customer/tasks/${task.id}/fill/3?page=process`)}
        >
          上一步
        </Button>
        <Button size="large" type="primary" loading={leaving} onClick={() => void leave(`/customer/tasks/${task.id}/fill/5`)}>
          下一步：核对并提交
        </Button>
      </div>
    </>
  );

  return (
    <FillFrame
      step={4}
      enterpriseName={task.enterpriseName}
      saveState={autosave.state}
      savedAt={autosave.savedAt}
      onExit={() => void leave(`/customer/enterprises/${task.enterpriseId}`)}
      exiting={leaving}
      footer={footer}
    >
      <div style={{ width: 760, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepTitle
          title="出了事，手边有什么可以用"
          description="勾选厂里已有的应急物资，上传平面图和疏散图。数量填大概即可，没有的不勾。"
        />
        {!step || !view ? (
          <div style={{ flex: 1 }}><Loading rows={8} /></div>
        ) : (
          <>
            <SuppliesCard
              step={step}
              sites={view.sites}
              people={view.people}
              fileNames={fileNames}
              uploading={uploading === 'ledger'}
              onChange={update}
              onLedger={(file) =>
                upload(
                  'ledger',
                  file,
                  'material',
                  (s, fileId) => ({ ...s, supplyLedgerFileIds: [...s.supplyLedgerFileIds, fileId] }),
                  'emergency_supplies',
                )
              }
              onRemoveLedger={(fileId) =>
                void removeLinked('emergency_supplies', fileId, (s, id) => ({
                  ...s,
                  supplyLedgerFileIds: s.supplyLedgerFileIds.filter((f) => f !== id),
                }))
              }
            />
            <FirstAidPoolCard
              step={step}
              fileNames={fileNames}
              uploading={uploading === 'first-aid'}
              onChange={update}
              onPhoto={(file) =>
                upload('first-aid', file, 'image_or_pdf', (s, fileId) => ({
                  ...s,
                  firstAidKit: { ...s.firstAidKit, photoFileIds: [...s.firstAidKit.photoFileIds, fileId] },
                }))
              }
            />
            <BuildingsCard
              step={step}
              sites={view.sites}
              fileNames={fileNames}
              uploading={uploading === 'fire-acceptance'}
              onChange={update}
              onFile={(file) =>
                upload('fire-acceptance', file, 'material', (s, fileId) => ({
                  ...s,
                  fireAcceptanceFileIds: [...s.fireAcceptanceFileIds, fileId],
                }))
              }
            />
            <MsdsCard
              step={step}
              materials={view.materials}
              fileNames={fileNames}
              uploading={uploading}
              onChange={update}
              onFile={(materialId, file) =>
                upload(
                  `msds-${materialId}`,
                  file,
                  'material',
                  (s, fileId) => {
                    const entry = s.msds[materialId] ?? { fileIds: [], later: false };
                    return {
                      ...s,
                      msds: { ...s.msds, [materialId]: { fileIds: [...entry.fileIds, fileId], later: false } },
                    };
                  },
                  'msds',
                )
              }
              onRemove={(materialId, fileId) =>
                void removeLinked('msds', fileId, (s, id) => {
                  const entry = s.msds[materialId] ?? { fileIds: [], later: false };
                  return { ...s, msds: { ...s.msds, [materialId]: { ...entry, fileIds: entry.fileIds.filter((f) => f !== id) } } };
                })
              }
            />
            <DrawingsCard
              step={step}
              fileNames={fileNames}
              uploading={uploading}
              onFile={(key, file) =>
                upload(
                  `drawing-${key}`,
                  file,
                  'image_or_pdf',
                  (s, fileId) => ({ ...s, drawings: { ...s.drawings, [key]: [...s.drawings[key], fileId] } }),
                  key,
                )
              }
              onRemove={(key, fileId) =>
                void removeLinked(key, fileId, (s, id) => ({
                  ...s,
                  drawings: { ...s.drawings, [key]: s.drawings[key].filter((f) => f !== id) },
                }))
              }
              onOnSite={() => setBooking(true)}
            />
            <NeighborsCard step={step} onChange={update} />
          </>
        )}
      </div>

      <SidePanel
        why={[
          '应急资源调查报告要逐项列出物资、数量、位置和保管人；平面图和疏散图是预案必附的图纸。',
          '图纸手绘拍照也可以，手机浏览器里可以直接拍照上传。',
        ]}
        after={AFTER_FILLING}
      />
      <OnSiteDialog taskId={task.id} open={booking} onClose={() => setBooking(false)} />
    </FillFrame>
  );
}

function LaterTag() {
  return (
    <span
      style={{
        padding: '0 6px',
        borderRadius: 4,
        background: gy.neutralBg,
        color: gy.secondary,
        fontSize: 12,
        lineHeight: '18px',
        fontWeight: 400,
      }}
    >
      可稍后补
    </span>
  );
}

function Checkbox({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      style={{
        width: 18,
        height: 18,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: 4,
        border: checked ? 'none' : '1px solid #C4C9D2',
        background: checked ? gy.primary : gy.surface,
        cursor: 'pointer',
      }}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 6.2l2.3 2.3 4.7-5"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

const smallChip: CSSProperties = {
  padding: '2px 8px',
  borderRadius: 4,
  border: `1px solid ${gy.split}`,
  background: gy.surface,
  color: '#3F4A5C',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const linkButton: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  color: gy.primary,
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const personLabel = (p: DraftPerson) => (p.phone ? `${p.name} · ${p.phone}` : p.name);

function SuppliesCard({
  step,
  sites,
  people,
  fileNames,
  uploading,
  onChange,
  onLedger,
  onRemoveLedger,
}: {
  step: ResourcesStep;
  sites: SiteType[];
  people: DraftPerson[];
  fileNames: Record<string, string>;
  uploading: boolean;
  onChange: Change;
  onLedger: (file: File) => void;
  onRemoveLedger: (fileId: string) => void;
}) {
  const supplyList = useListMotion<HTMLDivElement>();
  const [expanded, setExpanded] = useState(false);
  const checkedKeys = new Set(step.supplies.map((s) => s.catalogKey));
  const unchecked = supplyKeysForSites(sites).filter((k) => !checkedKeys.has(k));
  const shown = expanded ? unchecked : unchecked.slice(0, VISIBLE_CHIPS);
  const put = (id: string, p: Partial<DraftSupply>) =>
    onChange({ ...step, supplies: step.supplies.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  return (
    <FillCard gap={12}>
      <CardHeading
        title="应急物资与消防设施"
        description={`按您勾选的场所列出常用的 ${Object.keys(SUPPLY_CATALOG).length} 项，有的勾上并填数量。`}
        extra={
          <Upload
            accept={MATERIAL_ACCEPT}
            multiple
            showUploadList={false}
            disabled={uploading}
            beforeUpload={(file) => {
              onLedger(file);
              return false;
            }}
          >
            <Button style={{ flexShrink: 0 }} icon={uploading ? <LoadingOutlined /> : undefined}>
              上传物资台账
            </Button>
          </Upload>
        }
      />
      {step.supplyLedgerFileIds.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {step.supplyLedgerFileIds.map((id) => (
            <FileChip key={id} name={fileNames[id] ?? '物资台账'} onRemove={() => onRemoveLedger(id)} />
          ))}
          <span style={hint}>已上传物资台账，下面可以不逐项填，专家会按台账整理。</span>
        </div>
      )}
      {step.supplies.length > 0 && (
        <div style={{ display: 'flex', gap: 10, paddingLeft: 30 }}>
          <span style={{ ...muted, ...grow(1) }}>物资名称</span>
          <span style={{ ...muted, ...fixed(96) }}>数量</span>
          <span style={{ ...muted, ...fixed(200) }}>位置</span>
        </div>
      )}
      <div ref={supplyList} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {step.supplies.map((s, i) => (
        <div key={s.id} data-testid="supply-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Checkbox
            checked
            label={`取消勾选${s.name || `第 ${i + 1} 项物资`}`}
            onClick={() => onChange({ ...step, supplies: step.supplies.filter((x) => x.id !== s.id) })}
          />
          <span style={fixed(2)} />
          {s.catalogKey ? (
            <span style={{ ...grow(1), fontSize: 14, lineHeight: '22px', color: gy.text }}>{s.name}</span>
          ) : (
            <Input
              style={{ ...grow(1), height: 34 }}
              aria-label={`第 ${i + 1} 项物资名称`}
              maxLength={50}
              placeholder="物资名称，如消防水带"
              value={s.name}
              onChange={(e) => put(s.id, { name: e.target.value })}
            />
          )}
          <InputNumber
            style={{ ...fixed(96), height: 34 }}
            aria-label={`${s.name || `第 ${i + 1} 项物资`}数量`}
            min={0}
            precision={0}
            controls={false}
            value={s.quantity}
            suffix={<span style={{ color: '#8A93A3', fontSize: 13 }}>{s.unit ?? '个'}</span>}
            onChange={(n) => put(s.id, { quantity: n ?? undefined })}
          />
          <Input
            style={{ ...fixed(200), height: 34 }}
            aria-label={`${s.name || `第 ${i + 1} 项物资`}位置`}
            maxLength={50}
            placeholder="如厂区各处"
            value={s.location}
            onChange={(e) => put(s.id, { location: e.target.value })}
          />
        </div>
      ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingLeft: 30 }}>
        {unchecked.length > 0 && <span style={{ ...body, color: gy.tertiary }}>未勾选：</span>}
        {shown.map((key) => (
          <button
            key={key}
            type="button"
            style={smallChip}
            onClick={() => onChange({ ...step, supplies: [...step.supplies, supplyFromCatalog(key)] })}
          >
            {SUPPLY_CATALOG[key].name}
          </button>
        ))}
        {!expanded && unchecked.length > VISIBLE_CHIPS && (
          <button type="button" style={linkButton} onClick={() => setExpanded(true)}>
            展开其余 {unchecked.length - VISIBLE_CHIPS} 项
          </button>
        )}
        {(expanded || unchecked.length <= VISIBLE_CHIPS) && step.supplies.length < 100 && (
          <button
            type="button"
            style={linkButton}
            onClick={() => onChange({ ...step, supplies: [...step.supplies, { id: newId('r'), name: '', unit: '个' }] })}
          >
            + 其他物资
          </button>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          borderRadius: 6,
          background: gy.canvas,
        }}
      >
        <span style={{ flexShrink: 0, fontSize: 14, lineHeight: '22px', color: gy.text }}>统一保管人</span>
        <Select
          style={{ ...fixed(220) }}
          aria-label="统一保管人"
          allowClear
          placeholder={people.length > 0 ? '请选择' : '第 2 步还没填人员'}
          disabled={people.length === 0}
          value={people.some((p) => p.id === step.custodianId) ? step.custodianId : undefined}
          options={people.map((p) => ({ value: p.id, label: personLabel(p) }))}
          onChange={(custodianId?: string) => onChange({ ...step, custodianId })}
        />
        <span style={{ ...body, color: gy.tertiary }}>从已填人员中选，电话自动带出</span>
      </div>
    </FillCard>
  );
}

const modeChip = (on: boolean): CSSProperties => ({
  height: 30,
  padding: '0 12px',
  borderRadius: 15,
  border: `1px solid ${on ? gy.primary : '#D9D9D9'}`,
  background: on ? gy.selected : gy.surface,
  color: on ? gy.primary : gy.text,
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

const FIRST_AID_MODE_LABELS: Record<FirstAidMode, string> = {
  standard: '按常规配置',
  manual: '自己逐项填',
};

const block: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '14px 16px',
  borderRadius: 8,
  border: `1px solid ${gy.split}`,
};

function FirstAidPoolCard({
  step,
  fileNames,
  uploading,
  onChange,
  onPhoto,
}: {
  step: ResourcesStep;
  fileNames: Record<string, string>;
  uploading: boolean;
  onChange: Change;
  onPhoto: (file: File) => void;
}) {
  const [editing, setEditing] = useState(false);
  const kit = step.firstAidKit;
  const pool = step.firePool;
  const setKit = (p: Partial<ResourcesStep['firstAidKit']>) => onChange({ ...step, firstAidKit: { ...kit, ...p } });
  const setPool = (p: Partial<ResourcesStep['firePool']>) => onChange({ ...step, firePool: { ...pool, ...p } });
  const putItem = (id: string, p: Partial<DraftFirstAidItem>) =>
    setKit({ items: kit.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });

  const pickMode = (mode: FirstAidMode) => {
    // 回到常规配置时清单空了就重新带出；改为逐项填时保留已有的，没有就给一行空白
    if (mode === 'standard' && kit.items.length === 0) return setKit({ mode, items: standardFirstAidItems() });
    if (mode === 'manual' && kit.items.length === 0) return setKit({ mode, items: [{ id: newId('k'), name: '' }] });
    setKit({ mode });
  };

  return (
    <FillCard title="急救药箱与消防水池" gap={12}>
      <div style={block} data-testid="first-aid-kit">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>
            厂里有急救药箱吗？
          </span>
          <AnswerSwitch
            label="厂里有急救药箱吗？"
            value={kit.answer}
            options={[...YES_NO]}
            width={212}
            onChange={(answer) => setKit({ answer })}
          />
        </div>
        {kit.answer === 'yes' && (
          <>
            <div style={{ display: 'flex', gap: 10 }} role="radiogroup" aria-label="药品清单怎么填">
              {(Object.keys(FIRST_AID_MODE_LABELS) as FirstAidMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={kit.mode === mode}
                  style={modeChip(kit.mode === mode)}
                  onClick={() => pickMode(mode)}
                >
                  {FIRST_AID_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            {kit.mode === 'standard' && !editing && (
              <div style={body}>
                {kit.items.map((i) => `${i.name} ${i.quantity ?? ''} ${i.unit ?? ''}`.trim()).join(' · ')}
                <button type="button" style={{ ...linkButton, marginLeft: 16 }} onClick={() => setEditing(true)}>
                  改数量
                </button>
              </div>
            )}
            {((kit.mode === 'standard' && editing) || kit.mode === 'manual') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {kit.items.map((item, i) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {kit.mode === 'standard' ? (
                      <span style={{ ...grow(1), fontSize: 14, color: gy.text }}>{item.name}</span>
                    ) : (
                      <Input
                        style={grow(1)}
                        aria-label={`第 ${i + 1} 种药品名称`}
                        maxLength={30}
                        placeholder="如创可贴"
                        value={item.name}
                        onChange={(e) => putItem(item.id, { name: e.target.value })}
                      />
                    )}
                    <InputNumber
                      style={fixed(96)}
                      aria-label={`${item.name || `第 ${i + 1} 种药品`}数量`}
                      min={0}
                      precision={0}
                      value={item.quantity}
                      onChange={(n) => putItem(item.id, { quantity: n ?? undefined })}
                    />
                    <Input
                      style={fixed(72)}
                      aria-label={`${item.name || `第 ${i + 1} 种药品`}单位`}
                      maxLength={10}
                      placeholder="单位"
                      value={item.unit}
                      onChange={(e) => putItem(item.id, { unit: e.target.value })}
                    />
                    <RemoveButton
                      label={`删除${item.name || `第 ${i + 1} 种药品`}`}
                      hidden={kit.items.length <= 1}
                      onClick={() => setKit({ items: kit.items.filter((x) => x.id !== item.id) })}
                    />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 16 }}>
                  {kit.mode === 'manual' && (
                    <button
                      type="button"
                      style={linkButton}
                      disabled={kit.items.length >= 50}
                      onClick={() => setKit({ items: [...kit.items, { id: newId('k'), name: '' }] })}
                    >
                      + 添加药品
                    </button>
                  )}
                  {kit.mode === 'standard' && (
                    <button type="button" style={linkButton} onClick={() => setEditing(false)}>
                      改好了
                    </button>
                  )}
                </div>
              </div>
            )}
            {kit.photoFileIds.length > 0 && !kit.items.some((i) => i.name.trim() !== '') && (
              <span style={{ ...hint, color: gy.warning }}>只传了药箱照片还不够，请对照照片填写药品名称和数量</span>
            )}
            <PhotoRow
              label="药箱照片（选填）：拍药箱打开后的样子，方便专家核对；药品清单仍需您填写"
              button="拍照上传"
              fileIds={kit.photoFileIds}
              fileNames={fileNames}
              uploading={uploading}
              onFile={onPhoto}
              onRemove={(fileId) => setKit({ photoFileIds: kit.photoFileIds.filter((f) => f !== fileId) })}
            />
          </>
        )}
      </div>

      <div style={block} data-testid="fire-pool">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>有消防水池吗？</span>
            <span style={hint}>园区共用的也算</span>
          </div>
          <AnswerSwitch
            label="有消防水池吗？"
            value={pool.answer}
            options={[...YES_NO]}
            width={212}
            onChange={(answer) => setPool({ answer })}
          />
        </div>
        {pool.answer === 'yes' && (
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ ...fixed(140), display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={muted}>数量</span>
              <InputNumber
                style={{ width: '100%' }}
                min={1}
                max={100}
                precision={0}
                value={pool.count}
                suffix="个"
                onChange={(n) => setPool({ count: n ?? undefined })}
              />
            </label>
            <label style={{ ...grow(1), display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={muted}>容积</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <InputNumber
                  style={{ flex: 1 }}
                  min={0}
                  disabled={pool.volumeLater}
                  placeholder="容积"
                  value={pool.volumeM3}
                  suffix="m³"
                  onChange={(n) => setPool({ volumeM3: n ?? undefined })}
                />
                <Button
                  aria-pressed={pool.volumeLater}
                  style={pool.volumeLater ? { background: gy.neutralBg, color: gy.secondary } : undefined}
                  onClick={() => setPool({ volumeLater: !pool.volumeLater, volumeM3: undefined })}
                >
                  {pool.volumeLater ? '已标稍后补' : '稍后补'}
                </Button>
              </div>
            </label>
          </div>
        )}
      </div>
    </FillCard>
  );
}

const ratingOptions = (Object.keys(FIRE_RATINGS) as FireRating[]).map((value) => ({
  value,
  label: FIRE_RATINGS[value],
}));

function BuildingsCard({
  step,
  sites,
  fileNames,
  uploading,
  onChange,
  onFile,
}: {
  step: ResourcesStep;
  sites: SiteType[];
  fileNames: Record<string, string>;
  uploading: boolean;
  onChange: Change;
  onFile: (file: File) => void;
}) {
  const buildingList = useListMotion<HTMLDivElement>();
  const put = (id: string, p: Partial<DraftBuilding>) =>
    onChange({ ...step, buildings: step.buildings.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const total = totalBuildingArea(step.buildings);
  const blank = (): DraftBuilding => ({ id: newId('b'), name: '', fireRating: 'expert' });

  return (
    <FillCard gap={12}>
      <CardHeading
        title={
          (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              厂区建筑 <LaterTag />
            </span>
          )
        }
        description="已按您勾选的场所列出，宿舍也要填。耐火等级不用您判断，有消防验收资料就上传。"
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={{ ...muted, ...grow(1) }}>建筑名称</span>
        <span style={{ ...muted, ...fixed(98) }}>耐火等级</span>
        <span style={{ ...muted, ...fixed(66) }}>层数</span>
        <span style={{ ...muted, ...fixed(106) }}>建筑面积</span>
        <span style={fixed(24)} />
      </div>
      <div ref={buildingList} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {step.buildings.map((b, i) => (
        <div key={b.id} data-testid="building-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Input
            style={grow(1)}
            aria-label={`第 ${i + 1} 栋建筑名称`}
            maxLength={50}
            placeholder="如生产车间（A 栋）"
            value={b.name}
            onChange={(e) => put(b.id, { name: e.target.value })}
          />
          <Select
            style={fixed(98)}
            aria-label={`第 ${i + 1} 栋建筑耐火等级`}
            value={b.fireRating}
            options={ratingOptions}
            labelRender={({ value, label }) => (
              <span style={value === 'expert' ? { color: source.expert.color } : undefined}>{label}</span>
            )}
            onChange={(fireRating: FireRating) => put(b.id, { fireRating })}
          />
          <InputNumber
            style={fixed(66)}
            aria-label={`第 ${i + 1} 栋建筑层数`}
            min={1}
            max={200}
            precision={0}
            controls={false}
            value={b.floors}
            onChange={(n) => put(b.id, { floors: n ?? undefined })}
          />
          <InputNumber
            style={fixed(106)}
            aria-label={`第 ${i + 1} 栋建筑面积`}
            min={0}
            precision={2}
            controls={false}
            value={b.areaM2}
            suffix={<span style={{ color: '#8A93A3' }}>m²</span>}
            onChange={(n) => put(b.id, { areaM2: n ?? undefined })}
          />
          <RemoveButton
            label={`删除第 ${i + 1} 栋建筑`}
            onClick={() => onChange({ ...step, buildings: step.buildings.filter((x) => x.id !== b.id) })}
          />
        </div>
      ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          type="button"
          style={linkButton}
          disabled={step.buildings.length >= 50}
          onClick={() => onChange({ ...step, buildings: [...step.buildings, blank()] })}
        >
          + 添加建筑
        </button>
        {step.buildings.length === 0 && buildingsForSites(sites).length > 0 && (
          <button
            type="button"
            style={linkButton}
            onClick={() => onChange({ ...step, buildings: buildingsForSites(sites) })}
          >
            按场所重新列出
          </button>
        )}
        <Upload
          accept={MATERIAL_ACCEPT}
          multiple
          showUploadList={false}
          disabled={uploading}
          beforeUpload={(file) => {
            onFile(file);
            return false;
          }}
        >
          <button type="button" style={linkButton}>
            {uploading ? <LoadingOutlined style={{ marginRight: 4 }} /> : null}上传消防验收资料
          </button>
        </Upload>
        <span style={{ flex: 1 }} />
        {total > 0 && (
          <span data-testid="building-total" style={{ ...body, color: gy.tertiary }}>
            合计 {total.toFixed(2)} m²，已回填到第 1 步「总建筑面积」
          </span>
        )}
      </div>
      {step.fireAcceptanceFileIds.map((id) => (
        <FileChip
          key={id}
          name={fileNames[id] ?? '消防验收资料'}
          onRemove={() =>
            onChange({ ...step, fireAcceptanceFileIds: step.fireAcceptanceFileIds.filter((f) => f !== id) })
          }
        />
      ))}
    </FillCard>
  );
}

const MSDS_TEXT = {
  knowledge_base: { text: '纯物质 · 耕云资料库补全，无需上传', color: source.system.color },
  not_needed: { text: '一般原料 · 不需要', color: '#8A93A3' },
  supplier: { text: '混合物 · 需供应商提供', color: gy.secondary },
  expert: { text: '是否危化品待注安师核实，先不用传', color: gy.warning },
} as const;

function MsdsCard({
  step,
  materials,
  fileNames,
  uploading,
  onChange,
  onFile,
  onRemove,
}: {
  step: ResourcesStep;
  materials: DraftMaterial[];
  fileNames: Record<string, string>;
  uploading: string | null;
  onChange: Change;
  onFile: (materialId: string, file: File) => void;
  onRemove: (materialId: string, fileId: string) => void;
}) {
  const rows = materials.flatMap((m) => {
    const need = msdsNeedOf(m);
    return need ? [{ m, need }] : [];
  });
  return (
    <FillCard gap={12}>
      <CardHeading
        title="化学品安全技术说明书（MSDS）"
        description="按第 3 步的物料自动列出。不是危化品的不需要；纯物质由耕云补全；混合物请向供应商要。"
      />
      {rows.length === 0 ? (
        <span style={{ ...body, color: gy.tertiary }}>第 3 步还没填原辅材料，填了之后这里会列出来。</span>
      ) : (
        <div style={{ borderRadius: 8, border: `1px solid ${gy.split}` }}>
          {rows.map(({ m, need }, i) => {
            const entry = step.msds[m.id] ?? { fileIds: [], later: false };
            const busy = uploading === `msds-${m.id}`;
            const done = need === 'knowledge_base' || entry.fileIds.length > 0;
            return (
              <div
                key={m.id}
                data-testid="msds-row"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '10px 14px',
                  minHeight: 52,
                  justifyContent: 'center',
                  borderTop: i > 0 ? `1px solid ${gy.split}` : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    style={{
                      ...fixed(108),
                      fontSize: 14,
                      lineHeight: '22px',
                      color: need === 'not_needed' ? '#8A93A3' : gy.text,
                    }}
                  >
                    {m.name}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, lineHeight: '20px', color: MSDS_TEXT[need].color }}>
                    {need === 'supplier' && entry.fileIds.length > 0 ? '混合物 · 已上传' : MSDS_TEXT[need].text}
                  </span>
                  {need === 'supplier' && (
                    <>
                      <Upload
                        accept={MATERIAL_ACCEPT}
                        multiple
                        showUploadList={false}
                        disabled={busy}
                        beforeUpload={(file) => {
                          onFile(m.id, file);
                          return false;
                        }}
                      >
                        <Button size="small" icon={busy ? <LoadingOutlined /> : undefined}>
                          上传
                        </Button>
                      </Upload>
                      {entry.fileIds.length === 0 && (
                        <button
                          type="button"
                          aria-pressed={entry.later}
                          style={{ ...linkButton, color: entry.later ? gy.secondary : '#8A93A3' }}
                          onClick={() =>
                            onChange({ ...step, msds: { ...step.msds, [m.id]: { ...entry, later: !entry.later } } })
                          }
                        >
                          {entry.later ? '已标稍后补' : '稍后补'}
                        </button>
                      )}
                    </>
                  )}
                  {done && <CheckOutlined aria-label="已处理" style={{ fontSize: 13, color: gy.success }} />}
                </div>
                {entry.fileIds.map((id) => (
                  <FileChip key={id} name={fileNames[id] ?? 'MSDS'} onRemove={() => onRemove(m.id, id)} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </FillCard>
  );
}

function DrawingsCard({
  step,
  fileNames,
  uploading,
  onFile,
  onRemove,
  onOnSite,
}: {
  step: ResourcesStep;
  fileNames: Record<string, string>;
  uploading: string | null;
  onFile: (key: DrawingKey, file: File) => void;
  onRemove: (key: DrawingKey, fileId: string) => void;
  onOnSite: () => void;
}) {
  return (
    <FillCard gap={12}>
      <CardHeading
        title="厂区图纸"
        description="CAD 导出、图纸拍照或手绘拍照都可以。周边环境图和医院路线图由耕云画。"
      />
      <div style={{ display: 'flex', gap: 12 }}>
        {DRAWING_KEYS.map((key) => {
          const def = DRAWINGS[key];
          const ids = step.drawings[key];
          const has = ids.length > 0;
          const busy = uploading === `drawing-${key}`;
          return (
            <div
              key={key}
              data-testid={`drawing-${key}`}
              style={{
                ...grow(1),
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 14,
                borderRadius: 8,
                border: has ? '1px solid #BFD8C8' : '1px dashed #A9B4C6',
                background: has ? '#F4FAF6' : gy.surface,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{def.label}</span>
                <span style={{ fontSize: 12, lineHeight: '18px', color: def.required ? gy.error : gy.tertiary }}>
                  {def.required ? '必需' : '可稍后补'}
                </span>
              </div>
              {has ? (
                ids.map((id) => (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckOutlined aria-hidden style={{ fontSize: 12, color: gy.success }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: '20px', color: gy.success }}>
                      {fileNames[id] ?? def.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`移除${fileNames[id] ?? def.label}`}
                      style={{ ...linkButton, fontSize: 12, color: gy.tertiary }}
                      onClick={() => onRemove(key, id)}
                    >
                      移除
                    </button>
                  </div>
                ))
              ) : (
                <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>{def.hint}</span>
              )}
              <Upload
                accept={IMAGE_ACCEPT}
                multiple
                showUploadList={false}
                disabled={busy}
                beforeUpload={(file) => {
                  onFile(key, file);
                  return false;
                }}
              >
                <button type="button" style={linkButton} aria-label={`上传${def.label}`}>
                  {busy && <LoadingOutlined style={{ marginRight: 4 }} />}
                  {has ? '再传一张' : '选择文件'}
                </button>
              </Upload>
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 6,
          background: gy.canvas,
        }}
      >
        <span style={{ flex: 1, fontSize: 13, lineHeight: '20px', color: '#3F4A5C' }}>图纸都没有，或者没人手整理？</span>
        <button type="button" style={{ ...linkButton, fontSize: 13, lineHeight: '20px' }} onClick={onOnSite}>
          预约耕云专家上门
        </button>
      </div>
    </FillCard>
  );
}

function NeighborsCard({ step, onChange }: { step: ResourcesStep; onChange: Change }) {
  const n = step.neighbors;
  const set = (p: Partial<ResourcesStep['neighbors']>) => onChange({ ...step, neighbors: { ...n, ...p } });
  const add = () => set({ answer: 'has', items: [...n.items, { id: newId('n'), name: '' }] });
  const choice = (answer: 'none' | 'unknown', label: string): ReactNode => {
    const on = n.answer === answer;
    return (
      <button
        type="button"
        aria-pressed={on}
        style={{ ...linkButton, color: on ? gy.primary : gy.secondary, fontWeight: on ? 500 : 400 }}
        onClick={() => set({ answer, items: [] })}
      >
        {on && <CheckOutlined aria-hidden style={{ fontSize: 11, marginRight: 4 }} />}
        {label}
      </button>
    );
  };

  return (
    <FillCard gap={12}>
      <CardHeading
        title={
          (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              相邻企业 <LaterTag />
            </span>
          )
        }
        description="发生事故时需要互相通知。消防、医院、应急管理局等电话耕云按地址带出，第 5 步可查看。"
      />
      {n.items.map((item, i) => (
        <div key={item.id} data-testid="neighbor-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Input
            style={grow(1.4)}
            aria-label={`第 ${i + 1} 家相邻企业名称`}
            maxLength={50}
            placeholder="企业名称"
            value={item.name}
            onChange={(e) => set({ items: n.items.map((x) => (x.id === item.id ? { ...x, name: e.target.value } : x)) })}
          />
          <Input
            style={grow(1)}
            aria-label={`第 ${i + 1} 家相邻企业联系方式`}
            maxLength={50}
            placeholder="联系方式，如保安室电话"
            value={item.contact}
            onChange={(e) =>
              set({ items: n.items.map((x) => (x.id === item.id ? { ...x, contact: e.target.value } : x)) })
            }
          />
          <RemoveButton
            label={`删除第 ${i + 1} 家相邻企业`}
            onClick={() => {
              const items = n.items.filter((x) => x.id !== item.id);
              set({ items, answer: items.length > 0 ? 'has' : undefined });
            }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button type="button" style={linkButton} disabled={n.items.length >= 20} onClick={add}>
          + 添加
        </button>
        {choice('none', '没有相邻企业')}
        {choice('unknown', '不清楚')}
        {n.answer === 'unknown' && <span style={hint}>负责专家联系您时再一起确认</span>}
      </div>
    </FillCard>
  );
}
