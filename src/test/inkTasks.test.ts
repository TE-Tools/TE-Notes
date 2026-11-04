// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createNote, newInkPage } from '../db/repo';
import { __setDb, db, TeNotesDB } from '../db/db';
import { carryIntoNote, DEFAULT_TASK_ROWS, findCarrySource, markCarried, openTaskRows, placeTaskRows } from '../ink/carryOver';
import { hitTaskBox, hitTaskControl, maxTaskRows, taskAreaLayout, taskControls, taskRowOfStroke, taskRowTop } from '../ink/render';
import { exportInkPdf } from '../ink/inkExport';
import type { Note } from '../db/types';

describe('Aufgabenbereich in Handschrift-Seiten', () => {
  it('liegt unten auf der Seite und Kästchen sind antippbar', () => {
    const p = { ...newInkPage('n', 0), tasks: { rows: 6, checked: [] } };
    const { top, bottom, rows } = taskAreaLayout(p, p.tasks);
    expect(rows).toHaveLength(6);
    expect(bottom).toBeLessThanOrEqual(p.height);
    expect(top).toBeGreaterThan(p.height / 2);
    const b = rows[2].box;
    expect(hitTaskBox(p, b.x + b.s / 2, b.y + b.s / 2)).toBe(2);
    expect(hitTaskBox(p, p.width / 2, b.y + b.s / 2)).toBe(-1);
    expect(hitTaskBox({ ...p, tasks: null }, b.x, b.y)).toBe(-1);
    expect(taskAreaLayout(p, { rows: 999, checked: [] }).rows.length).toBe(maxTaskRows(p));
  });

  it('ordnet Handschrift der richtigen Zeile zu und erkennt die +/−-Knöpfe', () => {
    const p = { ...newInkPage('n', 0), tasks: { rows: 5, checked: [] as boolean[] } };
    const rows = taskAreaLayout(p, p.tasks).rows;
    const y = taskRowTop(rows[3]) + 30;
    const stroke = { id: 's', tool: 'pen' as const, color: '#000', size: 2, simulated: true, points: [200, y, 0.5, 300, y + 4, 0.5] };
    p.strokes = [stroke];
    expect(taskRowOfStroke(p, stroke)).toBe(3);
    const above = { ...stroke, id: 't', points: [200, 100, 0.5, 300, 104, 0.5] };
    expect(taskRowOfStroke(p, above)).toBe(-1);
    const c = taskControls(p, p.tasks);
    expect(hitTaskControl(p, c.add.x, c.add.y)).toBe('add');
    expect(hitTaskControl(p, c.remove.x, c.remove.y)).toBe('remove');
    expect(hitTaskControl(p, 100, 100)).toBe(null);
  });

  it('wird im PDF-Export mit ausgegeben', async () => {
    const p = { ...newInkPage('n', 0), tasks: { rows: 4, checked: [false, true] } };
    const blob = await exportInkPdf({ id: 'n', title: 'Test' } as Note, [p]);
    expect(blob.size).toBeGreaterThan(500);
  });
});

describe('Offene handschriftliche Aufgaben übernehmen', () => {
  const strokeInRow = (p: ReturnType<typeof newInkPage>, row: number, id: string) => {
    const r = taskAreaLayout(p, p.tasks!).rows[row];
    const y = taskRowTop(r) + 26;
    return { id, tool: 'pen' as const, color: '#000', size: 2, simulated: true, points: [150, y, 0.5, 400, y + 2, 0.5] };
  };

  it('übernimmt nur offene, nicht übertragene Zeilen und markiert sie an der Quelle', () => {
    const src = { ...newInkPage('a', 0), tasks: { rows: 6, checked: [false, true, false, false], carried: [false, false, false, true] } };
    src.strokes = [strokeInRow(src, 0, 's0'), strokeInRow(src, 1, 's1'), strokeInRow(src, 2, 's2'), strokeInRow(src, 3, 's3')];
    const open = openTaskRows(src);
    expect(open.map((o) => o.row)).toEqual([0, 2]);

    const { page, placed } = placeTaskRows(newInkPage('b', 0), open);
    expect(placed).toHaveLength(2);
    expect(page.tasks?.rows).toBe(DEFAULT_TASK_ROWS);
    expect(page.strokes.map((s) => taskRowOfStroke(page, s))).toEqual([0, 1]);
    expect(openTaskRows(page).map((o) => o.row)).toEqual([0, 1]);

    const marked = markCarried(src, placed.map((p) => p.row));
    expect(openTaskRows(marked)).toHaveLength(0);
  });

  it('vergrößert den Bereich, ohne vorhandene Zeilen zu verschieben', () => {
    const target = { ...newInkPage('b', 0), tasks: { rows: 2, checked: [false, true] } };
    target.strokes = [strokeInRow(target, 1, 'x')];
    const before = target.strokes[0].points.slice();
    const src = { ...newInkPage('a', 0), tasks: { rows: 3, checked: [] } };
    src.strokes = [strokeInRow(src, 0, 'a'), strokeInRow(src, 1, 'b'), strokeInRow(src, 2, 'c')];
    const { page, placed } = placeTaskRows(target, openTaskRows(src));
    expect(placed).toHaveLength(3);
    expect(page.strokes[0].points).toEqual(before);
    const last = page.tasks!.rows - 1;
    expect(taskRowOfStroke(page, page.strokes[0])).toBe(last);
    expect(page.tasks!.checked[last]).toBe(true);
    expect(new Set(page.strokes.map((s) => taskRowOfStroke(page, s))).size).toBe(4);
  });

  it('überträgt in die nächste Handschrift-Notiz', async () => {
    __setDb(new TeNotesDB('carry-' + Math.random()));
    await db.open();
    const a = await createNote('ink', { title: 'Woche 1' });
    const pa = (await db.inkPages.where('noteId').equals(a).first())!;
    const withArea = { ...pa, tasks: { rows: 4, checked: [false, true] } };
    withArea.strokes = [strokeInRow(withArea, 0, 'o'), strokeInRow(withArea, 1, 'd')];
    await db.inkPages.put(withArea);

    const source = await findCarrySource();
    expect(source?.note.id).toBe(a);
    expect(source?.open).toHaveLength(1);
    const b = await createNote('ink', { title: 'Woche 2' });
    expect(await carryIntoNote(b, source!.open)).toBe(1);
    const pb = (await db.inkPages.where('noteId').equals(b).first())!;
    expect(pb.tasks).toBeTruthy();
    expect(openTaskRows(pb)).toHaveLength(1);
    expect(openTaskRows((await db.inkPages.get(pa.id))!)).toHaveLength(0);
    // Ein zweites Mal wird nichts mehr angeboten
    expect((await findCarrySource(b))?.open).toHaveLength(0);
  });
});
