// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { newInkPage } from '../db/repo';
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
