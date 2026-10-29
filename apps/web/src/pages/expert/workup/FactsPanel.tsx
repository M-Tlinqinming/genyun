import { EditOutlined } from '@ant-design/icons';
import {
  FACT_SECTIONS,
  FACT_SOURCES,
  formatFact,
  type Fact,
  type FactPerson,
  type FactSection,
  type FactSource,
  type FactValue,
} from '@genyun/shared';
import { Button, Input, InputNumber, Space, Switch, Tooltip } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { linkButton } from '../../../components/ui';
import { FlashOnDone, useListMotion } from '../../../theme/motion';
import { gy, source, stage } from '../../../theme/tokens';

// 四类来源对应设计系统 gy-source 的颜色
const SOURCE_COLORS: Record<FactSource, { color: string; bg: string }> = {
  original: source.customer,
  customer: source.confirm,
  system: source.system,
  expert: source.expert,
};

export function SourceTag({
  kind,
  note,
  selected = false,
  onClick,
}: {
  kind: FactSource;
  note?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const c = SOURCE_COLORS[kind];
  const text = note ? `${FACT_SOURCES[kind]} · ${note}` : FACT_SOURCES[kind];
  const style: CSSProperties = {
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderRadius: 4,
    fontSize: 12,
    color: c.color,
    background: selected ? gy.surface : c.bg,
    border: `1px solid ${selected ? c.color : 'transparent'}`,
    padding: '0 7px',
    lineHeight: '20px',
    fontFamily: 'inherit',
  };
  if (!onClick) return <span style={style}>{text}</span>;
  return (
    <button type="button" title="在右侧对照原件" onClick={onClick} style={{ ...style, cursor: 'pointer' }}>
      {text}
    </button>
  );
}

const labelText: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.secondary, width: 108, flexShrink: 0 };
const valueText: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 14,
  lineHeight: '22px',
  color: gy.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const sectionTitle: CSSProperties = { fontSize: 13, fontWeight: 500, lineHeight: '20px', color: gy.secondary };

export type EditMode = 'expert' | 'customer';

export interface FactsPanelProps {
  facts: Fact[];
  onlyMissing: boolean;
  onOnlyMissingChange: (v: boolean) => void;
  focusKey: string | null;
  editing: { key: string; mode: EditMode } | null;
  onEdit: (key: string, mode: EditMode) => void;
  onCancelEdit: () => void;
  onSave: (fact: Fact, value: FactValue | null, mode: EditMode) => Promise<void>;
  onSourceClick?: (fact: Fact) => (() => void) | undefined;
  // 当前右侧打开的原件名称：专家直接填写时记作对照的原件
  originalName?: string;
  saving: boolean;
  registerSection: (section: FactSection, el: HTMLElement | null) => void;
  registerRow: (key: string, el: HTMLElement | null) => void;
}

// 中栏「企业事实」（14 页 E18-00A、E18-00A2）：按小节列出每一项的值与来源，缺的项可直接填写或标为客户确认
export function FactsPanel(props: FactsPanelProps) {
  const { facts, onlyMissing, onOnlyMissingChange } = props;
  const sections = (Object.keys(FACT_SECTIONS) as FactSection[])
    .map((section) => ({ section, rows: facts.filter((f) => f.section === section && (!onlyMissing || f.status !== 'done')) }))
    .filter((s) => s.rows.length > 0);

  return (
    <section
      aria-label="企业事实"
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
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>企业事实</h2>
        <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>点击来源标签，在右侧对照原件</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: gy.primary, cursor: 'pointer' }}>
          只看缺失项
          <Switch size="small" checked={onlyMissing} onChange={onOnlyMissingChange} aria-label="只看缺失项" />
        </label>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 16px' }}>
        {sections.length === 0 && (
          <p style={{ margin: '48px 0', textAlign: 'center', color: gy.secondary }}>企业事实都已齐全</p>
        )}
        {sections.map(({ section, rows }, i) => (
          <div
            key={section}
            ref={(el) => props.registerSection(section, el)}
            style={i > 0 ? { borderTop: `1px solid ${gy.split}`, marginTop: 8 } : undefined}
          >
            <div style={{ padding: `${i > 0 ? 12 : 10}px 0 6px` }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>{SECTION_HEADINGS[section] ?? FACT_SECTIONS[section]}</h3>
            </div>
            <Rows {...props} rows={rows} />
          </div>
        ))}
      </div>
    </section>
  );
}

const SECTION_HEADINGS: Partial<Record<FactSection, string>> = {
  agencies: '属地机构 · 按地址从知识库调取',
  compilation: '应急预案编制小组 · 系统生成',
  judgement: '专家判断 · 只由专家补充，都可以不填',
};

function Rows(props: FactsPanelProps & { rows: Fact[] }) {
  const listRef = useListMotion<HTMLDivElement>();
  return (
    <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {props.rows.map((fact) => (
        <div key={fact.key} ref={(el) => props.registerRow(fact.key, el)} data-fact={fact.key}>
          {props.editing?.key === fact.key ? (
            <FactEditor
              fact={fact}
              mode={props.editing.mode}
              originalName={props.originalName}
              saving={props.saving}
              onCancel={props.onCancelEdit}
              onSave={(value) => props.onSave(fact, value, props.editing!.mode)}
            />
          ) : fact.required && fact.status !== 'done' ? (
            <MissingRow fact={fact} focused={props.focusKey === fact.key} onEdit={props.onEdit} />
          ) : (
            <FactRow
              fact={fact}
              focused={props.focusKey === fact.key}
              onEdit={props.onEdit}
              onRevert={() => props.onSave(fact, null, 'expert')}
              onSourceClick={props.onSourceClick?.(fact)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function FactRow({
  fact,
  focused,
  onEdit,
  onRevert,
  onSourceClick,
}: {
  fact: Fact;
  focused: boolean;
  onEdit: FactsPanelProps['onEdit'];
  onRevert: () => void;
  onSourceClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const shown = formatFact(fact.value, fact.kind);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)}>
      <FlashOnDone
        done={fact.status === 'done'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minHeight: 40,
          padding: '0 8px',
          margin: '0 -8px',
          borderRadius: 6,
          background: focused ? gy.selected : undefined,
        }}
      >
        <span style={labelText}>
          {fact.label}
          {fact.required && ' *'}
        </span>
        {shown ? (
          <span style={valueText} title={shown}>
            {shown}
          </span>
        ) : (
          <span style={{ ...valueText, color: gy.tertiary }} title={fact.hint}>
            {fact.status === 'later' ? '客户稍后补' : fact.hint ?? '未填写'}
          </span>
        )}
        <span style={{ width: 152, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
          {fact.source && <SourceTag kind={fact.source} note={fact.sourceNote} selected={focused} onClick={onSourceClick} />}
        </span>
        <span style={{ width: 56, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {fact.readonly ? null : fact.override && hover ? (
            <Tooltip title="撤回专家的修改，回到客户资料里的值">
              <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={onRevert}>
                撤回
              </button>
            </Tooltip>
          ) : shown ? (
            <button
              type="button"
              aria-label={`修改${fact.label}`}
              style={{ ...linkButton, opacity: hover || focused ? 1 : 0, transition: 'opacity 0.15s' }}
              onClick={() => onEdit(fact.key, 'expert')}
            >
              <EditOutlined />
            </button>
          ) : (
            <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={() => onEdit(fact.key, 'expert')}>
              填写
            </button>
          )}
        </span>
      </FlashOnDone>
    </div>
  );
}

// 必需项缺失：黄底整块，三个处理方式（14 页 E18-00A「技术人员数」）
function MissingRow({ fact, focused, onEdit }: { fact: Fact; focused: boolean; onEdit: FactsPanelProps['onEdit'] }) {
  const status = fact.status === 'later' ? '客户稍后补' : '还没有';
  const why = [fact.use, fact.hint].filter(Boolean).join('；');
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        margin: '4px 0',
        padding: '10px 12px',
        borderRadius: 6,
        background: stage.action.bg,
        outline: focused ? `2px solid ${stage.action.color}` : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 96, flexShrink: 0, fontSize: 14, lineHeight: '22px', color: gy.text }}>{fact.label} *</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: '22px', color: stage.action.color }}>{status}</span>
        <Space size={16}>
          <Tooltip title="联系客户在第 5 项开放">
            <button type="button" style={{ ...linkButton, color: gy.tertiary, cursor: 'not-allowed' }} disabled>
              发起补件
            </button>
          </Tooltip>
          <button type="button" style={linkButton} onClick={() => onEdit(fact.key, 'customer')}>
            标为客户确认
          </button>
          <button type="button" style={linkButton} onClick={() => onEdit(fact.key, 'expert')}>
            直接填写
          </button>
        </Space>
      </div>
      {why && <div style={{ paddingLeft: 108, fontSize: 13, lineHeight: '20px', color: gy.secondary }}>{why}</div>}
    </div>
  );
}

function FactEditor({
  fact,
  mode,
  originalName,
  saving,
  onCancel,
  onSave,
}: {
  fact: Fact;
  mode: EditMode;
  originalName?: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: FactValue) => Promise<void>;
}) {
  const [text, setText] = useState(typeof fact.value === 'string' ? fact.value : '');
  const [count, setCount] = useState<number | null>(typeof fact.value === 'number' ? fact.value : null);
  const [person, setPerson] = useState<FactPerson>(
    typeof fact.value === 'object' ? fact.value : { name: '', position: '', phone: '' },
  );

  const value: FactValue | null =
    fact.kind === 'count'
      ? count
      : fact.kind === 'person'
        ? person.name.trim()
          ? { name: person.name.trim(), position: person.position?.trim() || undefined, phone: person.phone?.trim() || undefined }
          : null
        : text.trim() || null;
  const submit = () => {
    if (value !== null && !saving) void onSave(value);
  };
  const keys = { onPressEnter: submit, onKeyDown: (e: React.KeyboardEvent) => e.key === 'Escape' && onCancel() };

  let input: ReactNode;
  if (fact.kind === 'count') {
    input = (
      <InputNumber
        autoFocus
        min={0}
        precision={0}
        value={count}
        onChange={(v) => setCount(v)}
        suffix="人"
        style={{ width: 160 }}
        aria-label={fact.label}
        {...keys}
      />
    );
  } else if (fact.kind === 'person') {
    const set = (k: keyof FactPerson) => (e: React.ChangeEvent<HTMLInputElement>) => setPerson({ ...person, [k]: e.target.value });
    input = (
      <Space.Compact style={{ flex: 1 }}>
        <Input autoFocus placeholder="姓名" value={person.name} onChange={set('name')} aria-label="姓名" {...keys} />
        <Input placeholder="职位" value={person.position ?? ''} onChange={set('position')} aria-label="职位" {...keys} />
        <Input placeholder="手机" value={person.phone ?? ''} onChange={set('phone')} aria-label="手机" {...keys} />
      </Space.Compact>
    );
  } else {
    input = <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label={fact.label} {...keys} style={{ flex: 1 }} />;
  }

  const recorded =
    mode === 'customer' ? '记为「客户确认 · 电话确认」' : `记为「专家整理」${originalName ? `，对照原件：${originalName}` : ''}`;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        margin: '4px -8px',
        padding: '10px 8px',
        borderRadius: 6,
        background: gy.selected,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ ...labelText, color: gy.text }}>
          {fact.label}
          {fact.required && ' *'}
        </span>
        <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>{input}</div>
        <Button type="primary" onClick={submit} loading={saving} disabled={value === null}>
          保存
        </Button>
        <Button onClick={onCancel}>取消</Button>
      </div>
      <div style={{ paddingLeft: 120, fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
        {recorded}
        {fact.use && ` · 用于${fact.use.replace(/^用于/, '')}`}
      </div>
    </div>
  );
}
