import { PlusOutlined } from '@ant-design/icons';
import {
  accidentTypeOf,
  LEC_DIMENSIONS,
  LEC_KEYS,
  LEC_OPTIONS,
  PLAN_TEMPLATES,
  PRODUCTION_LISTS,
  RISK_THRESHOLDS,
  riskLevel,
  riskScore,
  type LecKey,
  type ProductionList,
  type RiskLevel,
  type RiskRow,
  type RiskRowValue,
  type RiskView,
} from '@genyun/shared';
import { AutoComplete, Button, Empty, Input, Select } from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import type { WorkupOriginal } from '../../../api/workup';
import { linkButton } from '../../../components/ui';
import { gy, source, stage } from '../../../theme/tokens';
import { originalTitle, Preview } from './OriginalsPanel';

const head: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.secondary };
const cell: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };
const sub: CSSProperties = { fontSize: 12, lineHeight: '18px', color: gy.secondary };
const small: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.text };
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const lecCol: CSSProperties = { width: 28, flexShrink: 0, textAlign: 'center' };
const dCol: CSSProperties = { width: 40, flexShrink: 0, textAlign: 'right' };
const levelCol: CSSProperties = { width: 72, flexShrink: 0, paddingLeft: 8 };
const sourceCol: CSSProperties = { width: 64, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' };

const newRowId = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const valueOf = (r: RiskRow): RiskRowValue => ({
  factor: r.factor,
  workplace: r.workplace,
  l: r.l,
  e: r.e,
  c: r.c,
  ...(r.note ? { note: r.note } : {}),
  ...(r.excluded ? { excluded: true } : {}),
});

// 手动新增时可选的事故类型：预案里的各类事故 + GB 6441-2025 表 1 里没有对应方案的几类
const FACTOR_OPTIONS = [
  ...new Set([
    ...PLAN_TEMPLATES.filter((t) => t.kind === 'site').map((t) => accidentTypeOf(t.title)),
    '水害',
    '民用爆炸物品爆炸',
    '烟花爆竹爆炸',
    '其他可燃固体爆炸',
    '滑坡',
  ]),
].map((value) => ({ value }));

const LEVEL_COLORS: Record<RiskLevel, { color: string; bg: string }> = {
  稍有危险: stage.progress,
  一般危险: stage.progress,
  显著危险: stage.action,
  高度危险: stage.error,
  极其危险: stage.error,
};

function Tag({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <span style={{ display: 'inline-block', padding: '0 6px', borderRadius: 4, fontSize: 12, lineHeight: '20px', color, background: bg }}>{text}</span>;
}

function LevelTag({ level, excluded }: { level: RiskLevel; excluded?: boolean }) {
  if (excluded) return <Tag text="不适用" color={gy.tertiary} bg={gy.neutralBg} />;
  return <Tag text={level} {...LEVEL_COLORS[level]} />;
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export interface RiskPanelProps {
  view: RiskView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  // 当前看的取值维度（右栏显示这一维的取值参考）
  dimension: LecKey;
  onDimension: (key: LecKey) => void;
  saving: boolean;
  onSave: (rowId: string, value: RiskRowValue | null) => Promise<boolean>;
  registerRow: (key: string, el: HTMLElement | null) => void;
}

// 中栏「危险源辨识」（14 页 E18-00C）：候选由设备与物料推出，选中一行即可改取值，改完自动保存
export function RiskPanel(props: RiskPanelProps) {
  const { view, selectedId, onSelect } = props;
  const [adding, setAdding] = useState<string | null>(null);
  const counted = view.levels.map((l) => `${l.level} ${l.count}`).join(' · ');

  return (
    <section
      aria-label="危险源辨识"
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
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>危险源辨识</h2>
        <span style={{ ...head, flex: 1, minWidth: 0, ...ellipsis }}>候选由设备与物料推导 · D = L × E × C</span>
        <button type="button" style={{ ...linkButton, fontSize: 14 }} onClick={() => setAdding(newRowId())}>
          <PlusOutlined /> 手动新增
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 16px' }}>
        <div role="row" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, borderBottom: `1px solid ${gy.split}` }}>
          <span style={{ ...head, flex: 1, minWidth: 0 }}>危险有害因素 · 作业场所</span>
          {LEC_KEYS.map((k) => (
            <span key={k} style={{ ...head, ...lecCol }}>
              {k.toUpperCase()}
            </span>
          ))}
          <span style={{ ...head, ...dCol }}>D</span>
          <span style={{ ...head, ...levelCol }}>等级</span>
          <span style={{ ...head, ...sourceCol }}>来源</span>
        </div>
        {adding && <AddRow key={adding} id={adding} places={view.places.map((p) => p.name)} {...props} onDone={() => setAdding(null)} />}
        {view.rows.map((r) =>
          r.id === selectedId ? (
            <SelectedRow key={r.id} row={r} {...props} />
          ) : (
            <div
              key={r.id}
              ref={(el) => props.registerRow(r.id, el)}
              data-row={`risk:${r.id}`}
              role="row"
              tabIndex={0}
              onClick={() => onSelect(r.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, height: 52, borderBottom: `1px solid ${gy.split}`, cursor: 'pointer' }}
            >
              <RowCells row={r} />
            </div>
          ),
        )}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, ...head }}>
          <span>{counted || '没有计入报告的危险源'}</span>
          <span>结果写入风险评估报告 表 2-1</span>
        </div>
      </div>
    </section>
  );
}

function Summary({ row, strong }: { row: RiskRow; strong?: boolean }) {
  const struck: CSSProperties = row.excluded ? { textDecoration: 'line-through', color: gy.tertiary } : {};
  return (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <span style={{ ...cell, ...ellipsis, fontWeight: strong ? 500 : 400, ...struck }}>{row.factor}</span>
      <span style={{ ...sub, ...ellipsis }}>{row.item ? `${row.workplace} · ${row.item}` : row.workplace}</span>
    </span>
  );
}

function SourceCell({ row }: { row: RiskRow }) {
  const c = row.source === 'expert' ? source.expert : source.system;
  return (
    <span style={sourceCol}>
      <Tag text={row.source === 'expert' ? '专家' : '系统'} {...c} />
    </span>
  );
}

function RowCells({ row }: { row: RiskRow }) {
  const muted = row.excluded ? { color: gy.tertiary } : {};
  return (
    <>
      <Summary row={row} />
      {LEC_KEYS.map((k) => (
        <span key={k} style={{ ...cell, ...lecCol, ...muted }}>
          {row[k]}
        </span>
      ))}
      <span style={{ ...cell, ...dCol, fontWeight: 500, ...muted }}>{row.d}</span>
      <span style={levelCol}>
        <LevelTag level={row.level} excluded={row.excluded} />
      </span>
      <SourceCell row={row} />
    </>
  );
}

// 选中的一行：L / E / C 直接选，作业场所与说明离开输入框时保存
function SelectedRow({ row, dimension, onDimension, saving, onSave, registerRow }: RiskPanelProps & { row: RiskRow }) {
  const [workplace, setWorkplace] = useState(row.workplace);
  const [note, setNote] = useState(row.note ?? '');
  useEffect(() => {
    setWorkplace(row.workplace);
    setNote(row.note ?? '');
  }, [row.workplace, row.note]);

  const save = (patch: Partial<RiskRowValue>) => void onSave(row.id, { ...valueOf(row), ...patch });
  const saveText = (key: 'workplace' | 'note', text: string) => {
    const v = text.trim();
    if (key === 'workplace' && (!v || v === row.workplace)) return setWorkplace(row.workplace);
    if (key === 'note' && v === (row.note ?? '')) return;
    save(key === 'note' ? { note: v || undefined } : { workplace: v });
  };

  return (
    <div
      ref={(el) => registerRow(row.id, el)}
      data-row={`risk:${row.id}`}
      role="row"
      aria-selected="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        margin: '0 -20px',
        padding: '8px 20px 10px',
        background: gy.selected,
        borderBottom: `1px solid ${gy.split}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
        <Summary row={row} strong />
        {LEC_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-label={`${k.toUpperCase()} 取值`}
            onClick={() => onDimension(k)}
            style={{
              ...linkButton,
              ...lecCol,
              fontSize: 14,
              lineHeight: '20px',
              borderRadius: 4,
              background: gy.surface,
              color: k === dimension ? gy.primary : gy.text,
              border: `1px solid ${k === dimension ? gy.primary : gy.split}`,
            }}
          >
            {row[k]}
          </button>
        ))}
        <span style={{ ...cell, ...dCol, fontWeight: 500 }}>{row.d}</span>
        <span style={levelCol}>
          <LevelTag level={row.level} excluded={row.excluded} />
        </span>
        <SourceCell row={row} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {LEC_KEYS.map((k) => (
          <Select
            key={k}
            size="small"
            aria-label={LEC_DIMENSIONS[k]}
            value={row[k]}
            disabled={saving || row.excluded}
            onFocus={() => onDimension(k)}
            onChange={(v) => save({ [k]: v })}
            popupMatchSelectWidth={false}
            style={{ width: 76 }}
            labelRender={({ value }) => `${k.toUpperCase()} ${value}`}
            options={LEC_OPTIONS[k].map((o) => ({ value: o.value, label: `${o.value}　${o.label}` }))}
          />
        ))}
        <Input
          size="small"
          aria-label="作业场所"
          prefix={<span style={{ color: gy.secondary }}>场所</span>}
          value={workplace}
          maxLength={30}
          disabled={saving || row.excluded}
          onChange={(e) => setWorkplace(e.target.value)}
          onBlur={() => saveText('workplace', workplace)}
          onPressEnter={() => saveText('workplace', workplace)}
          style={{ width: 168 }}
        />
      </div>
      <Input
        size="small"
        aria-label="改值说明"
        placeholder="改值说明（可不填），如：气瓶间紧邻冲压车间，爆炸可致数人伤亡"
        value={note}
        maxLength={200}
        disabled={saving || row.excluded}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => saveText('note', note)}
        onPressEnter={() => saveText('note', note)}
      />
      {row.edited && (row.changes.length > 0 || row.note) && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 6, background: gy.surface, border: `1px solid ${gy.split}` }}>
          {row.changes.length > 0 && <span style={{ ...small, flexShrink: 0, color: source.expert.color }}>{row.changes.join('　')}</span>}
          <span style={{ ...small, flex: 1, minWidth: 0 }}>
            {row.note ? `${row.note}。` : ''}
            {row.edited.byName} · {clock(row.edited.at)}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, ...head }}>
        {row.added ? (
          <button type="button" style={{ ...linkButton, fontSize: 13, color: gy.error }} disabled={saving} onClick={() => void onSave(row.id, null)}>
            删除这一行
          </button>
        ) : (
          <>
            <button type="button" style={{ ...linkButton, fontSize: 13 }} disabled={saving} onClick={() => save({ excluded: !row.excluded || undefined })}>
              {row.excluded ? '恢复，计入报告' : '标为不适用'}
            </button>
            {row.edited && (
              <button type="button" style={{ ...linkButton, fontSize: 13 }} disabled={saving} onClick={() => void onSave(row.id, null)}>
                撤回修改，用系统推荐
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 手动新增一行：危险有害因素、作业场所必填，取值先给一组常见值
function AddRow({ id, places, saving, onSave, onSelect, onDone }: RiskPanelProps & { id: string; places: string[]; onDone: () => void }) {
  const [value, setValue] = useState<RiskRowValue>({ factor: '', workplace: places[0] ?? '', l: 1, e: 3, c: 7 });
  const d = riskScore(value);
  const ready = value.factor.trim() !== '' && value.workplace.trim() !== '';
  const submit = async () => {
    if (await onSave(id, { ...value, factor: value.factor.trim(), workplace: value.workplace.trim() })) {
      onDone();
      onSelect(id);
    }
  };
  return (
    <div
      role="row"
      aria-label="新增危险源"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 -20px', padding: '10px 20px', background: gy.selected, borderBottom: `1px solid ${gy.split}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <AutoComplete
          size="small"
          aria-label="危险有害因素"
          placeholder="危险有害因素，如 水害"
          options={FACTOR_OPTIONS}
          value={value.factor}
          onChange={(factor) => setValue((v) => ({ ...v, factor }))}
          filterOption={(input, o) => String(o?.value).includes(input)}
          style={{ width: 168 }}
        />
        <AutoComplete
          size="small"
          aria-label="作业场所"
          placeholder="作业场所"
          options={places.map((p) => ({ value: p }))}
          value={value.workplace}
          onChange={(workplace) => setValue((v) => ({ ...v, workplace }))}
          style={{ width: 140 }}
        />
        {LEC_KEYS.map((k) => (
          <Select
            key={k}
            size="small"
            aria-label={LEC_DIMENSIONS[k]}
            value={value[k]}
            onChange={(n) => setValue((v) => ({ ...v, [k]: n }))}
            popupMatchSelectWidth={false}
            style={{ width: 76 }}
            labelRender={({ value: n }) => `${k.toUpperCase()} ${n}`}
            options={LEC_OPTIONS[k].map((o) => ({ value: o.value, label: `${o.value}　${o.label}` }))}
          />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...small, flex: 1 }}>
          D = {d}
          {d !== undefined && (
            <>
              {'　'}
              <LevelTag level={riskLevel(d)!} />
            </>
          )}
        </span>
        <Button size="small" onClick={onDone}>
          取消
        </Button>
        <Button size="small" type="primary" disabled={!ready} loading={saving} onClick={() => void submit()}>
          添加
        </Button>
      </div>
    </div>
  );
}

// ---------- 右栏「评价依据」 ----------
type BasisTab = 'basis' | 'table' | 'originals';
const TABS: { key: BasisTab; label: string }[] = [
  { key: 'basis', label: '推导依据' },
  { key: 'table', label: 'LEC 取值表' },
  { key: 'originals', label: '原件' },
];

export function RiskBasisPanel({
  row,
  dimension,
  saving,
  onPick,
  onJump,
  originals,
}: {
  row: RiskRow | undefined;
  dimension: LecKey;
  saving: boolean;
  // 在取值参考里点一个值，直接改选中行
  onPick: (key: LecKey, value: number) => void;
  onJump: (list: ProductionList) => void;
  originals: WorkupOriginal[];
}) {
  const [tab, setTab] = useState<BasisTab>('basis');
  const [fileId, setFileId] = useState<string | null>(null);
  const file = originals.find((o) => o.fileId === fileId) ?? originals[0];

  return (
    <aside
      aria-label="评价依据"
      style={{
        width: 360,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: gy.surface,
        border: `1px solid ${gy.split}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 0', borderBottom: `1px solid ${gy.split}` }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>评价依据</h2>
        <div role="tablist" style={{ display: 'flex', gap: 20 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...linkButton,
                fontSize: 14,
                lineHeight: '22px',
                paddingBottom: 8,
                color: tab === t.key ? gy.primary : gy.secondary,
                borderBottom: `2px solid ${tab === t.key ? gy.primary : 'transparent'}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'basis' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
          {row ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={head}>当前选中</span>
                <span style={{ fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>
                  {row.factor} · {row.workplace}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 6, background: source.system.bg }}>
                <span style={{ ...small, fontWeight: 500, color: source.system.color }}>为什么出现这一项</span>
                <span style={small}>
                  {row.basis}
                  {row.planTitle ? `；对应「${row.planTitle}」。` : '。'}
                </span>
                {row.ref && (
                  <button type="button" style={{ ...linkButton, ...small, color: gy.primary, textAlign: 'left' }} onClick={() => onJump(row.ref!.list)}>
                    查看{PRODUCTION_LISTS[row.ref.list]} · {row.ref.name} →
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ ...cell, fontWeight: 500 }}>
                  {dimension.toUpperCase()} · {LEC_DIMENSIONS[dimension]}取值参考
                </span>
                {LEC_OPTIONS[dimension].map((o) => {
                  const current = row[dimension] === o.value;
                  const suggested = row.suggested?.[dimension] === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      disabled={saving || row.excluded}
                      aria-pressed={current}
                      onClick={() => !current && onPick(dimension, o.value)}
                      style={{
                        ...linkButton,
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 4,
                        background: current ? gy.selected : 'none',
                      }}
                    >
                      <span style={{ ...small, color: current ? gy.primary : gy.secondary, fontWeight: current ? 500 : 400 }}>{o.value}</span>
                      <span style={{ ...small, color: current ? gy.primary : gy.text }}>
                        {o.label}
                        {suggested && !row.added ? '（系统默认）' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
              <span style={head}>{RISK_THRESHOLDS}</span>
            </>
          ) : (
            <Empty style={{ margin: 'auto' }} image={Empty.PRESENTED_IMAGE_SIMPLE} description="选中一项危险源查看推导依据" />
          )}
        </div>
      )}

      {tab === 'table' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
          {LEC_KEYS.map((k) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...cell, fontWeight: 500 }}>
                {k.toUpperCase()} · {LEC_DIMENSIONS[k]}
              </span>
              {LEC_OPTIONS[k].map((o) => (
                <span key={o.value} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 10px', ...small }}>
                  <span style={{ color: gy.secondary }}>{o.value}</span>
                  <span>{o.label}</span>
                </span>
              ))}
            </div>
          ))}
          <span style={head}>{RISK_THRESHOLDS}</span>
        </div>
      )}

      {tab === 'originals' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {file ? (
            <>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${gy.split}` }}>
                <Select
                  size="small"
                  aria-label="选择原件"
                  value={file.fileId}
                  onChange={setFileId}
                  style={{ width: '100%' }}
                  options={originals.map((o) => ({ value: o.fileId, label: originalTitle(o) }))}
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: gy.neutralBg }}>
                <Preview key={file.fileId} original={file} />
              </div>
            </>
          ) : (
            <Empty style={{ margin: 'auto', padding: 24 }} image={Empty.PRESENTED_IMAGE_SIMPLE} description="客户没有上传文件" />
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: `1px solid ${gy.split}`, ...head }}>
        <span style={{ flex: 1 }}>GB 6441-2025 · LEC 法</span>
        {tab !== 'table' && (
          <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={() => setTab('table')}>
            查看全表
          </button>
        )}
      </div>
    </aside>
  );
}
