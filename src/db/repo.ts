import type { JSONContent } from '@tiptap/react';
import { db } from './db';
import type {
  Attachment, AttachmentKind, Category, Folder, InkPage, Note, NoteType, Project, Task
} from './types';
import { COLORS, uid } from '../lib/util';
import { makeExcerpt, tokenize } from '../lib/text';

/* ------------------------------------------------------------------ */
/* Einstellungen                                                       */
/* ------------------------------------------------------------------ */

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  userName: string;
  lastBackupAt: number;
  backupReminderDays: number;
  /** Handschrift: Finger zeichnet ebenfalls (sonst nur Pencil/Maus, Finger navigiert) */
  fingerDraws: boolean;
  lockEnabled: boolean;
  lockHash: string;
  lockSalt: string;
  lockTimeoutMin: number;
  seeded: boolean;
  penColors: string[];
  defaultPageBackground: 'blank' | 'lines' | 'grid' | 'dots';
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  userName: '',
  lastBackupAt: 0,
  backupReminderDays: 7,
  fingerDraws: false,
  lockEnabled: false,
  lockHash: '',
  lockSalt: '',
  lockTimeoutMin: 5,
  seeded: false,
  penColors: ['#1d1d1f', '#2f5fb3', '#c0392b', '#2e8b57', '#8e44ad', '#e67e22'],
  defaultPageBackground: 'lines'
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await db.settings.put({ key, value });
}

/* ------------------------------------------------------------------ */
/* Erststart: Standardkategorien und Beispielprojekte                  */
/* ------------------------------------------------------------------ */

export async function ensureSeeded() {
  await db.transaction('rw', db.settings, db.categories, db.projects, async () => {
    const seeded = await db.settings.get('seeded');
    if (seeded?.value) return;
    const now = Date.now();
    const cats = ['Allgemeine Notizen', 'Private Notizen'];
    if ((await db.categories.count()) === 0) {
      await db.categories.bulkAdd(
        cats.map((name, i) => ({ id: uid(), name, color: COLORS[i + 5], createdAt: now, updatedAt: now }))
      );
    }
    if ((await db.projects.count()) === 0) {
      const projects = ['Margenplanung', 'SAP', 'PPWR', 'Digitalisierung'];
      await db.projects.bulkAdd(
        projects.map((name, i) => ({
          id: uid(), name, description: '', status: 'aktiv' as const, color: COLORS[i], createdAt: now, updatedAt: now
        }))
      );
    }
    await db.settings.put({ key: 'seeded', value: true });
  });
}

/* ------------------------------------------------------------------ */
/* Suchindex                                                           */
/* ------------------------------------------------------------------ */

async function lookupNames(categoryId: string | null, projectId: string | null, folderId: string | null) {
  const [c, p, f] = await Promise.all([
    categoryId ? db.categories.get(categoryId) : undefined,
    projectId ? db.projects.get(projectId) : undefined,
    folderId ? db.folders.get(folderId) : undefined
  ]);
  return [c?.name, p?.name, f?.name];
}

export async function indexNote(note: Note, bodyText?: string) {
  if (bodyText === undefined) bodyText = (await db.bodies.get(note.id))?.text ?? '';
  const names = await lookupNames(note.categoryId, note.projectId, note.folderId);
  const words = tokenize(note.title, bodyText, note.tags.join(' '), ...names);
  await db.search.put({ id: 'note:' + note.id, kind: 'note', refId: note.id, words });
}

export async function indexTask(task: Task) {
  const names = await lookupNames(task.categoryId, task.projectId, null);
  const words = tokenize(task.title, task.description, task.assignee, ...names);
  await db.search.put({ id: 'task:' + task.id, kind: 'task', refId: task.id, words });
}

export async function rebuildSearchIndex() {
  await db.search.clear();
  const notes = await db.notes.toArray();
  for (const n of notes) await indexNote(n);
  const tasks = await db.tasks.toArray();
  for (const t of tasks) await indexTask(t);
}

async function reindexByRef(field: 'categoryId' | 'projectId' | 'folderId', id: string) {
  const notes = await db.notes.where(field).equals(id).toArray();
  for (const n of notes) await indexNote(n);
  if (field !== 'folderId') {
    const tasks = await db.tasks.where(field).equals(id).toArray();
    for (const t of tasks) await indexTask(t);
  }
}

async function reindexIds(noteIds: string[], taskIds: string[]) {
  for (const n of await db.notes.bulkGet(noteIds)) if (n) await indexNote(n);
  for (const t of await db.tasks.bulkGet(taskIds)) if (t) await indexTask(t);
}

/* ------------------------------------------------------------------ */
/* Notizen                                                             */
/* ------------------------------------------------------------------ */

export interface NewNoteOptions {
  title?: string;
  projectId?: string | null;
  categoryId?: string | null;
  folderId?: string | null;
  tags?: string[];
  doc?: JSONContent;
  text?: string;
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export async function createNote(type: NoteType, opts: NewNoteOptions = {}): Promise<string> {
  const now = Date.now();
  const id = uid();
  const note: Note = {
    id,
    type,
    title: opts.title ?? '',
    excerpt: makeExcerpt(opts.text ?? ''),
    categoryId: opts.categoryId ?? null,
    projectId: opts.projectId ?? null,
    folderId: opts.folderId ?? null,
    tags: opts.tags ?? [],
    pinned: 0,
    archived: 0,
    archivedAt: 0,
    deletedAt: 0,
    createdAt: now,
    updatedAt: now
  };
  if (type === 'ink') note.inkPageCount = 1;

  const settings = await getSettings();
  await db.transaction('rw', [db.notes, db.bodies, db.inkPages, db.search, db.categories, db.projects, db.folders], async () => {
    await db.notes.add(note);
    if (type === 'ink') {
      await db.inkPages.add(newInkPage(id, 0, settings.defaultPageBackground));
    } else {
      await db.bodies.add({ id, doc: opts.doc ?? EMPTY_DOC, text: opts.text ?? '', updatedAt: now });
    }
    await indexNote(note, opts.text ?? '');
  });
  return id;
}

export function newInkPage(noteId: string, index: number, background: InkPage['background'] = 'lines'): InkPage {
  return {
    id: uid(),
    noteId,
    index,
    width: 794,
    height: 1123,
    background,
    bgAttachmentId: null,
    strokes: [],
    images: [],
    updatedAt: Date.now()
  };
}

const NOTE_TX = () => [db.notes, db.bodies, db.search, db.categories, db.projects, db.folders];

export async function updateNote(id: string, patch: Partial<Omit<Note, 'id'>>, touch = true) {
  await db.transaction('rw', NOTE_TX(), async () => {
    const note = await db.notes.get(id);
    if (!note) return;
    const next: Note = { ...note, ...patch, updatedAt: touch ? Date.now() : note.updatedAt };
    await db.notes.put(next);
    await indexNote(next);
  });
}

export async function saveNoteBody(id: string, doc: JSONContent, text: string) {
  const now = Date.now();
  await db.transaction('rw', NOTE_TX(), async () => {
    const note = await db.notes.get(id);
    if (!note) return;
    await db.bodies.put({ id, doc, text, updatedAt: now });
    const next: Note = { ...note, excerpt: makeExcerpt(text), updatedAt: now };
    await db.notes.put(next);
    await indexNote(next, text);
  });
}

export async function setPinned(id: string, pinned: boolean) {
  await updateNote(id, { pinned: pinned ? 1 : 0 }, false);
}

export async function archiveNote(id: string, archived: boolean) {
  await updateNote(id, { archived: archived ? 1 : 0, archivedAt: archived ? Date.now() : 0, pinned: 0 }, false);
}

export async function trashNote(id: string) {
  await updateNote(id, { deletedAt: Date.now(), pinned: 0 }, false);
}

export async function restoreNote(id: string) {
  await updateNote(id, { deletedAt: 0 }, false);
}

/** Endgültiges Löschen inkl. Inhalt, Handschrift und Anhängen. Aufgaben bleiben erhalten (Verknüpfung wird gelöst). */
export async function deleteNotePermanently(id: string) {
  await db.transaction('rw', [db.notes, db.bodies, db.inkPages, db.attachments, db.search, db.tasks], async () => {
    await db.notes.delete(id);
    await db.bodies.delete(id);
    await db.inkPages.where('noteId').equals(id).delete();
    await db.attachments.where('noteId').equals(id).delete();
    await db.search.delete('note:' + id);
    await db.tasks.where('noteId').equals(id).modify({ noteId: null });
  });
}

export async function emptyTrash() {
  const ids = await db.notes.where('deletedAt').above(0).primaryKeys();
  for (const id of ids) await deleteNotePermanently(id);
  const taskIds = await db.tasks.where('deletedAt').above(0).primaryKeys();
  await db.transaction('rw', db.tasks, db.search, async () => {
    await db.tasks.bulkDelete(taskIds);
    await db.search.bulkDelete(taskIds.map((t) => 'task:' + t));
  });
}

export async function duplicateNote(id: string): Promise<string | null> {
  const note = await db.notes.get(id);
  if (!note) return null;
  const newId = uid();
  const now = Date.now();
  await db.transaction('rw', [db.notes, db.bodies, db.inkPages, db.attachments, db.search, db.categories, db.projects, db.folders], async () => {
    const copy: Note = {
      ...note, id: newId, title: (note.title || 'Ohne Titel') + ' (Kopie)', pinned: 0, archived: 0, archivedAt: 0,
      deletedAt: 0, createdAt: now, updatedAt: now
    };
    await db.notes.add(copy);
    const body = await db.bodies.get(id);
    if (body) await db.bodies.add({ ...body, id: newId, updatedAt: now });
    const atts = await db.attachments.where('noteId').equals(id).toArray();
    const map = new Map<string, string>();
    for (const a of atts) {
      const nid = uid();
      map.set(a.id, nid);
      await db.attachments.add({ ...a, id: nid, noteId: newId });
    }
    const pages = await db.inkPages.where('noteId').equals(id).toArray();
    for (const p of pages) {
      await db.inkPages.add({
        ...p,
        id: uid(),
        noteId: newId,
        bgAttachmentId: p.bgAttachmentId ? map.get(p.bgAttachmentId) ?? null : null,
        images: p.images.map((im) => ({ ...im, id: uid(), attachmentId: map.get(im.attachmentId) ?? im.attachmentId }))
      });
    }
    await indexNote(copy, body?.text ?? '');
  });
  return newId;
}

/* ------------------------------------------------------------------ */
/* Anhänge                                                             */
/* ------------------------------------------------------------------ */

export async function addAttachment(noteId: string | null, file: Blob, name: string, kind: AttachmentKind = 'file'): Promise<string> {
  const id = uid();
  const att: Attachment = {
    id, noteId, kind, name, mime: file.type || 'application/octet-stream', size: file.size, blob: file, createdAt: Date.now()
  };
  await db.attachments.add(att);
  if (noteId && kind === 'file') await db.notes.update(noteId, { updatedAt: Date.now() });
  return id;
}

export async function deleteAttachment(id: string) {
  await db.attachments.delete(id);
}

/* ------------------------------------------------------------------ */
/* Aufgaben                                                            */
/* ------------------------------------------------------------------ */

export async function createTask(partial: Partial<Task> & { title: string }): Promise<string> {
  const now = Date.now();
  const task: Task = {
    id: uid(),
    description: '',
    dueDate: null,
    priority: 2,
    status: 'open',
    noteId: null,
    projectId: null,
    categoryId: null,
    assignee: '',
    createdAt: now,
    updatedAt: now,
    completedAt: 0,
    deletedAt: 0,
    ...partial
  };
  await db.transaction('rw', [db.tasks, db.search, db.categories, db.projects, db.folders], async () => {
    await db.tasks.add(task);
    await indexTask(task);
  });
  return task.id;
}

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id'>>) {
  await db.transaction('rw', [db.tasks, db.search, db.categories, db.projects, db.folders], async () => {
    const t = await db.tasks.get(id);
    if (!t) return;
    const next: Task = { ...t, ...patch, updatedAt: Date.now() };
    if (patch.status) {
      if (patch.status === 'done' && t.status !== 'done') next.completedAt = Date.now();
      if (patch.status !== 'done') next.completedAt = 0;
    }
    await db.tasks.put(next);
    await indexTask(next);
  });
}

export async function trashTask(id: string) {
  await updateTask(id, { deletedAt: Date.now() });
}
export async function restoreTask(id: string) {
  await updateTask(id, { deletedAt: 0 });
}
export async function deleteTaskPermanently(id: string) {
  await db.transaction('rw', db.tasks, db.search, async () => {
    await db.tasks.delete(id);
    await db.search.delete('task:' + id);
  });
}

/* ------------------------------------------------------------------ */
/* Projekte, Kategorien, Ordner                                        */
/* ------------------------------------------------------------------ */

const ALL_INDEX_TX = () => [db.notes, db.bodies, db.tasks, db.search, db.categories, db.projects, db.folders];

export async function saveProject(p: Partial<Project> & { name: string }): Promise<string> {
  const now = Date.now();
  if (p.id) {
    const id = p.id;
    await db.transaction('rw', ALL_INDEX_TX(), async () => {
      const prev = await db.projects.get(id);
      await db.projects.update(id, { ...p, updatedAt: now });
      if (prev && prev.name !== p.name) await reindexByRef('projectId', id);
    });
    return id;
  }
  // `id: undefined` aus Formularen darf die neue ID nicht überschreiben
  const { id: _ignore, ...rest } = p;
  const id = uid();
  const count = await db.projects.count();
  await db.projects.add({
    description: '', status: 'aktiv', color: COLORS[count % COLORS.length], createdAt: now, updatedAt: now, ...rest, id
  });
  return id;
}

export async function deleteProject(id: string) {
  await db.transaction('rw', ALL_INDEX_TX(), async () => {
    const noteIds = await db.notes.where('projectId').equals(id).primaryKeys();
    const taskIds = await db.tasks.where('projectId').equals(id).primaryKeys();
    await db.projects.delete(id);
    await db.notes.where('projectId').equals(id).modify({ projectId: null });
    await db.tasks.where('projectId').equals(id).modify({ projectId: null });
    await reindexIds(noteIds, taskIds);
  });
}

export async function saveCategory(c: Partial<Category> & { name: string }): Promise<string> {
  const now = Date.now();
  if (c.id) {
    const id = c.id;
    await db.transaction('rw', ALL_INDEX_TX(), async () => {
      const prev = await db.categories.get(id);
      await db.categories.update(id, { ...c, updatedAt: now });
      if (prev && prev.name !== c.name) await reindexByRef('categoryId', id);
    });
    return id;
  }
  const { id: _ignore, ...rest } = c;
  const id = uid();
  const count = await db.categories.count();
  await db.categories.add({ color: COLORS[count % COLORS.length], createdAt: now, updatedAt: now, ...rest, id });
  return id;
}

export async function deleteCategory(id: string) {
  await db.transaction('rw', ALL_INDEX_TX(), async () => {
    const noteIds = await db.notes.where('categoryId').equals(id).primaryKeys();
    const taskIds = await db.tasks.where('categoryId').equals(id).primaryKeys();
    await db.categories.delete(id);
    await db.notes.where('categoryId').equals(id).modify({ categoryId: null });
    await db.tasks.where('categoryId').equals(id).modify({ categoryId: null });
    await reindexIds(noteIds, taskIds);
  });
}

export async function saveFolder(f: Partial<Folder> & { name: string }): Promise<string> {
  const now = Date.now();
  if (f.id) {
    const id = f.id;
    await db.transaction('rw', ALL_INDEX_TX(), async () => {
      await db.folders.update(id, { ...f, updatedAt: now });
      await reindexByRef('folderId', id);
    });
    return id;
  }
  const { id: _ignore, ...rest } = f;
  const id = uid();
  await db.folders.add({ createdAt: now, updatedAt: now, ...rest, id });
  return id;
}

export async function deleteFolder(id: string) {
  await db.transaction('rw', ALL_INDEX_TX(), async () => {
    const noteIds = await db.notes.where('folderId').equals(id).primaryKeys();
    await db.folders.delete(id);
    await db.notes.where('folderId').equals(id).modify({ folderId: null });
    await reindexIds(noteIds, []);
  });
}

/* ------------------------------------------------------------------ */
/* Abfragen                                                            */
/* ------------------------------------------------------------------ */

export const isActive = (n: Note) => !n.deletedAt && !n.archived;

export async function recentNotes(limit = 8) {
  return db.notes.orderBy('updatedAt').reverse().filter(isActive).limit(limit).toArray();
}

export async function pinnedNotes() {
  return (await db.notes.where('pinned').equals(1).toArray()).filter(isActive).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function allTags(): Promise<string[]> {
  const keys = await db.notes.orderBy('tags').uniqueKeys();
  return (keys as string[]).sort((a, b) => a.localeCompare(b, 'de'));
}
