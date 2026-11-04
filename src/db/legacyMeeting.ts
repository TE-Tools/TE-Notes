import type { JSONContent } from '@tiptap/react';
import type { Note, NoteBody, Task } from './types';
import { fmtDate, fmtDateTime } from '../lib/util';
import { makeExcerpt } from '../lib/text';

/**
 * Die eigene Besprechungsplanung wurde entfernt (Schema 3).
 * Ältere Besprechungen – aus der lokalen Datenbank oder aus Sicherungen – werden
 * verlustfrei in normale Textnotizen umgewandelt:
 *  - Datum, Ort, Thema und Teilnehmer stehen als Kopfzeilen am Anfang des Inhalts,
 *  - Entscheidungen als nummerierte Liste am Ende,
 *  - eine gesetzte Wiedervorlage wird zur Aufgabe mit Fälligkeitsdatum.
 */

export interface LegacyMeetingInfo {
  date?: unknown;
  participants?: unknown;
  topic?: unknown;
  location?: unknown;
  decisions?: unknown;
  followUpDate?: unknown;
}

type LegacyNote = Omit<Note, 'type'> & { type: string; meeting?: LegacyMeetingInfo };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const para = (label: string, value: string): JSONContent => ({
  type: 'paragraph',
  content: [
    { type: 'text', text: label + ' ', marks: [{ type: 'bold' }] },
    { type: 'text', text: value }
  ]
});

/** Feste ID, damit wiederholte Importe keine doppelten Wiedervorlage-Aufgaben erzeugen */
export const followUpTaskId = (noteId: string) => 'wv-' + noteId;

export function isLegacyMeeting(n: { type: string }) {
  return n.type === 'meeting';
}

/**
 * Wandelt eine Besprechung in eine Textnotiz um. `updatedAt` bleibt unverändert,
 * damit der Import-Abgleich (Konflikterkennung) zwischen Geräten stabil bleibt.
 */
export function convertLegacyMeeting(
  raw: LegacyNote,
  body: NoteBody | undefined
): { note: Note; body: NoteBody; task: Task | null } {
  const m = raw.meeting ?? {};
  const date = str(m.date);
  const location = str(m.location);
  const topic = str(m.topic);
  const participants = list(m.participants);
  const decisions = list(m.decisions);
  const followUp = typeof m.followUpDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.followUpDate) ? m.followUpDate : null;

  const head: JSONContent[] = [];
  const headText: string[] = [];
  const add = (label: string, value: string) => {
    if (!value) return;
    head.push(para(label, value));
    headText.push(`${label} ${value}`);
  };
  add('Besprechung am', fmtDateTime(date) || date);
  add('Ort:', location);
  add('Thema:', topic);
  add('Teilnehmer:', participants.join(', '));
  add('Wiedervorlage:', followUp ? fmtDate(followUp) : '');

  const tail: JSONContent[] = [];
  const tailText: string[] = [];
  if (decisions.length) {
    tail.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Entscheidungen' }] });
    tail.push({
      type: 'orderedList',
      attrs: { start: 1 },
      content: decisions.map((d) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: d }] }] }))
    });
    tailText.push('Entscheidungen', ...decisions);
  }

  const original = body?.doc?.content ?? [];
  const hasOriginal = original.some((b) => JSON.stringify(b) !== '{"type":"paragraph"}');
  const content = [...head, ...(head.length && hasOriginal ? [{ type: 'horizontalRule' }] : []), ...(hasOriginal ? original : []), ...tail];
  const text = [...headText, body?.text ?? '', ...tailText].filter((s) => s.trim()).join('\n');

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { meeting: _drop, ...rest } = raw;
  const note: Note = {
    ...(rest as Note),
    type: 'text',
    excerpt: makeExcerpt(text)
  };
  const newBody: NoteBody = {
    id: raw.id,
    doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    text,
    updatedAt: body?.updatedAt ?? raw.updatedAt
  };

  let task: Task | null = null;
  if (followUp && !raw.deletedAt) {
    task = {
      id: followUpTaskId(raw.id),
      title: 'Wiedervorlage: ' + (raw.title || 'Besprechung'),
      description: '',
      dueDate: followUp,
      priority: 2,
      status: 'open',
      noteId: raw.id,
      projectId: raw.projectId ?? null,
      categoryId: raw.categoryId ?? null,
      assignee: '',
      createdAt: raw.updatedAt,
      updatedAt: raw.updatedAt,
      completedAt: 0,
      deletedAt: 0
    };
  }
  return { note, body: newBody, task };
}
