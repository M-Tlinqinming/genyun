import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  BOILER_TYPES,
  FIRE_GRADES,
  FIRE_RATINGS,
  hasAirCompressor,
  PRODUCTION_LISTS,
  pressureVolumeOf,
  productionView,
  scopeImpact,
  SPECIAL_ANSWERS,
  type ChecklistItemKey,
  type DraftEquipment,
  type EquipmentRow,
  type ExpertEquipment,
  type ExpertMaterial,
  type FireGrade,
  type MaterialRow,
  type ProductionList,
  type ProductionSave,
  type SpecialCategory,
  type SpecialRow,
  type SupplyRow,
  type WorkupData,
  type WorkupSnapshot,
} from '@genyun/shared';
import { Button, Input, InputNumber, Select, Space, Tooltip } from 'antd';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { linkButton } from '../../../components/ui';
import { useListMotion } from '../../../theme/motion';
import { gy, source, stage } from '../../../theme/tokens';
import type { AskItem } from './ContactDialog';
import { SourceTag } from './FactsPanel';

// 页面补上版本号和对照的原件
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ProductionSaveInput = Without<ProductionSave, 'version' | 'fileId'>;

export interface ProductionPanelProps {
  snapshot: WorkupSnapshot;
  data: WorkupData;
  list: ProductionList;
  focusKey: string | null;
  saving: boolean;
  onSave: (save: ProductionSaveInput) => Promise<boolean>;
  // 打开右栏的某个文件（铭牌照片、验收资料）
  onOpenFile: (fileId: string) => void;
  // 某类资料的原件（设备台账、原辅材料台账），没有时返回 undefined
  onOpenItem: (itemKey: ChecklistItemKey) => (() => void) | undefined;
  onAsk: (item: AskItem) => void;
  registerRow: (key: string, el: HTMLElement | null) => void;
}

const SUBTITLES: Record<ProductionList, string> = {
  equipment: '设备名称与数量进企业概况与危险源辨识',
  special: '客户逐项回答有没有，拍照给耕云看的由专家判定',
  materials: '危化品判定影响危险源与适用范围',
  buildings: '耐火等级由专家判断',
  fire: '消防水池、消防器材与验收资料',
  supplies: '应急物资表按此生成',
  firstAid: '药品清单由客户填写',
  process: '工艺流程图按此生成',
};

const head: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.secondary };
const cell: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };
const small: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.text };
const rowLine: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, borderBottom: `1px solid ${gy.split}` };
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const col = (width: number, extra: CSSProperties = {}): CSSProperties => ({ width, flexShrink: 0, ...ellipsis, ...extra });
const grow: CSSProperties = { flex: 1, minWidth: 0, ...ellipsis };

const newRowId = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const dash = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));

// 中栏「生产设备与物料」（14 页 E18-00B、E18-00B2）：一次显示一类清单
export function ProductionPanel(props: ProductionPanelProps) {
  const { snapshot, data, list } = props;
  const view = useMemo(() => productionView(snapshot, data), [snapshot, data]);
  const impact = useMemo(() => scopeImpact(snapshot, view, list), [snapshot, view, list]);
  const [adding, setAdding] = useState<string | null>(null);
  const canAdd = list === 'equipment' || list === 'materials';

  return (
    <section
      aria-label={PRODUCTION_LISTS[list]}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: gy.surface,
        border: `1px solid ${gy.split}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: `1px solid ${gy.split}` }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>{PRODUCTION_LISTS[list]}</h2>
        <span style={{ ...head, ...grow }}>{SUBTITLES[list]}</span>
        {canAdd && (
          <button type="button" style={{ ...linkButton, fontSize: 14 }} onClick={() => setAdding(newRowId())}>
            <PlusOutlined /> 新增一行
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 16px' }}>
        {list === 'equipment' && <EquipmentTable {...props} rows={view.equipment} adding={adding} onAdded={() => setAdding(null)} />}
        {list === 'materials' && <MaterialTable {...props} rows={view.materials} adding={adding} onAdded={() => setAdding(null)} />}
        {list === 'special' && (
          <SpecialTable {...props} rows={view.special} compressor={hasAirCompressor(view.equipment as unknown as DraftEquipment[])} />
        )}
        {list === 'buildings' && <BuildingTable {...props} rows={view.buildings} />}
        {list === 'fire' && <FireList {...props} fire={view.fire} />}
        {list === 'supplies' && <SupplyTable rows={view.supplies} empty="客户还没有填应急物资" />}
        {list === 'firstAid' && <FirstAid {...props} kit={view.firstAid} />}
        {list === 'process' && <ProcessList process={view.process} />}
        {impact.length > 0 && (
          <div
            aria-label="本表影响的适用范围开关"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, padding: '12px 14px', borderRadius: 6, background: source.system.bg }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, lineHeight: '20px', color: source.system.color }}>本表影响的适用范围开关</div>
            {impact.map((s) => (
              <div key={s.key} style={small}>
                <span style={{ color: s.suggestion.value ? gy.text : gy.secondary }}>
                  {s.suggestion.value ? '开' : '关'} · {s.label}
                </span>
                <span style={{ color: gy.secondary }}>　{s.suggestion.reason}</span>
              </div>
            ))}
            <div style={{ ...head, marginTop: 2 }}>按现在的整理结果建议，在「适用范围」里由专家最终确认</div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- 来源与行操作 ----------
function RowSource({ edited, onOpen }: { edited: boolean; onOpen?: () => void }) {
  return (
    <span style={{ width: 88, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
      {edited ? <SourceTag kind="expert" /> : onOpen ? <SourceTag kind="original" note="台账" onClick={onOpen} /> : <SourceTag kind="customer" />}
    </span>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return <span style={{ width: 32, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{children}</span>;
}

function useHover() {
  const [hover, setHover] = useState(false);
  return { hover, bind: { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), onFocus: () => setHover(true) } };
}

function EditButton({ label, shown, onClick }: { label: string; shown: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} style={{ ...linkButton, opacity: shown ? 1 : 0, transition: 'opacity 0.15s' }} onClick={onClick}>
      <EditOutlined />
    </button>
  );
}

// 改过的客户行可撤回，专家新增的行可删除
function UndoButton({ added, onClick }: { added: boolean; onClick: () => void }) {
  return added ? (
    <Tooltip title="删除专家新增的这一行">
      <button type="button" aria-label="删除这一行" style={linkButton} onClick={onClick}>
        <DeleteOutlined />
      </button>
    </Tooltip>
  ) : (
    <Tooltip title="撤回专家的修改，回到客户填写的内容">
      <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={onClick}>
        撤回
      </button>
    </Tooltip>
  );
}

// ---------- 设备清单 ----------
const EQUIPMENT_FIELDS: { key: keyof ExpertEquipment; label: string; width?: number }[] = [
  { key: 'name', label: '名称' },
  { key: 'spec', label: '规格', width: 88 },
  { key: 'quantity', label: '数量', width: 72 },
  { key: 'location', label: '使用部门', width: 96 },
  { key: 'condition', label: '状况', width: 72 },
];

function EquipmentTable(props: ProductionPanelProps & { rows: EquipmentRow[]; adding: string | null; onAdded: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useListMotion<HTMLDivElement>();
  const ledger = props.onOpenItem('equipment');
  const save = async (id: string, value: ExpertEquipment | null) => {
    const ok = await props.onSave({ kind: 'equipment', rowId: id, value });
    if (ok) {
      setEditing(null);
      if (id === props.adding) props.onAdded();
    }
  };
  return (
    <div ref={listRef}>
      <div style={{ ...rowLine, minHeight: 40 }}>
        <span style={{ ...head, ...grow }}>名称</span>
        <span style={{ ...head, ...col(72) }}>规格</span>
        <span style={{ ...head, ...col(56, { textAlign: 'right' }) }}>数量</span>
        <span style={{ ...head, ...col(80, { paddingLeft: 8 }) }}>使用部门</span>
        <span style={{ ...head, ...col(40) }}>状况</span>
        <span style={{ ...head, ...col(88, { textAlign: 'right' }) }}>来源</span>
        <span style={{ width: 32, flexShrink: 0 }} />
      </div>
      {props.rows.length === 0 && !props.adding && <Empty text="客户还没有填设备，可以对照台账新增" />}
      {props.rows.map((r) =>
        editing === r.id ? (
          <RowEditor
            key={r.id}
            fields={EQUIPMENT_FIELDS}
            initial={r}
            saving={props.saving}
            onCancel={() => setEditing(null)}
            onSave={(v) => save(r.id, { ...v, name: v.name ?? '' } as ExpertEquipment)}
          />
        ) : (
          <EquipmentLine key={r.id} row={r} ledger={ledger} onEdit={() => setEditing(r.id)} onUndo={() => save(r.id, null)} />
        ),
      )}
      {props.adding && (
        <RowEditor
          fields={EQUIPMENT_FIELDS}
          initial={{ name: '' }}
          saving={props.saving}
          onCancel={props.onAdded}
          onSave={(v) => save(props.adding!, { ...v, name: v.name ?? '' } as ExpertEquipment)}
        />
      )}
    </div>
  );
}

function EquipmentLine({ row, ledger, onEdit, onUndo }: { row: EquipmentRow; ledger?: () => void; onEdit: () => void; onUndo: () => void }) {
  const { hover, bind } = useHover();
  return (
    <div style={rowLine} {...bind}>
      <span style={{ ...cell, ...grow }} title={row.name}>
        {row.name}
      </span>
      <span style={{ ...small, ...col(72) }} title={row.spec}>
        {dash(row.spec)}
      </span>
      <span style={{ ...cell, ...col(56, { textAlign: 'right' }) }}>{dash(row.quantity)}</span>
      <span style={{ ...small, ...col(80, { paddingLeft: 8 }) }} title={row.location}>
        {dash(row.location)}
      </span>
      <span style={{ ...small, ...col(40), color: gy.secondary }}>{dash(row.condition)}</span>
      <RowSource edited={row.source === 'expert'} onOpen={ledger} />
      <RowActions>
        {row.edited && hover ? <UndoButton added={row.added} onClick={onUndo} /> : <EditButton label={`修改${row.name}`} shown={hover} onClick={onEdit} />}
      </RowActions>
    </div>
  );
}

// 一行的编辑：设备、物料共用，字段都是文字
function RowEditor({
  fields,
  initial,
  saving,
  onCancel,
  onSave,
  extra,
}: {
  fields: { key: string; label: string; width?: number }[];
  // 客户行或空行，按字段名取文字
  initial: object;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: Record<string, string | undefined>) => void;
  extra?: ReactNode;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, String((initial as Record<string, unknown>)[f.key] ?? '')])),
  );
  const name = draft[fields[0]!.key]?.trim() ?? '';
  const submit = () => {
    if (!name || saving) return;
    const out: Record<string, string | undefined> = {};
    for (const f of fields) out[f.key] = draft[f.key]?.trim() || undefined;
    onSave(out);
  };
  const keys = { onPressEnter: submit, onKeyDown: (e: React.KeyboardEvent) => e.key === 'Escape' && onCancel() };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px -8px', padding: '10px 8px', borderRadius: 6, background: gy.selected }}>
      <Space.Compact style={{ width: '100%' }}>
        {fields.map((f, i) => (
          <Input
            key={f.key}
            autoFocus={i === 0}
            placeholder={f.label}
            aria-label={f.label}
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            style={f.width ? { width: f.width, flexShrink: 0 } : { flex: 1 }}
            {...keys}
          />
        ))}
      </Space.Compact>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...head, flex: 1 }}>{extra ?? '记为「专家整理」，客户原来填的内容保留，可以撤回'}</span>
        <Button type="primary" onClick={submit} loading={saving} disabled={!name}>
          保存
        </Button>
        <Button onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

// ---------- 原辅材料 ----------
const MATERIAL_FIELDS: { key: keyof ExpertMaterial & string; label: string; width?: number }[] = [
  { key: 'name', label: '名称' },
  { key: 'annualUsage', label: '年用量', width: 88 },
  { key: 'maxStorage', label: '最大储量', width: 88 },
  { key: 'storageLocation', label: '存放位置', width: 96 },
];

function MaterialTable(props: ProductionPanelProps & { rows: MaterialRow[]; adding: string | null; onAdded: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [judging, setJudging] = useState<string | null>(null);
  const listRef = useListMotion<HTMLDivElement>();
  const ledger = props.onOpenItem('materials');
  const saveRow = async (id: string, value: ExpertMaterial | null) => {
    const ok = await props.onSave({ kind: 'material', rowId: id, value });
    if (ok) {
      setEditing(null);
      if (id === props.adding) props.onAdded();
    }
  };
  const judge = async (id: string, value: boolean | null) => {
    if (await props.onSave({ kind: 'hazardous', rowId: id, value })) setJudging(null);
  };
  const toMaterial = (v: Record<string, string | undefined>, base?: MaterialRow): ExpertMaterial => ({
    kind: base?.kind ?? 'material',
    cylinderSpec: base?.cylinderSpec,
    name: v.name ?? '',
    annualUsage: v.annualUsage,
    maxStorage: v.maxStorage,
    storageLocation: v.storageLocation,
  });
  return (
    <div ref={listRef}>
      <div style={{ ...rowLine, minHeight: 40 }}>
        <span style={{ ...head, ...grow }}>名称</span>
        <span style={{ ...head, ...col(64, { textAlign: 'right' }) }}>年用量</span>
        <span style={{ ...head, ...col(64, { textAlign: 'right' }) }}>最大储量</span>
        <span style={{ ...head, ...col(72, { paddingLeft: 8 }) }}>存放</span>
        <span style={{ ...head, ...col(64, { paddingLeft: 8 }) }}>危化品</span>
        <span style={{ ...head, ...col(88, { textAlign: 'right' }) }}>来源</span>
        <span style={{ width: 32, flexShrink: 0 }} />
      </div>
      {props.rows.length === 0 && !props.adding && <Empty text="客户还没有填原辅材料，可以对照台账新增" />}
      {props.rows.map((r) => {
        const key = `material:${r.id}`;
        if (editing === r.id) {
          return (
            <RowEditor
              key={r.id}
              fields={MATERIAL_FIELDS}
              initial={r}
              saving={props.saving}
              onCancel={() => setEditing(null)}
              onSave={(v) => saveRow(r.id, toMaterial(v, r))}
            />
          );
        }
        const open = r.hazard.decidedBy === null || judging === r.id;
        return (
          <div
            key={r.id}
            ref={(el) => props.registerRow(key, el)}
            data-row={key}
            style={
              open
                ? {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    margin: '0 -20px',
                    padding: '10px 20px',
                    background: gy.selected,
                    borderBottom: `1px solid ${gy.split}`,
                    outline: props.focusKey === key ? `2px solid ${gy.primary}` : undefined,
                    outlineOffset: -2,
                  }
                : undefined
            }
          >
            <MaterialLine
              row={r}
              open={open}
              ledger={ledger}
              onEdit={() => setEditing(r.id)}
              onUndo={() => saveRow(r.id, null)}
              onRejudge={() => setJudging(r.id)}
              onRevertJudgement={() => judge(r.id, null)}
            />
            {open && (
              <HazardBar
                row={r}
                saving={props.saving}
                onJudge={(v) => judge(r.id, v)}
                onCancel={r.hazard.decidedBy !== null ? () => setJudging(null) : undefined}
              />
            )}
          </div>
        );
      })}
      {props.adding && (
        <RowEditor
          fields={MATERIAL_FIELDS}
          initial={{ name: '' }}
          saving={props.saving}
          onCancel={props.onAdded}
          onSave={(v) => saveRow(props.adding!, toMaterial(v))}
          extra="记为「专家整理」；保存后再判断是否危化品"
        />
      )}
    </div>
  );
}

function hazardText(r: MaterialRow): { text: string; color: string } {
  if (r.hazard.value === undefined) return { text: '待确认', color: stage.action.color };
  return r.hazard.value ? { text: '是', color: gy.text } : { text: '否', color: gy.secondary };
}

function MaterialLine({
  row,
  open,
  ledger,
  onEdit,
  onUndo,
  onRejudge,
  onRevertJudgement,
}: {
  row: MaterialRow;
  open: boolean;
  ledger?: () => void;
  onEdit: () => void;
  onUndo: () => void;
  onRejudge: () => void;
  onRevertJudgement: () => void;
}) {
  const { hover, bind } = useHover();
  const h = hazardText(row);
  const name = row.kind === 'cylinder' && row.cylinderSpec ? `${row.name}（${row.cylinderSpec}）` : row.name;
  return (
    <div style={open ? { display: 'flex', alignItems: 'center', gap: 8 } : rowLine} {...bind}>
      <span style={{ ...cell, ...grow, fontWeight: open ? 500 : 400 }} title={name}>
        {name}
      </span>
      <span style={{ ...cell, ...col(64, { textAlign: 'right' }) }}>{dash(row.annualUsage)}</span>
      <span style={{ ...cell, ...col(64, { textAlign: 'right' }) }}>{dash(row.maxStorage)}</span>
      <span style={{ ...small, ...col(72, { paddingLeft: 8 }) }} title={row.storageLocation}>
        {dash(row.storageLocation)}
      </span>
      <span style={{ ...col(64, { paddingLeft: 8 }), ...cell, color: h.color }}>
        {row.hazard.decidedBy !== null && !open && hover ? (
          <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={onRejudge}>
            改判定
          </button>
        ) : (
          h.text
        )}
      </span>
      <RowSource edited={row.source === 'expert' || row.hazard.decidedBy === 'expert'} onOpen={ledger} />
      <RowActions>
        {hover && row.hazard.judged && !row.edited ? (
          <Tooltip title="撤回危化品判定">
            <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={onRevertJudgement}>
              撤回
            </button>
          </Tooltip>
        ) : row.edited && hover ? (
          <UndoButton added={row.added} onClick={onUndo} />
        ) : (
          <EditButton label={`修改${row.name}`} shown={hover} onClick={onEdit} />
        )}
      </RowActions>
    </div>
  );
}

// 系统建议 + 专家判定（设计稿「待确认行 · 天那水」）
function HazardBar({ row, saving, onJudge, onCancel }: { row: MaterialRow; saving: boolean; onJudge: (v: boolean) => void; onCancel?: () => void }) {
  const s = row.hazard.suggestion;
  const action = (label: string, v: boolean) => (
    <button type="button" disabled={saving} style={{ ...linkButton, fontSize: 13 }} onClick={() => onJudge(v)}>
      {label}
    </button>
  );
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: gy.surface,
        border: `1px solid ${gy.split}`,
        borderRadius: 6,
      }}
    >
      {s && <SourceTag kind="system" />}
      <span style={{ ...small, flex: 1, minWidth: 0 }}>
        {s ? s.reason.replace(/^一般原料，不是危化品$/, '一般原料，系统判定不是危化品') : '《危险化学品目录》里查不到这个名称，请对照包装标签或 MSDS 判断'}
      </span>
      {s?.value ? action('采纳', true) : action('是危化品', true)}
      {action('不是危化品', false)}
      {onCancel && (
        <button type="button" style={{ ...linkButton, fontSize: 13, color: gy.secondary }} onClick={onCancel}>
          取消
        </button>
      )}
    </div>
  );
}

// ---------- 特种设备 ----------
type ParamField = { key: string; label: string; kind: 'text' | 'number' | 'boiler'; suffix?: string; width: number };
const SPECIAL_FIELDS: Record<SpecialCategory, ParamField[]> = {
  pressureVessels: [
    { key: 'medium', label: '介质', kind: 'text', width: 120 },
    { key: 'maxWorkingPressureMPa', label: '最高工作压力', kind: 'number', suffix: 'MPa', width: 150 },
    { key: 'volumeM3', label: '容积', kind: 'number', suffix: 'm³', width: 120 },
  ],
  boilers: [
    { key: 'type', label: '类型', kind: 'boiler', width: 150 },
    { key: 'ratedParams', label: '额定参数（如 2 t/h，1.25 MPa）', kind: 'text', width: 240 },
  ],
  pressurePipelines: [
    { key: 'medium', label: '介质', kind: 'text', width: 140 },
    { key: 'nominalDiameter', label: '公称直径（如 DN50）', kind: 'text', width: 180 },
  ],
  storageTanks: [
    { key: 'substance', label: '储存物', kind: 'text', width: 140 },
    { key: 'capacity', label: '储存量', kind: 'text', width: 140 },
  ],
};

const ANSWER_TEXT: Record<(typeof SPECIAL_ANSWERS)[number], string> = { yes: '有', no: '没有', photo: '拍照给耕云看' };

function paramsText(category: SpecialCategory, items: Record<string, unknown>[]): string {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
  const parts = items.map((r) => {
    switch (category) {
      case 'pressureVessels': {
        const p = typeof r.maxWorkingPressureMPa === 'number' ? r.maxWorkingPressureMPa : undefined;
        const v = typeof r.volumeM3 === 'number' ? r.volumeM3 : undefined;
        const pv = pressureVolumeOf({ maxWorkingPressureMPa: p, volumeM3: v });
        return [str(r.medium), p !== undefined && `${p} MPa`, v !== undefined && `${v} m³`, pv !== undefined && `PV ${pv} MPa·m³（系统计算）`]
          .filter(Boolean)
          .join(' · ');
      }
      case 'boilers':
        return [r.type ? BOILER_TYPES[r.type as keyof typeof BOILER_TYPES] : '', str(r.ratedParams)].filter(Boolean).join(' ');
      case 'pressurePipelines':
        return [str(r.medium), str(r.nominalDiameter)].filter(Boolean).join(' · ');
      case 'storageTanks':
        return [str(r.substance), str(r.capacity)].filter(Boolean).join(' · ');
    }
  });
  return parts.filter(Boolean).join('；');
}

function SpecialTable(props: ProductionPanelProps & { rows: SpecialRow[]; compressor: boolean }) {
  const [editing, setEditing] = useState<SpecialCategory | null>(null);
  const judge = async (category: SpecialCategory, value: { answer: 'yes' | 'no'; items: Record<string, unknown>[] } | null) => {
    if (await props.onSave({ kind: 'special', category, value })) setEditing(null);
  };
  return (
    <div>
      <div style={{ ...rowLine, minHeight: 40 }}>
        <span style={{ ...head, ...col(100) }}>类别</span>
        <span style={{ ...head, ...col(96) }}>客户回答</span>
        <span style={{ ...head, ...grow }}>参数</span>
        <span style={{ ...head, ...col(88, { textAlign: 'right' }) }}>来源</span>
        <span style={{ width: 32, flexShrink: 0 }} />
      </div>
      {props.rows.map((r) => {
        const key = `special:${r.category}`;
        const open = r.pending || editing === r.category;
        return (
          <div
            key={r.category}
            ref={(el) => props.registerRow(key, el)}
            data-row={key}
            style={
              open
                ? {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    margin: '0 -20px',
                    padding: '10px 20px',
                    background: gy.selected,
                    borderBottom: `1px solid ${gy.split}`,
                    outline: props.focusKey === key ? `2px solid ${gy.primary}` : undefined,
                    outlineOffset: -2,
                  }
                : undefined
            }
          >
            <SpecialLine
              row={r}
              open={open}
              onPhoto={r.photoFileIds[0] ? () => props.onOpenFile(r.photoFileIds[0]!) : undefined}
              onEdit={() => setEditing(r.category)}
              onRevert={() => judge(r.category, null)}
            />
            {editing === r.category ? (
              <ParamEditor
                category={r.category}
                initial={r.items}
                saving={props.saving}
                onCancel={() => setEditing(null)}
                onSave={(items) => judge(r.category, { answer: 'yes', items })}
              />
            ) : (
              r.pending && (
                <SpecialBar
                  row={r}
                  compressor={props.compressor}
                  saving={props.saving}
                  onFill={() => setEditing(r.category)}
                  onNone={() => judge(r.category, { answer: 'no', items: [] })}
                  onAsk={() =>
                    props.onAsk({
                      itemKey: 'special_equipment',
                      question: `请确认厂里有没有${r.label}；有的话请拍铭牌，或写明${SPECIAL_FIELDS[r.category].map((f) => f.label.replace(/（.*）/, '')).join('、')}。`,
                    })
                  }
                />
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function SpecialLine({ row, open, onPhoto, onEdit, onRevert }: { row: SpecialRow; open: boolean; onPhoto?: () => void; onEdit: () => void; onRevert: () => void }) {
  const { hover, bind } = useHover();
  const params = row.answer === 'no' ? '—' : paramsText(row.category, row.items) || (row.answer === 'yes' ? '参数未填，可对照铭牌补' : '—');
  const customer = row.customer ? ANSWER_TEXT[row.customer] : '还没回答';
  return (
    <div style={open ? { display: 'flex', alignItems: 'center', gap: 8 } : rowLine} {...bind}>
      <span style={{ ...col(100), display: 'flex', flexDirection: 'column', padding: open ? 0 : '8px 0' }}>
        <span style={{ ...cell, fontWeight: open ? 500 : 400 }}>{row.label}</span>
        {row.answer === 'yes' && row.items.length > 0 && <span style={{ fontSize: 12, lineHeight: '18px', color: gy.secondary }}>{row.items.length} 台</span>}
      </span>
      <span style={{ ...col(96), ...small, color: row.pending ? stage.action.color : gy.text }}>
        {customer}
        {row.judged && <span style={{ color: gy.secondary }}>{` → ${row.judged.value.answer === 'yes' ? '有' : '无'}`}</span>}
      </span>
      <span style={{ ...small, flex: 1, minWidth: 0, color: params === '—' ? gy.secondary : gy.text }}>{row.pending ? <span style={{ color: stage.action.color }}>待专家判断</span> : params}</span>
      <span style={{ width: 88, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
        {onPhoto ? (
          <SourceTag kind="original" note="照片" onClick={onPhoto} />
        ) : row.judged ? (
          <SourceTag kind="expert" />
        ) : row.customer ? (
          <SourceTag kind="customer" />
        ) : null}
      </span>
      <RowActions>
        {row.judged && hover && !open ? (
          <Tooltip title="撤回专家的判定，回到客户的回答">
            <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={onRevert}>
              撤回
            </button>
          </Tooltip>
        ) : row.answer === 'yes' && !open ? (
          <EditButton label={`补${row.label}参数`} shown={hover} onClick={onEdit} />
        ) : null}
      </RowActions>
    </div>
  );
}

function specialHint(row: SpecialRow, compressor: boolean): string {
  if (row.category === 'pressurePipelines' && compressor) return '有空压机与储气罐，可能有压缩空气主管；需确认管径与压力后判定';
  if (row.customer === 'photo') return row.photoFileIds.length ? '客户拍了照片给耕云看，请对照照片判定' : '客户选了拍照给耕云看，但还没传照片';
  return '客户还没回答有没有';
}

function SpecialBar({
  row,
  compressor,
  saving,
  onFill,
  onNone,
  onAsk,
}: {
  row: SpecialRow;
  compressor: boolean;
  saving: boolean;
  onFill: () => void;
  onNone: () => void;
  onAsk: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 6 }}>
      <SourceTag kind="system" />
      <span style={{ ...small, flex: 1, minWidth: 0 }}>{specialHint(row, compressor)}</span>
      <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={onFill}>
        填参数
      </button>
      <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={onAsk}>
        联系客户
      </button>
      <button type="button" disabled={saving} style={{ ...linkButton, fontSize: 13 }} onClick={onNone}>
        判定为无
      </button>
    </div>
  );
}

function ParamEditor({
  category,
  initial,
  saving,
  onCancel,
  onSave,
}: {
  category: SpecialCategory;
  initial: Record<string, unknown>[];
  saving: boolean;
  onCancel: () => void;
  onSave: (items: Record<string, unknown>[]) => void;
}) {
  const fields = SPECIAL_FIELDS[category];
  const strip = (r: Record<string, unknown>) => Object.fromEntries(fields.map((f) => [f.key, r[f.key]]));
  const [rows, setRows] = useState<Record<string, unknown>[]>(() => (initial.length ? initial.map(strip) : [{}]));
  const set = (i: number, key: string, v: unknown) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: v ?? undefined } : r)));
  const clean = rows
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null && v !== '')))
    .filter((r) => Object.keys(r).length > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 6 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {fields.map((f) =>
            f.kind === 'number' ? (
              <InputNumber
                key={f.key}
                min={0}
                placeholder={f.label}
                aria-label={f.label}
                suffix={f.suffix}
                value={typeof r[f.key] === 'number' ? (r[f.key] as number) : null}
                onChange={(v) => set(i, f.key, v)}
                style={{ width: f.width }}
              />
            ) : f.kind === 'boiler' ? (
              <Select
                key={f.key}
                placeholder={f.label}
                aria-label={f.label}
                allowClear
                value={r[f.key] as string | undefined}
                onChange={(v) => set(i, f.key, v)}
                options={Object.entries(BOILER_TYPES).map(([value, label]) => ({ value, label }))}
                style={{ width: f.width }}
              />
            ) : (
              <Input
                key={f.key}
                placeholder={f.label}
                aria-label={f.label}
                value={typeof r[f.key] === 'string' ? (r[f.key] as string) : ''}
                onChange={(e) => set(i, f.key, e.target.value)}
                style={{ width: f.width }}
              />
            ),
          )}
          {rows.length > 1 && (
            <button type="button" aria-label="删除这一台" style={linkButton} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <DeleteOutlined />
            </button>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={() => setRows([...rows, {}])}>
          <PlusOutlined /> 再加一台
        </button>
        <span style={{ ...head, flex: 1 }}>保存即判定为有，记为「专家整理」</span>
        <Button type="primary" loading={saving} onClick={() => onSave(clean)}>
          判定为有
        </Button>
        <Button onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

// ---------- 建构筑物 ----------
function BuildingTable(props: ProductionPanelProps & { rows: ReturnType<typeof productionView>['buildings'] }) {
  return (
    <div>
      <div style={{ ...rowLine, minHeight: 40 }}>
        <span style={{ ...head, ...grow }}>名称</span>
        <span style={{ ...head, ...col(56, { textAlign: 'right' }) }}>层数</span>
        <span style={{ ...head, ...col(80, { textAlign: 'right' }) }}>面积</span>
        <span style={{ ...head, ...col(112, { paddingLeft: 16 }) }}>耐火等级</span>
        <span style={{ ...head, ...col(88, { textAlign: 'right' }) }}>来源</span>
        <span style={{ width: 32, flexShrink: 0 }} />
      </div>
      {props.rows.length === 0 && <Empty text="客户还没有填建筑" />}
      {props.rows.map((b) => {
        const key = `building:${b.id}`;
        const pending = !b.fireRating;
        return (
          <div
            key={b.id}
            ref={(el) => props.registerRow(key, el)}
            data-row={key}
            style={{
              ...rowLine,
              ...(pending ? { margin: '0 -20px', padding: '0 20px', background: gy.selected } : {}),
              outline: props.focusKey === key ? `2px solid ${gy.primary}` : undefined,
              outlineOffset: -2,
            }}
          >
            <span style={{ ...cell, ...grow }}>{b.name}</span>
            <span style={{ ...cell, ...col(56, { textAlign: 'right' }) }}>{b.floors ? `${b.floors} 层` : '—'}</span>
            <span style={{ ...cell, ...col(80, { textAlign: 'right' }) }}>{b.areaM2 ? `${b.areaM2} m²` : '—'}</span>
            <span style={{ ...col(112, { paddingLeft: 16, overflow: 'visible' }) }}>
              <Select
                size="small"
                placeholder="请判断"
                aria-label={`${b.name}耐火等级`}
                value={b.fireRating}
                status={pending ? 'warning' : undefined}
                disabled={props.saving}
                onChange={(v: FireGrade) => void props.onSave({ kind: 'fireRating', rowId: b.id, value: v })}
                options={FIRE_GRADES.map((g) => ({ value: g, label: FIRE_RATINGS[g] }))}
                style={{ width: 96 }}
              />
            </span>
            <span style={{ width: 88, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
              {b.ratingBy === 'expert' ? <SourceTag kind="expert" /> : b.ratingBy === 'customer' ? <SourceTag kind="customer" /> : null}
            </span>
            <RowActions>
              {b.judged && (
                <Tooltip title="撤回专家的判断">
                  <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={() => void props.onSave({ kind: 'fireRating', rowId: b.id, value: null })}>
                    撤回
                  </button>
                </Tooltip>
              )}
            </RowActions>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 消防设施、应急物资、急救药箱、工艺流程（只读，内容由客户填写） ----------
function FireList(props: ProductionPanelProps & { fire: ReturnType<typeof productionView>['fire'] }) {
  const pool = props.fire.firePool;
  const poolText =
    pool.answer === 'yes'
      ? `有 ${pool.count ?? '?'} 个${pool.volumeM3 ? `，容积 ${pool.volumeM3} m³` : '，容积客户稍后补'}`
      : pool.answer === 'no'
        ? '没有'
        : '客户还没回答';
  return (
    <div>
      <div style={rowLine}>
        <span style={{ ...cell, ...col(120) }}>消防水池</span>
        <span style={{ ...cell, ...grow, color: pool.answer ? gy.text : stage.action.color }}>{poolText}</span>
        <SourceTag kind="customer" />
      </div>
      <div style={rowLine}>
        <span style={{ ...cell, ...col(120) }}>消防验收资料</span>
        <span style={{ ...small, ...grow, display: 'flex', gap: 12 }}>
          {props.fire.acceptanceFileIds.length === 0
            ? <span style={{ color: gy.secondary }}>没有上传</span>
            : props.fire.acceptanceFileIds.map((id, i) => (
                <button key={id} type="button" style={{ ...linkButton, fontSize: 13 }} onClick={() => props.onOpenFile(id)}>
                  第 {i + 1} 份
                </button>
              ))}
        </span>
      </div>
      <h3 style={{ ...head, fontWeight: 500, margin: '16px 0 0' }}>消防器材</h3>
      <SupplyTable rows={props.fire.supplies} empty="客户还没有填灭火器、消火栓" />
    </div>
  );
}

function SupplyTable({ rows, empty }: { rows: SupplyRow[]; empty: string }) {
  return (
    <div>
      <div style={{ ...rowLine, minHeight: 40 }}>
        <span style={{ ...head, ...grow }}>名称</span>
        <span style={{ ...head, ...col(88, { textAlign: 'right' }) }}>数量</span>
        <span style={{ ...head, ...col(160, { paddingLeft: 16 }) }}>位置</span>
      </div>
      {rows.length === 0 && <Empty text={empty} />}
      {rows.map((s, i) => (
        <div key={`${s.name}-${i}`} style={rowLine}>
          <span style={{ ...cell, ...grow }}>{s.name}</span>
          <span style={{ ...cell, ...col(88, { textAlign: 'right' }) }}>{s.quantity !== undefined ? `${s.quantity} ${s.unit ?? ''}` : '—'}</span>
          <span style={{ ...small, ...col(160, { paddingLeft: 16 }) }}>{dash(s.location)}</span>
        </div>
      ))}
    </div>
  );
}

function FirstAid(props: ProductionPanelProps & { kit: ReturnType<typeof productionView>['firstAid'] }) {
  const { kit } = props;
  if (kit.status === 'none') return <Empty text="客户回答没有急救药箱" />;
  if (kit.status === 'needs_customer') {
    return (
      <div
        ref={(el) => props.registerRow('firstAid', el)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          margin: '8px 0',
          padding: '10px 12px',
          borderRadius: 6,
          background: stage.action.bg,
          outline: props.focusKey === 'firstAid' ? `2px solid ${stage.action.color}` : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ ...cell, flex: 1, color: stage.action.color }}>
            {kit.photoFileIds.length ? '客户只传了药箱照片，药品清单需客户补' : '客户还没有填药品清单'}
          </span>
          {kit.photoFileIds[0] && (
            <button type="button" style={linkButton} onClick={() => props.onOpenFile(kit.photoFileIds[0]!)}>
              看照片
            </button>
          )}
          <button
            type="button"
            style={linkButton}
            onClick={() => props.onAsk({ itemKey: 'first_aid_kit', question: '请在任务里补充急救药箱的药品清单（药品名称和数量）。' })}
          >
            请客户补充
          </button>
        </div>
        <div style={head}>药品清单由客户填写，专家不代为整理</div>
      </div>
    );
  }
  return <SupplyTable rows={kit.items} empty="客户还没有填药品清单" />;
}

function ProcessList({ process }: { process: ReturnType<typeof productionView>['process'] }) {
  if (process.steps.length === 0) return <Empty text={process.description ? `客户的描述：${process.description}` : '客户还没有填工艺流程'} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
      <ol aria-label="工序" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
        {process.steps.map((s, i) => (
          <li key={`${s}-${i}`} style={{ ...small, padding: '4px 10px', borderRadius: 4, background: gy.neutralBg }}>
            {i + 1}　{s}
          </li>
        ))}
      </ol>
      {process.description && <div style={{ ...head }}>客户的描述：{process.description}</div>}
      <div style={head}>工序的增删和流程图微调在「图件」里做（M2 第 9 项）</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ margin: '32px 0', textAlign: 'center', fontSize: 14, color: gy.secondary }}>{text}</p>;
}
