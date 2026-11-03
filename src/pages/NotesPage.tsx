import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArchiveRestore, CheckSquare, FileText, LayoutGrid, List, PenLine, Plus, RotateCcw, Search, Trash2, Users } from 'lucide-react';
import { db } from '../db/db';
import {
  deleteNotePermanently, deleteTaskPermanently, emptyTrash, restoreNote, restoreTask
} from '../db/repo';
import type { Note, NoteType } from '../db/types';
import { useLookups } from '../lib/hooks';
import { fmtDateTime, fmtRelative, parseLocal } from '../lib/util';
import { search } from '../lib/search';
import { NoteCard, NoteRow, TypeIcon, useCreateNote } from '../components/NoteItems';
import { confirmDialog, Empty, toast, toastError } from '../components/ui';
import { SidebarToggle } from '../components/Layout';

export type NotesVariant = 'all' | 'ink' | 'meetings' | 'archive' | 'trash';

const META: Record<NotesVariant, { title: string; sub: string; icon: JSX.Element }> = {
  all: { title: 'Alle Notizen', sub: 'Text-, Handschrift- und Besprechungsnotizen', icon: <FileText size={34} /> },
  ink: { title: 'Handschriftliche Notizen', sub: 'Geschrieben mit Apple Pencil, Stift oder Maus', icon: <PenLine size={34} /> },
  meetings: { title: 'Besprechungen', sub: 'Protokolle in chronologischer Reihenfolge', icon: <Users size={34} /> },
  archive: { title: 'Archiv', sub: 'Abgelegte Notizen – jederzeit wiederherstellbar', icon: <Archive size={34} /> },
  trash: { title: 'Papierkorb', sub: 'Gelöschte Einträge – bis zum endgültigen Löschen wiederherstellbar', icon: <Trash2 size={34} /> }
};

type SortKey = 'updatedAt' | 'createdAt' | 'title';
const PAGE = 60;

function readView(): 'grid' | 'list' {
  try {
    return (localStorage.getItem('te-view') as 'grid' | 'list') || 'grid';
  } catch {
    return 'grid';
  }
}

export default function NotesPage({ variant }: { variant: NotesVariant }) {
  const lookups = useLookups();
  const create = useCreateNote();
  const meta = META[variant];
  const [view, setView] = useState<'grid' | 'list'>(readView);
  const [sort, setSort] = useState<SortKey>('updatedAt');
  const [projectId, setProjectId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [tag, setTag] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | NoteType>('');
  const [limit, setLimit] = useState(PAGE);
  // Besprechungen: Suche + Zeitraum
  const [mq, setMq] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const tags = useLiveQuery(async () => (await db.notes.orderBy('tags').uniqueKeys()) as string[], []) ?? [];

  const pred = useMemo(() => {
    return (n: Note) => {
      if (variant === 'trash') return n.deletedAt > 0;
      if (n.deletedAt) return false;
      if (variant === 'archive') {
        if (!n.archived) return false;
      } else if (n.archived) return false;
      if (variant === 'ink' && n.type !== 'ink') return false;
      if (variant === 'meetings' && n.type !== 'meeting') return false;
      if (typeFilter && n.type !== typeFilter) return false;
      if (projectId && n.projectId !== projectId) return false;
      if (categoryId && n.categoryId !== categoryId) return false;
      if (folderId && n.folderId !== folderId) return false;
      if (tag && !n.tags.includes(tag)) return false;
      return true;
    };
  }, [variant, typeFilter, projectId, categoryId, folderId, tag]);

  const data = useLiveQuery(async () => {
    if (variant === 'meetings' && (mq.trim() || from || to)) {
      const r = await search(mq, { type: 'meeting', from: from || undefined, to: to || undefined }, 1000);
      const notes = r.notes.filter(pred).sort((a, b) => (b.meeting?.date ?? '').localeCompare(a.meeting?.date ?? ''));
      return { notes: notes.slice(0, limit), more: notes.length > limit };
    }
    let coll;
    if (variant === 'trash') coll = db.notes.where('deletedAt').above(0).reverse();
    else if (variant === 'archive') coll = db.notes.orderBy('archivedAt').reverse();
    else if (variant === 'meetings') coll = db.notes.orderBy('meeting.date').reverse();
    else if (sort === 'title') coll = db.notes.toCollection();
    else coll = db.notes.orderBy(sort).reverse();
    if (sort === 'title' && variant !== 'trash' && variant !== 'archive' && variant !== 'meetings') {
      const all = (await coll.filter(pred).toArray()).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de'));
      return { notes: all.slice(0, limit), more: all.length > limit };
    }
    const notes = await coll.filter(pred).limit(limit + 1).toArray();
    return { notes: notes.slice(0, limit), more: notes.length > limit };
  }, [variant, sort, pred, limit, mq, from, to]);

  const trashedTasks = useLiveQuery(() => (variant === 'trash' ? db.tasks.where('deletedAt').above(0).reverse().sortBy('deletedAt') : []), [variant]);

  const notes = data?.notes;
  const isList = view === 'list' || variant === 'trash' || variant === 'meetings';
  const filtersActive = projectId || categoryId || folderId || tag || typeFilter;

  const setViewPersist = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('te-view', v);
    } catch {
      /* ignore */
    }
  };

  const newType: NoteType = variant === 'ink' ? 'ink' : variant === 'meetings' ? 'meeting' : 'text';

  // Besprechungen nach Monat gruppieren
  const groups = useMemo(() => {
    if (variant !== 'meetings' || !notes) return null;
    const fmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
    const map = new Map<string, Note[]>();
    for (const n of notes) {
      const k = n.meeting?.date ? fmt.format(parseLocal(n.meeting.date)) : 'Ohne Datum';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(n);
    }
    return [...map.entries()];
  }, [variant, notes]);

  const trashActions = (n: Note) => (
    <div className="row" style={{ gap: 4 }} onClick={(e) => e.preventDefault()}>
      <button
        className="icon-btn sm"
        title="Wiederherstellen"
        aria-label="Wiederherstellen"
        onClick={async (e) => {
          e.preventDefault();
          await restoreNote(n.id);
          toast('Wiederhergestellt');
        }}
      >
        <RotateCcw size={18} />
      </button>
      <button
        className="icon-btn sm"
        title="Endgültig löschen"
        aria-label="Endgültig löschen"
        style={{ color: 'var(--danger)' }}
        onClick={async (e) => {
          e.preventDefault();
          if (await confirmDialog({ title: 'Endgültig löschen?', text: `„${n.title || 'Ohne Titel'}“ wird mit allen Inhalten und Anhängen unwiderruflich gelöscht.`, confirmLabel: 'Endgültig löschen', danger: true }))
            await deleteNotePermanently(n.id);
        }}
      >
        <Trash2 size={18} />
      </button>
    </div>
  );

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div className="row" style={{ gap: 6 }}>
            <span className="show-mobile" style={{ marginLeft: -10 }}>
              <SidebarToggle />
            </span>
            <div>
              <h1 className="page-title">{meta.title}</h1>
              <p className="page-sub">{meta.sub}</p>
            </div>
          </div>
          <div className="row">
            {variant === 'trash' ? (
              <button
                className="btn btn-danger"
                disabled={!notes?.length && !trashedTasks?.length}
                onClick={async () => {
                  if (await confirmDialog({ title: 'Papierkorb leeren?', text: 'Alle Einträge im Papierkorb werden unwiderruflich gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.', confirmLabel: 'Endgültig löschen', danger: true })) {
                    try {
                      await emptyTrash();
                      toast('Papierkorb geleert');
                    } catch (e) {
                      toastError(e);
                    }
                  }
                }}
              >
                <Trash2 size={18} /> Papierkorb leeren
              </button>
            ) : variant !== 'archive' ? (
              <button className="btn btn-primary" onClick={() => create(newType)}>
                <Plus size={19} /> {newType === 'ink' ? 'Neue Handschrift' : newType === 'meeting' ? 'Neue Besprechung' : 'Neue Notiz'}
              </button>
            ) : null}
          </div>
        </div>

        {variant === 'meetings' && (
          <div className="filters">
            <div className="search-box" style={{ flex: '1 1 260px', margin: 0, padding: '0 12px' }}>
              <Search size={18} className="muted" />
              <input value={mq} onChange={(e) => setMq(e.target.value)} placeholder="Besprechungen durchsuchen …" style={{ fontSize: 16 }} />
            </div>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Von" title="Von" />
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Bis" title="Bis" />
          </div>
        )}

        {variant !== 'trash' && (
          <div className="toolbar-row">
            {variant !== 'meetings' && (
              <div className="segmented">
                <button className={view === 'grid' ? 'active' : ''} onClick={() => setViewPersist('grid')} aria-label="Kachelansicht">
                  <LayoutGrid size={16} />
                </button>
                <button className={view === 'list' ? 'active' : ''} onClick={() => setViewPersist('list')} aria-label="Listenansicht">
                  <List size={16} />
                </button>
              </div>
            )}
            {variant === 'all' && (
              <select className="select" style={{ width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as NoteType | '')}>
                <option value="">Alle Typen</option>
                <option value="text">Textnotizen</option>
                <option value="ink">Handschrift</option>
                <option value="meeting">Besprechungen</option>
              </select>
            )}
            <select className="select" style={{ width: 'auto' }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Alle Projekte</option>
              {lookups.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select className="select" style={{ width: 'auto' }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Alle Kategorien</option>
              {lookups.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {lookups.folders.length > 0 && (
              <select className="select" style={{ width: 'auto' }} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">Alle Ordner</option>
                {lookups.folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
            {tags.length > 0 && (
              <select className="select" style={{ width: 'auto' }} value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Alle Tags</option>
                {tags.map((t) => (
                  <option key={t} value={t}>#{t}</option>
                ))}
              </select>
            )}
            {variant !== 'archive' && variant !== 'meetings' && (
              <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="updatedAt">Zuletzt geändert</option>
                <option value="createdAt">Zuletzt erstellt</option>
                <option value="title">Titel A–Z</option>
              </select>
            )}
            {filtersActive && (
              <button
                className="link-btn"
                onClick={() => {
                  setProjectId('');
                  setCategoryId('');
                  setFolderId('');
                  setTag('');
                  setTypeFilter('');
                }}
              >
                Filter zurücksetzen
              </button>
            )}
          </div>
        )}

        {notes && notes.length === 0 && !(variant === 'trash' && trashedTasks?.length) ? (
          <Empty icon={meta.icon} title={filtersActive || mq ? 'Keine passenden Einträge' : variant === 'trash' ? 'Der Papierkorb ist leer' : variant === 'archive' ? 'Das Archiv ist leer' : 'Noch nichts vorhanden'}>
            {variant === 'archive' && 'Notizen über das Menü „Archivieren“ hierher verschieben.'}
          </Empty>
        ) : groups ? (
          groups.map(([month, items]) => (
            <section key={month} className="section">
              <div className="section-head">
                <h2 className="section-title" style={{ textTransform: 'capitalize' }}>{month}</h2>
              </div>
              <div className="list">
                {items.map((n) => (
                  <NoteRow key={n.id} n={n} lookups={lookups} side={fmtDateTime(n.meeting?.date)} />
                ))}
              </div>
            </section>
          ))
        ) : isList ? (
          <div className="list">
            {notes?.map((n) =>
              variant === 'trash' ? (
                <div key={n.id} className="list-row" style={{ cursor: 'default' }}>
                  <TypeIcon type={n.type} />
                  <div className="list-row-main">
                    <div className="list-row-title">{n.title || 'Ohne Titel'}</div>
                    <div className="list-row-sub">Gelöscht {fmtRelative(n.deletedAt)}</div>
                  </div>
                  {trashActions(n)}
                </div>
              ) : variant === 'archive' ? (
                <div key={n.id} style={{ position: 'relative' }}>
                  <NoteRow n={n} lookups={lookups} side={'Archiviert ' + fmtRelative(n.archivedAt)} />
                </div>
              ) : (
                <NoteRow key={n.id} n={n} lookups={lookups} />
              )
            )}
          </div>
        ) : (
          <div className="note-grid">
            {notes?.map((n) => (
              <NoteCard key={n.id} n={n} lookups={lookups} />
            ))}
          </div>
        )}

        {data?.more && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>Weitere laden</button>
          </div>
        )}

        {variant === 'archive' && notes && notes.length > 0 && (
          <p className="small muted mt">
            <ArchiveRestore size={14} style={{ verticalAlign: -2 }} /> Zum Wiederherstellen eine Notiz öffnen und „Aus Archiv holen“ wählen.
          </p>
        )}

        {variant === 'trash' && trashedTasks && trashedTasks.length > 0 && (
          <section className="section mt">
            <div className="section-head">
              <h2 className="section-title">Gelöschte Aufgaben</h2>
            </div>
            <div className="list">
              {trashedTasks.map((t) => (
                <div key={t.id} className="list-row" style={{ cursor: 'default' }}>
                  <div className="type-icon"><CheckSquare size={19} /></div>
                  <div className="list-row-main">
                    <div className="list-row-title">{t.title}</div>
                    <div className="list-row-sub">Gelöscht {fmtRelative(t.deletedAt)}</div>
                  </div>
                  <button className="icon-btn sm" title="Wiederherstellen" aria-label="Wiederherstellen" onClick={() => restoreTask(t.id)}>
                    <RotateCcw size={18} />
                  </button>
                  <button className="icon-btn sm" title="Endgültig löschen" aria-label="Endgültig löschen" style={{ color: 'var(--danger)' }} onClick={() => deleteTaskPermanently(t.id)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

