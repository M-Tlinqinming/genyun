import {
  blocksText,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  EDIT_LIMITS,
  sameBlocks,
  type DraftKind,
  type EditBlock,
  type GenerationProgress,
  type OutlineNode,
  type SectionView,
} from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Input, Result, type InputRef } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { openFile } from '../../../api/documents';
import {
  downloadCurrentWord,
  editDocumentKey,
  rewriteParagraph,
  saveSection,
  saveStatus,
  sectionKey,
  useEditDocument,
  useSection,
} from '../../../api/editing';
import { ApiError } from '../../../api/request';
import { linkButton, Loading } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';
import { ContactRecords } from '../workup/ContactRecords';
import { ConflictDialog, copyText, LeaveDialog, RewriteDialog, stamp } from './EditDialogs';
import { blocksToDoc, docToBlocks } from './editorDoc';
import type { Editor } from '@tiptap/react';
import { retryStep } from './saveRetry';
import { currentParagraph, EditorPane, LockedContext, replaceParagraph } from './SectionEditor';

// I05 审核与修订 · 正文编辑（14 页 E18-03 未保存、E18-04 已保存、E18-07 恢复状态、E18-08 1366×768）。
// 按节改：左栏章节目录，中栏这一节的正文（表格和图锁定），右栏本次采用的企业资料；改完写修订说明再保存。
// 切换文档、换节、离开任务都先检查未保存的修改；保存结果不明时先查上一次保存有没有记上，再决定重发还是重新保存。

const STAGES = ['资料核实', '专业编制', '审核与修订', '成果发布'];
const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const panel: CSSProperties = { background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 6 };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  // cause：server = 服务返回出错；network = 没连上。blocks / note 是那一次发出去的内容，重试时用来判断之后有没有再改
  | { kind: 'failed'; saveId: string; checking: boolean; cause: 'server' | 'network'; blocks: EditBlock[]; note: string }
  | { kind: 'conflict'; latest: SectionView };

type RewritePreview = { at: { from: number; to: number }; before: string; after: string; note: string; promptVersion: string | null };

function firstLeaf(nodes: OutlineNode[]): string | null {
  let n = nodes[0];
  while (n && n.children.length) n = n.children[0];
  return n?.id ?? null;
}

function ancestorsOf(nodes: OutlineNode[], id: string, path: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.id === id) return path;
    const hit = ancestorsOf(n.children, id, [...path, n.id]);
    if (hit) return hit;
  }
  return null;
}

// 编辑器转过一遍的样子作为比较基准（空段落之类不算修改）
const baselineOf = (blocks: EditBlock[]) => docToBlocks(blocksToDoc(blocks));

export function EditView({
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
  // 面包屑和返回的去处：专家回任务中心和生成进度，运营回运营的任务中心
  links?: { center: string; task: string };
}) {
  const [params, setParams] = useSearchParams();
  const kind: DraftKind = DRAFT_KIND_KEYS.find((k) => k === params.get('doc')) ?? 'plan';
  const doc = useEditDocument(taskId, kind);
  const sectionId = params.get('section') ?? (doc.data ? firstLeaf(doc.data.outline) : null);
  const section = useSection(taskId, kind, doc.data ? sectionId : null);
  const client = useQueryClient();
  const { message, modal } = App.useApp();
  const [showRecords, setShowRecords] = useState(false);

  const [baseline, setBaseline] = useState<EditBlock[] | null>(null);
  const [current, setCurrent] = useState<EditBlock[] | null>(null);
  const [rev, setRev] = useState(0);
  const [saved, setSaved] = useState<SectionView['saved']>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [conflictOpen, setConflictOpen] = useState(false);
  // 冲突时选「保留输入并打开最新稿」后，右栏留着自己的输入供逐项合并
  const [kept, setKept] = useState<EditBlock[] | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [rewritePreview, setRewritePreview] = useState<RewritePreview | null>(null);
  // 本节这次修改采用过 AI 改写：保存时带上提示词版本，记进修订记录
  const aiVersion = useRef<string | null>(null);
  const noteRef = useRef<InputRef>(null);
  const focusNoteAfterLeave = useRef(false);
  const outlineRef = useRef<HTMLDivElement>(null);

  const editable = doc.data?.editable ?? false;
  const dirty = baseline !== null && current !== null && !sameBlocks(current, baseline);
  // 冲突后右栏还留着自己的输入（待合并），也算没保存：离开要提醒
  const unsaved = dirty || kept !== null;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const editorRef = useRef<Editor | null>(null);
  // 编辑器按这份内容新建；换节、放弃修改、换成最新稿时换内容并重新挂一个
  const [initial, setInitial] = useState<{ key: number; blocks: EditBlock[] } | null>(null);
  const remount = (blocks: EditBlock[]) => setInitial((prev) => ({ key: (prev?.key ?? 0) + 1, blocks }));

  // keepNote：冲突后打开最新稿时，已写的修订说明留着
  const load = useCallback((view: SectionView, keepNote = false) => {
    const b = baselineOf(view.blocks);
    setBaseline(b);
    setCurrent(b);
    setRev(view.rev);
    setSaved(view.saved);
    if (!keepNote) setNote('');
    setNoteError(null);
    setState({ kind: 'idle' });
    aiVersion.current = null;
    remount(view.blocks);
  }, []);

  // 换节或换文档：读到这一节后换进编辑器
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    const view = section.data;
    if (!view) return;
    // 同一节读到了更新的版本（别人刚保存过）且自己没在改，也换成新的
    const key = `${kind}/${view.id}/${view.rev}`;
    if (loadedFor.current === key || (loadedFor.current?.startsWith(`${kind}/${view.id}/`) && dirtyRef.current)) return;
    loadedFor.current = key;
    setKept(null);
    load(view);
  }, [section.data, kind, load]);

  // 关闭或刷新页面时提醒
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // 从网址直接打开较深的节：目录滚到这一节
  useEffect(() => {
    outlineRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sectionId, doc.data]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => unsaved && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`,
  );

  const where = `${DRAFT_KINDS[kind]}「${section.data?.path.slice(1).join(' · ') || section.data?.title || ''}」`;

  // 记下一次已存上的保存（编辑器里的内容不动）：基准、修订次数、目录上的「已改」和下次进来读到的
  const adoptSaved = (view: SectionView) => {
    loadedFor.current = `${kind}/${view.id}/${view.rev}`;
    setBaseline(baselineOf(view.blocks));
    setRev(view.rev);
    setSaved(view.saved);
    client.setQueryData(sectionKey(taskId, kind, view.id), { ...view });
    void client.invalidateQueries({ queryKey: editDocumentKey(taskId, kind) });
  };

  // 保存成功：不弹提示，状态和底栏变成「已保存」；待合并的内容自动收起
  const finishSave = (view: SectionView) => {
    adoptSaved(view);
    setNote('');
    setKept(null);
    aiVersion.current = null;
    setState({ kind: 'saved', at: view.saved?.at ?? new Date().toISOString() });
  };

  const askNote = () => {
    setNoteError('请写修订说明：改了什么、依据是什么');
    setTimeout(() => noteRef.current?.focus(), 0);
  };

  /** 保存；成功返回 true。重试时传入同一次的 saveId（原样重发）或新的基准修订次数 */
  const save = async (opts: { saveId?: string; baseRev?: number } = {}): Promise<boolean> => {
    if (!section.data || !current || !doc.data) return false;
    const trimmed = note.trim();
    if (!trimmed) {
      askNote();
      return false;
    }
    const saveId = opts.saveId ?? crypto.randomUUID();
    const sent = current;
    setState({ kind: 'saving' });
    try {
      const view = await saveSection(taskId, kind, section.data.id, {
        saveId,
        batchId: doc.data.batchId,
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
      if (err instanceof ApiError && err.status < 500) {
        // 内容或说明不合要求、或草稿已重新生成：没有保存，按提示处理
        setState({ kind: 'idle' });
        if (err.message.includes('修订说明')) setNoteError(err.message);
        else message.error(err.message);
        return false;
      }
      // 服务出错或没连上：结果不明，记下这次的 saveId 和发出去的内容，重试前先查
      setState({ kind: 'failed', saveId, checking: false, cause: err instanceof ApiError ? 'server' : 'network', blocks: sent, note: trimmed });
      return false;
    }
  };

  // 先查上一次保存有没有记上；之后内容又改过就换新的 saveId 保存，没改就原样重发
  const retry = async () => {
    if (state.kind !== 'failed' || !doc.data || !current) return;
    if (!note.trim()) return askNote();
    setState({ ...state, checking: true });
    let check: Awaited<ReturnType<typeof saveStatus>>;
    try {
      check = await saveStatus(taskId, kind, state.saveId, doc.data.batchId);
    } catch (err) {
      setState({ ...state, checking: false });
      message.error(err instanceof ApiError && err.status < 500 ? err.message : '还连不上服务器，请检查网络后再点「重试保存」');
      return;
    }
    const changed = !sameBlocks(current, state.blocks) || note.trim() !== state.note;
    const step = retryStep(check.saved ? { saved: true, rev: check.section.rev } : { saved: false }, changed, rev);
    if (check.saved && step.kind === 'done') return finishSave(check.section);
    if (step.kind === 'resend') return void save({ saveId: state.saveId });
    // 上一次其实存上了、之后又改过：先记下存上的那次，再以它为基准保存新内容
    if (check.saved) adoptSaved(check.section);
    if (step.kind === 'saveNew') await save({ baseRev: step.baseRev });
  };

  const discard = () => {
    if (!section.data) return;
    remount(baseline ?? []);
    setCurrent(baseline);
    setNote('');
    setNoteError(null);
    setState({ kind: 'idle' });
    aiVersion.current = null;
  };

  const openLatest = () => {
    if (state.kind !== 'conflict') return;
    setKept(current);
    setConflictOpen(false);
    loadedFor.current = `${kind}/${state.latest.id}/${state.latest.rev}`;
    load(state.latest, true);
    client.setQueryData(sectionKey(taskId, kind, state.latest.id), state.latest);
  };

  // 手动收起待合并的内容：先确认（保存成功后自动收起）
  const collapseKept = () =>
    modal.confirm({
      title: '收起你的未保存内容？',
      content: '收起后右栏不再显示冲突前你的输入，也找不回来。还没合并完的话，请先复制。',
      okText: '收起',
      cancelText: '先不收起',
      onOk: () => setKept(null),
    });

  const copyMine = async (blocks: EditBlock[] | null) => {
    if (await copyText(blocksText(blocks ?? []))) message.success('已复制本节内容');
    else message.info('浏览器不允许复制，请在编辑区里手动选中复制');
  };

  const rewrite = async () => {
    const editor = editorRef.current;
    if (!section.data || !editor) return;
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
      const res = await rewriteParagraph(taskId, kind, section.data.id, at.text);
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

  const download = () => downloadCurrentWord(taskId, kind).catch(() => message.error('没有下载成功，请检查网络后重试'));

  const go = (next: { doc?: DraftKind; section?: string }) => {
    const p = new URLSearchParams(params);
    p.set('view', 'edit');
    if (next.doc) {
      p.set('doc', next.doc);
      p.delete('section');
    }
    if (next.section) p.set('section', next.section);
    setParams(p);
  };

  const leaveAndSave = async () => {
    // 还没写修订说明：留在本页，光标放到修订说明
    if (!note.trim()) {
      // 弹窗关完再把光标放进修订说明（关的过程中焦点还在弹窗里）
      focusNoteAfterLeave.current = true;
      setNoteError('请写修订说明：改了什么、依据是什么');
      blocker.reset?.();
      return;
    }
    if (await save()) blocker.proceed?.();
    else blocker.reset?.();
  };

  const tooLong = useMemo(() => (current ? blocksText(current).length > EDIT_LIMITS.textChars * 4 : false), [current]);
  const locked = useMemo(
    () => ({ previews: section.data?.locked ?? [], workupHref: editable ? `/expert/tasks/${taskId}?view=workup` : null }),
    [section.data, editable, taskId],
  );

  if (doc.isLoading) return <Loading />;
  if (doc.isError) {
    return (
      <Result
        status="info"
        title="还不能编辑正文"
        subTitle={doc.error.message}
        extra={
          <Link to={links.task}>
            <Button>返回生成进度</Button>
          </Link>
        }
      />
    );
  }
  const d = doc.data!;
  const expanded = new Set([...(ancestorsOf(d.outline, sectionId ?? '') ?? []), sectionId ?? '']);
  const chip = !editable
    ? { text: '只读 · 由负责专家修改', color: gy.secondary, bg: gy.neutralBg }
    : dirty
      ? { text: '修订未保存', ...stage.action }
      : kept
        ? { text: '你的修改待合并', ...stage.action }
        : saved
          ? { text: '已保存 · 待人工核对', color: gy.primary, bg: gy.selected }
          : { text: '待人工核对', color: gy.primary, bg: gy.selected };
  const status =
    state.kind === 'saving' ? (
      <span style={{ color: gy.secondary }}>正在保存…</span>
    ) : dirty ? (
      <span style={{ color: gy.warning }}>● 未保存</span>
    ) : kept ? (
      <span style={{ color: gy.warning }}>● 待合并</span>
    ) : saved ? (
      <span style={{ color: gy.success }}>✓ 已保存 {stamp(saved.at)}</span>
    ) : null;
  // 刚保存、或这一节之前修订过且现在没在改：修订说明只读显示，开始修改后再填新的
  const showSavedNote = !dirty && !kept && saved !== null && state.kind !== 'failed';
  const failed = state.kind === 'failed' ? state : null;

  return (
    <div className="gy-edit-page gy-wide-workbench" style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '-16px 0 -48px' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <nav aria-label="面包屑" style={{ ...text14, color: gy.secondary }}>
          <Link to={links.center} style={{ color: gy.secondary }}>
            任务中心
          </Link>
          {'　/　'}
          <Link to={links.task} style={{ color: gy.secondary }}>
            {enterpriseName}
          </Link>
          {'　/　审核与修订'}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, lineHeight: '32px', color: gy.text }}>{enterpriseName}</h1>
          <span style={{ ...text14, color: gy.secondary }}>{taskNumber}</span>
          <span style={{ flex: 1 }} />
          <span role="status" style={{ ...text14, padding: '3px 10px', borderRadius: 4, background: chip.bg, color: chip.color }}>
            {chip.text}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, paddingBottom: 12, borderBottom: `1px solid ${gy.split}` }}>
          <ol aria-label="处理阶段" style={{ display: 'flex', gap: 32, flex: 1, margin: 0, padding: 0, listStyle: 'none' }}>
            {STAGES.map((s, i) => (
              <li key={s} aria-current={i === 2 ? 'step' : undefined} style={{ ...text14, color: i === 2 ? gy.primary : gy.secondary }}>
                {i + 1}　{s}
              </li>
            ))}
          </ol>
          <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => setShowRecords(true)}>
            处理记录
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 28, paddingBottom: 12, borderBottom: `1px solid ${gy.split}` }}>
        <div role="tablist" aria-label="三份文档" style={{ display: 'flex', gap: 28 }}>
          {DRAFT_KIND_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === kind}
              onClick={() => k !== kind && go({ doc: k })}
              style={{ ...linkButton, ...text14, color: k === kind ? gy.primary : gy.text, fontWeight: k === kind ? 500 : 400 }}
            >
              {DRAFT_KINDS[k]}　待核对
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', ...text14, color: gy.secondary }}>人工核对 0 / 3</span>
      </div>

      <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 330px)', minHeight: 420 }}>
        <nav aria-label="章节目录" style={{ ...panel, width: 168, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: '18px 0' }}>
          <div style={{ ...text14, fontWeight: 500, color: gy.text, padding: '0 12px 12px' }}>章节目录</div>
          <div ref={outlineRef} style={{ overflowY: 'auto', flex: 1, padding: '0 8px' }}>
            <OutlineList nodes={d.outline} depth={0} selected={sectionId} expanded={expanded} onSelect={(id) => go({ section: id })} />
          </div>
        </nav>

        <section aria-label="本节正文" style={{ ...panel, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, ...text14 }}>
            <span style={{ color: gy.primary, fontWeight: 500 }}>正文</span>
            <span style={{ marginLeft: 'auto' }} aria-live="polite">
              {status}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.text }}>
            {section.data ? section.data.path.slice(1).join(' · ') || section.data.title : ' '}
          </h2>
          {section.isError ? (
            <span style={{ ...text14, color: gy.error }}>{section.error.message}</span>
          ) : initial && !section.isLoading ? (
            <LockedContext.Provider value={locked}>
              <EditorPane
                key={initial.key}
                initial={initial.blocks}
                editable={editable}
                dirty={dirty}
                onChange={setCurrent}
                editorRef={editorRef}
                extra={
                  d.rewrite && editable ? (
                    <Button size="small" type="link" loading={rewriting} onClick={() => void rewrite()}>
                      帮我改写这段
                    </Button>
                  ) : null
                }
              />
            </LockedContext.Provider>
          ) : (
            <Loading />
          )}
          {editable && showSavedNote && saved ? (
            <div aria-label="本节修订说明" style={{ display: 'flex', gap: 12, ...text14 }}>
              <span style={{ color: gy.secondary, flexShrink: 0 }}>修订说明：</span>
              <span style={{ flex: 1, minWidth: 0, color: gy.text, overflowWrap: 'anywhere' }}>{saved.note}</span>
              <span style={{ color: gy.secondary, flexShrink: 0 }}>
                {saved.byName} {stamp(saved.at)}
              </span>
            </div>
          ) : (
            editable && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <label htmlFor="revision-note" style={{ ...text14, color: gy.secondary, flexShrink: 0, paddingTop: 5 }}>
                  修订说明
                </label>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Input
                    id="revision-note"
                    ref={noteRef}
                    value={note}
                    maxLength={EDIT_LIMITS.note}
                    status={noteError ? 'error' : undefined}
                    placeholder="改了什么、依据是什么，如：按已核实名册，将联系人由陈某更正为李某"
                    onChange={(e) => {
                      setNote(e.target.value);
                      if (noteError) setNoteError(null);
                    }}
                    onPressEnter={() => (failed ? void retry() : dirty && void save())}
                    aria-describedby={noteError ? 'revision-note-error' : undefined}
                  />
                  {noteError && (
                    <span id="revision-note-error" role="alert" style={{ fontSize: 13, lineHeight: '20px', color: gy.error }}>
                      {noteError}
                    </span>
                  )}
                </div>
              </div>
            )
          )}
        </section>

        <aside aria-label="企业资料依据" style={{ ...panel, width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 20, overflowY: 'auto' }}>
          {kept ? (
            <>
              <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>你的未保存内容</span>
              <span style={{ ...text14, color: gy.secondary }}>编辑区已换成最新保存稿。对照下面你的输入逐项合并，再写修订说明保存；保存成功后这里自动收起。</span>
              <p style={{ ...text14, color: gy.text, whiteSpace: 'pre-wrap', margin: 0 }}>{blocksText(kept)}</p>
              <div style={{ display: 'flex', gap: 16 }}>
                <button type="button" style={{ ...linkButton, ...text14 }} onClick={() => void copyMine(kept)}>
                  复制我的内容
                </button>
                <button type="button" style={{ ...linkButton, ...text14, color: gy.secondary }} onClick={collapseKept}>
                  收起
                </button>
              </div>
            </>
          ) : (
            <>
              <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>企业资料依据</span>
              <span style={{ ...text14, color: gy.secondary }}>本次生成采用的资料 · 共 {generation.materials.length} 份，均已核实</span>
              <ul aria-label="本次采用的资料" style={{ margin: 0, padding: '0 0 14px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${gy.split}` }}>
                {generation.materials.map((m) => (
                  <li key={m.fileId} style={{ display: 'flex', gap: 8, ...text14 }}>
                    <span style={{ flex: 1, minWidth: 0, color: gy.text, overflowWrap: 'anywhere' }}>
                      {m.name}
                      {m.version ? ` · V${m.version}` : ''}
                    </span>
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
                {generation.materials.length === 0 && <li style={{ ...text14, color: gy.secondary }}>本次按专业整理的内容生成，没有采用客户上传的文件</li>}
              </ul>
              <span style={{ ...text14, color: gy.secondary }}>
                在这里修正文稿措辞与转录差异。企业事实存疑时，先回到专业整理核实或联系客户补件，再重新生成。
              </span>
              <span style={{ ...text14, color: gy.secondary }}>表格和图来自专业整理，在正文里锁定。</span>
            </>
          )}
        </aside>
      </div>

      {/* 底栏贴在屏幕底部；保存失败时就在底栏里提示（红框），不另起一块盖住修订说明 */}
      <div
        role={failed ? 'alert' : 'region'}
        aria-label="保存本节"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: failed ? '10px 20px' : '16px 20px',
          // border 简写不能和 borderColor 交替出现（React 会删掉 borderColor，框变成默认深色）：两种状态都写明颜色
          background: gy.surface,
          borderRadius: 6,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: failed ? gy.error : gy.split,
        }}
      >
        {!editable ? (
          <span style={{ flex: 1, ...text14, color: gy.secondary }}>只有负责这个任务的专家可以修改正文；可以下载当前稿 Word 查看。</span>
        ) : failed ? (
          <>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ ...text14, fontWeight: 500, color: gy.error }}>修订未保存成功</span>
              <span style={{ ...text14, color: gy.text }}>
                {failed.cause === 'server' ? '服务暂时出错' : '连接中断'}。当前输入仍保留在编辑区，已保存稿没有改变；请保持此页打开并重试。
              </span>
            </div>
            <Button type="text" disabled={failed.checking} onClick={discard}>
              取消本次修改
            </Button>
            <Button onClick={() => void copyMine(current)}>复制本节内容</Button>
            <Button type="primary" loading={failed.checking} onClick={() => void retry()}>
              重试保存
            </Button>
          </>
        ) : dirty || state.kind === 'saving' || state.kind === 'conflict' ? (
          <>
            <span style={{ flex: 1, ...text14, color: gy.warning }}>
              {tooLong ? '本节内容过长，请拆成几段或删去重复内容后再保存' : '有未保存修订 · 保存成功后才能进行全文核对'}
            </span>
            <Button disabled={state.kind === 'saving'} onClick={discard}>
              取消本次修改
            </Button>
            <Button type="primary" loading={state.kind === 'saving'} disabled={!dirty} onClick={() => void save()}>
              保存本节修订
            </Button>
          </>
        ) : kept ? (
          <span style={{ flex: 1, ...text14, color: gy.warning }}>你的输入还在右栏，合并进正文后写修订说明保存</span>
        ) : state.kind === 'saved' ? (
          <>
            <span style={{ flex: 1, ...text14, color: gy.success }}>修订已保存 · 人工核对仍为 0 / 3；请检查全文与 Word 版式</span>
            <Button onClick={() => editorRef.current?.commands.focus('end')}>继续编辑本节</Button>
            <Button type="primary" onClick={() => void download()}>
              下载当前稿 Word
            </Button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, ...text14, color: gy.secondary }}>
              {saved ? `本节已修订 · ${saved.byName} ${stamp(saved.at)}` : '在正文里直接修改；改完写明修订说明再保存本节'}
            </span>
            <Button onClick={() => void download()}>下载当前稿 Word</Button>
          </>
        )}
      </div>

      <LeaveDialog
        open={blocker.state === 'blocked'}
        where={where}
        saving={state.kind === 'saving'}
        keptOnly={!dirty && kept !== null}
        onStay={() => blocker.reset?.()}
        onDiscard={() => {
          discard();
          setKept(null);
          blocker.proceed?.();
        }}
        onSave={() => void leaveAndSave()}
        afterClose={() => {
          if (focusNoteAfterLeave.current) noteRef.current?.focus();
          focusNoteAfterLeave.current = false;
        }}
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
      <ContactRecords taskId={taskId} open={showRecords} onClose={() => setShowRecords(false)} />
    </div>
  );
}

function OutlineList({
  nodes,
  depth,
  selected,
  expanded,
  onSelect,
}: {
  nodes: OutlineNode[];
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? '章节' : undefined} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {nodes.map((n) => {
        const active = n.id === selected;
        // 前两层总是显示；更深的只展开选中的这一支
        const open = n.children.length > 0 && (depth === 0 || expanded.has(n.id));
        return (
          <li key={n.id} role="treeitem" aria-selected={active} aria-expanded={n.children.length ? open : undefined}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(n.id)}
              style={{
                ...linkButton,
                ...text14,
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                width: '100%',
                padding: `6px 8px 6px ${8 + depth * 12}px`,
                borderRadius: 4,
                // 当前节：左侧竖条 + 加粗
                boxShadow: active ? `inset 3px 0 0 ${gy.primary}` : 'none',
                fontWeight: active ? 500 : 400,
                color: active ? gy.primary : gy.text,
                background: active ? gy.selected : 'none',
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{n.title}</span>
              {n.edited && (
                <span aria-label="已修订" title="本节已人工修订" style={{ fontSize: 12, lineHeight: '20px', color: gy.primary, flexShrink: 0 }}>
                  已改
                </span>
              )}
            </button>
            {open && <OutlineList nodes={n.children} depth={depth + 1} selected={selected} expanded={expanded} onSelect={onSelect} />}
          </li>
        );
      })}
    </ul>
  );
}
