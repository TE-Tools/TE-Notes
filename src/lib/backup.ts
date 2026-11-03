import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { db, DB_SCHEMA_VERSION } from '../db/db';
import type {
  Attachment, Category, Folder, InkPage, Note, NoteBody, Project, Setting, Task
} from '../db/types';
import { rebuildSearchIndex, indexNote, indexTask } from '../db/repo';
import { APP_VERSION } from './version';

/**
 * Sicherungsformat "te-notes-backup" (ZIP-Datei, Endung .tenotes)
 *
 *   manifest.json            – Format, Version, Zeitpunkt, Umfang
 *   data/<tabelle>.json      – Datensätze je Tabelle
 *   data/attachments.json    – Metadaten der Anhänge (ohne Binärdaten)
 *   files/<attachmentId>     – Binärdaten der Anhänge
 *
 * formatVersion wird bei inkompatiblen Änderungen erhöht; `migrateBackup`
 * hebt ältere Sicherungen auf das aktuelle Format an.
 */
export const BACKUP_FORMAT = 'te-notes-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  dbVersion: number;
  createdAt: number;
  scope: 'full' | 'notes';
  counts: Record<string, number>;
}

type AttachmentMeta = Omit<Attachment, 'blob'>;

export interface BackupData {
  notes: Note[];
  bodies: NoteBody[];
  inkPages: InkPage[];
  attachments: Attachment[];
  tasks: Task[];
  projects: Project[];
  categories: Category[];
  folders: Folder[];
  settings: Setting[];
}

export interface ParsedBackup {
  manifest: BackupManifest;
  data: BackupData;
}

/** Diese Einstellungen werden nie gesichert/übernommen (gerätespezifisch). */
const DEVICE_ONLY_SETTINGS = new Set(['lockEnabled', 'lockHash', 'lockSalt', 'lastBackupAt', 'seeded']);

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

async function packZip(data: BackupData, scope: BackupManifest['scope']): Promise<Blob> {
  const files: Zippable = {};
  const counts: Record<string, number> = {};
  const json = (name: string, rows: unknown[]) => {
    counts[name] = rows.length;
    files[`data/${name}.json`] = strToU8(JSON.stringify(rows));
  };
  json('notes', data.notes);
  json('bodies', data.bodies);
  json('inkPages', data.inkPages);
  json('tasks', data.tasks);
  json('projects', data.projects);
  json('categories', data.categories);
  json('folders', data.folders);
  json('settings', data.settings.filter((s) => !DEVICE_ONLY_SETTINGS.has(s.key)));
  const metas: AttachmentMeta[] = [];
  for (const a of data.attachments) {
    const { blob, ...meta } = a;
    metas.push(meta);
    // Bereits komprimierte Formate nicht erneut komprimieren
    files[`files/${a.id}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  json('attachments', metas);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    dbVersion: DB_SCHEMA_VERSION,
    createdAt: Date.now(),
    scope,
    counts
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

export async function exportFullBackup(): Promise<Blob> {
  const data: BackupData = await db.transaction(
    'r',
    [db.notes, db.bodies, db.inkPages, db.attachments, db.tasks, db.projects, db.categories, db.folders, db.settings],
    async () => ({
      notes: await db.notes.toArray(),
      bodies: await db.bodies.toArray(),
      inkPages: await db.inkPages.toArray(),
      attachments: await db.attachments.toArray(),
      tasks: await db.tasks.toArray(),
      projects: await db.projects.toArray(),
      categories: await db.categories.toArray(),
      folders: await db.folders.toArray(),
      settings: await db.settings.toArray()
    })
  );
  return packZip(data, 'full');
}

/** Einzelne Notizen inkl. Inhalt, Handschrift, Anhängen, Aufgaben und referenzierten Projekten/Kategorien */
export async function exportNotes(noteIds: string[]): Promise<Blob> {
  const notes = (await db.notes.bulkGet(noteIds)).filter((n): n is Note => !!n);
  const ids = notes.map((n) => n.id);
  const bodies = (await db.bodies.bulkGet(ids)).filter((b): b is NoteBody => !!b);
  const inkPages = await db.inkPages.where('noteId').anyOf(ids).toArray();
  const attachments = await db.attachments.where('noteId').anyOf(ids).toArray();
  const tasks = await db.tasks.where('noteId').anyOf(ids).toArray();
  const projIds = [...new Set([...notes.map((n) => n.projectId), ...tasks.map((t) => t.projectId)].filter(Boolean))] as string[];
  const catIds = [...new Set([...notes.map((n) => n.categoryId), ...tasks.map((t) => t.categoryId)].filter(Boolean))] as string[];
  const folderIds = [...new Set(notes.map((n) => n.folderId).filter(Boolean))] as string[];
  return packZip(
    {
      notes, bodies, inkPages, attachments, tasks,
      projects: (await db.projects.bulkGet(projIds)).filter((x): x is Project => !!x),
      categories: (await db.categories.bulkGet(catIds)).filter((x): x is Category => !!x),
      folders: (await db.folders.bulkGet(folderIds)).filter((x): x is Folder => !!x),
      settings: []
    },
    'notes'
  );
}

/* ------------------------------------------------------------------ */
/* Einlesen & Prüfen                                                   */
/* ------------------------------------------------------------------ */

export class BackupError extends Error {}

export async function parseBackup(file: Blob): Promise<ParsedBackup> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new BackupError('Die Datei ist keine gültige TE-Notes-Sicherung (ZIP konnte nicht gelesen werden).');
  }
  const mRaw = entries['manifest.json'];
  if (!mRaw) throw new BackupError('Die Sicherung enthält kein Manifest (manifest.json fehlt).');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(mRaw));
  } catch {
    throw new BackupError('Das Manifest der Sicherung ist beschädigt.');
  }
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError('Unbekanntes Sicherungsformat.');
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      `Diese Sicherung wurde mit einer neueren Version von TE Notes erstellt (Format ${manifest.formatVersion}). Bitte die App aktualisieren.`
    );
  }
  const read = <T,>(name: string): T[] => {
    const raw = entries[`data/${name}.json`];
    if (!raw) return [];
    try {
      const v = JSON.parse(strFromU8(raw));
      if (!Array.isArray(v)) throw new Error();
      return v as T[];
    } catch {
      throw new BackupError(`Die Datei data/${name}.json in der Sicherung ist beschädigt.`);
    }
  };
  const metas = read<AttachmentMeta>('attachments');
  const attachments: Attachment[] = [];
  const missing: string[] = [];
  for (const m of metas) {
    const bin = entries[`files/${m.id}`];
    if (!bin) {
      missing.push(m.name);
      continue;
    }
    attachments.push({ ...m, blob: new Blob([bin], { type: m.mime }) });
  }
  if (missing.length) {
    throw new BackupError(`In der Sicherung fehlen ${missing.length} Anhangsdatei(en), z. B. „${missing[0]}“.`);
  }
  const data: BackupData = {
    notes: read<Note>('notes'),
    bodies: read<NoteBody>('bodies'),
    inkPages: read<InkPage>('inkPages'),
    attachments,
    tasks: read<Task>('tasks'),
    projects: read<Project>('projects'),
    categories: read<Category>('categories'),
    folders: read<Folder>('folders'),
    settings: read<Setting>('settings')
  };
  return migrateBackup({ manifest, data });
}

/** Hebt ältere Sicherungsformate auf den aktuellen Stand und ergänzt fehlende Felder. */
export function migrateBackup(b: ParsedBackup): ParsedBackup {
  // Format 1 ist aktuell. Künftige Formate: hier schrittweise migrieren (if formatVersion < 2 ...).
  for (const n of b.data.notes) {
    n.tags ??= [];
    n.pinned ??= 0;
    n.archived ??= 0;
    n.archivedAt ??= 0;
    n.deletedAt ??= 0;
    n.excerpt ??= '';
    n.categoryId ??= null;
    n.projectId ??= null;
    n.folderId ??= null;
    if (n.type === 'meeting' && n.meeting) {
      n.meeting.location ??= '';
      n.meeting.followUpDate ??= null;
      n.meeting.decisions ??= [];
      n.meeting.participants ??= [];
    }
  }
  for (const t of b.data.tasks) {
    t.deletedAt ??= 0;
    t.completedAt ??= 0;
    t.assignee ??= '';
  }
  b.manifest.formatVersion = BACKUP_FORMAT_VERSION;
  return b;
}

export type ConflictKind = 'notes' | 'tasks' | 'projects' | 'categories' | 'folders';

export interface Conflict {
  key: string; // kind:id
  kind: ConflictKind;
  id: string;
  title: string;
  localUpdatedAt: number;
  incomingUpdatedAt: number;
}

export interface ImportAnalysis {
  added: Record<ConflictKind, number>;
  identical: Record<ConflictKind, number>;
  conflicts: Conflict[];
}

const KINDS: ConflictKind[] = ['notes', 'tasks', 'projects', 'categories', 'folders'];

function titleOf(kind: ConflictKind, row: Note | Task | Project | Category | Folder): string {
  if (kind === 'notes' || kind === 'tasks') return (row as Note).title || 'Ohne Titel';
  return (row as Project).name;
}

export async function analyzeImport(b: ParsedBackup): Promise<ImportAnalysis> {
  const added = { notes: 0, tasks: 0, projects: 0, categories: 0, folders: 0 };
  const identical = { ...added };
  const conflicts: Conflict[] = [];
  for (const kind of KINDS) {
    const rows = b.data[kind] as (Note | Task | Project | Category | Folder)[];
    const local = await (db[kind] as unknown as { bulkGet(ids: string[]): Promise<(typeof rows)[number][]> }).bulkGet(
      rows.map((r) => r.id)
    );
    rows.forEach((r, i) => {
      const l = local[i];
      if (!l) added[kind]++;
      else if (l.updatedAt === r.updatedAt) identical[kind]++;
      else
        conflicts.push({
          key: `${kind}:${r.id}`, kind, id: r.id, title: titleOf(kind, r), localUpdatedAt: l.updatedAt, incomingUpdatedAt: r.updatedAt
        });
    });
  }
  return { added, identical, conflicts };
}

/* ------------------------------------------------------------------ */
/* Übernehmen                                                          */
/* ------------------------------------------------------------------ */

export type ImportMode =
  /** Neue Einträge hinzufügen, bei Konflikten die neuere Version behalten */
  | 'merge-newer'
  /** Nur neue Einträge hinzufügen, Vorhandenes bleibt unverändert */
  | 'keep-local'
  /** Neue hinzufügen, bei Konflikten die Version aus der Sicherung übernehmen */
  | 'prefer-incoming'
  /** Vollständige Wiederherstellung: alle lokalen Daten werden ersetzt */
  | 'replace';

export interface ImportResult {
  written: number;
  skipped: number;
}

export function defaultChoice(mode: ImportMode, c: Conflict): 'local' | 'incoming' {
  if (mode === 'keep-local') return 'local';
  if (mode === 'prefer-incoming' || mode === 'replace') return 'incoming';
  return c.incomingUpdatedAt > c.localUpdatedAt ? 'incoming' : 'local';
}

export async function applyImport(
  b: ParsedBackup,
  mode: ImportMode,
  choices: Record<string, 'local' | 'incoming'> = {}
): Promise<ImportResult> {
  const d = b.data;
  let written = 0;
  let skipped = 0;
  const tables = [db.notes, db.bodies, db.inkPages, db.attachments, db.tasks, db.projects, db.categories, db.folders, db.settings, db.search];

  await db.transaction('rw', tables, async () => {
    if (mode === 'replace') {
      const keepLocal = (await db.settings.toArray()).filter((s) => DEVICE_ONLY_SETTINGS.has(s.key));
      for (const t of tables) await t.clear();
      await db.notes.bulkPut(d.notes);
      await db.bodies.bulkPut(d.bodies);
      await db.inkPages.bulkPut(d.inkPages);
      await db.attachments.bulkPut(d.attachments);
      await db.tasks.bulkPut(d.tasks);
      await db.projects.bulkPut(d.projects);
      await db.categories.bulkPut(d.categories);
      await db.folders.bulkPut(d.folders);
      await db.settings.bulkPut([...d.settings.filter((s) => !DEVICE_ONLY_SETTINGS.has(s.key)), ...keepLocal]);
      await db.settings.put({ key: 'seeded', value: true });
      written = d.notes.length + d.tasks.length + d.projects.length + d.categories.length + d.folders.length;
      return;
    }

    const analysis = await analyzeImport(b);
    const conflictMap = new Map(analysis.conflicts.map((c) => [c.key, c]));
    const shouldWrite = async (kind: ConflictKind, id: string, updatedAt: number): Promise<boolean> => {
      const key = `${kind}:${id}`;
      const c = conflictMap.get(key);
      if (c) return (choices[key] ?? defaultChoice(mode, c)) === 'incoming';
      const exists = await (db[kind] as unknown as { get(id: string): Promise<{ updatedAt: number } | undefined> }).get(id);
      // Kein Konflikt: entweder neu (schreiben) oder identisch (überspringen)
      return !exists || exists.updatedAt !== updatedAt;
    };

    // Stammdaten zuerst
    for (const kind of ['projects', 'categories', 'folders'] as const) {
      for (const row of d[kind]) {
        if (await shouldWrite(kind, row.id, row.updatedAt)) {
          await (db[kind] as unknown as { put(r: unknown): Promise<unknown> }).put(row);
          written++;
        } else skipped++;
      }
    }

    const bodies = new Map(d.bodies.map((x) => [x.id, x]));
    for (const n of d.notes) {
      if (!(await shouldWrite('notes', n.id, n.updatedAt))) {
        skipped++;
        continue;
      }
      // Zugehörige Inhalte vollständig ersetzen
      await db.inkPages.where('noteId').equals(n.id).delete();
      await db.attachments.where('noteId').equals(n.id).delete();
      await db.notes.put(n);
      const body = bodies.get(n.id);
      if (body) await db.bodies.put(body);
      else await db.bodies.delete(n.id);
      await db.inkPages.bulkPut(d.inkPages.filter((p) => p.noteId === n.id));
      await db.attachments.bulkPut(d.attachments.filter((a) => a.noteId === n.id));
      written++;
    }

    for (const t of d.tasks) {
      if (await shouldWrite('tasks', t.id, t.updatedAt)) {
        await db.tasks.put(t);
        written++;
      } else skipped++;
    }
  });

  // Suchindex neu aufbauen (außerhalb der Transaktion, kann bei großen Beständen dauern)
  if (mode === 'replace') {
    await rebuildSearchIndex();
  } else {
    for (const n of d.notes) {
      const local = await db.notes.get(n.id);
      if (local) await indexNote(local);
    }
    for (const t of d.tasks) {
      const local = await db.tasks.get(t.id);
      if (local) await indexTask(local);
    }
  }
  return { written, skipped };
}

export function backupFileName(scope: 'full' | 'notes' = 'full', title?: string) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(
    d.getHours()
  ).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  if (scope === 'notes') return `TE-Notes_${(title || 'Notiz').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)}_${stamp}.tenotes`;
  return `TE-Notes-Sicherung_${stamp}.tenotes`;
}
