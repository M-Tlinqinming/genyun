import {
  BRANCH_KINDS,
  FIGURES,
  orgChartSvg,
  PER_ROW_OPTIONS,
  processFlowSvg,
  type BranchKind,
  type FigureKey,
  type FiguresSave,
  type FigureStatus,
  type FiguresView,
  type FiguresWorkup,
  type ProcessBranch,
  type Svg,
} from '@genyun/shared';
import { Button, Modal, Popconfirm, Radio, Select } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { linkButton } from '../../../components/ui';
import { gy, source, stage } from '../../../theme/tokens';

const label: CSSProperties = { width: 96, flexShrink: 0, fontSize: 13, lineHeight: '20px', color: gy.secondary };
const small: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.text };
const link13: CSSProperties = { ...linkButton, fontSize: 13, lineHeight: '20px' };

export type FiguresSaveInput = Omit<FiguresSave, 'version'>;

export interface FiguresPanelProps {
  view: FiguresView;
  // 已保存的画法（只改其中一项时带上其余几项）
  settings: FiguresWorkup;
  saving: boolean;
  onSave: (input: FiguresSaveInput) => Promise<boolean>;
  // 人员与工序回到对应模块修改
  onGoOrganization: () => void;
  onGoProcess: () => void;
  registerRow: (key: string, el: HTMLElement | null) => void;
}

function day(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}.${get('day')}`;
}

// 页面预览缩小后宋体太细，换成界面字体；Word 里的图仍是宋体
const svgUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/font-family="[^"]*"/, `font-family="'Microsoft YaHei', 'Noto Sans SC', sans-serif"`))}`;

// 中栏「图件」（14 页 E18-00F）：两张图并排，各自调整画法后采用；人员和工序内容回到对应模块修改
export function FiguresPanel(props: FiguresPanelProps) {
  const { view, saving, onSave } = props;
  const pending = view.pending.map((p) => p.key);

  return (
    <section aria-label="图件" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>预案附图 · 系统生成，专家微调后采用</h2>
          <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
            图由客户填写的应急组织和工序自动画出。这里只改「怎么画」；人员和工序内容回到对应模块修改，改后图会重新生成。
          </span>
        </div>
        <Popconfirm
          title="两张图都恢复自动排版？"
          description="去掉这里的调整和添加的支路，已采用的图要重新采用。"
          okText="恢复"
          cancelText="取消"
          onConfirm={() => void onSave({ org: null, process: null })}
        >
          <Button disabled={saving || (!view.org.customized && !view.process.customized)}>全部恢复自动排版</Button>
        </Popconfirm>
        <Button type="primary" disabled={saving || pending.length === 0} onClick={() => void onSave({ adopt: pending })}>
          {pending.length === 2 ? '两张图都采用' : pending.length === 1 ? `采用${FIGURES[pending[0]!]}` : '两张图都已采用'}
        </Button>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <OrgCard {...props} />
        <ProcessCard {...props} />
      </div>
    </section>
  );
}

function StatusTag({ status, by, at }: { status: FigureStatus; by?: string; at?: string }) {
  const done = status === 'adopted';
  const text = done ? `已采用 · ${by} ${at ? day(at) : ''}` : status === 'changed' ? '图有变化，待重新采用' : '待采用';
  const tone = done ? stage.done : stage.action;
  return (
    <span style={{ padding: '0 8px', borderRadius: 4, background: tone.bg, color: tone.color, fontSize: 12, lineHeight: '22px', whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

// 体系图窄、流程图宽，两张卡片按 2 : 3 分
const CARD_FLEX: Record<FigureKey, string> = { org: '2 1 0', process: '3 1 0' };

function Card({
  figure,
  status,
  adopted,
  svg,
  caption,
  children,
  customized,
  resetHint,
  saving,
  onSave,
  registerRow,
}: {
  figure: FigureKey;
  status: FigureStatus;
  adopted?: { byName: string; at: string };
  svg: Svg;
  caption?: string;
  children: ReactNode;
  customized: boolean;
  resetHint?: string;
  saving: boolean;
  onSave: (input: FiguresSaveInput) => Promise<boolean>;
  registerRow: (key: string, el: HTMLElement | null) => void;
}) {
  const [zoom, setZoom] = useState(false);
  const reset = () => void onSave(figure === 'org' ? { org: null } : { process: null });
  const image = (scale: number) => (
    <img src={svgUrl(svg.svg)} width={svg.width * scale} alt={`${FIGURES[figure]}预览`} style={{ maxWidth: '100%', height: 'auto' }} />
  );
  return (
    <article
      ref={(el) => registerRow(`figure:${figure}`, el)}
      aria-label={FIGURES[figure]}
      style={{ flex: CARD_FLEX[figure], minWidth: 0, display: 'flex', flexDirection: 'column', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', borderBottom: `1px solid ${gy.split}` }}>
        <h3 style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 600, lineHeight: '24px', color: gy.text }}>{FIGURES[figure]}</h3>
        <StatusTag status={status} by={adopted?.byName} at={adopted?.at} />
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 16px 16px', background: '#FAFBFC' }}>
        <button type="button" style={{ ...link13, position: 'absolute', top: 8, right: 12 }} onClick={() => setZoom(true)}>
          放大预览
        </button>
        {image(1)}
        {caption && <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>{caption}</span>}
      </div>
      <Modal title={FIGURES[figure]} open={zoom} width={Math.min(svg.width * 1.4 + 48, 1200)} footer={null} onCancel={() => setZoom(false)}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>{image(1.4)}</div>
      </Modal>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px' }}>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {resetHint ? (
            <Popconfirm title="恢复自动排版？" description={resetHint} okText="恢复" cancelText="取消" onConfirm={reset}>
              <Button disabled={saving || !customized}>恢复自动排版</Button>
            </Popconfirm>
          ) : (
            <Button disabled={saving || !customized} onClick={reset}>
              恢复自动排版
            </Button>
          )}
          <Button type="primary" disabled={saving || status === 'adopted'} onClick={() => void onSave({ adopt: [figure] })}>
            {status === 'adopted' ? '已采用' : '采用此图'}
          </Button>
        </div>
      </div>
    </article>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-setting={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span style={{ ...label, paddingTop: 4 }}>{name}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minHeight: 28 }}>{children}</div>
    </div>
  );
}

function ShowHide({ name, value, disabled, onChange }: { name: string; value: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <Radio.Group
      aria-label={name}
      size="small"
      optionType="button"
      buttonStyle="solid"
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value as boolean)}
      options={[
        { label: '显示', value: true },
        { label: '不显示', value: false },
      ]}
    />
  );
}

function OrgCard({ view, settings, saving, onSave, onGoOrganization, registerRow }: FiguresPanelProps) {
  const org = view.org;
  const [ordering, setOrdering] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const saveOrg = (patch: Partial<NonNullable<FiguresWorkup['org']>>) => onSave({ org: { ...settings.org, ...patch } });
  const svg = orgChartSvg({ deputy: org.deputy, office: org.office, groups: org.groups });

  const moveBefore = (name: string, target: string) => {
    if (name === target) return;
    const rest = org.groups.filter((g) => g !== name);
    const after = org.groups.indexOf(name) < org.groups.indexOf(target);
    rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, name);
    void saveOrg({ order: rest });
  };

  return (
    <Card
      figure="org"
      status={org.status}
      adopted={org.adopted}
      customized={org.customized}
      saving={saving}
      onSave={onSave}
      registerRow={registerRow}
      svg={svg}
    >
      <Row name="副总指挥">
        <ShowHide name="副总指挥" value={org.deputy} disabled={saving} onChange={(deputy) => void saveOrg({ deputy })} />
        {org.deputy && !org.hasDeputy && <span style={{ fontSize: 12, lineHeight: '20px', color: stage.action.color }}>客户没有填副总指挥</span>}
      </Row>
      <Row name="应急办公室">
        <ShowHide name="应急办公室" value={org.office} disabled={saving} onChange={(office) => void saveOrg({ office })} />
      </Row>
      <Row name="小组顺序">
        <span style={small}>{org.customOrder ? '专家调整过' : '按规则排序'}</span>
        {org.groups.length > 1 && (
          <button type="button" style={link13} onClick={() => setOrdering(!ordering)}>
            {ordering ? '完成' : '拖动调整'}
          </button>
        )}
        {org.customOrder && (
          <button type="button" style={link13} disabled={saving} onClick={() => void saveOrg({ order: undefined })}>
            恢复规则排序
          </button>
        )}
      </Row>
      {ordering && (
        <ol aria-label="小组顺序" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 0 108px', padding: 0, listStyle: 'none' }}>
          {org.groups.map((g, i) => (
            <li
              key={g}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', g);
                setDragging(g);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                moveBefore(e.dataTransfer.getData('text/plain') || dragging || '', g);
                setDragging(null);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 30,
                padding: '0 10px 0 6px',
                borderRadius: 6,
                borderWidth: 1,
                borderStyle: dragging && dragging !== g ? 'dashed' : 'solid',
                borderColor: dragging && dragging !== g ? gy.primary : '#D9D9D9',
                background: gy.surface,
                opacity: dragging === g ? 0.4 : 1,
                cursor: 'grab',
                ...small,
              }}
            >
              <span aria-hidden style={{ width: 18, height: 18, borderRadius: 9, background: gy.neutralBg, textAlign: 'center', fontSize: 12, lineHeight: '18px', color: gy.secondary }}>
                {i + 1}
              </span>
              {g}
            </li>
          ))}
        </ol>
      )}
      <Row name="人员">
        <span style={small}>
          {org.groups.length} 个小组{org.hasDeputy ? ' · 有副总指挥' : ''}
        </span>
        <button type="button" style={link13} onClick={onGoOrganization}>
          去企业事实修改
        </button>
      </Row>
    </Card>
  );
}

let branchSeq = 0;
const newBranchId = () => `b${Date.now().toString(36)}${(branchSeq++).toString(36)}`;

function ProcessCard({ view, settings, saving, onSave, onGoProcess, registerRow }: FiguresPanelProps) {
  const p = view.process;
  const [adding, setAdding] = useState<{ from?: string; to?: string; kind: BranchKind } | null>(null);
  const saved = settings.process?.branches ?? [];
  const saveProcess = (patch: Partial<NonNullable<FiguresWorkup['process']>>) => onSave({ process: { ...settings.process, ...patch } });
  const removeBranch = (id: string) => void saveProcess({ branches: saved.filter((b) => b.id !== id) });
  const addBranch = async () => {
    if (!adding?.from || !adding.to) return;
    const branch: ProcessBranch = { id: newBranchId(), from: adding.from, to: adding.to, kind: adding.kind };
    if (await saveProcess({ branches: [...saved, branch] })) setAdding(null);
  };
  const stepOptions = p.steps.map((s, i) => ({ value: s, label: `${i + 1}. ${s}` }));

  if (!p.available) {
    return (
      <article
        aria-label={FIGURES.process}
        style={{ flex: CARD_FLEX.process, minWidth: 0, display: 'flex', flexDirection: 'column', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${gy.split}` }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: '24px', color: gy.text }}>{FIGURES.process}</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '24px 20px' }}>
          <span style={small}>
            客户没有填写工序，画不出流程图。
            {p.sketchFileIds.length ? '客户上传了流程图照片，生成时直接用照片。' : ''}
          </span>
          <button type="button" style={{ ...link13, alignSelf: 'flex-start' }} onClick={onGoProcess}>
            去工艺流程查看
          </button>
        </div>
      </article>
    );
  }

  const svg = processFlowSvg(p.steps, { perRow: p.perRow, branches: p.flowBranches });
  return (
    <Card
      figure="process"
      status={p.status}
      adopted={p.adopted}
      customized={p.customized}
      resetHint={saved.length ? `每行恢复 5 道，去掉 ${saved.length} 条支路。` : undefined}
      saving={saving}
      onSave={onSave}
      registerRow={registerRow}
      svg={svg}
      caption="附图　生产工艺流程图"
    >
      <Row name="每行工序数">
        <Radio.Group
          aria-label="每行工序数"
          size="small"
          optionType="button"
          buttonStyle="solid"
          disabled={saving}
          value={p.perRow}
          onChange={(e) => void saveProcess({ perRow: e.target.value as 3 | 4 | 5 | 0 })}
          options={PER_ROW_OPTIONS.map((n) => ({ label: n === 0 ? '单行' : String(n), value: n }))}
        />
      </Row>
      <Row name="支路">
        {p.branches.length === 0 && <span style={small}>没有返工 / 回用</span>}
        {!adding && (
          <button type="button" style={link13} onClick={() => setAdding({ kind: 'rework' })}>
            + 添加返工 / 回用
          </button>
        )}
      </Row>
      {p.branches.length > 0 && (
        <ul aria-label="支路" style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '-6px 0 0 108px', padding: 0, listStyle: 'none' }}>
          {p.branches.map((b) => (
            <li key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, ...small, color: b.valid ? source.expert.color : gy.tertiary }}>
              <span style={{ textDecoration: b.valid ? 'none' : 'line-through' }}>
                {b.from} → {b.to} · {BRANCH_KINDS[b.kind]}
              </span>
              {!b.valid && <span style={{ fontSize: 12, color: stage.action.color }}>工序已改名或删掉，不再画</span>}
              <button type="button" style={{ ...link13, color: gy.secondary }} disabled={saving} onClick={() => removeBranch(b.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div
          role="group"
          aria-label="添加支路"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '-4px 0 0 108px', padding: 10, borderRadius: 6, background: gy.canvas }}
        >
          <span style={small}>从</span>
          <Select
            aria-label="从哪道工序"
            showSearch
            size="small"
            style={{ width: 128 }}
            placeholder="工序"
            value={adding.from}
            options={stepOptions}
            onChange={(from: string) => setAdding({ ...adding, from })}
          />
          <span style={small}>回到</span>
          <Select
            aria-label="回到哪道工序"
            showSearch
            size="small"
            style={{ width: 128 }}
            placeholder="工序"
            value={adding.to}
            options={stepOptions.filter((o) => o.value !== adding.from)}
            onChange={(to: string) => setAdding({ ...adding, to })}
          />
          <Radio.Group
            aria-label="支路类型"
            size="small"
            optionType="button"
            value={adding.kind}
            onChange={(e) => setAdding({ ...adding, kind: e.target.value as BranchKind })}
            options={(Object.keys(BRANCH_KINDS) as BranchKind[]).map((k) => ({ label: BRANCH_KINDS[k], value: k }))}
          />
          <Button size="small" type="primary" disabled={saving || !adding.from || !adding.to || adding.from === adding.to} onClick={() => void addBranch()}>
            添加
          </Button>
          <Button size="small" onClick={() => setAdding(null)}>
            取消
          </Button>
        </div>
      )}
      <Row name="工序内容">
        <span style={small}>
          {p.steps.length} 道 · {p.source}
        </span>
        <button type="button" style={link13} onClick={onGoProcess}>
          去工艺流程查看
        </button>
      </Row>
    </Card>
  );
}
