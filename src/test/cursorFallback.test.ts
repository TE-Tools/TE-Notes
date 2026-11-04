// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setDb, db, TeNotesDB } from '../db/db';
import { createNote, createTask, recentNotes, updateNote } from '../db/repo';
import { __forceCursorFallback } from '../db/cursorFallback';
import { search } from '../lib/search';

let n = 0;
beforeEach(async () => {
  __setDb(new TeNotesDB('cf-' + ++n));
  await db.open();
  for (let i = 0; i < 40; i++) {
    const id = await createNote(i % 3 === 0 ? 'ink' : 'text', { title: 'Notiz ' + (i % 7) });
    await updateNote(id, { tags: i % 2 ? ['a', 'b'] : ['b', 'c'], pinned: i % 5 === 0 ? 1 : 0, updatedAt: 1000 + (i % 9) } as never);
    await createTask({ title: 'Aufgabe ' + i, dueDate: i % 4 ? `2026-11-${String((i % 28) + 1).padStart(2, '0')}` : null });
  }
});
afterEach(() => __forceCursorFallback(false));

const queries: Record<string, () => Promise<unknown>> = {
  orderByReverseLimit: () => db.notes.orderBy('updatedAt').reverse().filter((x) => !x.deletedAt).limit(7).toArray().then((r) => r.map((x) => x.id)),
  orderByForward: () => db.notes.orderBy('updatedAt').primaryKeys(),
  aboveReverse: () => db.notes.where('updatedAt').above(1003).reverse().primaryKeys(),
  anyOf: () => db.tasks.where('status').anyOf('open', 'inprogress').primaryKeys(),
  uniqueTags: () => db.notes.orderBy('tags').uniqueKeys(),
  uniqueTagsReverse: () => db.notes.orderBy('tags').reverse().uniqueKeys(),
  sortBy: () => db.notes.where('type').equals('ink').reverse().sortBy('title').then((r) => r.map((x) => x.id)),
  compound: () => db.notes.where('[type+archived+deletedAt]').equals(['text', 0, 0]).filter(() => true).primaryKeys(),
  offset: () => db.notes.orderBy('updatedAt').offset(5).limit(10).primaryKeys(),
  recent: () => recentNotes(9).then((r) => r.map((x) => x.id)),
  search: () => search('notiz 3').then((r) => r.notes.map((x) => x.id).sort())
};

describe('Cursor-Ausweichweg (Safari „Unable to open cursor“)', () => {
  it('liefert dieselben Ergebnisse wie der echte Cursor', async () => {
    for (const [name, q] of Object.entries(queries)) {
      __forceCursorFallback(false);
      const native = await q();
      __forceCursorFallback(true);
      const fallback = await q();
      expect(fallback, name).toEqual(native);
    }
  });

  it('modify() funktioniert im Ausweichweg', async () => {
    __forceCursorFallback(true);
    await db.notes.where('type').equals('ink').filter(() => true).modify({ pinned: 1 });
    __forceCursorFallback(false);
    const ms = await db.notes.where('type').equals('ink').toArray();
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((m) => m.pinned === 1)).toBe(true);
  });

  it('springt bei einem UnknownError automatisch auf den Ausweichweg', async () => {
    const proto = IDBIndex.prototype as unknown as { openCursor: (...a: unknown[]) => IDBRequest };
    const orig = proto.openCursor;
    // Wie Safari: die Anfrage scheitert während der Ereignis-Auslieferung
    proto.openCursor = function () {
      const req = orig.apply(this, arguments as never);
      let onerror: ((e: unknown) => void) | null = null;
      req.onsuccess = () => {
        onerror?.({ target: { error: Object.assign(new Error('Unable to open cursor'), { name: 'UnknownError' }) }, preventDefault() {}, stopPropagation() {} });
      };
      return { set onsuccess(_f: unknown) {}, set onerror(f: (e: unknown) => void) { onerror = f; } } as unknown as IDBRequest;
    };
    try {
      const r = await db.notes.orderBy('updatedAt').reverse().limit(3).toArray();
      expect(r).toHaveLength(3);
    } finally {
      proto.openCursor = orig;
    }
  });
});
