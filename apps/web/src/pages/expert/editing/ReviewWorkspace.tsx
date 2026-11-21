import { CheckCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons';
import {
  blocksText,
  checkValid,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  EDIT_LIMITS,
  nextToCheck,
  pendingCount,
  reviewValid,
  sameBlocks,
  type DraftKind,
  type EditBlock,
  type GenerationProgress,
  type OutlineNode,
  type PendingChapter,
  type ReviewView,
  type SectionView,
} from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { App, Button, Input, Result } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useSearchParams, type Location } from 'react-router';
import { useSession } from '../../../auth/session';
import {
  downloadCurrentWord,
  editDocumentKey,
  pendingKey,
  rewriteParagraph,
  saveSection,
  saveStatus,
  sectionKey,
  useEditDocument,
  usePending,
  useSections,
} from '../../../api/editing';
import { ApiError } from '../../../api/request';
import { checkDraft, historyKey, previewKey, reviewKey, useReview } from '../../../api/review';
import { linkButton, Loading } from '../../../components/ui';
import { WizardHeader } from '../../../components/WizardHeader';
import { EXPERT_STAGES } from '../../../layouts/WizardLayout';
import { gy } from '../../../theme/tokens';
import { EditedChip, SectionBlocks } from './ChapterReader';
import { ConclusionTab } from './ConclusionTab';
import { ConflictDialog, copyText, LeaveDialog, RewriteDialog, sectionShort, when } from './EditDialogs';
import { blocksToDoc, docToBlocks } from './editorDoc';
import { PreviewPane } from './PreviewPane';
import { ChapterNav, DocBar, HistoryDrawer, SidePanel } from './ReviewParts';
import { retryStep } from './saveRetry';
import { currentParagraph, EditorPane, LockedContext, replaceParagraph } from './SectionEditor';

// 核对定稿（14 页 E18-03 到 E18-15）：三份文稿逐章看、逐节改，逐份点「这一份核对完成」，三份都核对后写审核结论。
// 整页盖住工作台（顶栏、文稿栏、三栏、底栏）。左栏章节，中栏一章的正文（或 Word 预览），右栏待补充和资料依据。
// 一次只改一节；有没保存的修改时，换章、换文稿、看预览、改别的节、离开页面都先问。
// 保存结果不明时先查上一次保存有没有记上，再决定重发还是重新保存（saveRetry）。

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const caption: CSSProperties = { fontSize: 12, lineHeight: '20px' };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  // cause：server = 服务返回出错；network = 没连上。blocks / note 是那一次发出去的内容，重试时用来判断之后有没有再改
  | { kind: 'failed'; saveId: string; checking: boolean; cause: 'server' | 'network'; blocks: EditBlock[]; note: string }
  | { kind: 'conflict'; latest: SectionView };

type RewritePreview = { at: { from: number; to: number }; before: string; after: string; note: string; promptVersion: string | null };
type Tab = 'text' | 'preview' | 'conclusion';

// 编辑器转过一遍的样子作为比较基准（空段落之类不算修改）
const baselineOf = (blocks: EditBlock[]) => docToBlocks(blocksToDoc(blocks));
// 后台明确拒绝（4xx）：没有保存，按后台的说明处理。断网时 request 记为状态 0，不算拒绝
const refused = (err: unknown): err is ApiError => err instanceof ApiError && err.status >= 400 && err.status < 500;

// 待补充清单读不出来时（正文编辑上线前生成的稿），按目录的一级当章
function chaptersFromOutline(outline: OutlineNode[]): PendingChapter[] {
  const flat = (n: OutlineNode, level: number): PendingChapter['sections'] => [
    { id: n.id, title: n.title, level },
    ...n.children.flatMap((c) => flat(c, level + 1)),
  ];
  return outline.map((n) => ({ id: n.id, title: n.title, group: null, sections: flat(n, 0), pending: 0 }));
}

function Segmented({ value, onChange }: { value: 'text' | 'preview'; onChange: (v: 'text' | 'preview') => void }) {
  const item = (v: 'text' | 'preview', label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      onClick={() => value !== v && onChange(v)}
      style={{
        ...linkButton,
        ...text14,
        padding: '3px 12px',
        borderRadius: 4,
        color: value === v ? gy.text : gy.secondary,
        fontWeight: value === v ? 600 : 400,
        background: value === v ? gy.surface : 'none',
        boxShadow: value === v ? '0 1px 2px rgb(24 36 59 / 10%)' : 'none',
      }}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="正文或 Word 预览" style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 6, background: gy.neutralBg }}>
      {item('text', '正文')}
      {item('preview', 'Word 预览')}
    </div>
  );
}

export function ReviewWorkspace({
  taskId,
  enterpriseName,
  taskNumber,
  generation,
  links = { center: '/expert', task: `/expert/tasks/${taskId}` },
}: {
  taskId: string;
  enterpriseName: string;
  taskNumber: string;
  generation: GenerationProgress;
  // 返回的去处：专家回任务中心和生成进度，运营回运营的任务中心
  links?: { center: string; task: string };
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { message, modal } = App.useApp();
  const me = useSession().data;
  const review = useReview(taskId);
  const r = review.data;

  // ---- 打开哪一份、哪一章 ----
  const kind: DraftKind = DRAFT_KIND_KEYS.find((k) => k === params.get('doc')) ?? 'plan';
  const allChecked = r ? r.docs.length > 0 && r.docs.every(checkValid) : false;
  // 三份都核对过才有审核结论页签；结论写过但之后又改了文稿（结论失效）也收起，重新核对后框里放回上次写的
  const conclusionOpen = allChecked;
  const wanted: Tab = params.get('view') === 'review' || params.get('tab') === 'conclusion' ? 'conclusion' : params.get('tab') === 'preview' ? 'preview' : 'text';
  const tab: Tab = wanted === 'conclusion' && !conclusionOpen ? 'text' : wanted;

  // 回来接着做（E18-11）：网址里没有指定位置时，按结论 → 上次保存的地方 → 第一份没核对的打开
  const [resumed, setResumed] = useState(false);
  const [resumeNote, setResumeNote] = useState<{ at: string; where: string } | null>(null);
  useEffect(() => {
    if (resumed || !r) return;
    setResumed(true);
    if (['doc', 'tab', 'section', 'chapter'].some((k) => params.has(k)) || params.get('view') === 'review') return;
    if (allChecked && !reviewValid(r)) return setParams({ view: 'edit', tab: 'conclusion' }, { replace: true });
    if (r.lastSave) {
      const s = r.lastSave;
      setResumeNote({ at: s.at, where: `${DRAFT_KINDS[s.kind]} · ${s.sectionTitle}` });
      return setParams({ view: 'edit', doc: s.kind, section: s.sectionId }, { replace: true });
    }
    const first = r.docs.find((d) => !checkValid(d))?.kind;
    if (first && first !== 'plan') setParams({ view: 'edit', doc: first }, { replace: true });
  }, [r, resumed, params, allChecked, setParams]);

  const doc = useEditDocument(taskId, kind);
  const d = doc.data;
  const pending = usePending(taskId, kind);
  const chapters = useMemo(() => pending.data?.chapters ?? (pending.isError && d ? chaptersFromOutline(d.outline) : []), [pending.data, pending.isError, d]);
  const sectionParam = params.get('section');
  const chapter =
    chapters.find((c) => c.id === params.get('chapter')) ??
    (sectionParam ? chapters.find((c) => c.sections.some((s) => s.id === sectionParam)) : undefined) ??
    chapters[0] ??
    null;
  const sections = useSections(taskId, kind, chapter?.sections.map((s) => s.id) ?? []);
  const viewOf = (id: string) => sections[chapter?.sections.findIndex((s) => s.id === id) ?? -1]?.data;
  const thisDoc = r?.docs.find((x) => x.kind === kind);
  const published = d?.published ?? r?.published ?? null;
  const editable = (d?.editable ?? false) && !published;
  const canCheck = (r?.editable ?? false) && !published;
  const passed = r ? reviewValid(r) : false;

  // ---- 正在改的那一节 ----
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [baseline, setBaseline] = useState<EditBlock[] | null>(null);
  const [current, setCurrent] = useState<EditBlock[] | null>(null);
  const [rev, setRev] = useState(0);
  const [note, setNote] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [conflictOpen, setConflictOpen] = useState(false);
  // 冲突时选「留着我的输入，打开最新的」后，编辑框下面留着自己的输入供逐项合并
  const [kept, setKept] = useState<EditBlock[] | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [rewritePreview, setRewritePreview] = useState<RewritePreview | null>(null);
  const aiVersion = useRef<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [initial, setInitial] = useState<{ key: number; blocks: EditBlock[] } | null>(null);
  const remount = (blocks: EditBlock[]) => setInitial((prev) => ({ key: (prev?.key ?? 0) + 1, blocks }));

  const dirty = editing !== null && baseline !== null && current !== null && !sameBlocks(current, baseline);
  const unsaved = dirty || kept !== null || state.kind === 'failed';
  const short = editing ? sectionShort(editing.title) : '';

  const load = useCallback((view: SectionView, keepNote = false) => {
    const b = baselineOf(view.blocks);
    setBaseline(b);
    setCurrent(b);
    setRev(view.rev);
    if (!keepNote) setNote('');
    setState({ kind: 'idle' });
    aiVersion.current = null;
    remount(view.blocks);
  }, []);

  const closeEditor = useCallback(() => {
    setEditing(null);
    setBaseline(null);
    setCurrent(null);
    setKept(null);
    setNote('');
    setState({ kind: 'idle' });
    setConflictOpen(false);
    aiVersion.current = null;
  }, []);

  // 换文稿、换章：编辑框收起（有没保存的修改时，离开前已经问过）
  const chapterId = chapter?.id ?? null;
  useEffect(() => {
    closeEditor();
  }, [kind, chapterId, closeEditor]);

  // 关闭或刷新页面时提醒
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // ---- 离开前先问（E18-07） ----
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => unsaved && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`,
  );
  // 点别的节的「修改这一节」：不换网址，自己问
  const [guard, setGuard] = useState<{ target: string; proceed: () => void } | null>(null);
  const targetOf = (loc: Location): string => {
    if (loc.pathname !== window.location.pathname) return '其他页面';
    const p = new URLSearchParams(loc.search);
    if (p.get('view') === 'publish') return '交付';
    if (p.get('tab') === 'conclusion') return '审核结论';
    if (p.get('tab') === 'preview') return 'Word 预览';
    const k = DRAFT_KIND_KEYS.find((x) => x === p.get('doc')) ?? 'plan';
    if (k !== kind) return DRAFT_KINDS[k];
    const c = chapters.find((x) => x.id === p.get('chapter'));
    return c ? c.title : '别的章';
  };
  const leaving = blocker.state === 'blocked' ? { target: targetOf(blocker.location) } : guard;
  const [flashReq, setFlashReq] = useState<{ sectionId: string; key: string | null } | null>(null);
  const stay = () => {
    setGuard(null);
    setFlashReq(null);
    blocker.reset?.();
  };
  const proceed = () => {
    if (blocker.state === 'blocked') blocker.proceed();
    else {
      guard?.proceed();
      setGuard(null);
    }
  };

  // ---- 保存 ----
  // 记下一次已存上的保存（编辑器里的内容不动）
  const adoptSaved = (view: SectionView) => {
    setBaseline(baselineOf(view.blocks));
    setRev(view.rev);
    client.setQueryData(sectionKey(taskId, kind, view.id), { ...view });
    void client.invalidateQueries({ queryKey: editDocumentKey(taskId, kind) });
    // 保存后这一份的核对失效、待补充重新数、Word 预览按新内容重新排
    void client.invalidateQueries({ queryKey: reviewKey(taskId) });
    void client.invalidateQueries({ queryKey: pendingKey(taskId, kind) });
    void client.invalidateQueries({ queryKey: previewKey(taskId, kind) });
    void client.invalidateQueries({ queryKey: historyKey(taskId) });
  };
  // 保存成功：编辑框收起，栏头变成「已保存」
  const finishSave = (view: SectionView) => {
    adoptSaved(view);
    closeEditor();
  };

  /** 保存；成功返回 true。重试时传入同一次的 saveId（原样重发）或新的基准版本号 */
  const save = async (opts: { saveId?: string; baseRev?: number } = {}): Promise<boolean> => {
    if (!editing || !current || !d) return false;
    const trimmed = note.trim();
    const saveId = opts.saveId ?? crypto.randomUUID();
    const sent = current;
    setState({ kind: 'saving' });
    try {
      const view = await saveSection(taskId, kind, editing.id, {
        saveId,
        batchId: d.batchId,
        baseRev: opts.baseRev ?? rev,
        blocks: sent,
        note: trimmed,
        ...(aiVersion.current ? { aiPromptVersion: aiVersion.current } : {}),
      });
      finishSave(view);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.latest) {
        setState({ kind: 'conflict', latest: err.body.latest as SectionView });
        setConflictOpen(true);
        return false;
      }
      if (refused(err)) {
        setState({ kind: 'idle' });
        message.error(err.message);
        return false;
      }
      setState({ kind: 'failed', saveId, checking: false, cause: err instanceof ApiError && err.status >= 500 ? 'server' : 'network', blocks: sent, note: trimmed });
      return false;
    }
  };

  // 先查上一次保存有没有记上；之后内容又改过就换新的 saveId 保存，没改就原样重发
  const retry = async (): Promise<boolean> => {
    if (state.kind !== 'failed' || !d || !current) return false;
    setState({ ...state, checking: true });
    let check: Awaited<ReturnType<typeof saveStatus>>;
    try {
      check = await saveStatus(taskId, kind, state.saveId, d.batchId);
    } catch (err) {
      setState({ ...state, checking: false });
      message.error(refused(err) ? err.message : '还连不上耕云，请检查网络后再点「重新保存」');
      return false;
    }
    const changed = !sameBlocks(current, state.blocks) || note.trim() !== state.note;
    const step = retryStep(check.saved ? { saved: true, rev: check.section.rev } : { saved: false }, changed, rev);
    if (check.saved && step.kind === 'done') {
      finishSave(check.section);
      return true;
    }
    if (step.kind === 'resend') return save({ saveId: state.saveId });
    if (check.saved) adoptSaved(check.section);
    if (step.kind === 'saveNew') return save({ baseRev: step.baseRev });
    return false;
  };

  const confirmLapse = () =>
    new Promise<boolean>((resolve) => {
      modal.confirm({
        title: '保存后审核结论要重写',
        content: '三份都已核对，审核结论也写好了。保存后这一份要重新核对，审核结论也要重写。',
        okText: '仍然保存',
        cancelText: '先不保存',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

  const saveClicked = async () => {
    if (passed && !(await confirmLapse())) return;
    await save();
  };

  const leaveAndSave = async () => {
    if (passed && !(await confirmLapse())) return stay();
    const ok = state.kind === 'failed' ? await retry() : await save();
    if (ok) proceed();
    else stay();
  };

  const openLatest = () => {
    if (state.kind !== 'conflict') return;
    setKept(current);
    setConflictOpen(false);
    load(state.latest, true);
    client.setQueryData(sectionKey(taskId, kind, state.latest.id), state.latest);
  };

  const collapseKept = () =>
    modal.confirm({
      title: '收起您没保存的内容？',
      content: '收起后就不再显示冲突前您的输入，也找不回来。还没合并完的话，请先复制。',
      okText: '收起',
      cancelText: '先不收起',
      onOk: () => setKept(null),
    });

  const copyMine = async (blocks: EditBlock[] | null) => {
    if (await copyText(blocksText(blocks ?? []))) message.success('已复制这一节的内容');
    else message.info('浏览器不允许复制，请在编辑框里手动选中复制');
  };

  const rewrite = async () => {
    const editor = editorRef.current;
    if (!editing || !editor) return;
    const at = currentParagraph(editor);
    if (!at || at.text.trim().length < 4) {
      message.info('把光标放在要改写的那一段文字里，再点「帮我改写这段」');
      return;
    }
    if (at.text.length > 1000) {
      message.info('这一段超过 1000 字，请分成几段再改写');
      return;
    }
    setRewriting(true);
    try {
      const res = await rewriteParagraph(taskId, kind, editing.id, at.text);
      if (res.source === 'ai') setRewritePreview({ at, before: at.text, after: res.text, note: res.note, promptVersion: res.promptVersion });
      else message.info(res.note);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '没有连上服务器，原文没有改动；请稍后再试');
    } finally {
      setRewriting(false);
    }
  };

  const adoptRewrite = () => {
    const editor = editorRef.current;
    if (!rewritePreview || !editor) return;
    replaceParagraph(editor, rewritePreview.at, rewritePreview.after);
    aiVersion.current = rewritePreview.promptVersion;
    setRewritePreview(null);
  };

  // 点「修改这一节」：别的节有没保存的修改时先问
  const openEditor = (id: string, title: string) => {
    const view = viewOf(id);
    if (!view) return;
    closeEditor();
    setEditing({ id, title });
    load(view);
  };
  const startEdit = (id: string, title: string) => {
    if (editing?.id === id) return;
    if (unsaved) setGuard({ target: title, proceed: () => openEditor(id, title) });
    else openEditor(id, title);
  };
  const discard = () => {
    closeEditor();
  };

  // ---- 换位置 ----
  const go = (next: { doc?: DraftKind; chapter?: string; tab?: Tab }) => {
    // 从实际网址出发：连续切换时页面可能还没重画，params 还是上一次的
    const p = new URLSearchParams(window.location.search);
    p.set('view', 'edit');
    if (next.doc) {
      p.set('doc', next.doc);
      p.delete('chapter');
      p.delete('section');
    }
    if (next.chapter) {
      p.set('chapter', next.chapter);
      p.delete('section');
    }
    if (next.tab) {
      if (next.tab === 'text') p.delete('tab');
      else p.set('tab', next.tab);
    }
    setParams(p);
  };

  // 网址里指定了节（接着上次的地方）：这一章读完后滚到那一节
  const middleRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const sectionsReady = sections.length > 0 && sections.every((q) => q.data);
  useEffect(() => {
    if (!sectionParam || tab !== 'text' || !sectionsReady) return;
    const key = `${kind}/${sectionParam}`;
    if (scrolledFor.current === key) return;
    const el = middleRef.current?.querySelector(`[data-section="${CSS.escape(sectionParam)}"]`);
    if (!el) return;
    scrolledFor.current = key;
    el.scrollIntoView({ block: 'start' });
  }, [sectionParam, kind, tab, sectionsReady]);
  // 换章回到顶上
  useEffect(() => {
    if (!sectionParam) middleRef.current?.scrollTo({ top: 0 });
  }, [chapterId, kind, sectionParam]);

  // 右栏点一条待补充：正文滚到那一处，琥珀框闪约 2 秒（E18-15 ②）
  const [flash, setFlash] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    if (!flashReq || tab !== 'text' || !sectionsReady) return;
    const root = middleRef.current;
    const mark = flashReq.key ? root?.querySelector(`[data-pending="${CSS.escape(flashReq.key)}"]`) : null;
    const el = mark ?? root?.querySelector(`[data-section="${CSS.escape(flashReq.sectionId)}"]`);
    if (!el) return;
    setFlashReq(null);
    el.scrollIntoView({ block: 'center' });
    if (mark) setFlash(flashReq.key);
  }, [flashReq, tab, sectionsReady, chapterId]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => setPicked(null), [kind]);

  const items = pending.data?.items ?? [];
  const pick = (index: number) => {
    const it = items[index];
    if (!it) return;
    setPicked(index);
    const n = items.slice(0, index).filter((x) => x.sectionId === it.sectionId && !x.handled).length;
    setFlashReq({ sectionId: it.sectionId, key: it.handled ? null : `${it.sectionId}:${n}` });
    if (it.chapterId !== chapterId || tab !== 'text') {
      const p = new URLSearchParams(params);
      p.set('view', 'edit');
      p.set('chapter', it.chapterId);
      p.delete('section');
      p.delete('tab');
      setParams(p);
    }
  };

  // ---- 这一份核对完成 ----
  const [checking, setChecking] = useState(false);
  const check = async () => {
    if (!thisDoc) return;
    setChecking(true);
    try {
      const view = await checkDraft(taskId, kind, thisDoc.version);
      client.setQueryData(reviewKey(taskId), view);
      void client.invalidateQueries({ queryKey: historyKey(taskId) });
      message.success(`已核对「${DRAFT_KINDS[kind]}」`);
      const next = nextToCheck(view.docs, kind);
      if (next) go({ doc: next, tab: 'text' });
      else go({ tab: 'conclusion' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { view?: ReviewView } | undefined;
        if (body?.view) client.setQueryData(reviewKey(taskId), body.view);
        void client.invalidateQueries({ queryKey: previewKey(taskId, kind) });
        message.warning(err.message);
      } else {
        message.error(err instanceof ApiError ? err.message : '没有记下核对，请检查网络后重试');
      }
    } finally {
      setChecking(false);
    }
  };

  const download = () => downloadCurrentWord(taskId, kind).catch(() => message.error('没有下载成功，请检查网络后重试'));
  const [historyOpen, setHistoryOpen] = useState(false);

  // ---- 画面 ----
  const header = (
    <WizardHeader
      title="编制文稿"
      enterpriseName={`${enterpriseName} · ${taskNumber}`}
      stages={EXPERT_STAGES}
      current={2}
      // 画板：左右两块各宽 280，元素间距 16
      sideWidth={280}
      extra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button type="button" style={{ ...linkButton, ...text14 }} aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
            处理记录
          </button>
          <Button onClick={() => navigate(links.center)}>返回任务中心</Button>
        </div>
      }
    />
  );

  const frame = (body: ReactNode) => (
    <div className="gy-review-page" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: gy.canvas }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {body}
        <HistoryDrawer taskId={taskId} open={historyOpen} onClose={() => setHistoryOpen(false)} />
      </div>
    </div>
  );

  const docBar = r && (
    <DocBar
      docs={r.docs}
      kind={tab === 'conclusion' ? null : kind}
      conclusion={conclusionOpen ? { filled: passed } : null}
      onDoc={(k) => {
        // 按网址判断是不是已在这一份：切页签后页面还没重画时，连按方向键也不会被当成「点了当前页签」
        const now = new URLSearchParams(window.location.search);
        if ((now.get('doc') ?? 'plan') === k && now.get('tab') !== 'conclusion') return;
        go({ doc: k, tab: 'text' });
      }}
      onConclusion={() => {
        if (new URLSearchParams(window.location.search).get('tab') !== 'conclusion') go({ tab: 'conclusion' });
      }}
    />
  );

  if (review.isLoading || (!resumed && !review.isError)) return frame(<div style={{ padding: 32 }}><Loading /></div>);
  // 切到还没读过的文稿：页签留着（键盘焦点不丢），下面先显示加载
  if (doc.isLoading) return frame(<>{docBar}<div style={{ padding: 32 }}><Loading /></div></>);
  if (doc.isError || review.isError || !r || !d) {
    return frame(
      <Result
        status="info"
        title="还不能核对正文"
        subTitle={doc.error?.message ?? review.error?.message}
        extra={
          <Link to={links.task}>
            <Button>返回生成进度</Button>
          </Link>
        }
      />,
    );
  }

  if (tab === 'conclusion') {
    return frame(
      <>
        {docBar}
        <ConclusionTab taskId={taskId} review={r} reviewer={me?.name ?? ''} onPublished={() => setParams({ view: 'publish' })} />
      </>,
    );
  }

  // 栏头的保存状态
  const failed = state.kind === 'failed' ? state : null;
  const status = failed ? (
    <>
      <ExclamationCircleFilled aria-hidden style={{ color: gy.error, fontSize: 14 }} />
      <span style={{ color: gy.error }}>没保存上 · {short}有修改</span>
    </>
  ) : state.kind === 'saving' ? (
    <span style={{ color: gy.secondary }}>正在保存…</span>
  ) : dirty || kept ? (
    <span style={{ color: gy.warning }}>● {short}还没保存</span>
  ) : thisDoc?.savedAt ? (
    <>
      <CheckCircleFilled aria-hidden style={{ color: gy.success, fontSize: 14 }} />
      <span style={{ color: gy.tertiary }}>已保存 · {when(thisDoc.savedAt)}</span>
    </>
  ) : null;

  // 底栏：按先后取第一条符合的原因
  const left = pending.data ? pendingCount(pending.data) : null;
  // 接着上次的提示第二句：哪几份已核对完成，这一份待补充已处理几处；哪半句没有就不写
  const checkedNames = r ? r.docs.filter(checkValid).map((x) => DRAFT_KINDS[x.kind]) : [];
  const handledHere = items.filter((it) => it.handled).length;
  const resumeTail = [checkedNames.length ? `${checkedNames.join('、')}已核对完成` : '', handledHere ? `待补充已处理 ${handledHere} 处` : '']
    .filter(Boolean)
    .join('，');
  const checkedNow = thisDoc ? checkValid(thisDoc) : false;
  const name = DRAFT_KINDS[kind];
  let reason: ReactNode;
  let canClick = true;
  if (published) {
    reason = '这批文稿已交付，正文不能再修改。要更正请回到资料核对，重新生成后再交付。';
    canClick = false;
  } else if (!canCheck) {
    reason = '只有负责这个任务的专家可以修改和核对；可以下载 Word 查看。';
    canClick = false;
  } else if (failed) {
    reason = <span style={{ color: gy.error }}>{short}还没保存上</span>;
    canClick = false;
  } else if (dirty || kept || state.kind === 'saving') {
    reason = `先保存正在修改的 ${short}，再点「这一份核对完成」`;
    canClick = false;
  } else if (checkedNow && thisDoc?.check) {
    reason = `${name} · ${thisDoc.check.byName} ${when(thisDoc.check.at)} 已核对，再修改要重新核对`;
    canClick = false;
  } else if (left) {
    reason = `${name} · 还有 ${left} 处待补充，可以留空，交付时会列在待补充清单里`;
  } else if (left === 0) {
    reason = `${name} · 待补充都已处理`;
  }

  const workupHref = editable ? `/expert/tasks/${taskId}?view=workup` : null;
  const editingView = editing ? viewOf(editing.id) : undefined;

  const sectionBlock = (s: PendingChapter['sections'][number], i: number) => {
    const view = sections[i]?.data;
    const q = sections[i];
    const isEditing = editing?.id === s.id;
    const head = s.level === 0 ? null : (
      <h3 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text, overflowWrap: 'anywhere' }}>{s.title}</h3>
    );
    if (isEditing && initial && editingView) {
      return (
        <section key={s.id} data-section={s.id} aria-label={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 12, scrollMarginTop: 16 }}>
          {failed && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 8, background: gy.errorBg }}>
              <ExclamationCircleFilled aria-hidden style={{ color: gy.error, fontSize: 16, alignSelf: 'flex-start', marginTop: 3 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...text14, fontWeight: 600, color: gy.text }}>{failed.cause === 'server' ? '服务出了点问题，没保存上' : '网络断了，没保存上'}</span>
                <span style={{ ...text14, color: gy.secondary }}>您填的内容还在框里，不要关掉页面。网络好了点「重新保存」。</span>
              </div>
              <Button loading={failed.checking} onClick={() => void retry()}>
                重新保存
              </Button>
            </div>
          )}
          <div className="gy-editor-box" style={{ border: `1px solid ${gy.primary}`, borderRadius: 8, overflow: 'hidden', background: gy.surface }}>
            <LockedContext.Provider value={{ previews: editingView.locked, workupHref }}>
              <EditorPane
                key={initial.key}
                initial={initial.blocks}
                editable={editable}
                onChange={setCurrent}
                editorRef={editorRef}
                label={s.title}
                extra={
                  d.rewrite ? (
                    <Button size="small" type="link" loading={rewriting} onClick={() => void rewrite()}>
                      帮我改写这段
                    </Button>
                  ) : null
                }
              >
                {head ?? <span style={{ ...caption, color: gy.tertiary }}>本章正文</span>}
              </EditorPane>
            </LockedContext.Provider>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: `1px solid ${gy.split}` }}>
              <Input
                aria-label="修改说明"
                value={note}
                maxLength={EDIT_LIMITS.note}
                placeholder="修改说明（选填），会记进处理记录"
                onChange={(e) => setNote(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button disabled={state.kind === 'saving' || (failed?.checking ?? false)} onClick={discard}>
                放弃修改
              </Button>
              <Button
                type="primary"
                loading={state.kind === 'saving'}
                disabled={!dirty && !failed}
                onClick={() => void (failed ? retry() : saveClicked())}
              >
                保存这一节
              </Button>
            </div>
          </div>
          {kept && (
            <div aria-label="您没保存的内容" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', borderRadius: 8, background: gy.warningBg }}>
              <span style={{ ...text14, fontWeight: 600, color: gy.text }}>您没保存的内容</span>
              <span style={{ ...caption, color: gy.secondary }}>编辑框里已换成最新保存的内容。对照下面您的输入逐项合并，再保存；保存后这里自动收起。</span>
              <p style={{ ...text14, color: gy.text, whiteSpace: 'pre-wrap', margin: 0 }}>{blocksText(kept)}</p>
              <div style={{ display: 'flex', gap: 16 }}>
                <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => void copyMine(kept)}>
                  复制我的内容
                </button>
                <button type="button" style={{ ...linkButton, ...text14, color: gy.secondary }} onClick={collapseKept}>
                  收起
                </button>
              </div>
            </div>
          )}
        </section>
      );
    }
    const editLink = editable && view ? (
      <button type="button" aria-label={`修改这一节 ${s.title}`} style={{ ...linkButton, ...text14, flexShrink: 0 }} onClick={() => startEdit(s.id, s.title)}>
        修改这一节
      </button>
    ) : null;
    // 章本身的正文：没有内容也不能改就不显示
    if (s.level === 0 && view && view.blocks.length === 0 && !view.saved) return null;
    return (
      <section key={s.id} data-section={s.id} aria-label={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 8, scrollMarginTop: 16 }}>
        {(head || editLink) && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{head}</span>
            {editLink}
          </div>
        )}
        {view?.saved && <EditedChip saved={view.saved} me={me?.id} />}
        {view ? (
          <SectionBlocks view={view} flash={flash} workupHref={workupHref} />
        ) : q?.isError ? (
          <span style={{ ...text14, color: gy.error }}>{q.error.message}</span>
        ) : (
          <Loading rows={2} card={false} />
        )}
      </section>
    );
  };

  const middle = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 52, padding: '0 24px', flexShrink: 0 }}>
        <Segmented value={tab === 'preview' ? 'preview' : 'text'} onChange={(v) => go({ tab: v })} />
        <span style={{ flex: 1 }} />
        <span aria-live="polite" style={{ ...caption, minWidth: 0, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {status}
        </span>
      </div>
      {tab === 'preview' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '0 24px 24px' }}>
          <PreviewPane taskId={taskId} kind={kind} savedAt={thisDoc?.savedAt ?? null} onBackToText={() => go({ tab: 'text' })} />
        </div>
      ) : (
        <div ref={middleRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 24px' }}>
          {resumeNote && (
            <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', marginBottom: 16, borderRadius: 8, background: gy.neutralBg }}>
              <InfoCircleFilled aria-hidden style={{ color: gy.secondary, fontSize: 16, marginTop: 3 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...text14, fontWeight: 600, color: gy.text }}>已接着上次的地方打开</span>
                <span style={{ ...text14, color: gy.secondary }}>
                  {when(resumeNote.at)} 您核对到「{resumeNote.where}」{resumeTail ? `。${resumeTail}。` : ''}
                </span>
              </div>
              <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => setResumeNote(null)}>
                知道了
              </button>
            </div>
          )}
          <article
            aria-label="正文"
            style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '32px 40px', borderRadius: 8, border: `1px solid ${gy.split}`, background: gy.surface }}
          >
            <h2 tabIndex={-1} data-page-title style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600, color: gy.text, overflowWrap: 'anywhere' }}>
              {chapter ? chapter.title : DRAFT_KINDS[kind]}
            </h2>
            {chapter ? (
              chapter.sections.map((s, i) => sectionBlock(s, i))
            ) : pending.isLoading ? (
              <Loading card={false} />
            ) : (
              <span style={{ ...text14, color: gy.tertiary }}>这一份没有正文。</span>
            )}
          </article>
        </div>
      )}
    </div>
  );

  return frame(
    <>
      {docBar}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ChapterNav chapters={chapters} current={chapterId} onSelect={(id) => go({ chapter: id, tab: 'text' })} />
        {middle}
        <SidePanel items={items} selected={picked} materials={generation.materials} onPick={pick} />
      </div>
      <div style={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 32px', background: gy.surface, borderTop: `1px solid ${gy.split}` }}>
        <span role={failed ? 'alert' : undefined} style={{ ...text14, flex: 1, minWidth: 0, color: gy.secondary }}>
          {reason}
        </span>
        <Button onClick={() => void download()}>下载 Word</Button>
        {canCheck &&
          (checkedNow ? (
            <Button type="primary" disabled>
              已核对
            </Button>
          ) : (
            <Button type="primary" disabled={!canClick} loading={checking} onClick={() => void check()}>
              这一份核对完成
            </Button>
          ))}
      </div>

      <LeaveDialog
        open={leaving !== null}
        section={short || '这一节'}
        target={leaving?.target ?? ''}
        saving={state.kind === 'saving' || (failed?.checking ?? false)}
        keptOnly={!dirty && !failed && kept !== null}
        onStay={stay}
        onDiscard={() => {
          closeEditor();
          proceed();
        }}
        onSave={() => void leaveAndSave()}
      />
      <ConflictDialog
        open={conflictOpen && state.kind === 'conflict'}
        mine={current ?? []}
        latest={state.kind === 'conflict' ? state.latest : null}
        onBack={() => setConflictOpen(false)}
        onOpenLatest={openLatest}
        onCopyMine={() => void copyMine(current)}
      />
      <RewriteDialog preview={rewritePreview} onAdopt={adoptRewrite} onReject={() => setRewritePreview(null)} />
    </>,
  );
}
