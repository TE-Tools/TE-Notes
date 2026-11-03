import { jsPDF } from 'jspdf';
import { zipSync } from 'fflate';
import type { InkPage, Note } from '../db/types';
import { BitmapCache } from './assets';
import { HIGHLIGHTER_ALPHA, renderPageToCanvas, strokeOutline } from './render';
import { blobToDataUrl } from '../lib/images';
import { db } from '../db/db';

const PX_TO_PT = 0.75; // 96 dpi → 72 dpi

function pageAssets(pages: InkPage[]) {
  return [...new Set(pages.flatMap((p) => [p.bgAttachmentId, ...p.images.map((i) => i.attachmentId)]).filter(Boolean))] as string[];
}

async function attachmentDataUrl(id: string): Promise<{ url: string; fmt: string } | null> {
  const att = await db.attachments.get(id);
  if (!att) return null;
  const url = await blobToDataUrl(att.blob);
  const fmt = att.mime.includes('png') ? 'PNG' : 'JPEG';
  if (!/png|jpe?g/.test(att.mime)) {
    // andere Formate (z. B. WebP/HEIC) über Canvas in JPEG umwandeln
    const c = new BitmapCache(1);
    await c.loadAll([id]);
    const bmp = c.view.get(id) as ImageBitmap;
    const cv = document.createElement('canvas');
    cv.width = (bmp as ImageBitmap).width;
    cv.height = (bmp as ImageBitmap).height;
    cv.getContext('2d')!.drawImage(bmp, 0, 0);
    const out = { url: cv.toDataURL('image/jpeg', 0.9), fmt: 'JPEG' };
    c.clear();
    return out;
  }
  return { url, fmt };
}

/**
 * PDF-Export mit Vektorstrichen: Handschrift bleibt im PDF in jeder Vergrößerung scharf.
 * Hintergründe (PDF-Import) und Bilder werden als Bild eingebettet.
 */
export async function exportInkPdf(note: Note, pages: InkPage[]): Promise<Blob> {
  const first = pages[0];
  const pdf = new jsPDF({
    unit: 'pt',
    format: [first.width * PX_TO_PT, first.height * PX_TO_PT],
    orientation: first.width > first.height ? 'landscape' : 'portrait',
    compress: true
  });
  pdf.setProperties({ title: note.title || 'Handschrift', creator: 'TE Notes – TE Digital' });
  const dataUrls = new Map<string, { url: string; fmt: string } | null>();
  for (const id of pageAssets(pages)) dataUrls.set(id, await attachmentDataUrl(id));

  pages.forEach((page, idx) => {
    const W = page.width * PX_TO_PT;
    const H = page.height * PX_TO_PT;
    if (idx > 0) pdf.addPage([W, H], W > H ? 'landscape' : 'portrait');
    const k = PX_TO_PT;

    if (page.bgAttachmentId) {
      const d = dataUrls.get(page.bgAttachmentId);
      if (d) pdf.addImage(d.url, d.fmt, 0, 0, W, H, undefined, 'FAST');
    } else if (page.background !== 'blank') {
      if (page.background === 'lines') {
        pdf.setDrawColor(213, 219, 229);
        pdf.setLineWidth(0.6);
        for (let y = 104; y < page.height - 40; y += 32) pdf.line(48 * k, y * k, (page.width - 48) * k, y * k);
        pdf.setDrawColor(240, 196, 196);
        pdf.line(96 * k, 40 * k, 96 * k, (page.height - 40) * k);
      } else if (page.background === 'grid') {
        pdf.setDrawColor(225, 230, 238);
        pdf.setLineWidth(0.5);
        for (let x = 25; x < page.width; x += 24) pdf.line(x * k, 0, x * k, H);
        for (let y = 25; y < page.height; y += 24) pdf.line(0, y * k, W, y * k);
      } else if (page.background === 'dots') {
        pdf.setFillColor(195, 202, 214);
        for (let y = 25; y < page.height; y += 24) for (let x = 25; x < page.width; x += 24) pdf.circle(x * k, y * k, 1.0, 'F');
      }
    }

    for (const im of page.images) {
      const d = dataUrls.get(im.attachmentId);
      if (d) pdf.addImage(d.url, d.fmt, im.x * k, im.y * k, im.w * k, im.h * k, undefined, 'FAST');
    }

    for (const s of page.strokes) {
      const outline = strokeOutline(s);
      if (outline.length < 3) continue;
      const [r, g, b] = hexToRgb(s.color);
      pdf.setFillColor(r, g, b);
      const highlight = s.tool === 'highlighter';
      if (highlight) pdf.setGState(pdf.GState({ opacity: HIGHLIGHTER_ALPHA }));
      // Polygon mit Kurven glätten (wie auf dem Bildschirm)
      const p0 = outline[0];
      pdf.moveTo(p0[0] * k, p0[1] * k);
      for (let i = 1; i < outline.length; i++) {
        const a = outline[i];
        const bb = outline[(i + 1) % outline.length];
        const mx = (a[0] + bb[0]) / 2, my = (a[1] + bb[1]) / 2;
        // quadratische Kurve als kubische Bézierkurve ausdrücken
        const prev = i === 1 ? p0 : [(outline[i - 1][0] + a[0]) / 2, (outline[i - 1][1] + a[1]) / 2];
        const c1x = prev[0] + (2 / 3) * (a[0] - prev[0]);
        const c1y = prev[1] + (2 / 3) * (a[1] - prev[1]);
        const c2x = mx + (2 / 3) * (a[0] - mx);
        const c2y = my + (2 / 3) * (a[1] - my);
        pdf.curveTo(c1x * k, c1y * k, c2x * k, c2y * k, mx * k, my * k);
      }
      pdf.close();
      pdf.fill();
      if (highlight) pdf.setGState(pdf.GState({ opacity: 1 }));
    }
  });
  return pdf.output('blob');
}

/** Bildexport: eine Seite → PNG, mehrere Seiten → ZIP mit PNG-Dateien */
export async function exportInkImages(note: Note, pages: InkPage[]): Promise<{ blob: Blob; ext: 'png' | 'zip' }> {
  const cache = new BitmapCache(9999);
  await cache.loadAll(pageAssets(pages));
  try {
    const toPng = (p: InkPage) =>
      new Promise<Blob>((res, rej) => {
        const c = renderPageToCanvas(p, cache.view, 2);
        c.toBlob((b) => {
          c.width = c.height = 0;
          b ? res(b) : rej(new Error('Bild konnte nicht erzeugt werden'));
        }, 'image/png');
      });
    if (pages.length === 1) return { blob: await toPng(pages[0]), ext: 'png' };
    const files: Record<string, Uint8Array> = {};
    const base = (note.title || 'Handschrift').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60);
    for (let i = 0; i < pages.length; i++) {
      files[`${base} - Seite ${String(i + 1).padStart(2, '0')}.png`] = new Uint8Array(await (await toPng(pages[i])).arrayBuffer());
    }
    return { blob: new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), ext: 'zip' };
  } finally {
    cache.clear();
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
