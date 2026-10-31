import {
  accidentTypeOf,
  SCOPE_GROUPS,
  SCOPE_SHORT,
  type PreviewPlan,
  type ScopeGroup,
  type ScopeKey,
  type ScopeSwitch,
  type ScopeView,
} from '@genyun/shared';
import { Button } from 'antd';
import { useState, type CSSProperties } from 'react';
import { linkButton } from '../../../components/ui';
import { gy, source, stage } from '../../../theme/tokens';

const head: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.secondary };
const small: CSSProperties = { fontSize: 13, lineHeight: '20px', color: gy.text };
const sub: CSSProperties = { fontSize: 12, lineHeight: '18px', color: gy.secondary };
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const onOff = (v: boolean) => (v ? '开' : '关');

function clock(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

// 客户明确回答且专家没改过的，单独一行「客户回答」
const byCustomer = (s: ScopeSwitch) => s.suggestion.basis === 'answer' && !s.judged;

export interface ScopePanelProps {
  view: ScopeView;
  // 左栏点了某一组时只看这一组
  group: ScopeGroup | null;
  onShowAll: () => void;
  selectedKey: ScopeKey | null;
  onSelect: (key: ScopeKey | null) => void;
  saving: boolean;
  onSave: (key: ScopeKey, value: boolean | null) => Promise<boolean>;
  registerRow: (key: string, el: HTMLElement | null) => void;
}

// 中栏「适用范围」（14 页 E18-00D）：待确认的开关逐个开启 / 关闭，已确定的按开启、客户回答、关闭汇总，点名称可以改
export function ScopePanel(props: ScopePanelProps) {
  const { view, group, onShowAll, selectedKey, onSelect } = props;
  const inGroup = (s: ScopeSwitch) => !group || s.group === group;
  const pending = view.pending.filter(inGroup);
  const settled = view.switches.filter((s) => s.status === 'confirmed' && inGroup(s));
  const lines = [
    { label: '已开启', items: settled.filter((s) => s.value && !byCustomer(s)) },
    { label: '客户回答', items: settled.filter(byCustomer) },
    { label: '已关闭', items: settled.filter((s) => !s.value && !byCustomer(s)) },
  ].filter((l) => l.items.length > 0);
  const selected = settled.find((s) => s.key === selectedKey);

  return (
    <section
      aria-label="适用范围"
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
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>适用范围</h2>
        <span style={{ ...head, flex: 1, minWidth: 0, ...ellipsis }}>
          决定专项预案与现场处置方案{group ? ` · ${SCOPE_GROUPS[group]}` : ''}
        </span>
        <button type="button" style={{ ...linkButton, fontSize: 14, lineHeight: '22px' }} onClick={onShowAll}>
          全部 {view.switches.length} 项
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '8px 20px 16px' }}>
        {pending.length > 0 && (
          <>
            <div style={{ padding: '8px 0 6px', fontSize: 13, fontWeight: 500, lineHeight: '20px', color: stage.action.color }}>
              待确认 {pending.length} 项 · 系统已给出建议
            </div>
            {pending.map((s) => (
              <SwitchRow key={s.key} sw={s} {...props} />
            ))}
          </>
        )}
        <div style={{ padding: `${pending.length ? 16 : 8}px 0 6px`, fontSize: 13, fontWeight: 500, lineHeight: '20px', color: gy.secondary }}>
          已确定 {settled.length} 项
        </div>
        {lines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 6, background: gy.canvas }}>
            {lines.map((l) => (
              <div key={l.label} style={{ display: 'flex', gap: 10 }}>
                <span style={{ ...head, width: 72, flexShrink: 0 }}>
                  {l.label} {l.items.length}
                </span>
                <span role="list" aria-label={l.label} style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', ...small }}>
                  {l.items.map((s, i) => (
                    <span key={s.key} role="listitem">
                      {i > 0 && <span style={{ color: gy.tertiary }}>{' · '}</span>}
                      <button
                        type="button"
                        aria-pressed={s.key === selectedKey}
                        onClick={() => onSelect(s.key === selectedKey ? null : s.key)}
                        style={{
                          ...linkButton,
                          ...small,
                          color: s.key === selectedKey ? gy.primary : s.judged ? source.expert.color : gy.text,
                          textDecoration: s.key === selectedKey ? 'underline' : 'none',
                        }}
                      >
                        {s.label}
                        {byCustomer(s) ? `：${s.value ? '是' : '否'}` : ''}
                      </button>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        {selected && (
          <div style={{ marginTop: 8, padding: '0 14px', border: `1px solid ${gy.split}`, borderRadius: 6 }}>
            <SwitchRow sw={selected} {...props} last />
          </div>
        )}
        {!selected && settled.length > 0 && <span style={{ ...sub, marginTop: 8 }}>点开关名称可以查看依据、改开或关；专家改过的显示为紫色。</span>}
      </div>
    </section>
  );
}

// 一个开关：名称与依据、系统建议、开启 / 关闭；专家确认过的显示谁、何时，可撤回
function SwitchRow({ sw, saving, onSave, onSelect, registerRow, last }: ScopePanelProps & { sw: ScopeSwitch; last?: boolean }) {
  const chosen = sw.judged?.value ?? (sw.status === 'confirmed' ? sw.value : undefined);
  const pick = async (value: boolean) => {
    if (chosen === value) return;
    // 已确定的开关选回系统建议就是撤回，不留专家记录
    const ok = await onSave(sw.key, !sw.needsConfirm && value === sw.suggestion.value ? null : value);
    if (ok && sw.status === 'pending') onSelect(null);
  };
  const plans = sw.plans.map((p) => p.title).join('、');

  return (
    <div
      ref={(el) => registerRow(`scope:${sw.key}`, el)}
      data-row={`scope:${sw.key}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderBottom: last ? 'none' : `1px solid ${gy.split}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>{sw.label}</span>
          <span style={{ ...sub, ...ellipsis }} title={sw.suggestion.reason}>
            {sw.suggestion.reason}
          </span>
        </div>
        <span style={{ width: 64, flexShrink: 0, fontSize: 13, lineHeight: '20px', color: source.system.color }}>建议 {onOff(sw.suggestion.value)}</span>
        <span role="group" aria-label={`${sw.label}开关`} style={{ width: 128, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
          <Button size="small" type={chosen === true ? 'primary' : 'default'} aria-pressed={chosen === true} disabled={saving} onClick={() => void pick(true)}>
            开启
          </Button>
          <Button size="small" type={chosen === false ? 'primary' : 'default'} aria-pressed={chosen === false} disabled={saving} onClick={() => void pick(false)}>
            关闭
          </Button>
        </span>
      </div>
      {(sw.status === 'confirmed' || plans) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...sub }}>
          <span style={{ flex: 1, minWidth: 0 }}>{plans ? `影响：${plans}` : sw.description}</span>
          {sw.judged && (
            <>
              <span style={{ color: source.expert.color }}>
                {sw.needsConfirm ? '专家确认' : '专家改为'}
                {onOff(sw.judged.value)} · {sw.judged.byName} · {clock(sw.judged.at)}
              </span>
              <button type="button" style={{ ...linkButton, fontSize: 12, lineHeight: '18px' }} disabled={saving} onClick={() => void onSave(sw.key, null)}>
                撤回
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type PreviewTab = 'plan' | 'switches';

// 右栏「生成结构预览」：按现在的开关会生成哪些专项预案与现场处置方案；待确认开关影响的用虚线标出
export function ScopePreviewPanel({ view, onSelect }: { view: ScopeView; onSelect: (key: ScopeKey) => void }) {
  const [tab, setTab] = useState<PreviewTab>('plan');
  const [full, setFull] = useState(false);
  const { specialty, site } = view.preview;
  const sure = (list: PreviewPlan[]) => list.filter((p) => p.state === 'always' || p.state === 'included');
  const undecided = (list: PreviewPlan[]) => list.filter((p) => p.state === 'pendingIn' || p.state === 'pendingOut');
  const count = (list: PreviewPlan[]) => {
    const n = sure(list).length;
    const m = list.filter((p) => p.state === 'pendingIn').length;
    return m ? `${n} + ${m} 待定` : `${n} 项`;
  };
  // 已定要生成的那份是因为哪个开关
  const because = (p: PreviewPlan) => {
    if (p.state === 'always') return '始终';
    const key = [p.template.trigger ?? []].flat().find((k) => view.scope[k]);
    return key ? SCOPE_SHORT[key] : '';
  };

  const pendingBox = (p: PreviewPlan) => {
    const out = p.state === 'pendingOut';
    const color = out ? gy.tertiary : stage.action.color;
    return (
      <button
        key={p.template.id}
        type="button"
        data-plan={p.template.title}
        data-state={p.state}
        onClick={() => p.pendingKey && onSelect(p.pendingKey)}
        style={{
          ...linkButton,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          margin: '0 -8px',
          padding: '4px 8px',
          border: `1px dashed ${out ? gy.border : stage.action.color}`,
          borderRadius: 4,
          textAlign: 'left',
        }}
      >
        <span style={{ ...small, color }}>{p.template.title}</span>
        <span style={{ ...small, color, flexShrink: 0 }}>{out ? '建议不含' : SCOPE_SHORT[p.pendingKey!]}</span>
      </button>
    );
  };
  const row = (p: PreviewPlan) => (
    <div key={p.template.id} data-plan={p.template.title} data-state={p.state} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={small}>{p.template.title}</span>
      <span style={{ ...head, flexShrink: 0 }}>{because(p)}</span>
    </div>
  );

  return (
    <aside
      aria-label="生成结构预览"
      className="gy-side-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: gy.surface,
        border: `1px solid ${gy.split}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 0', borderBottom: `1px solid ${gy.split}` }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>生成结构预览</h2>
        <div role="tablist" style={{ display: 'flex', gap: 20 }}>
          {(
            [
              { key: 'plan', label: '应急预案' },
              { key: 'switches', label: '开关说明' },
            ] as const
          ).map((t) => (
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

      {tab === 'plan' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
          <section aria-label="专项应急预案" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, lineHeight: '22px', color: gy.text }}>专项应急预案 · {count(specialty)}</span>
            {sure(specialty).map(row)}
            {undecided(specialty).map(pendingBox)}
          </section>
          <section aria-label="现场处置方案" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, lineHeight: '22px', color: gy.text }}>现场处置方案 · {count(site)}</span>
            {full ? (
              sure(site).map(row)
            ) : (
              <span style={{ ...small, lineHeight: '22px' }}>
                {sure(site).map((p, i) => (
                  <span key={p.template.id} data-plan={p.template.title} data-state={p.state}>
                    {i > 0 && ' · '}
                    {accidentTypeOf(p.template.title)}
                  </span>
                ))}
              </span>
            )}
            {undecided(site).map(pendingBox)}
          </section>
          <span style={head}>虚线为待确认开关对应的章节，点一下可以去确认；附件中的应急预案体系图会同步更新。</span>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '4px 16px 16px' }}>
          {view.switches.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect(s.key)}
              style={{ ...linkButton, display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 0', borderBottom: `1px solid ${gy.split}`, textAlign: 'left' }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8 }}>
                <span style={{ ...small, fontWeight: 500 }}>{s.label}</span>
                <span style={{ ...small, color: s.status === 'pending' ? stage.action.color : s.value ? stage.done.color : gy.secondary }}>
                  {s.status === 'pending' ? `待确认 · 建议${onOff(s.suggestion.value)}` : onOff(s.value)}
                </span>
              </span>
              <span style={sub}>{s.description}</span>
              {s.plans.length > 0 && <span style={sub}>决定：{s.plans.map((p) => p.title).join('、')}</span>}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: `1px solid ${gy.split}`, ...head }}>
        <span style={{ flex: 1 }}>开关确认后即时更新</span>
        {tab === 'plan' && (
          <button type="button" style={{ ...linkButton, fontSize: 13 }} onClick={() => setFull(!full)}>
            {full ? '收起目录' : '完整目录'}
          </button>
        )}
      </div>
    </aside>
  );
}
