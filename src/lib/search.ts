import { db } from '../db/db';
import type { Note, NoteType, Task, TaskStatus } from '../db/types';
import { normalize, queryTokens } from './text';

export interface SearchFilters {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  categoryId?: string;
  projectId?: string;
  type?: NoteType | 'task' | '';
  /** Notizen: active | archived | pinned; Aufgaben: TaskStatus */
  status?: '' | 'active' | 'archived' | 'pinned' | TaskStatus;
}

export interface SearchResult {
  notes: Note[];
  tasks: Task[];
  total: number;
}

const NOTE_STATUSES = ['active', 'archived', 'pinned'];

function dayOf(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function inRange(day: string, f: SearchFilters) {
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  return true;
}

function noteMatches(n: Note, f: SearchFilters) {
  if (n.deletedAt) return false;
  if (f.type && f.type !== n.type) return false;
  if (f.categoryId && n.categoryId !== f.categoryId) return false;
  if (f.projectId && n.projectId !== f.projectId) return false;
  if (f.status) {
    if (!NOTE_STATUSES.includes(f.status)) return false;
    if (f.status === 'active' && n.archived) return false;
    if (f.status === 'archived' && !n.archived) return false;
    if (f.status === 'pinned' && !n.pinned) return false;
  }
  return inRange(dayOf(n.updatedAt), f);
}

function taskMatches(t: Task, f: SearchFilters) {
  if (t.deletedAt) return false;
  if (f.type && f.type !== 'task') return false;
  if (f.categoryId && t.categoryId !== f.categoryId) return false;
  if (f.projectId && t.projectId !== f.projectId) return false;
  if (f.status && (NOTE_STATUSES.includes(f.status) || t.status !== f.status)) return false;
  return inRange(t.dueDate ?? dayOf(t.updatedAt), f);
}

/**
 * Volltextsuche über den lokalen Wortindex (Präfixsuche je Wort, alle Wörter müssen vorkommen).
 * Ohne Suchbegriff werden nur die Filter angewendet.
 */
export async function search(q: string, f: SearchFilters = {}, limit = 300): Promise<SearchResult> {
  const tokens = queryTokens(q);
  let notes: Note[] = [];
  let tasks: Task[] = [];

  if (tokens.length === 0) {
    const hasFilter = Object.values(f).some(Boolean);
    if (!hasFilter) return { notes: [], tasks: [], total: 0 };
    if (f.type !== 'task') {
      notes = await db.notes.orderBy('updatedAt').reverse().filter((n) => noteMatches(n, f)).limit(limit).toArray();
    }
    if (!f.type || f.type === 'task') {
      tasks = await db.tasks.orderBy('updatedAt').reverse().filter((t) => taskMatches(t, f)).limit(limit).toArray();
    }
    return { notes, tasks, total: notes.length + tasks.length };
  }

  // Seltenste Wörter zuerst auflösen und Schnittmenge bilden
  let ids: Set<string> | null = null;
  for (const tok of tokens.sort((a, b) => b.length - a.length)) {
    const keys = (await db.search.where('words').startsWith(tok).primaryKeys()) as string[];
    const set = new Set<string>(keys);
    if (ids === null) {
      ids = set;
    } else {
      const prev: Set<string> = ids;
      ids = new Set([...prev].filter((k) => set.has(k)));
    }
    if (ids.size === 0) break;
  }
  const keys = [...(ids ?? [])];
  const noteIds = keys.filter((k) => k.startsWith('note:')).map((k) => k.slice(5));
  const taskIds = keys.filter((k) => k.startsWith('task:')).map((k) => k.slice(5));

  notes = (await db.notes.bulkGet(noteIds)).filter((n): n is Note => !!n && noteMatches(n, f));
  tasks = (await db.tasks.bulkGet(taskIds)).filter((t): t is Task => !!t && taskMatches(t, f));

  const nq = normalize(q.trim());
  const score = (title: string, ts: number) => (normalize(title).includes(nq) ? 1e13 : 0) + ts;
  notes.sort((a, b) => score(b.title, b.updatedAt) - score(a.title, a.updatedAt));
  tasks.sort((a, b) => score(b.title, b.updatedAt) - score(a.title, a.updatedAt));
  const total = notes.length + tasks.length;
  return { notes: notes.slice(0, limit), tasks: tasks.slice(0, limit), total };
}
