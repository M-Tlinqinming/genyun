import { CloseOutlined, DownOutlined, InfoCircleFilled, UpOutlined } from '@ant-design/icons';
import {
  checkStale,
  checkValid,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  type DraftCheckView,
  type DraftKind,
  type HistoryEntry,
  type LockedMaterial,
  type PendingChapter,
  type PendingItem,
  type ReopenedView,
} from '@genyun/shared';
import { App } from 'antd';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { openFile } from '../../../api/documents';
import { useHistory } from '../../../api/review';
import { linkButton } from '../../../components/ui';
import { MOTION } from '../../../theme/motion';
import { gy, stage } from '../../../theme/tokens';
import { clock, dayLabel } from './EditDialogs';

/** 文稿页签栏的高度：处理记录抽屉从它下面开始，盖住右栏、不盖页签 */
export const DOC_BAR_HEIGHT = 52;

// 核对定稿页的几块：文稿栏（E18-09）、左栏章节、右栏待补充和资料依据、处理记录抽屉（E18-13）

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const caption: CSSProperties = { fontSize: 12, lineHeight: '20px' };

export function Tag({ tone, children }: { tone: 'action' | 'done'; children: ReactNode }) {
  const c = tone === 'done' ? stage.done : stage.action;
  return <span style={{ ...caption, padding: '0 6px', borderRadius: 4, color: c.color, background: c.bg, whiteSpace: 'nowrap', fontWeight: 400 }}>{children}</span>;
}

export function docTag(d: DraftCheckView | undefined): ReactNode {
  if (d && checkValid(d)) return <Tag tone="done">已核对</Tag>;
  if (d && checkStale(d)) return <Tag tone="action">改过，待重新核对</Tag>;
  return <Tag tone="action">待核对</Tag>;
}

const tabStyle = (on: boolean): CSSProperties => ({
  ...linkButton,
  ...text14,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 52,
  color: on ? gy.primary : gy.text,
  fontWeight: on ? 600 : 400,
  boxShadow: on ? `inset 0 -2px 0 ${gy.primary}` : 'none',
});

/** 用方向键切过去的页签：切文稿时页面可能先显示加载、页签重画，画好后把焦点放回去 */
let focusTab: string | null = null;

/** 文稿栏：三份文稿页签（三份都核对后多一个「审核结论」）＋ 已核对 N / 3 和三段小条 */
export function DocBar({
  docs,
  kind,
  conclusion,
  onDoc,
  onConclusion,
}: {
  docs: DraftCheckView[];
  /** 当前文稿；在审核结论页签时为 null */
  kind: DraftKind | null;
  /** 审核结论页签：不显示为 null；filled = 结论写好且还有效 */
  conclusion: { filled: boolean } | null;
  onDoc: (k: DraftKind) => void;
  onConclusion: () => void;
}) {
  const checked = docs.filter(checkValid).length;
  const selectedId = `doc-tab-${kind ?? 'conclusion'}`;
  useEffect(() => {
    if (focusTab === selectedId) document.getElementById(selectedId)?.focus();
  }, [selectedId]);
  const keys = (e: React.KeyboardEvent) => {
    const tabs = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const id = tabs[to]!.id;
    focusTab = id;
    // 新文稿读完、页签不再重画后就不再抢焦点
    window.setTimeout(() => {
      if (focusTab === id) focusTab = null;
    }, 3000);
    tabs[to]!.focus();
    tabs[to]!.click();
  };
  return (
    <div style={{ height: DOC_BAR_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 32, padding: '0 32px', background: gy.surface, borderBottom: `1px solid ${gy.split}` }}>
      <div role="tablist" aria-label="三份文稿" onKeyDown={keys} style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        {DRAFT_KIND_KEYS.map((k, i) => (
          <button
            key={k}
            id={`doc-tab-${k}`}
            type="button"
            role="tab"
            aria-selected={k === kind}
            tabIndex={k === kind ? 0 : -1}
            onClick={() => onDoc(k)}
            style={tabStyle(k === kind)}
          >
            {i + 1} {DRAFT_KINDS[k]}
            {docTag(docs.find((d) => d.kind === k))}
          </button>
        ))}
        {conclusion && (
          <>
            <span aria-hidden style={{ width: 1, height: 16, background: gy.split }} />
            <button
              id="doc-tab-conclusion"
              type="button"
              role="tab"
              aria-selected={kind === null}
              tabIndex={kind === null ? 0 : -1}
              onClick={onConclusion}
              style={tabStyle(kind === null)}
            >
              审核结论
              {conclusion.filled ? <Tag tone="done">已填写</Tag> : <Tag tone="action">待填写</Tag>}
            </button>
          </>
        )}
      </div>
      <span style={{ flex: 1 }} />
      <span style={{ ...text14, color: gy.secondary }}>
        已核对 {checked} / {docs.length}
      </span>
      <span aria-hidden style={{ display: 'flex', gap: 4 }}>
        {DRAFT_KIND_KEYS.map((k) => {
          const d = docs.find((x) => x.kind === k);
          return <span key={k} style={{ width: 24, height: 4, borderRadius: 2, background: d && checkValid(d) ? gy.success : gy.split }} />;
        })}
      </span>
    </div>
  );
}

/** 左栏：章节和每章还有几处待补充；应急预案按部分分组 */
export function ChapterNav({ chapters, current, onSelect }: { chapters: PendingChapter[]; current: string | null; onSelect: (id: string) => void }) {
  let group: string | null = null;
  const rows: ReactNode[] = [];
  for (const c of chapters) {
    const g = c.group?.id ?? null;
    if (g !== group) {
      group = g;
      if (c.group) {
        rows.push(
          <li key={`g-${c.group.id}`} role="presentation" style={{ ...caption, fontWeight: 600, color: gy.secondary, padding: '12px 8px 4px' }}>
            {c.group.title}
          </li>,
        );
      }
    }
    const on = c.id === current;
    // 部分自带正文单算的一章，标题和分组标题一样，左栏写「开头说明」
    const title = c.group && c.group.id === c.id ? '开头说明' : c.title;
    rows.push(
      <li key={c.id}>
        <button
          type="button"
          aria-current={on ? 'true' : undefined}
          onClick={() => !on && onSelect(c.id)}
          style={{
            ...linkButton,
            ...text14,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: `6px 8px 6px ${c.group ? 16 : 8}px`,
            borderRadius: 6,
            textAlign: 'left',
            color: on ? gy.primary : gy.text,
            fontWeight: on ? 600 : 400,
            background: on ? gy.selected : 'none',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{title}</span>
          {c.pending > 0 && (
            <span aria-label={`${c.pending} 处待补充`} style={{ ...caption, color: gy.warning, flexShrink: 0 }}>
              {c.pending}
            </span>
          )}
        </button>
      </li>,
    );
  }
  return (
    <nav aria-label="章节" style={{ width: 240, flexShrink: 0, overflowY: 'auto', background: gy.surface, borderRight: `1px solid ${gy.split}`, padding: '20px 12px' }}>
      <div style={{ ...caption, color: gy.tertiary, padding: '0 8px 8px' }}>章节 · 共 {chapters.length} 章</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>{rows}</ul>
      <div style={{ ...caption, color: gy.tertiary, padding: '16px 8px 0' }}>右侧数字 = 这一章还有几处待补充</div>
    </nav>
  );
}

const FOLD = 4;

/** 右栏：待补充 / 资料依据 */
export function SidePanel({
  items,
  selected,
  materials,
  onPick,
  previous,
}: {
  items: PendingItem[];
  /** 刚点过的那一条（序号） */
  selected: number | null;
  materials: LockedMaterial[];
  onPick: (index: number) => void;
  /** 交付后重新打开期间：上一次交付时专家亲手改过的节（只读对照） */
  previous?: ReopenedView['edits'];
}) {
  const { message } = App.useApp();
  const [tab, setTab] = useState<'pending' | 'basis'>('pending');
  const [open, setOpen] = useState(false);
  const left = items.filter((i) => !i.handled).length;
  const handled = items.length - left;
  const shown = open ? items : items.slice(0, FOLD);
  return (
    <aside aria-label="待补充和资料依据" style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', background: gy.surface, borderLeft: `1px solid ${gy.split}` }}>
      <div role="tablist" aria-label="右栏" style={{ display: 'flex', gap: 24, padding: '0 20px', borderBottom: `1px solid ${gy.split}`, flexShrink: 0 }}>
        <button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')} style={tabStyle(tab === 'pending')}>
          待补充
        </button>
        <button type="button" role="tab" aria-selected={tab === 'basis'} onClick={() => setTab('basis')} style={tabStyle(tab === 'basis')}>
          资料依据
        </button>
      </div>
      <div role="tabpanel" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tab === 'pending' ? (
          <>
            {previous && previous.length > 0 && <PreviousEdits edits={previous} />}
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <span style={{ ...text14, fontWeight: 600, color: gy.text }}>待补充 {left} 处</span>
              <span style={{ flex: 1 }} />
              <span style={{ ...caption, color: gy.tertiary }}>已处理 {handled}</span>
            </div>
            {items.length === 0 ? (
              <span style={{ ...text14, color: gy.tertiary }}>这一份没有待补充的内容。</span>
            ) : (
              <ul aria-label="待补充清单" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {shown.map((it, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => onPick(i)}
                      style={{
                        ...linkButton,
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: '8px 12px',
                        borderRadius: 6,
                        textAlign: 'left',
                        background: selected === i ? gy.selected : 'none',
                      }}
                    >
                      <span style={{ ...text14, color: it.handled ? gy.tertiary : gy.text, textDecoration: it.handled ? 'line-through' : 'none' }}>{it.label}</span>
                      <span style={{ ...caption, color: gy.tertiary }}>
                        {it.sectionTitle}
                        {it.where === 'table' ? ' · 表格里，回资料核对补' : ''}
                        {it.handled ? ' · 已处理' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {items.length > FOLD && (
              <button type="button" style={{ ...linkButton, ...text14, alignSelf: 'flex-start', paddingLeft: 12 }} onClick={() => setOpen((v) => !v)}>
                {open ? '收起' : `还有 ${items.length - FOLD} 处`}
              </button>
            )}
          </>
        ) : (
          <>
            <span style={{ ...text14, fontWeight: 600, color: gy.text }}>本次采用的资料</span>
            {materials.length === 0 ? (
              <span style={{ ...text14, color: gy.secondary }}>这批文稿只用了资料核对里确认的内容，没有采用客户上传的文件。</span>
            ) : (
              <ul aria-label="本次采用的资料" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {materials.map((m) => (
                  <li key={m.fileId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', border: `1px solid ${gy.split}`, borderRadius: 8 }}>
                    <span style={{ ...text14, flex: 1, minWidth: 0, color: gy.text, overflowWrap: 'anywhere' }}>{m.name}</span>
                    <button
                      type="button"
                      aria-label={`查看原文件 ${m.name}`}
                      style={{ ...linkButton, ...text14, flexShrink: 0 }}
                      onClick={() => void openFile(m.fileId).catch(() => message.error('打不开这份文件，请稍后重试'))}
                    >
                      查看原文件
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span style={{ ...caption, color: gy.tertiary }}>要改企业事实，回资料核对改，再重新生成。表格和图来自资料核对，正文里不能改。</span>
          </>
        )}
      </div>
    </aside>
  );
}

/** 处理记录抽屉（E18-13）：从右边滑入、关时滑出，盖在右栏上面（不盖文稿页签栏），按天分组 */
export function HistoryDrawer({
  taskId,
  open,
  onClose,
  top = DOC_BAR_HEIGHT,
}: {
  taskId: string;
  open: boolean;
  onClose: () => void;
  /** 离主体顶边多远；核对定稿要让开文稿页签栏，生成页贴顶 */
  top?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="history"
          role="dialog"
          aria-label="处理记录"
          initial={reduce ? false : { x: '100%' }}
          animate={{ x: 0 }}
          exit={reduce ? undefined : { x: '100%' }}
          transition={{ duration: MOTION.fast, ease: MOTION.ease }}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          style={{
            position: 'absolute',
            top,
            right: 0,
            bottom: 0,
            width: 480,
            zIndex: 5,
            display: 'flex',
            flexDirection: 'column',
            background: gy.surface,
            borderLeft: `1px solid ${gy.split}`,
            boxShadow: '0 6px 16px rgb(0 0 0 / 8%)',
          }}
        >
          <HistoryBody taskId={taskId} onClose={onClose} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function HistoryBody({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const history = useHistory(taskId, true);
  const days: { day: string; rows: HistoryEntry[] }[] = [];
  for (const e of history.data ?? []) {
    const day = dayLabel(e.at);
    const last = days[days.length - 1];
    if (last?.day === day) last.rows.push(e);
    else days.push({ day, rows: [e] });
  }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', height: 56, flexShrink: 0, padding: '0 24px', borderBottom: `1px solid ${gy.split}` }}>
        <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>处理记录</span>
        <span style={{ flex: 1 }} />
        <button type="button" aria-label="关闭处理记录" autoFocus onClick={onClose} style={{ ...linkButton, color: gy.secondary, fontSize: 14 }}>
          <CloseOutlined />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {history.isLoading && <span style={{ ...text14, color: gy.tertiary }}>正在读取…</span>}
        {history.isError && <span style={{ ...text14, color: gy.error }}>{history.error.message}</span>}
        {history.data?.length === 0 && <span style={{ ...text14, color: gy.tertiary }}>还没有记录。</span>}
        {days.map((d) => (
          <section key={d.day} aria-label={d.day} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ ...caption, color: gy.tertiary }}>{d.day}</span>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {d.rows.map((e, i) => (
                <li key={i} style={{ display: 'flex', gap: 12 }}>
                  {/* 圆点下移 7、行距 16：照 E18-13 画板 */}
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, flexShrink: 0, background: e.check ? gy.primary : gy.controlLine }} />
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ ...text14, color: gy.text, overflowWrap: 'anywhere' }}>{e.who ? `${e.who} ${e.what}` : e.what}</span>
                    <span style={{ ...caption, color: gy.tertiary, overflowWrap: 'anywhere' }}>
                      {clock(e.at)}
                      {e.extra ? ` · ${e.extra}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/** 交付后重新打开期间，文稿进度条下面的灰条（15 页 R13、R14） */
export function ReopenedBar({ deliveredOn }: { /** 例：11 月 20 日 */ deliveredOn: string }) {
  return (
    <div
      role="note"
      style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 32px', background: gy.neutralBg, borderBottom: `1px solid ${gy.split}` }}
    >
      <InfoCircleFilled aria-hidden style={{ fontSize: 16, color: gy.tertiary }} />
      <span style={{ ...text14, color: gy.secondary }}>交付后重新打开 · 客户现在仍能下载 {deliveredOn}交付的那一版</span>
    </div>
  );
}

/** 「上一版您改过的 N 节」那一句 */
export function previousEditsHint(n: number): string {
  const which = n === 1 ? '这一节' : n === 2 ? '这两节' : `这 ${n} 节`;
  return `重新生成会换掉${which}，原文留在这里供您对照`;
}

/** 右栏顶上「上一版您改过的 N 节」（15 页 R13）：每节默认收起，点「看原文」展开；只读 */
function PreviousEdits({ edits }: { edits: ReopenedView['edits'] }) {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <section
      aria-label="上一版您改过的节"
      style={{ margin: '-20px -20px 0', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${gy.split}` }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...text14, fontWeight: 600, color: gy.text }}>上一版您改过的 {edits.length} 节</span>
        <span style={{ ...caption, color: gy.tertiary }}>{previousEditsHint(edits.length)}</span>
      </div>
      {edits.map((e) => {
        const key = `${e.kind}/${e.sectionId}`;
        const open = opened.has(key);
        const id = `previous-${e.kind}-${e.sectionId}`;
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px', border: `1px solid ${gy.split}`, borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ ...text14, color: gy.text, minWidth: 0, overflowWrap: 'anywhere' }}>{e.title}</span>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => toggle(key)}
                style={{ ...linkButton, ...caption, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {open ? '收起' : '看原文'}
                {open ? <UpOutlined aria-hidden style={{ fontSize: 12 }} /> : <DownOutlined aria-hidden style={{ fontSize: 12 }} />}
              </button>
            </div>
            {open && (
              <div id={id} style={{ ...caption, color: gy.secondary, background: gy.neutralBg, borderRadius: 4, padding: '8px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {e.text || '（这一节当时是空的）'}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
