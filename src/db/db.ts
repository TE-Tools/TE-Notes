import Dexie, { type Table } from 'dexie';
import type {
  Attachment, Category, Folder, InkPage, MeetingInfo, Note, NoteBody, Project, SearchEntry, Setting, Task
} from './types';

export const DB_NAME = 'te-notes';

/**
 * Lokale Datenbank (IndexedDB über Dexie).
 *
 * Migrationen: Für jede Schemaänderung eine neue `this.version(n)` mit
 * geänderten Stores und ggf. `.upgrade(tx => ...)` ergänzen.
 * Ältere Versionen NIE entfernen oder ändern – Dexie migriert schrittweise.
 */
export class TeNotesDB extends Dexie {
  notes!: Table<Note, string>;
  bodies!: Table<NoteBody, string>;
  inkPages!: Table<InkPage, string>;
  attachments!: Table<Attachment, string>;
  tasks!: Table<Task, string>;
  projects!: Table<Project, string>;
  categories!: Table<Category, string>;
  folders!: Table<Folder, string>;
  settings!: Table<Setting, string>;
  search!: Table<SearchEntry, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      notes: 'id, type, updatedAt, createdAt, pinned, archived, archivedAt, deletedAt, categoryId, projectId, folderId, *tags',
      bodies: 'id',
      inkPages: 'id, noteId, [noteId+index]',
      attachments: 'id, noteId, kind',
      tasks: 'id, status, dueDate, noteId, projectId, categoryId, updatedAt, deletedAt',
      projects: 'id, name',
      categories: 'id, name',
      folders: 'id, name',
      settings: 'key',
      search: 'id, kind, refId, *words'
    });
    // Version 2: Index für das Besprechungsdatum (chronologische Besprechungsliste),
    // zusammengesetzte Indizes für schnelle Zähler und Migration älterer Besprechungen.
    this.version(2)
      .stores({
        notes:
          'id, type, updatedAt, createdAt, pinned, archived, archivedAt, deletedAt, categoryId, projectId, folderId, *tags, meeting.date, [archived+deletedAt], [type+archived+deletedAt]'
      })
      .upgrade(async (tx) => {
        await tx
          .table('notes')
          .toCollection()
          .modify((n: Note) => {
            if (n.type === 'meeting' && n.meeting) {
              n.meeting.location ??= '';
              n.meeting.followUpDate ??= null;
              n.meeting.decisions ??= [];
            }
          });
      });

    // Beim Lesen unvollständige Besprechungsdaten (ältere Versionen, Importe) ergänzen,
    // damit einzelne fehlerhafte Einträge keine Seite zum Absturz bringen.
    this.notes.hook('reading', (n: Note) => normalizeNote(n));
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x != null).map(str) : []);

/** Fehlende oder falsch typisierte Felder einer Notiz auffüllen */
export function normalizeNote(n: Note): Note {
  if (!n) return n;
  if (!Array.isArray(n.tags)) n.tags = strList(n.tags);
  if (typeof n.title !== 'string') n.title = str(n.title);
  if (n.type === 'meeting') {
    const m = (n.meeting ?? {}) as Partial<MeetingInfo>;
    let date = str(m.date);
    if (date && isNaN(new Date(date.length <= 10 ? date + 'T00:00' : date).getTime())) date = '';
    n.meeting = {
      date,
      participants: strList(m.participants),
      topic: str(m.topic),
      location: str(m.location),
      decisions: strList(m.decisions),
      followUpDate: typeof m.followUpDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.followUpDate) ? m.followUpDate : null
    };
  }
  return n;
}

export const DB_SCHEMA_VERSION = 2;

export let db = new TeNotesDB();

/** Nur für Tests: andere Datenbankinstanz verwenden. */
export function __setDb(next: TeNotesDB) {
  db = next;
}

export const ALL_TABLES = [
  'notes', 'bodies', 'inkPages', 'attachments', 'tasks', 'projects', 'categories', 'folders', 'settings', 'search'
] as const;
export type TableName = (typeof ALL_TABLES)[number];
