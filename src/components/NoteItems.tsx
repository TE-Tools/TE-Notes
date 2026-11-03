import { Link, useNavigate } from 'react-router-dom';
import { FileText, PenLine, Pin, Users } from 'lucide-react';
import type { Note, NoteType } from '../db/types';
import { NOTE_TYPE_LABEL } from '../db/types';
import type { Lookups } from '../lib/hooks';
import { fmtDateTime, fmtRelative } from '../lib/util';
import { createNote, type NewNoteOptions } from '../db/repo';
import { toastError } from './ui';

export function TypeIcon({ type, size = 19 }: { type: NoteType; size?: number }) {
  const Icon = type === 'ink' ? PenLine : type === 'meeting' ? Users : FileText;
  return (
    <div className={'type-icon ' + type} title={NOTE_TYPE_LABEL[type]}>
      <Icon size={size} />
    </div>
  );
}

function subtitle(n: Note) {
  if (n.type === 'meeting' && n.meeting) {
    const parts = [fmtDateTime(n.meeting.date)];
    if (n.meeting.participants.length) parts.push(n.meeting.participants.join(', '));
    return parts.join(' · ');
  }
  if (n.type === 'ink') return `${n.inkPageCount ?? 1} Seite${(n.inkPageCount ?? 1) === 1 ? '' : 'n'} · Handschrift`;
  return n.excerpt || 'Kein weiterer Text';
}

export function MetaChips({ n, lookups }: { n: Note; lookups: Lookups }) {
  const p = n.projectId ? lookups.projectMap.get(n.projectId) : undefined;
  const c = n.categoryId ? lookups.categoryMap.get(n.categoryId) : undefined;
  return (
    <>
      {p && (
        <span className="chip">
          <span className="dot" style={{ background: p.color }} />
          {p.name}
        </span>
      )}
      {c && (
        <span className="chip">
          <span className="dot" style={{ background: c.color }} />
          {c.name}
        </span>
      )}
      {n.tags.slice(0, 3).map((t) => (
        <span key={t} className="chip">#{t}</span>
      ))}
    </>
  );
}

export function NoteCard({ n, lookups }: { n: Note; lookups: Lookups }) {
  return (
    <Link to={`/note/${n.id}`} className="note-card">
      {n.pinned === 1 && <Pin size={15} className="pin" fill="currentColor" />}
      <div className="note-card-meta">
        <TypeIcon type={n.type} size={15} />
        <span>{fmtRelative(n.updatedAt)}</span>
      </div>
      <div className="note-card-title" style={{ paddingRight: n.pinned ? 18 : 0 }}>{n.title || 'Ohne Titel'}</div>
      <div className="note-card-excerpt">{subtitle(n)}</div>
      <div className="note-card-meta">
        <MetaChips n={n} lookups={lookups} />
      </div>
    </Link>
  );
}

export function NoteRow({ n, lookups, side, onClick }: { n: Note; lookups: Lookups; side?: string; onClick?: () => void }) {
  const inner = (
    <>
      <TypeIcon type={n.type} />
      <div className="list-row-main">
        <div className="list-row-title">
          {n.pinned === 1 && <Pin size={13} style={{ color: 'var(--brand-gold)', marginRight: 6, verticalAlign: -1 }} fill="currentColor" />}
          {n.title || 'Ohne Titel'}
        </div>
        <div className="list-row-sub">{subtitle(n)}</div>
        <div className="note-card-meta" style={{ marginTop: 4 }}>
          <MetaChips n={n} lookups={lookups} />
        </div>
      </div>
      <div className="list-row-side">{side ?? fmtRelative(n.updatedAt)}</div>
    </>
  );
  if (onClick)
    return (
      <div className="list-row" onClick={onClick} role="button" tabIndex={0}>
        {inner}
      </div>
    );
  return (
    <Link to={`/note/${n.id}`} className="list-row">
      {inner}
    </Link>
  );
}

/** Neue Notiz anlegen und direkt öffnen */
export function useCreateNote() {
  const navigate = useNavigate();
  return async (type: NoteType, opts: NewNoteOptions = {}) => {
    try {
      const id = await createNote(type, opts);
      navigate(`/note/${id}`, { state: { fresh: true } });
    } catch (e) {
      toastError(e, 'Notiz konnte nicht angelegt werden');
    }
  };
}
