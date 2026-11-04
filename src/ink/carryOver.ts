import type { InkPage, InkTaskArea, Note, Stroke } from '../db/types';
import { maxTaskRows, taskAreaLayout, taskRowOfStroke, taskRowTop } from './render';
import { clamp, uid } from '../lib/util';
import { db } from '../db/db';
import { isActive } from '../db/repo';

/**
 * Übernahme offener handschriftlicher Aufgaben
 * (Aufgabenbereich unten auf Handschrift-Seiten) auf eine neue Seite oder in die nächste Handschrift-Notiz.
 *
 * Übernommene Zeilen werden an der Quelle als „übertragen“ (Pfeil) markiert. Sie zählen dort nicht
 * mehr als offen – so wandert jede Aufgabe genau einmal weiter und taucht nicht doppelt auf.
 */

export const DEFAULT_TASK_ROWS = 10;

export interface OpenTaskRow {
  pageId: string;
  row: number;
  rowTop: number;
  strokes: Stroke[];
}

/** Nicht abgehakte und noch nicht übertragene Zeilen mit Handschrift */
export function openTaskRows(page: InkPage): OpenTaskRow[] {
  const area = page.tasks;
  if (!area) return [];
  const rows = taskAreaLayout(page, area).rows;
  const byRow = new Map<number, Stroke[]>();
  for (const st of page.strokes) {
    const r = taskRowOfStroke(page, st);
    if (r < 0 || area.checked[r] || area.carried?.[r]) continue;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(st);
  }
  return rows
    .filter((r) => byRow.has(r.index))
    .map((r) => ({ pageId: page.id, row: r.index, rowTop: taskRowTop(r), strokes: byRow.get(r.index)! }));
}

/**
 * Schreibt die Zeilen in den Aufgabenbereich der Zielseite (wird bei Bedarf angelegt bzw. vergrößert).
 * Belegt werden die obersten freien Zeilen. Gibt die tatsächlich übernommenen Zeilen zurück
 * (passen nicht alle auf die Seite, bleiben die übrigen an der Quelle offen).
 */
export function placeTaskRows(target: InkPage, open: OpenTaskRow[]): { page: InkPage; placed: OpenTaskRow[] } {
  const prev: InkTaskArea = target.tasks ?? { rows: DEFAULT_TASK_ROWS, checked: [] };
  const used = new Set<number>();
  for (const st of target.strokes) {
    const r = taskRowOfStroke(target, st);
    if (r >= 0) used.add(r);
  }
  const curRows = target.tasks ? taskAreaLayout(target, prev).rows.length : 0;
  const free = Math.max(0, curRows - used.size);
  const max = maxTaskRows(target);
  // Bereich wächst nach oben: neue Zeilen kommen oben hinzu, bestehende Zeilen behalten ihren Platz
  const wanted = clamp(Math.max(curRows, DEFAULT_TASK_ROWS, curRows + (open.length - free)), 1, max);
  const grow = target.tasks ? wanted - curRows : 0;
  const shift = <T,>(arr: T[] | undefined, fill: T) =>
    target.tasks ? [...Array(grow).fill(fill), ...Array.from({ length: curRows }, (_, i) => arr?.[i] ?? fill)] : [];
  const area: InkTaskArea = { rows: wanted, checked: shift(prev.checked, false), carried: shift(prev.carried, false) };
  const page: InkPage = { ...target, tasks: area, strokes: [...target.strokes] };
  const usedAfter = new Set([...used].map((r) => r + grow));
  const rows = taskAreaLayout(page, area).rows.filter((r) => !usedAfter.has(r.index));
  const placed = open.slice(0, rows.length);
  placed.forEach((o, i) => {
    const dy = taskRowTop(rows[i]) - o.rowTop;
    for (const st of o.strokes) {
      const pts = st.points.slice();
      for (let k = 1; k < pts.length; k += 3) pts[k] = +(pts[k] + dy).toFixed(2);
      page.strokes.push({ ...st, id: uid(), points: pts });
    }
  });
  return { page, placed };
}

/** Markiert übernommene Zeilen an der Quelle als übertragen */
export function markCarried(page: InkPage, rows: number[]): InkPage {
  if (!page.tasks || !rows.length) return page;
  const carried = [...(page.tasks.carried ?? [])];
  for (const r of rows) carried[r] = true;
  return { ...page, tasks: { ...page.tasks, carried } };
}

/** Kandidat für „offene Aufgaben übernehmen“ beim Anlegen einer neuen Handschrift-Notiz */
export interface CarrySource {
  note: Note;
  pages: InkPage[];
  open: OpenTaskRow[];
  /** Hatte die Notiz überhaupt einen Aufgabenbereich (dann bekommt die neue Notiz auch einen) */
  hasArea: boolean;
}

export function collectOpenRows(pages: InkPage[]): OpenTaskRow[] {
  return [...pages].sort((a, b) => a.index - b.index).flatMap(openTaskRows);
}

/* ------------------------------------------------------------------ */
/* Datenbank                                                           */
/* ------------------------------------------------------------------ */


/**
 * Quelle für „offene Aufgaben übernehmen“: die zuletzt bearbeitete Handschrift-Notiz (ohne `excludeId`),
 * die noch offene handschriftliche Aufgaben hat. Gibt es keine, aber eine Notiz mit Aufgabenbereich,
 * wird diese ohne offene Zeilen geliefert (die neue Notiz erhält dann einen leeren Aufgabenbereich).
 * Liefert null, wenn keine der letzten Notizen einen Aufgabenbereich hat.
 */
export async function findCarrySource(excludeId?: string): Promise<CarrySource | null> {
  // Ohne Index-Cursor lesen (Safari) und hier sortieren
  const notes = (await db.notes.where('type').equals('ink').toArray())
    .filter((n) => isActive(n) && n.id !== excludeId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 25);
  let withArea: CarrySource | null = null;
  for (const note of notes) {
    const pages = await db.inkPages.where('noteId').equals(note.id).toArray();
    if (!pages.some((p) => p.tasks)) continue;
    const src = { note, pages, open: collectOpenRows(pages), hasArea: true };
    if (src.open.length) return src;
    withArea ??= src;
  }
  return withArea;
}

/**
 * Überträgt Zeilen auf die erste Seite der Notiz `targetNoteId`
 * (bei `rows = []` wird nur ein leerer Aufgabenbereich angelegt). Gibt die Zahl der übernommenen Zeilen zurück.
 */
export async function carryIntoNote(targetNoteId: string, rows: OpenTaskRow[]): Promise<number> {
  return db.transaction('rw', db.inkPages, async () => {
    const target = (await db.inkPages.where('noteId').equals(targetNoteId).toArray()).sort((a, b) => a.index - b.index)[0];
    if (!target) return 0;
    const { page, placed } = placeTaskRows(target, rows);
    await db.inkPages.put({ ...page, updatedAt: Date.now() });
    const byPage = new Map<string, number[]>();
    for (const p of placed) byPage.set(p.pageId, [...(byPage.get(p.pageId) ?? []), p.row]);
    for (const [pageId, rs] of byPage) {
      const src = await db.inkPages.get(pageId);
      if (src) await db.inkPages.put({ ...markCarried(src, rs), updatedAt: Date.now() });
    }
    return placed.length;
  });
}
