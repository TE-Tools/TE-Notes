import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { JSONContent } from '@tiptap/react';
import {
  Archive, ArchiveRestore, Check, ChevronLeft, Copy, FileDown, FileText, Image as ImageIcon, Loader2, MoreHorizontal, Paperclip,
  Pin, PinOff, Plus, Printer, RotateCcw, SlidersHorizontal, Trash2, X, Package
} from 'lucide-react';
import { db } from '../db/db';
import {
  addAttachment, archiveNote, createTask, deleteAttachment, deleteNotePermanently, duplicateNote, restoreNote, saveNoteBody,
  setPinned, trashNote, updateNote
} from '../db/repo';
import type { MeetingInfo, Note, NoteBody, Task } from '../db/types';
import { NOTE_TYPE_LABEL } from '../db/types';
import { useLookups, type Lookups } from '../lib/hooks';
import { debounce, fmtBytes, fmtDateTime, safeFileName, todayISO } from '../lib/util';
import { markDirty, registerFlusher, track, useSaveState } from '../lib/saver';
import { RichEditor } from '../editor/RichEditor';
import { InkEditor, loadInkPages } from '../ink/InkEditor';
import { confirmDialog, Empty, MenuButton, Modal, TagInput, toast, toastError } from '../components/ui';
import { TaskModal, TaskRow } from '../components/TaskItems';
import { pickFiles, saveFile } from '../components/FileSave';
import { SidebarToggle } from '../components/Layout';
import { backupFileName, exportNotes } from '../lib/backup';

export default function NoteEditorPage() {
  const { id = '' } = useParams();
  const note = useLiveQuery(() => db.notes.get(id), [id]);
  // Inhalt nur einmal laden – der Editor hält danach den aktuellen Stand
  const [body, setBody] = useState<NoteBody | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setBody(undefined);
    db.bodies.get(id).then((b) => alive && setBody(b ?? null));
    return () => {
      alive = false;
    };
  }, [id]);
  if (note === undefined || (note && note.type !== 'ink' && body === undefined)) {
    return <div className="page"><div className="muted">Lade …</div></div>;
  }
  if (!note) {
    return (
      <div className="page">
        <Empty icon={<FileText size={34} />} title="Notiz nicht gefunden">Sie wurde möglicherweise endgültig gelöscht.</Empty>
      </div>
    );
  }
  return <Editor key={note.id} note={note} initialDoc={body?.doc ?? null} />;
}

const openNotes = new Set<string>();

async function discardIfEmpty(id: string) {
  const n = await db.notes.get(id);
  if (!n || n.title.trim() || n.tags.length || n.pinned || n.archived || n.deletedAt || n.type === 'meeting') return;
  if (Date.now() - n.createdAt > 6 * 3600_000) return; // nur frisch angelegte
  if (await db.attachments.where('noteId').equals(id).count()) return;
  if (await db.tasks.where('noteId').equals(id).count()) return;
  if (n.type === 'text') {
    const b = await db.bodies.get(id);
    if (b?.text.trim() || JSON.stringify(b?.doc ?? {}).includes('"image"')) return;
  } else if (n.type === 'ink') {
    const pages = await db.inkPages.where('noteId').equals(id).toArray();
    if (pages.length > 1 || pages.some((p) => p.strokes.length || p.images.length || p.bgAttachmentId)) return;
  }
  await deleteNotePermanently(id);
}

function SaveIndicator() {
  const s = useSaveState();
  const busy = s.pending > 0 || s.dirty > 0;
  if (s.error) return <span className="save-state" style={{ color: 'var(--danger)' }}>Nicht gespeichert</span>;
  return (
    <span className={'save-state' + (busy ? ' saving' : '')} aria-live="polite">
      {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
      <span className="hide-mobile">{busy ? 'Speichert …' : 'Gespeichert'}</span>
    </span>
  );
}

function Editor({ note, initialDoc }: { note: Note; initialDoc: JSONContent | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const lookups = useLookups();
  const fresh = (location.state as { fresh?: boolean } | null)?.fresh;
  const [title, setTitle] = useState(note.title);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [taskModal, setTaskModal] = useState<Task | Partial<Task> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const readOnly = note.deletedAt > 0;
  const meetingState = useMeetingState(note);

  // Titel automatisch speichern
  const saveTitle = useMemo(
    () =>
      debounce((t: string) => {
        markDirty(-1);
        void track(updateNote(note.id, { title: t })).catch(() => {});
      }, 400),
    [note.id]
  );
  // Inhalt automatisch speichern
  const saveBody = useMemo(
    () =>
      debounce((doc: JSONContent, text: string) => {
        markDirty(-1);
        void track(saveNoteBody(note.id, doc, text)).catch(() => {});
      }, 600),
    [note.id]
  );
  // Titel übernehmen, wenn er außerhalb des Eingabefelds geändert wurde (z. B. durch PDF-Import oder Import)
  useEffect(() => {
    if (saveTitle.pending()) return;
    const active = document.activeElement;
    if (active && (active === titleRef.current || active.classList.contains('ink-title'))) return;
    setTitle(note.title);
  }, [note.title, saveTitle]);

  useEffect(() => {
    const off1 = registerFlusher(() => saveTitle.flush());
    const off2 = registerFlusher(() => saveBody.flush());
    return () => {
      off1();
      off2();
      saveTitle.flush();
      saveBody.flush();
    };
  }, [saveTitle, saveBody]);

  // Leere, unberührte Notizen beim Verlassen verwerfen (keine Karteileichen durch versehentliches Anlegen)
  useEffect(() => {
    const id = note.id;
    openNotes.add(id);
    return () => {
      openNotes.delete(id);
      setTimeout(() => {
        if (!openNotes.has(id)) void discardIfEmpty(id);
      }, 700);
    };
  }, [note.id]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [title]);

  useEffect(() => {
    if (fresh && note.type !== 'ink') titleRef.current?.focus();
  }, [fresh, note.type]);

  const onTitle = (t: string) => {
    setTitle(t);
    if (!saveTitle.pending()) markDirty(1);
    saveTitle(t);
  };
  const onBody = (doc: JSONContent, text: string) => {
    if (!saveBody.pending()) markDirty(1);
    saveBody(doc, text);
  };

  const tasks = useLiveQuery(() => db.tasks.where('noteId').equals(note.id).filter((t) => !t.deletedAt).toArray(), [note.id]) ?? [];

  const goBack = () => {
    if (window.history.length > 1 && location.key !== 'default') navigate(-1);
    else navigate(note.type === 'meeting' ? '/meetings' : note.type === 'ink' ? '/ink' : '/notes');
  };

  const exp = useExport(note, lookups);

  const menu = [
    { label: note.pinned ? 'Nicht mehr anheften' : 'Anheften', icon: note.pinned ? <PinOff size={17} /> : <Pin size={17} />, onClick: () => setPinned(note.id, !note.pinned), hidden: readOnly || note.archived === 1 },
    {
      label: note.archived ? 'Aus Archiv holen' : 'Archivieren',
      icon: note.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />,
      hidden: readOnly,
      onClick: async () => {
        await archiveNote(note.id, !note.archived);
        toast(note.archived ? 'Aus dem Archiv geholt' : 'Archiviert', { action: { label: 'Rückgängig', run: () => archiveNote(note.id, !!note.archived) } });
      }
    },
    { label: 'Details & Zuordnung', icon: <SlidersHorizontal size={17} />, onClick: () => setDetailsOpen(true), hidden: note.type !== 'ink' },
    {
      label: 'Duplizieren', icon: <Copy size={17} />, hidden: readOnly,
      onClick: async () => {
        saveBody.flush();
        const nid = await duplicateNote(note.id);
        if (nid) navigate(`/note/${nid}`);
      }
    },
    'sep' as const,
    ...(note.type === 'ink'
      ? [
          { label: 'Als PDF exportieren', icon: <FileDown size={17} />, onClick: exp.inkPdf },
          { label: 'Als Bild exportieren (PNG)', icon: <ImageIcon size={17} />, onClick: exp.inkImage }
        ]
      : [
          { label: 'Als PDF exportieren', icon: <FileDown size={17} />, onClick: () => { saveBody.flush(); void exp.pdf(); } },
          { label: 'Als Markdown exportieren', icon: <FileText size={17} />, onClick: () => { saveBody.flush(); void exp.markdown(); } },
          { label: 'Drucken', icon: <Printer size={17} />, onClick: () => window.print() }
        ]),
    { label: 'Als TE-Notes-Datei exportieren', icon: <Package size={17} />, onClick: () => { saveBody.flush(); void exp.tenotes(); } },
    'sep' as const,
    ...(readOnly
      ? [
          { label: 'Wiederherstellen', icon: <RotateCcw size={17} />, onClick: () => restoreNote(note.id) },
          {
            label: 'Endgültig löschen', icon: <Trash2 size={17} />, danger: true,
            onClick: async () => {
              if (await confirmDialog({ title: 'Endgültig löschen?', text: 'Diese Notiz wird mit allen Inhalten unwiderruflich gelöscht.', confirmLabel: 'Endgültig löschen', danger: true })) {
                await deleteNotePermanently(note.id);
                navigate('/trash');
              }
            }
          }
        ]
      : [
          {
            label: 'In den Papierkorb', icon: <Trash2 size={17} />, danger: true,
            onClick: async () => {
              saveBody.flush();
              saveTitle.flush();
              await trashNote(note.id);
              toast('In den Papierkorb verschoben', { action: { label: 'Rückgängig', run: () => restoreNote(note.id) } });
              goBack();
            }
          }
        ])
  ];

  const topBar = (
    <div className="editor-top no-print">
      <button className="icon-btn" onClick={goBack} aria-label="Zurück" title="Zurück">
        <ChevronLeft size={24} />
      </button>
      <SidebarToggle />
      {note.type === 'ink' ? (
        <input
          className="ink-title"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="Titel der Handschrift"
          aria-label="Titel"
          readOnly={readOnly}
        />
      ) : (
        <span className="small muted hide-mobile" style={{ marginLeft: 6 }}>
          {NOTE_TYPE_LABEL[note.type]}
          {note.archived ? ' · Archiviert' : ''}
          {readOnly ? ' · Im Papierkorb' : ''}
        </span>
      )}
      <span className="spacer" />
      <SaveIndicator />
      {!readOnly && (
        <button className={'icon-btn' + (note.pinned ? ' active' : '')} onClick={() => setPinned(note.id, !note.pinned)} title={note.pinned ? 'Angeheftet' : 'Anheften'} aria-label="Anheften">
          <Pin size={19} fill={note.pinned ? 'currentColor' : 'none'} />
        </button>
      )}
      <MenuButton items={menu} title="Weitere Aktionen">
        <MoreHorizontal size={22} />
      </MenuButton>
    </div>
  );

  if (note.type === 'ink') {
    return (
      <div className="editor-page">
        {topBar}
        {readOnly ? (
          <div className="banner info" style={{ margin: 16 }}>
            <Trash2 size={20} />
            <div className="banner-text">Diese Notiz liegt im Papierkorb. Zum Bearbeiten bitte wiederherstellen.</div>
            <button className="btn btn-sm" onClick={() => restoreNote(note.id)}>Wiederherstellen</button>
          </div>
        ) : (
          <InkEditor note={note} />
        )}
        {detailsOpen && (
          <Modal title="Details & Zuordnung" onClose={() => setDetailsOpen(false)}>
            <MetaBar note={note} lookups={lookups} vertical />
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div className="editor-page">
      {topBar}
      <div className="editor-scroll">
        <div className="editor-inner">
          {readOnly && (
            <div className="banner info">
              <Trash2 size={20} />
              <div className="banner-text">Diese Notiz liegt im Papierkorb.</div>
              <button className="btn btn-sm" onClick={() => restoreNote(note.id)}>Wiederherstellen</button>
            </div>
          )}
          <textarea
            ref={titleRef}
            className="title-input"
            rows={1}
            value={title}
            placeholder={note.type === 'meeting' ? 'Titel der Besprechung' : 'Titel'}
            onChange={(e) => onTitle(e.target.value.replace(/\n/g, ' '))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (document.querySelector('.ProseMirror') as HTMLElement | null)?.focus();
              }
            }}
            readOnly={readOnly}
            aria-label="Titel"
          />
          <MetaBar note={note} lookups={lookups} />
          {note.type === 'meeting' && note.meeting && <MeetingHeader state={meetingState} />}
          {note.type === 'meeting' && (
            <div className="meeting-section" style={{ marginTop: 18 }}>
              <h3>Gesprächsnotizen</h3>
            </div>
          )}
          <div style={readOnly ? { pointerEvents: 'none', opacity: 0.85 } : undefined}>
            <RichEditor
              initial={initialDoc ?? { type: 'doc', content: [{ type: 'paragraph' }] }}
              onChange={onBody}
              placeholder={note.type === 'meeting' ? 'Notizen zum Gesprächsverlauf …' : 'Schreiben Sie los …'}
              onAttach={async () => {
                const files = await pickFiles('*/*', true);
                for (const f of files) {
                  if (f.size > 100 * 1024 * 1024) {
                    toast(`„${f.name}“ ist größer als 100 MB und wurde nicht angehängt.`, { kind: 'error' });
                    continue;
                  }
                  await track(addAttachment(note.id, f, f.name));
                }
                if (files.length) toast(files.length === 1 ? 'Datei angehängt' : `${files.length} Dateien angehängt`);
              }}
              onCreateTask={(text) => setTaskModal({ title: text, noteId: note.id, projectId: note.projectId, categoryId: note.categoryId })}
            />
          </div>
          {note.type === 'meeting' && note.meeting && <MeetingFooter note={note} state={meetingState} tasks={tasks} onOpenTask={setTaskModal} />}
          {note.type === 'text' && tasks.length > 0 && (
            <div className="meeting-section">
              <h3>Aufgaben aus dieser Notiz</h3>
              <div className="list">
                {tasks.map((t) => (
                  <TaskRow key={t.id} t={t} showNote={false} onOpen={setTaskModal} />
                ))}
              </div>
            </div>
          )}
          <Attachments noteId={note.id} />
          <div className="small muted" style={{ marginTop: 28 }}>
            Erstellt {fmtDateTime(note.createdAt)} · Zuletzt geändert {fmtDateTime(note.updatedAt)}
          </div>
        </div>
      </div>
      {taskModal && (
        <TaskModal
          task={'id' in taskModal && taskModal.id ? (taskModal as Task) : undefined}
          defaults={!('id' in taskModal) || !taskModal.id ? taskModal : undefined}
          onClose={() => setTaskModal(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metadaten: Kategorie, Projekt, Ordner, Tags                         */
/* ------------------------------------------------------------------ */

function MetaBar({ note, lookups, vertical }: { note: Note; lookups: Lookups; vertical?: boolean }) {
  const allTags = useLiveQuery(async () => (await db.notes.orderBy('tags').uniqueKeys()) as string[], []) ?? [];
  const set = (patch: Partial<Note>) => void track(updateNote(note.id, patch));
  const proj = note.projectId ? lookups.projectMap.get(note.projectId) : undefined;
  const cat = note.categoryId ? lookups.categoryMap.get(note.categoryId) : undefined;

  if (vertical) {
    return (
      <>
        <div className="field">
          <label>Projekt</label>
          <select className="select" value={note.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })}>
            <option value="">Kein Projekt</option>
            {lookups.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Kategorie</label>
          <select className="select" value={note.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || null })}>
            <option value="">Keine Kategorie</option>
            {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Ordner</label>
          <select className="select" value={note.folderId ?? ''} onChange={(e) => set({ folderId: e.target.value || null })}>
            <option value="">Kein Ordner</option>
            {lookups.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tags</label>
          <TagInput value={note.tags} onChange={(tags) => set({ tags })} placeholder="Tag eingeben, Enter" suggestions={allTags} />
        </div>
        <div className="small muted">Erstellt {fmtDateTime(note.createdAt)} · Geändert {fmtDateTime(note.updatedAt)}</div>
      </>
    );
  }

  return (
    <div className="meta-bar no-print">
      <label className="meta-pill">
        {proj ? <span className="nav-dot" style={{ background: proj.color, margin: 0 }} /> : <span className="muted">Projekt</span>}
        <select value={note.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })} aria-label="Projekt">
          <option value="">{proj ? 'Kein Projekt' : '–'}</option>
          {lookups.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="meta-pill">
        {cat ? <span className="nav-dot" style={{ background: cat.color, margin: 0 }} /> : <span className="muted">Kategorie</span>}
        <select value={note.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || null })} aria-label="Kategorie">
          <option value="">{cat ? 'Keine Kategorie' : '–'}</option>
          {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {lookups.folders.length > 0 && (
        <label className="meta-pill">
          <span className="muted">Ordner</span>
          <select value={note.folderId ?? ''} onChange={(e) => set({ folderId: e.target.value || null })} aria-label="Ordner">
            <option value="">–</option>
            {lookups.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      )}
      <div style={{ flex: '1 1 220px', minWidth: 200 }}>
        <TagInput value={note.tags} onChange={(tags) => set({ tags })} placeholder="+ Tags" suggestions={allTags} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Besprechung                                                         */
/* ------------------------------------------------------------------ */

const EMPTY_MEETING: MeetingInfo = { date: '', participants: [], topic: '', location: '', decisions: [], followUpDate: null };
type MeetingState = readonly [MeetingInfo, (patch: Partial<MeetingInfo>) => void];

function useMeetingState(note: Note): MeetingState {
  const [m, setM] = useState<MeetingInfo>(note.meeting ?? EMPTY_MEETING);
  const save = useMemo(
    () =>
      debounce((next: MeetingInfo) => {
        markDirty(-1);
        void track(updateNote(note.id, { meeting: next })).catch(() => {});
      }, 450),
    [note.id]
  );
  useEffect(() => {
    const off = registerFlusher(() => save.flush());
    return () => {
      off();
      save.flush();
    };
  }, [save]);
  const update = (patch: Partial<MeetingInfo>) => {
    setM((prev) => {
      const next = { ...prev, ...patch };
      if (!save.pending()) markDirty(1);
      save(next);
      return next;
    });
  };
  return [m, update] as const;
}

function MeetingHeader({ state }: { state: MeetingState }) {
  const [m, update] = state;
  const participantsSuggest = useLiveQuery(async () => {
    const ms = await db.notes.where('type').equals('meeting').limit(200).toArray();
    return [...new Set(ms.flatMap((x) => x.meeting?.participants ?? []))].sort((a, b) => a.localeCompare(b, 'de'));
  }, []) ?? [];
  return (
    <div className="meeting-grid">
      <div className="field">
        <label htmlFor="m-date">Datum und Uhrzeit</label>
        <input id="m-date" type="datetime-local" className="input" value={m.date} onChange={(e) => update({ date: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="m-loc">Ort / Format</label>
        <input id="m-loc" className="input" value={m.location} onChange={(e) => update({ location: e.target.value })} placeholder="z. B. Raum 2.04, Teams" />
      </div>
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label htmlFor="m-topic">Thema</label>
        <input id="m-topic" className="input" value={m.topic} onChange={(e) => update({ topic: e.target.value })} placeholder="Worum geht es?" />
      </div>
      <div className="field">
        <label>Teilnehmer</label>
        <TagInput value={m.participants} onChange={(participants) => update({ participants })} placeholder="Name eingeben, Enter" suggestions={participantsSuggest} />
      </div>
      <div className="field">
        <label htmlFor="m-follow">Wiedervorlage</label>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
          <input id="m-follow" type="date" className="input" value={m.followUpDate ?? ''} onChange={(e) => update({ followUpDate: e.target.value || null })} />
          {m.followUpDate && (
            <button className="icon-btn sm" onClick={() => update({ followUpDate: null })} aria-label="Wiedervorlage entfernen">
              <X size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MeetingFooter({ note, state, tasks, onOpenTask }: { note: Note; state: MeetingState; tasks: Task[]; onOpenTask: (t: Task) => void }) {
  const [m, update] = state;
  const decisions = m.decisions.length ? m.decisions : [];
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');

  const addTask = async () => {
    if (!title.trim()) return;
    try {
      await createTask({
        title: title.trim(), assignee: assignee.trim(), dueDate: due || null, noteId: note.id, projectId: note.projectId, categoryId: note.categoryId
      });
      setTitle('');
      setAssignee('');
      setDue('');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <div className="meeting-section">
        <h3>Entscheidungen</h3>
        {decisions.map((d, i) => (
          <div className="decision" key={i}>
            <span className="decision-num">{i + 1}</span>
            <textarea
              rows={1}
              value={d}
              placeholder="Entscheidung festhalten …"
              onChange={(e) => {
                const next = [...decisions];
                next[i] = e.target.value;
                update({ decisions: next });
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const next = [...decisions];
                  next.splice(i + 1, 0, '');
                  update({ decisions: next });
                  setTimeout(() => (document.querySelectorAll('.decision textarea')[i + 1] as HTMLTextAreaElement | undefined)?.focus());
                }
              }}
            />
            <button className="icon-btn sm" onClick={() => update({ decisions: decisions.filter((_, j) => j !== i) })} aria-label="Entscheidung entfernen">
              <X size={16} />
            </button>
          </div>
        ))}
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => update({ decisions: [...decisions, ''] })}>
          <Plus size={16} /> Entscheidung hinzufügen
        </button>
      </div>

      <div className="meeting-section">
        <h3>Aufgaben & Verantwortlichkeiten</h3>
        {tasks.length > 0 && (
          <div className="list">
            {tasks.map((t) => (
              <TaskRow key={t.id} t={t} showNote={false} onOpen={onOpenTask} />
            ))}
          </div>
        )}
        <div className="inline-task-form">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Neue Aufgabe …" onKeyDown={(e) => e.key === 'Enter' && addTask()} />
          <input className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Verantwortlich" list="participants-list" onKeyDown={(e) => e.key === 'Enter' && addTask()} />
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fällig am" min={todayISO()} />
          <button className="btn btn-primary" onClick={addTask} disabled={!title.trim()}>
            <Plus size={18} /> Anlegen
          </button>
          <datalist id="participants-list">
            {m.participants.map((p) => <option key={p} value={p} />)}
          </datalist>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Tipp: Text in den Gesprächsnotizen markieren und „Als Aufgabe“ wählen.
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Anhänge                                                             */
/* ------------------------------------------------------------------ */

function Attachments({ noteId }: { noteId: string }) {
  const atts = useLiveQuery(() => db.attachments.where('noteId').equals(noteId).filter((a) => a.kind === 'file').toArray(), [noteId]);
  if (!atts?.length) return null;
  const isTouch = navigator.maxTouchPoints > 1;
  return (
    <div className="attachments">
      <div className="section-head">
        <h3 className="section-title" style={{ fontSize: 15 }}>
          <Paperclip size={16} /> Anhänge <span className="count">{atts.length}</span>
        </h3>
      </div>
      <div className="att-list">
        {atts.map((a) => (
          <div key={a.id} className="att">
            <FileText size={20} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <button
              className="att-name link-btn"
              style={{ textAlign: 'left', color: 'var(--text)', padding: 0 }}
              onClick={() => {
                if (!isTouch && /pdf|image|text/.test(a.mime)) {
                  const url = URL.createObjectURL(a.blob);
                  window.open(url, '_blank', 'noopener');
                  setTimeout(() => URL.revokeObjectURL(url), 120_000);
                } else void saveFile(a.blob, a.name, { title: 'Anhang öffnen oder sichern' });
              }}
              title={a.name}
            >
              {a.name}
            </button>
            <span className="att-size">{fmtBytes(a.size)}</span>
            <button
              className="icon-btn sm"
              aria-label="Anhang entfernen"
              onClick={async () => {
                if (await confirmDialog({ title: 'Anhang entfernen?', text: `„${a.name}“ wird aus der Notiz entfernt.`, confirmLabel: 'Entfernen', danger: true })) await deleteAttachment(a.id);
              }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function useExport(note: Note, lookups: Lookups) {
  const names = () => ({
    project: note.projectId ? lookups.projectMap.get(note.projectId)?.name : undefined,
    category: note.categoryId ? lookups.categoryMap.get(note.categoryId)?.name : undefined,
    folder: note.folderId ? lookups.folderMap.get(note.folderId)?.name : undefined
  });
  const base = safeFileName(note.title || 'Notiz');
  const load = async () => {
    // kurz warten, damit gerade entprellte Änderungen geschrieben sind
    await new Promise((r) => setTimeout(r, 120));
    const fresh = (await db.notes.get(note.id)) ?? note;
    const body = await db.bodies.get(note.id);
    const tasks = await db.tasks.where('noteId').equals(note.id).filter((t) => !t.deletedAt).toArray();
    return { fresh, doc: body?.doc ?? null, tasks };
  };
  const run = async (fn: () => Promise<void>) => {
    try {
      toast('Export wird vorbereitet …', { ms: 1800 });
      await fn();
    } catch (e) {
      toastError(e, 'Export fehlgeschlagen');
    }
  };
  return {
    markdown: () =>
      run(async () => {
        const { noteToMarkdown } = await import('../lib/markdown');
        const { fresh, doc, tasks } = await load();
        const md = noteToMarkdown(fresh, doc, tasks, names());
        await saveFile(new Blob([md], { type: 'text/markdown;charset=utf-8' }), base + '.md');
      }),
    pdf: () =>
      run(async () => {
        const { noteToPdf } = await import('../lib/pdf');
        const { fresh, doc, tasks } = await load();
        await saveFile(await noteToPdf(fresh, doc, tasks, names()), base + '.pdf');
      }),
    tenotes: () =>
      run(async () => {
        await new Promise((r) => setTimeout(r, 120));
        await saveFile(await exportNotes([note.id]), backupFileName('notes', note.title), {
          hint: 'Diese Datei enthält die Notiz mit allen Inhalten und Anhängen und kann auf einem anderen Gerät in TE Notes importiert werden.'
        });
      }),
    inkPdf: () =>
      run(async () => {
        const { exportInkPdf } = await import('../ink/inkExport');
        await new Promise((r) => setTimeout(r, 500));
        const pages = await loadInkPages(note.id);
        await saveFile(await exportInkPdf(note, pages), base + '.pdf');
      }),
    inkImage: () =>
      run(async () => {
        const { exportInkImages } = await import('../ink/inkExport');
        await new Promise((r) => setTimeout(r, 500));
        const pages = await loadInkPages(note.id);
        const { blob, ext } = await exportInkImages(note, pages);
        await saveFile(blob, `${base}.${ext}`);
      })
  };
}
