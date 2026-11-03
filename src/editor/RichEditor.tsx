import { useEffect, useRef, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import {
  Bold, CheckSquare, Code, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered,
  ListTodo, Minus, Paperclip, Quote, Redo2, Strikethrough, Table as TableIcon, Underline as UnderlineIcon, Undo2,
  Columns3, Rows3, Trash2, Pilcrow
} from 'lucide-react';
import { blobToDataUrl, downscaleImage } from '../lib/images';
import { pickFiles } from '../components/FileSave';
import { MenuButton, promptDialog, toastError } from '../components/ui';

export interface RichEditorProps {
  initial: JSONContent;
  placeholder?: string;
  onChange: (doc: JSONContent, text: string) => void;
  onAttach?: () => void;
  onCreateTask?: (text: string) => void;
  autoFocus?: boolean;
}

async function insertImages(editor: Editor, files: File[]) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const small = await downscaleImage(f, 1800);
      const src = await blobToDataUrl(small);
      editor.chain().focus().setImage({ src, alt: f.name }).run();
    } catch (e) {
      toastError(e, 'Bild konnte nicht eingefügt werden');
    }
  }
}

export function RichEditor({ initial, placeholder, onChange, onAttach, onCreateTask, autoFocus }: RichEditorProps) {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Highlight,
      Link.configure({ openOnClick: true, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: placeholder ?? 'Schreiben Sie los …' })
    ],
    content: initial,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { spellcheck: 'true', autocapitalize: 'sentences' },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length && editorRef.current) {
          insertImages(editorRef.current, files);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length && editorRef.current) {
          event.preventDefault();
          insertImages(editorRef.current, files);
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor }) => changeRef.current(editor.getJSON(), editor.getText({ blockSeparator: '\n' }))
  });
  editorRef.current = editor;

  useEffect(() => () => editor?.destroy(), [editor]);

  if (!editor) return null;
  return (
    <>
      <Toolbar editor={editor} onAttach={onAttach} onCreateTask={onCreateTask} />
      <EditorContent editor={editor} />
    </>
  );
}

function B({ on, active, title, children, disabled }: { on: () => void; active?: boolean; title: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={'icon-btn' + (active ? ' active' : '')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, onAttach, onCreateTask }: { editor: Editor; onAttach?: () => void; onCreateTask?: (t: string) => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      hasSelection: !e.state.selection.empty
    })
  });
  const c = () => editor.chain().focus();

  const setLink = async () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = await promptDialog({ title: 'Link einfügen', label: 'Adresse (URL)', value: prev ?? 'https://', confirmLabel: 'Übernehmen' });
    if (url === null) return;
    if (!url || url === 'https://') c().extendMarkRange('link').unsetLink().run();
    else {
      const href = /^[a-z]+:/i.test(url) ? url : 'https://' + url;
      if (editor.state.selection.empty && !prev) c().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href } }] }).run();
      else c().extendMarkRange('link').setLink({ href }).run();
    }
  };

  const taskFromSelection = () => {
    const { from, to, empty } = editor.state.selection;
    let text = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    if (!text) {
      // Aktuellen Absatz verwenden
      const $from = editor.state.selection.$from;
      text = $from.parent.textContent;
    }
    onCreateTask?.(text.trim());
  };

  return (
    <div className="rt-toolbar no-print" role="toolbar" aria-label="Formatierung">
      <B on={() => c().undo().run()} title="Rückgängig" disabled={!s.canUndo}><Undo2 size={18} /></B>
      <B on={() => c().redo().run()} title="Wiederholen" disabled={!s.canRedo}><Redo2 size={18} /></B>
      <span className="sep" />
      <B on={() => c().setParagraph().run()} title="Fließtext" active={!s.h1 && !s.h2 && !s.h3 && !s.code}><Pilcrow size={18} /></B>
      <B on={() => c().toggleHeading({ level: 1 }).run()} title="Überschrift 1" active={s.h1}><Heading1 size={19} /></B>
      <B on={() => c().toggleHeading({ level: 2 }).run()} title="Überschrift 2" active={s.h2}><Heading2 size={19} /></B>
      <B on={() => c().toggleHeading({ level: 3 }).run()} title="Überschrift 3" active={s.h3}><Heading3 size={19} /></B>
      <span className="sep" />
      <B on={() => c().toggleBold().run()} title="Fett" active={s.bold}><Bold size={18} /></B>
      <B on={() => c().toggleItalic().run()} title="Kursiv" active={s.italic}><Italic size={18} /></B>
      <B on={() => c().toggleUnderline().run()} title="Unterstrichen" active={s.underline}><UnderlineIcon size={18} /></B>
      <B on={() => c().toggleStrike().run()} title="Durchgestrichen" active={s.strike}><Strikethrough size={18} /></B>
      <B on={() => c().toggleHighlight().run()} title="Markieren" active={s.highlight}><Highlighter size={18} /></B>
      <span className="sep" />
      <B on={() => c().toggleBulletList().run()} title="Aufzählung" active={s.bullet}><List size={19} /></B>
      <B on={() => c().toggleOrderedList().run()} title="Nummerierte Liste" active={s.ordered}><ListOrdered size={19} /></B>
      <B on={() => c().toggleTaskList().run()} title="Checkliste" active={s.task}><ListTodo size={19} /></B>
      <B on={() => c().toggleBlockquote().run()} title="Zitat" active={s.quote}><Quote size={18} /></B>
      <B on={() => c().toggleCodeBlock().run()} title="Code" active={s.code}><Code size={18} /></B>
      <B on={() => c().setHorizontalRule().run()} title="Trennlinie"><Minus size={18} /></B>
      <span className="sep" />
      <B on={setLink} title="Link" active={s.link}><Link2 size={18} /></B>
      {s.table ? (
        <MenuButton
          className="icon-btn active"
          title="Tabelle bearbeiten"
          items={[
            { label: 'Zeile darunter einfügen', icon: <Rows3 size={17} />, onClick: () => c().addRowAfter().run() },
            { label: 'Zeile darüber einfügen', icon: <Rows3 size={17} />, onClick: () => c().addRowBefore().run() },
            { label: 'Spalte rechts einfügen', icon: <Columns3 size={17} />, onClick: () => c().addColumnAfter().run() },
            { label: 'Spalte links einfügen', icon: <Columns3 size={17} />, onClick: () => c().addColumnBefore().run() },
            'sep',
            { label: 'Kopfzeile umschalten', icon: <TableIcon size={17} />, onClick: () => c().toggleHeaderRow().run() },
            'sep',
            { label: 'Zeile löschen', icon: <Trash2 size={17} />, onClick: () => c().deleteRow().run(), danger: true },
            { label: 'Spalte löschen', icon: <Trash2 size={17} />, onClick: () => c().deleteColumn().run(), danger: true },
            { label: 'Tabelle löschen', icon: <Trash2 size={17} />, onClick: () => c().deleteTable().run(), danger: true }
          ]}
        >
          <TableIcon size={18} />
        </MenuButton>
      ) : (
        <B on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Tabelle einfügen"><TableIcon size={18} /></B>
      )}
      <B
        on={async () => {
          const files = await pickFiles('image/*', true);
          if (files.length) insertImages(editor, files);
        }}
        title="Bild einfügen"
      >
        <ImagePlus size={18} />
      </B>
      {onAttach && <B on={onAttach} title="Datei anhängen"><Paperclip size={18} /></B>}
      {onCreateTask && (
        <>
          <span className="sep" />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={taskFromSelection}
            title="Markierten Text bzw. aktuelle Zeile als Aufgabe übernehmen"
          >
            <CheckSquare size={17} /> Als Aufgabe
          </button>
        </>
      )}
    </div>
  );
}
