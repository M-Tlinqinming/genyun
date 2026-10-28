import { CheckOutlined, CloseOutlined, LoadingOutlined } from '@ant-design/icons';
import {
  BOILER_TYPES,
  EQUIPMENT_CONDITION_OPTIONS,
  hasAirCompressor,
  msdsHintOf,
  newId,
  pressureVolumeOf,
  SITE_TYPES,
  sitesFromBusinessScope,
  SPECIAL_CATEGORIES,
  SPECIAL_CATEGORY_KEYS,
  type DraftEquipment,
  type DraftMaterial,
  type ProductionStep,
  type SiteType,
  type SpecialAnswer,
  type SpecialCategory,
} from '@genyun/shared';
import { AutoComplete, Button, Dropdown, Input, InputNumber, Popconfirm, Radio, Select, Upload } from 'antd';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Task } from '../../../api/tasks';
import { gy, source } from '../../../theme/tokens';
import { AFTER_FILLING, FillCard, FillFrame, SidePanel, StepTitle } from './FillFrame';
import { useProductionDraft } from './useProductionDraft';
import { Loading } from '../../../components/ui';

type Ledger = keyof ProductionStep['ledgers'];
// 台账代替逐行填写，同时挂到任务对应的资料项上；铭牌、包装标签照片只存在企业资料里，供专家判断
const LEDGER_ITEMS = { equipment: 'equipment', materials: 'materials' } as const;
const LEDGER_LABELS: Record<Ledger, string> = { equipment: '设备台账', materials: '原辅材料台账' };

export const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.pdf';
export const MATERIAL_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp';

const filled = (v?: string) => Boolean(v && v.trim() !== '');
const blankEquipment = (): DraftEquipment => ({ id: newId('e'), name: '' });
const blankMaterial = (kind: DraftMaterial['kind'] = 'material'): DraftMaterial => ({
  id: newId('m'),
  kind,
  name: '',
  labelPhotoFileIds: [],
});

const muted = { fontSize: 12, lineHeight: '18px', color: gy.tertiary } as const;
const hint = { fontSize: 12, lineHeight: '18px', color: '#8A93A3' } as const;

// S03a 企业自填第 3 步第 1 页「场所、设备与物料」：边填边自动保存
export function ProductionStepPage({ task }: { task: Task }) {
  // 因为设备里有空压机，系统替客户选了压力容器「有」
  const [vesselAutoPicked, setVesselAutoPicked] = useState(false);
  const { step, saved, fileNames, uploading, leaving, autosave, update, leave, upload, removeLinked } =
    useProductionDraft(task, {
      // 设备、物料至少留一行空白，方便直接填
      normalize: (s) => ({
        ...s,
        equipment: s.equipment.length > 0 ? s.equipment : [blankEquipment()],
        materials: s.materials.length > 0 ? s.materials : [blankMaterial()],
      }),
      // 刚填进空压机、压力容器还没回答：一般带储气罐，替客户预选「有」
      adjust: (prev, next) => {
        const vessels = next.specialEquipment.pressureVessels;
        if (!prev || hasAirCompressor(prev.equipment) || !hasAirCompressor(next.equipment) || vessels.answer) {
          return next;
        }
        setVesselAutoPicked(true);
        return { ...next, specialEquipment: { ...next.specialEquipment, pressureVessels: { ...vessels, answer: 'yes' } } };
      },
    });

  const removeLedger = (ledger: Ledger, fileId: string) =>
    removeLinked(LEDGER_ITEMS[ledger], fileId, (s, id) => ({
      ...s,
      ledgers: { ...s.ledgers, [ledger]: s.ledgers[ledger].filter((f) => f !== id) },
    }));

  const siteCount = step ? step.sites.length + step.customSites.length : 0;
  const specialYes = step ? SPECIAL_CATEGORY_KEYS.filter((k) => step.specialEquipment[k].answer === 'yes').length : 0;
  const labelsPending = step ? step.materials.filter((m) => msdsHintOf(m) === 'label_needed').length : 0;
  const summary = step
    ? [
        `已选 ${siteCount} 个场所`,
        `${specialYes} 类特种设备`,
        ...(labelsPending > 0 ? [`${labelsPending} 张包装标签待拍`] : []),
      ].join('，')
    : '';

  const footer = (
    <>
      <span style={{ fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>
        第 3 步（共 2 页）{summary && ` · ${summary}`}
      </span>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button size="large" disabled={leaving} onClick={() => void leave(`/customer/tasks/${task.id}/fill/2`)}>
          上一步
        </Button>
        <Button
          size="large"
          type="primary"
          loading={leaving}
          onClick={() => void leave(`/customer/tasks/${task.id}/fill/3?page=process`)}
        >
          下一页：工艺流程
        </Button>
      </div>
    </>
  );

  return (
    <FillFrame
      step={3}
      enterpriseName={task.enterpriseName}
      saveState={autosave.state}
      savedAt={autosave.savedAt}
      onExit={() => void leave(`/customer/enterprises/${task.enterpriseId}`)}
      exiting={leaving}
      footer={footer}
    >
      <div style={{ width: 760, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepTitle
          title="您的工厂里有哪些场所和东西"
          description="勾选场所就能帮 AI 判断主要风险。设备和物料有台账的，直接上传更省事。"
        />
        {!step ? (
          <div style={{ flex: 1 }}><Loading rows={8} /></div>
        ) : (
          <>
            <SitesCard step={step} businessScope={saved.current?.businessScope ?? null} onChange={update} />
            <SpecialCard
              step={step}
              vesselAutoPicked={vesselAutoPicked}
              fileNames={fileNames}
              uploading={uploading}
              onChange={(next) => {
                if (next.specialEquipment.pressureVessels.answer !== step.specialEquipment.pressureVessels.answer) {
                  setVesselAutoPicked(false);
                }
                update(next);
              }}
              onPhoto={(cat, file) =>
                upload(`special-${cat}`, file, 'image_or_pdf', (s, fileId) => ({
                  ...s,
                  specialEquipment: {
                    ...s.specialEquipment,
                    [cat]: {
                      ...s.specialEquipment[cat],
                      photoFileIds: [...s.specialEquipment[cat].photoFileIds, fileId],
                    },
                  },
                }))
              }
            />
            <AssetsCard
              step={step}
              fileNames={fileNames}
              uploading={uploading}
              onChange={update}
              onLedger={(ledger, file) =>
                upload(
                  `ledger-${ledger}`,
                  file,
                  'material',
                  (s, fileId) => ({ ...s, ledgers: { ...s.ledgers, [ledger]: [...s.ledgers[ledger], fileId] } }),
                  LEDGER_ITEMS[ledger],
                )
              }
              onRemoveLedger={(ledger, fileId) => void removeLedger(ledger, fileId)}
              onLabel={(materialId, file) =>
                upload(`label-${materialId}`, file, 'image_or_pdf', (s, fileId) => ({
                  ...s,
                  materials: s.materials.map((m) =>
                    m.id === materialId ? { ...m, labelPhotoFileIds: [...m.labelPhotoFileIds, fileId] } : m,
                  ),
                }))
              }
            />
            <QuestionsCard step={step} onChange={update} />
          </>
        )}
      </div>

      <SidePanel
        why={[
          '不同场所对应不同的事故类型：喷涂对应火灾爆炸，配电房对应触电，有限空间对应中毒窒息。AI 据此决定要编写哪些专项预案和现场处置方案。',
          '是不是危化品不用您判断：填名称、拍包装标签，专家会对照目录确认。',
        ]}
        after={AFTER_FILLING}
      />
    </FillFrame>
  );
}

export function CardHeading({ title, description, extra }: { title: ReactNode; description: string; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>{description}</p>
      </div>
      {extra}
    </div>
  );
}

const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 14px',
  borderRadius: 18,
  // 分开写边框，选中、虚线样式只改其中一项
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#D9D9D9',
  background: gy.surface,
  color: '#3F4A5C',
  fontSize: 14,
  lineHeight: '22px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const chipOn: CSSProperties = { ...chip, background: '#EEF3FD', borderColor: gy.primary, color: gy.primary };

function SitesCard({
  step,
  businessScope,
  onChange,
}: {
  step: ProductionStep;
  businessScope: string | null;
  onChange: (s: ProductionStep) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const fromScope = sitesFromBusinessScope(businessScope ?? undefined);
  const toggle = (site: SiteType) =>
    onChange({
      ...step,
      sites: step.sites.includes(site) ? step.sites.filter((s) => s !== site) : [...step.sites, site],
    });
  const addCustom = () => {
    const name = draft.trim();
    setDraft('');
    setAdding(false);
    if (!name || step.customSites.includes(name) || step.customSites.length >= 10) return;
    onChange({ ...step, customSites: [...step.customSites, name] });
  };

  return (
    <FillCard>
      <CardHeading
        title="厂区里有这些场所吗？"
        description={
          fromScope.length > 0
            ? `可多选。已根据经营范围预选了${fromScope.map((s) => `「${SITE_TYPES[s]}」`).join('')}，请确认。`
            : '可多选。常见的生产车间、仓库、配电房已预选，请确认。'
        }
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {(Object.keys(SITE_TYPES) as SiteType[]).map((site) => {
          const on = step.sites.includes(site);
          return (
            <button key={site} type="button" aria-pressed={on} style={on ? chipOn : chip} onClick={() => toggle(site)}>
              {on && <CheckOutlined aria-hidden style={{ fontSize: 12 }} />}
              {SITE_TYPES[site]}
            </button>
          );
        })}
        {step.customSites.map((name) => (
          <span key={name} style={{ ...chipOn, cursor: 'default' }}>
            <CheckOutlined aria-hidden style={{ fontSize: 12 }} />
            {name}
            <CloseOutlined
              aria-label={`移除${name}`}
              style={{ fontSize: 11, cursor: 'pointer', marginLeft: 2 }}
              onClick={() => onChange({ ...step, customSites: step.customSites.filter((s) => s !== name) })}
            />
          </span>
        ))}
        {adding ? (
          <Input
            autoFocus
            style={{ width: 180, height: 36, borderRadius: 18 }}
            placeholder="场所名称，回车添加"
            maxLength={20}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={addCustom}
            onBlur={addCustom}
          />
        ) : (
          step.customSites.length < 10 && (
            <button
              type="button"
              style={{ ...chip, borderStyle: 'dashed', borderColor: '#C4C9D2', color: gy.tertiary }}
              onClick={() => setAdding(true)}
            >
              + 其他
            </button>
          )
        )}
      </div>
    </FillCard>
  );
}

const ANSWER_OPTIONS: { value: SpecialAnswer; label: string }[] = [
  { value: 'yes', label: '有' },
  { value: 'no', label: '没有' },
  { value: 'photo', label: '拍照给耕云看' },
];

export function AnswerSwitch<T extends string>({
  value,
  options,
  width,
  label,
  onChange,
}: {
  value: T | undefined;
  options: { value: T; label: string }[];
  width: number;
  label: string;
  onChange: (v: T) => void;
}) {
  return (
    <Radio.Group
      aria-label={label}
      optionType="button"
      buttonStyle="solid"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ display: 'flex', width, flexShrink: 0 }}
    >
      {options.map((o) => (
        <Radio.Button
          key={o.value}
          value={o.value}
          style={{ flex: o.label.length > 2 ? 1.3 : 1, textAlign: 'center', fontSize: 13, padding: 0 }}
        >
          {o.label}
        </Radio.Button>
      ))}
    </Radio.Group>
  );
}

function SpecialCard({
  step,
  vesselAutoPicked,
  fileNames,
  uploading,
  onChange,
  onPhoto,
}: {
  step: ProductionStep;
  vesselAutoPicked: boolean;
  fileNames: Record<string, string>;
  uploading: string | null;
  onChange: (s: ProductionStep) => void;
  onPhoto: (cat: SpecialCategory, file: File) => void;
}) {
  const compressor = hasAirCompressor(step.equipment);
  const patch = (cat: SpecialCategory, value: Partial<ProductionStep['specialEquipment'][SpecialCategory]>) =>
    onChange({
      ...step,
      specialEquipment: { ...step.specialEquipment, [cat]: { ...step.specialEquipment[cat], ...value } },
    });

  return (
    <FillCard>
      <CardHeading
        title="特种设备与储存设施"
        description="先回答有没有。拿不准算不算的，拍照给耕云看；选「有」再填参数，拍铭牌也可以。"
      />
      {SPECIAL_CATEGORY_KEYS.map((cat) => {
        const value = step.specialEquipment[cat];
        const open = value.answer === 'yes' || value.answer === 'photo';
        const note =
          cat === 'pressureVessels' && compressor && value.answer === 'yes'
            ? vesselAutoPicked
              ? '设备表里有空压机，已预选「有」；只有空压机储气罐的可不填参数'
              : '只有空压机储气罐的可不填参数'
            : undefined;
        return (
          <div
            key={cat}
            data-testid={`special-${cat}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: open ? '14px 16px' : '10px 16px',
              borderRadius: 8,
              border: `1px solid ${gy.split}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>
                  {SPECIAL_CATEGORIES[cat].label}
                </span>
                {note && <span style={hint}>{note}</span>}
              </div>
              <AnswerSwitch
                label={SPECIAL_CATEGORIES[cat].label}
                value={value.answer}
                options={ANSWER_OPTIONS}
                width={272}
                onChange={(answer) => patch(cat, { answer })}
              />
            </div>
            {value.answer === 'yes' && <SpecialParams cat={cat} step={step} onChange={onChange} />}
            {open && (
              <PhotoRow
                label={value.answer === 'yes' ? '或拍铭牌，代替填写参数' : '拍设备或铭牌照片，耕云的注册安全工程师判断是否属于特种设备'}
                button={value.answer === 'yes' ? '拍铭牌' : '拍照上传'}
                fileIds={value.photoFileIds}
                fileNames={fileNames}
                uploading={uploading === `special-${cat}`}
                onFile={(file) => onPhoto(cat, file)}
                onRemove={(fileId) => patch(cat, { photoFileIds: value.photoFileIds.filter((f) => f !== fileId) })}
              />
            )}
          </div>
        );
      })}
    </FillCard>
  );
}

function Field({ label, flex, width, children }: { label: string; flex?: number; width?: number; children: ReactNode }) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        ...(width ? { width, flexShrink: 0 } : { flex: `${flex ?? 1} 1 0`, minWidth: 0 }),
      }}
    >
      <span style={muted}>{label}</span>
      {children}
    </label>
  );
}

export function RemoveButton({ label, onClick, hidden }: { label: string; onClick: () => void; hidden?: boolean }) {
  return (
    <span style={{ width: 24, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
      {!hidden && (
        <Button
          type="text"
          size="small"
          aria-label={label}
          icon={<CloseOutlined style={{ fontSize: 12, color: '#8A93A3' }} />}
          onClick={onClick}
        />
      )}
    </span>
  );
}

// 选「有」之后的参数：每类可填多台，参数都可以留空（拍铭牌代替）
function SpecialParams({
  cat,
  step,
  onChange,
}: {
  cat: SpecialCategory;
  step: ProductionStep;
  onChange: (s: ProductionStep) => void;
}) {
  const se = step.specialEquipment;
  const set = <K extends SpecialCategory>(key: K, items: ProductionStep['specialEquipment'][K]['items']) =>
    onChange({ ...step, specialEquipment: { ...se, [key]: { ...se[key], items } } });
  const rowStyle = { display: 'flex', alignItems: 'flex-end', gap: 12 } as const;
  const add = (
    <Button
      type="link"
      size="small"
      style={{ alignSelf: 'flex-start', padding: 0 }}
      onClick={() => {
        const id = newId('s');
        if (cat === 'pressureVessels') set(cat, [...se.pressureVessels.items, { id }]);
        if (cat === 'boilers') set(cat, [...se.boilers.items, { id }]);
        if (cat === 'pressurePipelines') set(cat, [...se.pressurePipelines.items, { id }]);
        if (cat === 'storageTanks') set(cat, [...se.storageTanks.items, { id }]);
      }}
    >
      + 填写参数{se[cat].items.length > 0 ? '（再加一台）' : ''}
    </Button>
  );

  let rows: ReactNode[] = [];
  if (cat === 'pressureVessels') {
    const items = se.pressureVessels.items;
    const put = (id: string, p: Partial<(typeof items)[number]>) =>
      set(cat, items.map((v) => (v.id === id ? { ...v, ...p } : v)));
    rows = items.map((v, i) => {
      const pv = pressureVolumeOf(v);
      return (
        <div key={v.id} style={rowStyle}>
          <Field label="介质">
            <Input value={v.medium} maxLength={30} placeholder="如压缩空气" onChange={(e) => put(v.id, { medium: e.target.value })} />
          </Field>
          <Field label="最高工作压力">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              value={v.maxWorkingPressureMPa}
              suffix="MPa"
              onChange={(n) => put(v.id, { maxWorkingPressureMPa: n ?? undefined })}
            />
          </Field>
          <Field label="容积">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              value={v.volumeM3}
              suffix="m³"
              onChange={(n) => put(v.id, { volumeM3: n ?? undefined })}
            />
          </Field>
          <Field label="PV 值（自动计算）">
            <div
              data-testid="pv-value"
              style={{
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 12px',
                borderRadius: 6,
                background: gy.neutralBg,
                fontSize: 14,
                color: pv === undefined ? '#8A93A3' : gy.text,
              }}
            >
              <span>{pv ?? '—'}</span>
              <span style={{ color: '#8A93A3' }}>MPa·m³</span>
            </div>
          </Field>
          <RemoveButton label={`删除第 ${i + 1} 台压力容器`} onClick={() => set(cat, items.filter((x) => x.id !== v.id))} />
        </div>
      );
    });
  } else if (cat === 'boilers') {
    const items = se.boilers.items;
    const put = (id: string, p: Partial<(typeof items)[number]>) =>
      set(cat, items.map((v) => (v.id === id ? { ...v, ...p } : v)));
    rows = items.map((v, i) => (
      <div key={v.id} style={rowStyle}>
        <Field label="类型" width={180}>
          <Select
            value={v.type}
            placeholder="请选择"
            options={Object.entries(BOILER_TYPES).map(([value, label]) => ({ value, label }))}
            onChange={(type) => put(v.id, { type })}
          />
        </Field>
        <Field label="额定参数">
          <Input
            value={v.ratedParams}
            maxLength={50}
            placeholder="如 2 t/h、1.25 MPa，铭牌上有"
            onChange={(e) => put(v.id, { ratedParams: e.target.value })}
          />
        </Field>
        <RemoveButton label={`删除第 ${i + 1} 台锅炉`} onClick={() => set(cat, items.filter((x) => x.id !== v.id))} />
      </div>
    ));
  } else if (cat === 'pressurePipelines') {
    const items = se.pressurePipelines.items;
    const put = (id: string, p: Partial<(typeof items)[number]>) =>
      set(cat, items.map((v) => (v.id === id ? { ...v, ...p } : v)));
    rows = items.map((v, i) => (
      <div key={v.id} style={rowStyle}>
        <Field label="介质">
          <Input value={v.medium} maxLength={30} placeholder="如蒸汽、天然气" onChange={(e) => put(v.id, { medium: e.target.value })} />
        </Field>
        <Field label="公称直径">
          <Input
            value={v.nominalDiameter}
            maxLength={20}
            placeholder="如 DN50"
            onChange={(e) => put(v.id, { nominalDiameter: e.target.value })}
          />
        </Field>
        <RemoveButton label={`删除第 ${i + 1} 条压力管道`} onClick={() => set(cat, items.filter((x) => x.id !== v.id))} />
      </div>
    ));
  } else {
    const items = se.storageTanks.items;
    const put = (id: string, p: Partial<(typeof items)[number]>) =>
      set(cat, items.map((v) => (v.id === id ? { ...v, ...p } : v)));
    rows = items.map((v, i) => (
      <div key={v.id} style={rowStyle}>
        <Field label="储存物">
          <Input value={v.substance} maxLength={30} placeholder="如柴油" onChange={(e) => put(v.id, { substance: e.target.value })} />
        </Field>
        <Field label="储存量">
          <Input value={v.capacity} maxLength={20} placeholder="如 5 t" onChange={(e) => put(v.id, { capacity: e.target.value })} />
        </Field>
        <RemoveButton label={`删除第 ${i + 1} 个储罐`} onClick={() => set(cat, items.filter((x) => x.id !== v.id))} />
      </div>
    ));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows}
      {add}
    </div>
  );
}

export function PhotoRow({
  label,
  button,
  fileIds,
  fileNames,
  uploading,
  onFile,
  onRemove,
}: {
  label: string;
  button: string;
  fileIds: string[];
  fileNames: Record<string, string>;
  uploading: boolean;
  onFile: (file: File) => void;
  onRemove: (fileId: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ ...muted, flex: 1 }}>{label}</span>
        <Upload
          accept={IMAGE_ACCEPT}
          multiple
          showUploadList={false}
          disabled={uploading}
          beforeUpload={(file) => {
            onFile(file);
            return false;
          }}
        >
          <Button
            style={{ width: 120, borderStyle: 'dashed', borderColor: '#A9B4C6', color: gy.primary, fontSize: 13 }}
            icon={uploading ? <LoadingOutlined /> : <CameraIcon />}
          >
            {button}
          </Button>
        </Upload>
      </div>
      {fileIds.map((id) => (
        <FileChip key={id} name={fileNames[id] ?? '照片'} onRemove={() => onRemove(id)} />
      ))}
    </div>
  );
}

export function FileChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 6px 6px 12px',
        borderRadius: 6,
        background: '#F3F7FF',
        border: '1px solid #CFDDFB',
      }}
    >
      <span style={{ flex: 1, fontSize: 13, lineHeight: '20px', color: gy.text }}>{name}</span>
      <Popconfirm title="移除这个文件？" okText="移除" cancelText="取消" onConfirm={onRemove}>
        <Button type="link" size="small">
          移除
        </Button>
      </Popconfirm>
    </div>
  );
}

export function CameraIcon({ color = gy.primary }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1.5" y="3.5" width="11" height="8" rx="1.5" fill="none" stroke={color} strokeWidth="1.2" />
      <circle cx="7" cy="7.5" r="2" fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

const colLabel = (style: CSSProperties) => ({ ...muted, ...style });
const grow = (n: number): CSSProperties => ({ flex: `${n} 1 0`, minWidth: 0 });
const fixed = (w: number): CSSProperties => ({ width: w, flexShrink: 0 });
const cellInput: CSSProperties = { paddingInline: 10 };

function AssetsCard({
  step,
  fileNames,
  uploading,
  onChange,
  onLedger,
  onRemoveLedger,
  onLabel,
}: {
  step: ProductionStep;
  fileNames: Record<string, string>;
  uploading: string | null;
  onChange: (s: ProductionStep) => void;
  onLedger: (ledger: Ledger, file: File) => void;
  onRemoveLedger: (ledger: Ledger, fileId: string) => void;
  onLabel: (materialId: string, file: File) => void;
}) {
  const ledgerInput = useRef<HTMLInputElement>(null);
  const [ledgerTarget, setLedgerTarget] = useState<Ledger>('equipment');
  const putEquipment = (id: string, p: Partial<DraftEquipment>) =>
    onChange({ ...step, equipment: step.equipment.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const putMaterial = (id: string, p: Partial<DraftMaterial>) =>
    onChange({ ...step, materials: step.materials.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const ledgerBusy = uploading?.startsWith('ledger-');

  const ledgerList = (ledger: Ledger) =>
    step.ledgers[ledger].length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {step.ledgers[ledger].map((id) => (
          <FileChip key={id} name={fileNames[id] ?? LEDGER_LABELS[ledger]} onRemove={() => onRemoveLedger(ledger, id)} />
        ))}
        <span style={hint}>已上传{LEDGER_LABELS[ledger]}，下面的表格可以不填，专家会按台账整理。</span>
      </div>
    );

  return (
    <FillCard gap={12}>
      <CardHeading
        title="主要设备与原辅材料"
        description="名称和数量先填，其余列可稍后补；有台账直接上传（Excel / 照片均可）。"
        extra={
          <>
            <Dropdown
              trigger={['click']}
              disabled={ledgerBusy}
              menu={{
                items: (Object.keys(LEDGER_LABELS) as Ledger[]).map((key) => ({ key, label: LEDGER_LABELS[key] })),
                onClick: ({ key }) => {
                  setLedgerTarget(key as Ledger);
                  ledgerInput.current?.click();
                },
              }}
            >
              <Button style={{ flexShrink: 0 }} icon={ledgerBusy ? <LoadingOutlined /> : undefined}>
                上传台账
              </Button>
            </Dropdown>
            <input
              ref={ledgerInput}
              type="file"
              hidden
              multiple
              accept={MATERIAL_ACCEPT}
              data-testid="ledger-input"
              onChange={(e) => {
                for (const file of Array.from(e.target.files ?? [])) onLedger(ledgerTarget, file);
                e.target.value = '';
              }}
            />
          </>
        }
      />

      <div style={{ paddingTop: 4, fontSize: 13, lineHeight: '20px', fontWeight: 500, color: '#3F4A5C' }}>设备</div>
      {ledgerList('equipment')}
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={colLabel(grow(1.4))}>名称</span>
        <span style={colLabel(grow(1))}>规格型号</span>
        <span style={colLabel(fixed(72))}>数量</span>
        <span style={colLabel(grow(0.9))}>使用部门 / 地点</span>
        <span style={colLabel(fixed(92))}>使用状况</span>
        <span style={fixed(24)} />
      </div>
      {step.equipment.map((e, i) => (
        <div key={e.id} data-testid="equipment-row" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Input
            style={{ ...grow(1.4), ...cellInput }}
            aria-label={`第 ${i + 1} 台设备名称`}
            maxLength={50}
            placeholder="如冲床、焊机"
            value={e.name}
            onChange={(ev) => putEquipment(e.id, { name: ev.target.value })}
          />
          <Input
            style={{ ...grow(1), ...cellInput }}
            aria-label={`第 ${i + 1} 台设备规格型号`}
            maxLength={50}
            placeholder="可留空"
            value={e.spec}
            onChange={(ev) => putEquipment(e.id, { spec: ev.target.value })}
          />
          <Input
            style={{ ...fixed(72), ...cellInput }}
            aria-label={`第 ${i + 1} 台设备数量`}
            maxLength={20}
            placeholder="如 2 台"
            value={e.quantity}
            onChange={(ev) => putEquipment(e.id, { quantity: ev.target.value })}
          />
          <Input
            style={{ ...grow(0.9), ...cellInput }}
            aria-label={`第 ${i + 1} 台设备使用部门或地点`}
            maxLength={50}
            placeholder="如焊接车间"
            value={e.location}
            onChange={(ev) => putEquipment(e.id, { location: ev.target.value })}
          />
          <AutoComplete
            style={fixed(92)}
            aria-label={`第 ${i + 1} 台设备使用状况`}
            options={EQUIPMENT_CONDITION_OPTIONS.map((value) => ({ value }))}
            placeholder="正常"
            maxLength={20}
            value={e.condition}
            onChange={(condition: string) => putEquipment(e.id, { condition })}
          />
          <RemoveButton
            label={`删除第 ${i + 1} 台设备`}
            hidden={step.equipment.length <= 1}
            onClick={() => onChange({ ...step, equipment: step.equipment.filter((x) => x.id !== e.id) })}
          />
        </div>
      ))}
      <Button
        type="link"
        style={{ alignSelf: 'flex-start', padding: 0, height: 22 }}
        disabled={step.equipment.length >= 200}
        onClick={() => onChange({ ...step, equipment: [...step.equipment, blankEquipment()] })}
      >
        + 添加设备
      </Button>

      <div style={{ height: 1, background: '#EEF0F3', flexShrink: 0 }} />

      <div style={{ fontSize: 13, lineHeight: '20px', fontWeight: 500, color: '#3F4A5C' }}>原辅材料（含气瓶）</div>
      {ledgerList('materials')}
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={colLabel(grow(1.2))}>名称</span>
        <span style={colLabel(fixed(84))}>年用量</span>
        <span style={colLabel(fixed(84))}>最大存放量</span>
        <span style={colLabel(grow(0.8))}>存放位置</span>
        <span style={colLabel(fixed(168))}>包装标签 / MSDS</span>
        <span style={fixed(24)} />
      </div>
      {step.materials.map((m, i) => (
        <div key={m.id} data-testid="material-row" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Input
            style={{ ...grow(1.2), ...cellInput }}
            aria-label={`第 ${i + 1} 种物料名称`}
            maxLength={50}
            placeholder={m.kind === 'cylinder' ? '如氧气、乙炔' : '如油漆、钢板'}
            value={m.name}
            onChange={(ev) => putMaterial(m.id, { name: ev.target.value })}
            suffix={
              m.kind === 'cylinder' && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: '0 2px 0 6px',
                    borderRadius: 4,
                    background: gy.neutralBg,
                    color: gy.secondary,
                    fontSize: 12,
                  }}
                >
                  气瓶
                  <input
                    aria-label={`第 ${i + 1} 种物料气瓶规格`}
                    maxLength={20}
                    placeholder="40L"
                    value={m.cylinderSpec ?? ''}
                    onChange={(ev) => putMaterial(m.id, { cylinderSpec: ev.target.value })}
                    style={{
                      width: 40,
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      color: gy.secondary,
                      fontSize: 12,
                      lineHeight: '18px',
                    }}
                  />
                </span>
              )
            }
          />
          <Input
            style={{ ...fixed(84), ...cellInput }}
            aria-label={`第 ${i + 1} 种物料年用量`}
            maxLength={20}
            placeholder="稍后补"
            value={m.annualUsage}
            onChange={(ev) => putMaterial(m.id, { annualUsage: ev.target.value })}
          />
          <Input
            style={{ ...fixed(84), ...cellInput }}
            aria-label={`第 ${i + 1} 种物料最大存放量`}
            maxLength={20}
            placeholder={m.kind === 'cylinder' ? '如 6 瓶' : '如 200 kg'}
            value={m.maxStorage}
            onChange={(ev) => putMaterial(m.id, { maxStorage: ev.target.value })}
          />
          <Input
            style={{ ...grow(0.8), ...cellInput }}
            aria-label={`第 ${i + 1} 种物料存放位置`}
            maxLength={50}
            placeholder="如原料仓"
            value={m.storageLocation}
            onChange={(ev) => putMaterial(m.id, { storageLocation: ev.target.value })}
          />
          <MsdsCell
            material={m}
            fileNames={fileNames}
            uploading={uploading === `label-${m.id}`}
            onFile={(file) => onLabel(m.id, file)}
            onClear={() => putMaterial(m.id, { labelPhotoFileIds: [] })}
          />
          <RemoveButton
            label={`删除第 ${i + 1} 种物料`}
            hidden={step.materials.length <= 1}
            onClick={() => onChange({ ...step, materials: step.materials.filter((x) => x.id !== m.id) })}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 16 }}>
        {(['material', 'cylinder'] as const).map((kind) => (
          <Button
            key={kind}
            type="link"
            style={{ padding: 0, height: 22 }}
            disabled={step.materials.length >= 200}
            onClick={() => onChange({ ...step, materials: [...step.materials, blankMaterial(kind)] })}
          >
            {kind === 'material' ? '+ 添加物料' : '+ 添加气瓶'}
          </Button>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 6,
          background: source.system.bg,
          fontSize: 13,
          lineHeight: '20px',
        }}
      >
        <span style={{ flexShrink: 0, fontWeight: 500, color: source.system.color }}>MSDS</span>
        <span style={{ color: gy.text }}>
          是不是危化品由专家按名称和包装标签判断，您不用选。油漆、稀释剂多为混合物，请向供应商要安全技术说明书，第 4
          步上传；氧气等纯物质，耕云资料库会补全。
        </span>
      </div>
    </FillCard>
  );
}

// 包装标签 / MSDS 一栏：按物料名称提示要不要拍标签
function MsdsCell({
  material,
  fileNames,
  uploading,
  onFile,
  onClear,
}: {
  material: DraftMaterial;
  fileNames: Record<string, string>;
  uploading: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const box: CSSProperties = {
    ...fixed(168),
    height: 36,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 10px',
    borderRadius: 6,
    fontSize: 13,
    lineHeight: '20px',
  };
  const kind = msdsHintOf(material);
  if (kind === 'knowledge_base') {
    return <span style={{ ...box, background: source.system.bg, color: source.system.color }}>纯物质 · 耕云补全</span>;
  }
  if (kind === 'not_needed') return <span style={{ ...box, color: '#8A93A3' }}>一般原料 · 不需要</span>;
  if (kind === 'label_done') {
    const names = material.labelPhotoFileIds.map((id) => fileNames[id] ?? '照片').join('、');
    return (
      <span
        title={names}
        style={{ ...box, background: '#F4FAF6', border: '1px solid #BFD8C8', color: gy.success, paddingRight: 2 }}
      >
        <CheckOutlined style={{ fontSize: 12 }} />
        <span style={{ flex: 1 }}>已拍包装标签</span>
        <Popconfirm title="移除包装标签照片？" okText="移除" cancelText="取消" onConfirm={onClear}>
          <Button
            type="text"
            size="small"
            aria-label="移除包装标签照片"
            icon={<CloseOutlined style={{ fontSize: 11, color: gy.success }} />}
          />
        </Popconfirm>
      </span>
    );
  }
  if (kind === 'label_needed') {
    return (
      <Upload
        accept={IMAGE_ACCEPT}
        showUploadList={false}
        disabled={uploading}
        beforeUpload={(file) => {
          onFile(file);
          return false;
        }}
      >
        <Button
          style={{ ...fixed(168), borderStyle: 'dashed', borderColor: '#A9B4C6', color: gy.primary, fontSize: 13 }}
          icon={uploading ? <LoadingOutlined /> : <CameraIcon />}
        >
          拍包装标签
        </Button>
      </Upload>
    );
  }
  return <span style={fixed(168)} />;
}

const YES_NO = [
  { value: 'yes', label: '是' },
  { value: 'no', label: '否' },
] as const;

function QuestionsCard({ step, onChange }: { step: ProductionStep; onChange: (s: ProductionStep) => void }) {
  const questions = [
    {
      key: 'leasesPremises',
      title: '有没有把厂房出租给其他企业？',
      note: '有出租的，预案需写明与承租方的应急协作。',
    },
    { key: 'ownVehicles', title: '有自己的车辆运输货物吗？', note: '有自有车辆的，需增加道路运输事故的处置内容。' },
  ] as const;
  return (
    <FillCard title="最后两个问题" gap={16}>
      {questions.map((q, i) => {
        const value = step[q.key];
        return (
          <div key={q.key} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {i > 0 && <div style={{ height: 1, background: '#EEF0F3' }} />}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>{q.title}</span>
                <span style={muted}>{q.note}</span>
              </div>
              <AnswerSwitch
                label={q.title}
                value={value === undefined ? undefined : value ? 'yes' : 'no'}
                options={[...YES_NO]}
                width={212}
                onChange={(v) => onChange({ ...step, [q.key]: v === 'yes' })}
              />
            </div>
          </div>
        );
      })}
    </FillCard>
  );
}
