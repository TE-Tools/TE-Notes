// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { newInkPage } from '../db/repo';
import { hitTaskBox, maxTaskRows, taskAreaLayout } from '../ink/render';
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

  it('wird im PDF-Export mit ausgegeben', async () => {
    const p = { ...newInkPage('n', 0), tasks: { rows: 4, checked: [false, true] } };
    const blob = await exportInkPdf({ id: 'n', title: 'Test' } as Note, [p]);
    expect(blob.size).toBeGreaterThan(500);
  });
});
