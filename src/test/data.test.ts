// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { __setDb, db, TeNotesDB } from '../db/db';
import {
  addAttachment, archiveNote, createNote, createTask, deleteCategory, deleteNotePermanently, ensureSeeded,
  recentNotes, restoreNote, saveCategory, saveNoteBody, saveProject, trashNote, updateNote, updateTask
} from '../db/repo';
import { search } from '../lib/search';
import { analyzeImport, applyImport, exportFullBackup, exportNotes, parseBackup } from '../lib/backup';

let n = 0;
beforeEach(async () => {
  __setDb(new TeNotesDB('test-' + ++n));
  await db.open();
});

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

describe('Notizen', () => {
  it('legt an, speichert Inhalt und findet per Volltext (Umlaute)', async () => {
    const id = await createNote('text', { title: 'Margenplanung Q3' });
    await saveNoteBody(id, doc('Besprechung mit Müller über Größenvorteile'), 'Besprechung mit Müller über Größenvorteile');
    const n1 = await db.notes.get(id);
    expect(n1?.excerpt).toContain('Müller');
    expect((await search('muller')).notes.map((x) => x.id)).toEqual([id]);
    expect((await search('größen')).notes).toHaveLength(1);
    expect((await search('marg q3')).notes).toHaveLength(1);
    expect((await search('marg xyz')).notes).toHaveLength(0);
  });

  it('Papierkorb, Wiederherstellen und endgültiges Löschen', async () => {
    const id = await createNote('text', { title: 'Weg damit' });
    await addAttachment(id, new Blob(['abc'], { type: 'text/plain' }), 'a.txt');
    const tid = await createTask({ title: 'Folgeaufgabe', noteId: id });
    await trashNote(id);
    expect((await recentNotes()).find((x) => x.id === id)).toBeUndefined();
    expect((await search('weg')).notes).toHaveLength(0);
    await restoreNote(id);
    expect((await recentNotes()).find((x) => x.id === id)).toBeDefined();
    await deleteNotePermanently(id);
    expect(await db.notes.get(id)).toBeUndefined();
    expect(await db.bodies.get(id)).toBeUndefined();
    expect(await db.attachments.where('noteId').equals(id).count()).toBe(0);
    expect((await db.tasks.get(tid))?.noteId).toBeNull();
  });

  it('Archiv entfernt Anheftung', async () => {
    const id = await createNote('text', { title: 'x' });
    await updateNote(id, { pinned: 1 });
    await archiveNote(id, true);
    const x = await db.notes.get(id);
    expect(x?.archived).toBe(1);
    expect(x?.pinned).toBe(0);
    expect(x?.archivedAt).toBeGreaterThan(0);
  });

  it('Kategorie umbenennen/löschen aktualisiert den Suchindex', async () => {
    const cat = await saveCategory({ name: 'Einkauf' });
    const id = await createNote('text', { title: 'Lieferant', categoryId: cat });
    await updateNote(id, { categoryId: cat });
    expect((await search('einkauf')).notes).toHaveLength(1);
    await saveCategory({ id: cat, name: 'Beschaffung' });
    expect((await search('einkauf')).notes).toHaveLength(0);
    expect((await search('beschaffung')).notes).toHaveLength(1);
    await deleteCategory(cat);
    expect((await search('beschaffung')).notes).toHaveLength(0);
    expect((await db.notes.get(id))?.categoryId).toBeNull();
  });
});

describe('Aufgaben', () => {
  it('Status erledigt setzt completedAt und Suche nach Verantwortlichem', async () => {
    const id = await createTask({ title: 'Angebot prüfen', assignee: 'Schmidt', dueDate: '2020-01-01' });
    expect((await search('schmidt')).tasks).toHaveLength(1);
    await updateTask(id, { status: 'done' });
    expect((await db.tasks.get(id))?.completedAt).toBeGreaterThan(0);
    await updateTask(id, { status: 'open' });
    expect((await db.tasks.get(id))?.completedAt).toBe(0);
    expect((await search('', { status: 'open' })).tasks).toHaveLength(1);
  });
});

describe('Sicherung', () => {
  it('vollständige Sicherung und Wiederherstellung in leere Datenbank', async () => {
    await ensureSeeded();
    const p = await saveProject({ name: 'SAP Migration' });
    const id = await createNote('meeting', { title: 'Kickoff', projectId: p });
    await saveNoteBody(id, doc('Protokoll'), 'Protokoll');
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 9]);
    const attId = await addAttachment(id, new Blob([bytes], { type: 'application/octet-stream' }), 'daten.bin');
    const ink = await createNote('ink', { title: 'Skizze' });
    const page = (await db.inkPages.where('noteId').equals(ink).first())!;
    await db.inkPages.update(page.id, {
      strokes: [{ id: 's1', tool: 'pen', color: '#000', size: 3, points: [1, 2, 0.5, 3, 4, 0.5], simulated: false }]
    });
    await createTask({ title: 'Folgetermin', noteId: id, projectId: p });

    const blob = await exportFullBackup();
    const parsed = await parseBackup(blob);
    expect(parsed.manifest.formatVersion).toBe(1);
    expect(parsed.data.notes).toHaveLength(2);

    __setDb(new TeNotesDB('restore-' + n));
    await db.open();
    await applyImport(parsed, 'replace');
    expect(await db.notes.count()).toBe(2);
    expect((await db.bodies.get(id))?.text).toBe('Protokoll');
    const att = await db.attachments.get(attId);
    expect(new Uint8Array(await att!.blob.arrayBuffer())).toEqual(bytes);
    expect((await db.inkPages.where('noteId').equals(ink).first())?.strokes).toHaveLength(1);
    expect(await db.tasks.count()).toBe(1);
    expect((await search('kickoff')).notes).toHaveLength(1);
    expect((await search('sap')).notes).toHaveLength(1);
  });

  it('erkennt Konflikte und führt nach Änderungsdatum zusammen', async () => {
    const a = await createNote('text', { title: 'Alpha' });
    const b = await createNote('text', { title: 'Beta' });
    const parsed = await parseBackup(await exportFullBackup());

    // Lokal: Alpha neuer bearbeitet, Beta gelöscht, Gamma neu
    await new Promise((r) => setTimeout(r, 5));
    await updateNote(a, { title: 'Alpha lokal neuer' });
    await deleteNotePermanently(b);
    await createNote('text', { title: 'Gamma' });
    // In der Sicherung: Alpha älter → Konflikt
    const analysis = await analyzeImport(parsed);
    expect(analysis.conflicts.map((c) => c.id)).toEqual([a]);
    expect(analysis.added.notes).toBe(1); // Beta

    await applyImport(parsed, 'merge-newer');
    expect((await db.notes.get(a))?.title).toBe('Alpha lokal neuer');
    expect((await db.notes.get(b))?.title).toBe('Beta');
    expect(await db.notes.count()).toBe(3);

    await applyImport(parsed, 'merge-newer', { ['notes:' + a]: 'incoming' });
    expect((await db.notes.get(a))?.title).toBe('Alpha');
  });

  it('Einzelnotiz-Export enthält nur diese Notiz', async () => {
    const a = await createNote('text', { title: 'Eins' });
    await createNote('text', { title: 'Zwei' });
    const parsed = await parseBackup(await exportNotes([a]));
    expect(parsed.manifest.scope).toBe('notes');
    expect(parsed.data.notes.map((x) => x.title)).toEqual(['Eins']);
  });

  it('lehnt ungültige Dateien ab', async () => {
    await expect(parseBackup(new Blob(['kein zip']))).rejects.toThrow(/keine gültige/);
  });
});

describe('Migration', () => {
  it('migriert eine Datenbank von Schema 1 auf Schema 2', async () => {
    const name = 'migrate-' + n;
    const old = new Dexie(name);
    old.version(1).stores({
      notes: 'id, type, updatedAt, createdAt, pinned, archived, archivedAt, deletedAt, categoryId, projectId, folderId, *tags',
      bodies: 'id', inkPages: 'id, noteId, [noteId+index]', attachments: 'id, noteId, kind',
      tasks: 'id, status, dueDate, noteId, projectId, categoryId, updatedAt, deletedAt',
      projects: 'id, name', categories: 'id, name', folders: 'id, name', settings: 'key', search: 'id, kind, refId, *words'
    });
    await old.table('notes').add({
      id: 'm1', type: 'meeting', title: 'Alt', excerpt: '', tags: [], pinned: 0, archived: 0, archivedAt: 0, deletedAt: 0,
      createdAt: 1, updatedAt: 1, categoryId: null, projectId: null, folderId: null,
      meeting: { date: '2024-05-01T10:00', participants: ['A'], topic: 'T' }
    });
    old.close();

    const migrated = new TeNotesDB(name);
    await migrated.open();
    expect(migrated.verno).toBe(2);
    const m = await migrated.notes.get('m1');
    expect(m?.meeting?.location).toBe('');
    expect(m?.meeting?.decisions).toEqual([]);
    expect(await migrated.notes.where('meeting.date').above('2024').count()).toBe(1);
  });
});

describe('Leistung', () => {
  it('bleibt mit 3000 Notizen schnell', async () => {
    const now = Date.now();
    const words = ['Angebot', 'Lieferung', 'Projekt', 'Kunde', 'Marge', 'Planung', 'Rechnung', 'Termin'];
    const notes = [];
    const bodies = [];
    const index = [];
    for (let i = 0; i < 3000; i++) {
      const text = `Notiz ${i} ${words[i % 8]} ${words[(i * 3) % 8]} Lorem ipsum dolor sit amet `.repeat(20);
      const id = 'n' + i;
      notes.push({
        id, type: 'text' as const, title: `Notiz ${i} ${words[i % 8]}`, excerpt: text.slice(0, 100), categoryId: null,
        projectId: null, folderId: null, tags: [], pinned: 0 as const, archived: 0 as const, archivedAt: 0, deletedAt: 0,
        createdAt: now - i * 1000, updatedAt: now - i * 1000
      });
      bodies.push({ id, doc: {}, text, updatedAt: now });
      const { tokenize } = await import('../lib/text');
      index.push({ id: 'note:' + id, kind: 'note' as const, refId: id, words: tokenize(notes[i].title, text) });
    }
    await db.notes.bulkAdd(notes);
    await db.bodies.bulkAdd(bodies);
    await db.search.bulkAdd(index);

    let t = performance.now();
    const recent = await recentNotes(20);
    const tRecent = performance.now() - t;
    expect(recent).toHaveLength(20);

    t = performance.now();
    const r = await search('marge notiz');
    const tSearch = performance.now() - t;
    expect(r.notes.length).toBeGreaterThan(0);
    // fake-indexeddb ist deutlich langsamer als echtes IndexedDB – großzügige Grenzen
    expect(tRecent).toBeLessThan(500);
    expect(tSearch).toBeLessThan(3000);
    console.log(`3000 Notizen: zuletzt bearbeitet ${tRecent.toFixed(0)} ms, Suche ${tSearch.toFixed(0)} ms`);
  }, 60000);
});
