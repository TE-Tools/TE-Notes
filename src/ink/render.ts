import { getStroke } from 'perfect-freehand';
import type { InkImage, InkPage, PageBackground, Stroke } from '../db/types';

/* ------------------------------------------------------------------ */
/* Geometrie                                                           */
/* ------------------------------------------------------------------ */

export const PAGE_GAP = 28;
export const HIGHLIGHTER_ALPHA = 0.38;

export function freehandOptions(s: Pick<Stroke, 'tool' | 'size' | 'simulated'>, last = true) {
  if (s.tool === 'highlighter') {
    return { size: s.size, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last, start: { cap: false }, end: { cap: false } };
  }
  return {
    size: s.size,
    thinning: s.simulated ? 0.45 : 0.62,
    smoothing: 0.55,
    streamline: s.simulated ? 0.5 : 0.38,
    simulatePressure: s.simulated,
    easing: (t: number) => t,
    last
  };
}

export function toInputPoints(points: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]]);
  return out;
}

/** Umriss-Polygon eines Strichs (Vektordaten → bleibt bei jedem Zoom scharf) */
export function strokeOutline(s: Stroke, last = true): number[][] {
  const pts = toInputPoints(s.points);
  if (pts.length === 1) pts.push([pts[0][0] + 0.1, pts[0][1] + 0.1, pts[0][2]]);
  return getStroke(pts, freehandOptions(s, last));
}

export function outlineToPath(outline: number[][]): Path2D {
  const p = new Path2D();
  const len = outline.length;
  if (len < 3) return p;
  let a = outline[0];
  let b = outline[1];
  p.moveTo(a[0], a[1]);
  for (let i = 1; i < len; i++) {
    a = outline[i];
    b = outline[(i + 1) % len];
    p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  p.closePath();
  return p;
}

const pathCache = new WeakMap<Stroke, Path2D>();
const boundsCache = new WeakMap<Stroke, Bounds>();

export function strokePath(s: Stroke): Path2D {
  let p = pathCache.get(s);
  if (!p) {
    p = outlineToPath(strokeOutline(s));
    pathCache.set(s, p);
  }
  return p;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function strokeBounds(s: Stroke): Bounds {
  let b = boundsCache.get(s);
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < s.points.length; i += 3) {
      const x = s.points[i], y = s.points[i + 1];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    const pad = s.size;
    b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    boundsCache.set(s, b);
  }
  return b;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Prüft, ob ein Punkt (Seitenkoordinaten) einen Strich innerhalb des Radius trifft */
export function hitStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const b = strokeBounds(s);
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
  const p = s.points;
  const tol = r + s.size / 2;
  if (p.length <= 3) return Math.hypot(p[0] - x, p[1] - y) <= tol;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (distToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= tol) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Seitenlayout                                                        */
/* ------------------------------------------------------------------ */

export interface PageLayout {
  page: InkPage;
  top: number; // Weltkoordinate
}

export function layoutPages(pages: InkPage[]): { items: PageLayout[]; width: number; height: number } {
  let y = 0;
  let width = 0;
  const items = pages.map((p) => {
    const it = { page: p, top: y };
    y += p.height + PAGE_GAP;
    width = Math.max(width, p.width);
    return it;
  });
  return { items, width, height: Math.max(0, y - PAGE_GAP) };
}

/* ------------------------------------------------------------------ */
/* Zeichnen (in Seitenkoordinaten, Transformation durch Aufrufer)      */
/* ------------------------------------------------------------------ */

export function drawBackground(ctx: CanvasRenderingContext2D, page: InkPage, bg: CanvasImageSource | null, unit = 1) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, page.width, page.height);
  if (bg) {
    ctx.drawImage(bg, 0, 0, page.width, page.height);
    return;
  }
  drawPattern(ctx, page.background, page.width, page.height, unit);
}

export function drawPattern(ctx: CanvasRenderingContext2D, kind: PageBackground, w: number, h: number, unit = 1) {
  if (kind === 'blank') return;
  ctx.save();
  if (kind === 'lines') {
    ctx.strokeStyle = '#d5dbe5';
    ctx.lineWidth = Math.max(0.6, unit * 0.8);
    ctx.beginPath();
    for (let y = 104; y < h - 40; y += 32) {
      ctx.moveTo(48, y);
      ctx.lineTo(w - 48, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#f0c4c4';
    ctx.beginPath();
    ctx.moveTo(96, 40);
    ctx.lineTo(96, h - 40);
    ctx.stroke();
  } else if (kind === 'grid') {
    ctx.strokeStyle = '#e1e6ee';
    ctx.lineWidth = Math.max(0.5, unit * 0.7);
    ctx.beginPath();
    for (let x = 25; x < w; x += 24) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 25; y < h; y += 24) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  } else if (kind === 'dots') {
    ctx.fillStyle = '#c3cad6';
    const r = 1.3;
    for (let y = 25; y < h; y += 24) for (let x = 25; x < w; x += 24) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, path?: Path2D) {
  const p = path ?? strokePath(s);
  ctx.fillStyle = s.color;
  if (s.tool === 'highlighter') {
    ctx.save();
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fill(p);
    ctx.restore();
  } else {
    ctx.fill(p);
  }
}

export function drawImages(ctx: CanvasRenderingContext2D, images: InkImage[], cache: Map<string, CanvasImageSource>) {
  for (const im of images) {
    const bmp = cache.get(im.attachmentId);
    if (bmp) ctx.drawImage(bmp, im.x, im.y, im.w, im.h);
    else {
      ctx.save();
      ctx.fillStyle = '#eef0f3';
      ctx.fillRect(im.x, im.y, im.w, im.h);
      ctx.restore();
    }
  }
}

/** Zeichnet den Seiteninhalt; `visible` (Seitenkoordinaten) erlaubt das Auslassen unsichtbarer Striche */
export function drawPageContent(
  ctx: CanvasRenderingContext2D,
  page: InkPage,
  cache: Map<string, CanvasImageSource>,
  visible?: Bounds,
  unit = 1
) {
  drawBackground(ctx, page, page.bgAttachmentId ? cache.get(page.bgAttachmentId) ?? null : null, unit);
  drawImages(ctx, page.images, cache);
  for (const s of page.strokes) {
    if (visible) {
      const b = strokeBounds(s);
      if (b.x1 < visible.x0 || b.x0 > visible.x1 || b.y1 < visible.y0 || b.y0 > visible.y1) continue;
    }
    drawStroke(ctx, s);
  }
}

/** Eine Seite als Rasterbild (für PNG-Export) */
export function renderPageToCanvas(page: InkPage, cache: Map<string, CanvasImageSource>, scale = 2): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(page.width * scale);
  c.height = Math.round(page.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  drawPageContent(ctx, page, cache, undefined, 1 / scale);
  return c;
}
