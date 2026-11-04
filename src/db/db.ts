import Dexie, { type Table } from 'dexie';
import { cursorFallbackMiddleware } from './cursorFallback';
import type {
  Attachment, Category, Folder, InkPage, Note, NoteBody, Project, SearchEntry, Setting, Task
} from './types';
import { convertLegacyMeeting, isLegacyMeeting } from './legacyMeeting';

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
    // Safari-Ausweichweg bei „UnknownError: Unable to open cursor“
    this.use(cursorFallbackMiddleware);
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
          .modify((n: { type: string; meeting?: Record<string, unknown> }) => {
            if (n.type === 'meeting' && n.meeting) {
              n.meeting.location ??= '';
              n.meeting.followUpDate ??= null;
              n.meeting.decisions ??= [];
            }
          });
      });

    // Version 3: Besprechungsplanung entfällt. Besprechungen werden zu Textnotizen
    // (Kopfdaten und Entscheidungen im Inhalt, Wiedervorlage als Aufgabe). Nichts geht verloren.
    this.version(3)
      .stores({
        notes:
          'id, type, updatedAt, createdAt, pinned, archived, archivedAt, deletedAt, categoryId, projectId, folderId, *tags, [archived+deletedAt], [type+archived+deletedAt]'
      })
      .upgrade(async (tx) => {
        const notes = tx.table('notes');
        const bodies = tx.table('bodies');
        const tasks = tx.table('tasks');
        const meetings = (await notes.toArray()).filter(isLegacyMeeting);
        for (const raw of meetings) {
          const { note, body, task } = convertLegacyMeeting(raw, await bodies.get(raw.id));
          await notes.put(note);
          await bodies.put(body);
          if (task && !(await tasks.get(task.id))) await tasks.put(task);
        }
        // Suchindex beim nächsten Start neu aufbauen (Inhalte/Aufgaben haben sich geändert)
        if (meetings.length) await tx.table('settings').put({ key: 'reindexPending', value: true });
      });

    // Beim Lesen unvollständige Daten (ältere Versionen, Importe) ergänzen,
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
  return n;
}

export const DB_SCHEMA_VERSION = 3;

export let db = new TeNotesDB();

/** Nur für Tests: andere Datenbankinstanz verwenden. */
export function __setDb(next: TeNotesDB) {
  db = next;
}

export const ALL_TABLES = [
  'notes', 'bodies', 'inkPages', 'attachments', 'tasks', 'projects', 'categories', 'folders', 'settings', 'search'
] as const;
export type TableName = (typeof ALL_TABLES)[number];
