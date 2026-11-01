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

/** 锁定块要显示的表格内容、图的缩略图，以及去专业整理修改的入口 */
export const LockedContext = createContext<{ previews: LockedPreview[]; workupHref: string | null }>({ previews: [], workupHref: null });

const cell: CSSProperties = { padding: '4px 8px', border: `1px solid ${gy.split}`, textAlign: 'left', verticalAlign: 'top', fontWeight: 400 };

// 表格和图：来自专业整理，正文里不能删、不能挪、不能改；表格内容只读展示（可收起），图显示缩略图
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
        <span style={{ marginLeft: 'auto' }}>来自专业整理，正文里不能修改</span>
        {workupHref && (
          <Link to={workupHref} style={{ color: gy.primary }}>
            去专业整理修改
          </Link>
        )}
      </div>
      {preview?.kind === 'table' && open && (
        <div style={{ overflowX: 'auto', background: gy.surface }}>
          <table aria-label={`${label}（只读）`} style={{ borderCollapse: 'collapse', width: '100%', color: gy.text, fontSize: 13, lineHeight: '20px' }}>
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

// 每一节（以及放弃修改、换成最新稿时）重新挂一个编辑器，内容在创建时给定
export function EditorPane({
  initial,
  editable,
  dirty,
  onChange,
  editorRef,
  extra,
}: {
  initial: EditBlock[];
  editable: boolean;
  dirty: boolean;
  onChange: (blocks: EditBlock[]) => void;
  editorRef: React.RefObject<Editor | null>;
  extra?: React.ReactNode;
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
      <Toolbar editor={editor} extra={extra} />
      <div
        className="gy-editor-box"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '8px 16px',
          borderRadius: 6,
          border: `1px solid ${dirty ? gy.primary : gy.split}`,
          background: editable ? gy.surface : gy.canvas,
        }}
      >
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
  padding: '0 10px',
  border: 'none',
  borderRadius: 4,
  background: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '24px',
  color: gy.text,
  fontFamily: 'inherit',
};

// 工具栏：加粗、列表、撤销（E18-03）
export function Toolbar({ editor, extra }: { editor: Editor; extra?: React.ReactNode }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      list: e.isActive('orderedList'),
      bullet: e.isActive('bulletList'),
      canUndo: e.can().undo(),
      editable: e.isEditable,
    }),
  });
  const disabled = !state.editable;
  // 只读（运营查看、非负责专家）时格式按钮置灰
  const on = (active: boolean): CSSProperties =>
    disabled
      ? { ...tool, color: gy.tertiary, cursor: 'not-allowed' }
      : active
        ? { ...tool, background: gy.selected, color: gy.primary }
        : tool;
  return (
    <div
      role="toolbar"
      aria-label="正文格式"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '7px 8px',
        borderRadius: 4,
        border: `1px solid ${gy.split}`,
        background: gy.canvas,
      }}
    >
      <button
        type="button"
        aria-label="加粗"
        aria-pressed={state.bold}
        disabled={disabled}
        style={{ ...on(state.bold), fontWeight: 600 }}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </button>
      <button
        type="button"
        aria-pressed={state.list}
        disabled={disabled}
        style={on(state.list)}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        编号列表
      </button>
      <button
        type="button"
        aria-pressed={state.bullet}
        disabled={disabled}
        style={on(state.bullet)}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        圆点列表
      </button>
      <button
        type="button"
        disabled={disabled || !state.canUndo}
        style={{ ...tool, color: disabled || !state.canUndo ? gy.tertiary : gy.text, cursor: disabled || !state.canUndo ? 'not-allowed' : 'pointer' }}
        onClick={() => editor.chain().focus().undo().run()}
      >
        撤销
      </button>
      <span style={{ flex: 1 }} />
      {extra}
    </div>
  );
}

