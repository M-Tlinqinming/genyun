import { LockOutlined } from '@ant-design/icons';
import type { EditBlock, LockedPreview } from '@genyun/shared';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import { Plugin } from '@tiptap/pm/state';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { linkButton } from '../../../components/ui';
import { gy } from '../../../theme/tokens';
import { blocksToDoc, docToBlocks, lockedOrder, type PmNode } from './editorDoc';

/** 锁定块要显示的表格内容、图的缩略图，以及去资料核对修改的入口 */
export const LockedContext = createContext<{ previews: LockedPreview[]; workupHref: string | null }>({ previews: [], workupHref: null });

const cell: CSSProperties = { padding: '4px 8px', border: `1px solid ${gy.split}`, textAlign: 'left', verticalAlign: 'top', fontWeight: 400 };

// 表格和图：来自资料核对，正文里不能删、不能挪、不能改；表格内容只读展示（可收起），图显示缩略图
function LockedView({ node }: { node: { attrs: Record<string, unknown> } }) {
  const { previews, workupHref } = useContext(LockedContext);
  const preview = previews.find((p) => p.index === Number(node.attrs.index));
  const [open, setOpen] = useState(true);
  const label = String(node.attrs.label);
  return (
    <NodeViewWrapper
      data-locked=""
      contentEditable={false}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        margin: '8px 0',
        padding: '8px 12px',
        borderRadius: 4,
        background: gy.neutralBg,
        color: gy.secondary,
        fontSize: 14,
        lineHeight: '22px',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <LockOutlined aria-hidden />
        <span style={{ color: gy.text }}>{label}</span>
        {preview?.kind === 'table' && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ ...linkButton, fontSize: 14, color: gy.secondary }}>
            {open ? '收起表格' : '展开表格'}
          </button>
        )}
        <span style={{ marginLeft: 'auto' }}>来自资料核对，正文里不能改</span>
        {workupHref && (
          <Link to={workupHref} style={{ color: gy.primary }}>
            去资料核对修改
          </Link>
        )}
      </div>
      {preview?.kind === 'table' && open && (
        <div style={{ overflowX: 'auto', background: gy.surface }}>
          <table aria-label={`${label}（只读）`} style={{ borderCollapse: 'collapse', width: '100%', color: gy.text, fontSize: 14, lineHeight: '22px' }}>
            <thead>
              {preview.header.map((r, i) => (
                <tr key={i} style={{ background: gy.canvas }}>
                  {r.map((c, j) => (
                    <th key={j} style={{ ...cell, fontWeight: 500 }}>
                      {c}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {preview.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} style={cell}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview?.kind === 'figure' && (
        <img src={preview.src} alt={label} style={{ maxWidth: 240, maxHeight: 160, objectFit: 'contain', alignSelf: 'flex-start', background: gy.surface, border: `1px solid ${gy.split}` }} />
      )}
    </NodeViewWrapper>
  );
}

const Locked = Node.create({
  name: 'locked',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { index: { default: 0 }, label: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-locked]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-locked': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(LockedView);
  },
});

const lockedIndices = (doc: { descendants: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void) => void }) => {
  const out: number[] = [];
  doc.descendants((n) => {
    if (n.type.name === 'locked') out.push(Number(n.attrs.index));
  });
  return out;
};

// 拦下会删掉或挪动表格、图的改动
const KeepLocked = Extension.create({
  name: 'keepLocked',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (tr, state) => !tr.docChanged || lockedOrder(lockedIndices(state.doc), lockedIndices(tr.doc)),
      }),
    ];
  },
});

// 段落保留生成稿里的对齐方式
const AlignedParagraph = Paragraph.extend({
  addAttributes() {
    return {
      align: {
        default: null,
        renderHTML: (attrs: Record<string, unknown>) => (attrs.align ? { style: `text-align:${String(attrs.align)}` } : {}),
      },
    };
  },
});

const extensions = [
  StarterKit.configure({
    paragraph: false,
    heading: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    italic: false,
    strike: false,
    underline: false,
    link: false,
  }),
  AlignedParagraph,
  Locked,
  KeepLocked,
];

// 每一节（以及放弃修改、换成最新稿时）重新挂一个编辑器，内容在创建时给定。外框由页面画（E18-03 的蓝框）
export function EditorPane({
  initial,
  editable,
  onChange,
  editorRef,
  label,
  extra,
  children,
}: {
  initial: EditBlock[];
  editable: boolean;
  onChange: (blocks: EditBlock[]) => void;
  editorRef: React.RefObject<Editor | null>;
  /** 工具栏上「正在修改 …」 */
  label: string;
  /** 工具栏最右边（「帮我改写这段」） */
  extra?: React.ReactNode;
  /** 编辑区里正文上面（节标题） */
  children?: React.ReactNode;
}) {
  const editor = useEditor({
    extensions,
    editable,
    content: blocksToDoc(initial),
    editorProps: { attributes: { 'aria-label': '本节正文', 'aria-multiline': 'true', role: 'textbox', class: 'gy-section-editor' } },
    onUpdate: ({ editor: e }) => onChange(docToBlocks(e.getJSON() as PmNode)),
  });
  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor, editorRef]);
  return (
    <>
      <Toolbar editor={editor} label={label} extra={extra} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px' }}>
        {children}
        <EditorContent editor={editor} />
      </div>
    </>
  );
}

/** 光标所在的那一段文字（「帮我改写这段」用） */
export function currentParagraph(editor: Editor): { from: number; to: number; text: string } | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'paragraph') {
      return { from: $from.before(d) + 1, to: $from.after(d) - 1, text: node.textBetween(0, node.content.size, '\n') };
    }
  }
  return null;
}

export function replaceParagraph(editor: Editor, at: { from: number; to: number }, text: string) {
  const content = text.split('\n').flatMap((part, i) => [
    ...(i > 0 ? [{ type: 'hardBreak' }] : []),
    ...(part ? [{ type: 'text', text: part }] : []),
  ]);
  editor.chain().focus().insertContentAt({ from: at.from, to: at.to }, content).run();
}

const tool: CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'none',
  cursor: 'pointer',
  color: gy.secondary,
};

const sep = <span aria-hidden style={{ width: 1, height: 16, background: gy.split, margin: '0 4px' }} />;

// 14px 线条图标：撤销、重做是弯箭头（旧的圆箭头看着像刷新）
const icon = (d: string) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ICONS = {
  undo: icon('M6 3 2.5 6.5 6 10M2.5 6.5H10a3.5 3.5 0 0 1 0 7H8'),
  redo: icon('M10 3l3.5 3.5L10 10M13.5 6.5H6a3.5 3.5 0 0 0 0 7h2'),
  ordered: icon('M7 4h7M7 8h7M7 12h7M2.5 3h1v3M2.2 9.2c.3-.4 1.6-.5 1.6.4 0 .6-1.6 1.4-1.6 2.4h1.8'),
  bullet: icon('M7 4h7M7 8h7M7 12h7M3 4h.01M3 8h.01M3 12h.01'),
};

// 工具栏（E18-03）：撤销、重做 | 加粗 | 编号列表、圆点列表；右边「正在修改 …」和「帮我改写这段」。
// 文档格式只支持加粗，所以没有斜体、下划线、表格
export function Toolbar({ editor, label, extra }: { editor: Editor; label: string; extra?: React.ReactNode }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      list: e.isActive('orderedList'),
      bullet: e.isActive('bulletList'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      editable: e.isEditable,
    }),
  });
  const off = !state.editable;
  const style = (active: boolean, disabled = off): CSSProperties =>
    disabled ? { ...tool, color: gy.controlLine, cursor: 'not-allowed' } : active ? { ...tool, background: gy.selected, color: gy.primary } : tool;
  const button = (name: string, content: React.ReactNode, run: () => void, opts: { active?: boolean; disabled?: boolean; pressed?: boolean } = {}) => (
    <button
      type="button"
      aria-label={name}
      title={name}
      aria-pressed={opts.pressed}
      disabled={opts.disabled ?? off}
      style={style(opts.active ?? false, opts.disabled ?? off)}
      onClick={run}
    >
      {content}
    </button>
  );
  return (
    <div
      role="toolbar"
      aria-label="正文格式"
      style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 8px', borderBottom: `1px solid ${gy.split}` }}
    >
      {button('撤销', ICONS.undo, () => editor.chain().focus().undo().run(), { disabled: off || !state.canUndo })}
      {button('重做', ICONS.redo, () => editor.chain().focus().redo().run(), { disabled: off || !state.canRedo })}
      {sep}
      {button('加粗', <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600 }}>B</span>, () => editor.chain().focus().toggleBold().run(), {
        active: state.bold,
        pressed: state.bold,
      })}
      {sep}
      {button('编号列表', ICONS.ordered, () => editor.chain().focus().toggleOrderedList().run(), { active: state.list, pressed: state.list })}
      {button('圆点列表', ICONS.bullet, () => editor.chain().focus().toggleBulletList().run(), { active: state.bullet, pressed: state.bullet })}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, lineHeight: '20px', color: gy.tertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        正在修改 {label}
      </span>
      {extra}
    </div>
  );
}
