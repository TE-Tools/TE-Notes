import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Dexie from 'dexie';
import {
  Eraser, FilePlus2, FileUp, Hand, Highlighter, ImagePlus, Maximize2, MousePointer2, PenTool, Redo2, Trash2, Undo2,
  ZoomIn, ZoomOut, LayoutTemplate, Fingerprint, ListChecks, Expand, Shrink, PanelTopOpen, PanelTopClose, X
} from 'lucide-react';
import { db } from '../db/db';
import { addAttachment, newInkPage, setSetting, updateNote } from '../db/repo';
import type { InkImage, InkPage, InkTaskArea, InkTool, Note, PageBackground, Stroke } from '../db/types';
import { BitmapCache } from './assets';
import {
  drawPageContent, drawStroke, hitStroke, hitTaskBox, hitTaskControl, layoutPages, maxTaskRows, outlineToPath, strokeOutline,
  taskAreaLayout, taskRowOfStroke, type PageLayout
} from './render';
import { DEFAULT_TASK_ROWS, markCarried, openTaskRows, placeTaskRows } from './carryOver';
import { renderPdf } from './pdfImport';
import { pickFiles } from '../components/FileSave';
import { confirmDialog, MenuButton, Modal, toast, toastError } from '../components/ui';
import { downscaleImage, imageSize, loadBitmap } from '../lib/images';
import { clamp, debounce, uid } from '../lib/util';
import { markDirty, registerFlusher, track } from '../lib/saver';
import { useSettings } from '../lib/hooks';
import { useWriteFullscreen } from '../lib/fullscreen';

type Tool = InkTool | 'eraser' | 'select' | 'hand';

type Command =
  | { t: 'add'; pageId: string; stroke: Stroke }
  | { t: 'erase'; items: { pageId: string; stroke: Stroke; index: number }[] }
  | { t: 'img-add'; pageId: string; image: InkImage }
  | { t: 'img-change'; pageId: string; before: InkImage; after: InkImage }
  | { t: 'img-del'; pageId: string; image: InkImage; index: number }
  | { t: 'clear'; pageId: string; strokes: Stroke[]; images: InkImage[] }
  | { t: 'tasks'; pageId: string; before: InkTaskArea | null; after: InkTaskArea | null };

const PEN_SIZES = [1.6, 2.6, 4.2];
const HL_SIZES = [12, 18, 28];
const ERASER_SIZES = [6, 14, 28];
const HL_COLORS = ['#f7d038', '#7ee081', '#6fc3f7', '#f78fb3'];
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 6;

interface View {
  x: number;
  y: number;
  z: number;
}

export function InkEditor({ note }: { note: Note }) {
  const settings = useSettings();
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const pagesRef = useRef<InkPage[]>([]);
  const layoutRef = useRef<PageLayout[]>([]);
  const docSize = useRef({ w: 794, h: 1123 });
  const viewRef = useRef<View>({ x: 0, y: 0, z: 1 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1, left: 0, top: 0 });
  const cacheRef = useRef<BitmapCache | null>(null);
  const undoRef = useRef<Command[]>([]);
  const redoRef = useRef<Command[]>([]);
  const dirtyPages = useRef(new Set<string>());
  const fitted = useRef(false);

  const [loaded, setLoaded] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoomPct, setZoomPct] = useState(100);
  const { fullscreen, toggleFullscreen, exitFullscreen } = useWriteFullscreen('ink-fullscreen');
  // Im Vollbild ist die große Werkzeugleiste eingeklappt (nur schwebende Kurzleiste)
  const [barOpen, setBarOpen] = useState(false);
  useEffect(() => {
    if (!fullscreen) setBarOpen(false);
  }, [fullscreen]);
  const [, setHistoryVersion] = useState(0);
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState('#1d1d1f');
  const [hlColor, setHlColor] = useState(HL_COLORS[0]);
  const [penSize, setPenSize] = useState(1);
  const [hlSize, setHlSize] = useState(1);
  const [eraserSize, setEraserSize] = useState(1);
  const [selected, setSelected] = useState<{ pageId: string; imageId: string } | null>(null);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const optsRef = useRef({ penColor, hlColor, penSize, hlSize, eraserSize, fingerDraws: settings.fingerDraws });
  optsRef.current = { penColor, hlColor, penSize, hlSize, eraserSize, fingerDraws: settings.fingerDraws };
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  if (!cacheRef.current) cacheRef.current = new BitmapCache(14, () => requestRender());

  /* ---------------------------------------------------------------- */
  /* Speichern                                                         */
  /* ---------------------------------------------------------------- */

  const saveNow = useCallback(async () => {
    const ids = [...dirtyPages.current];
    if (!ids.length) return;
    dirtyPages.current.clear();
    markDirty(-1);
    const pages = pagesRef.current.filter((p) => ids.includes(p.id)).map((p) => ({ ...p, updatedAt: Date.now() }));
    await track(
      db.transaction('rw', db.inkPages, async () => {
        await db.inkPages.bulkPut(pages);
      }).then(() => updateNote(note.id, { inkPageCount: pagesRef.current.length }))
    );
  }, [note.id]);

  const saveDebounced = useRef(debounce(() => void saveNow().catch(() => {}), 450)).current;

  const markPageDirty = (pageId: string) => {
    if (dirtyPages.current.size === 0) markDirty(1);
    dirtyPages.current.add(pageId);
    saveDebounced();
  };

  useEffect(() => {
    const off = registerFlusher(() => saveDebounced.flush());
    return () => {
      off();
      saveDebounced.flush();
    };
  }, [saveDebounced]);

  /* ---------------------------------------------------------------- */
  /* Laden                                                             */
  /* ---------------------------------------------------------------- */

  const relayout = () => {
    const l = layoutPages(pagesRef.current);
    layoutRef.current = l.items;
    docSize.current = { w: l.width || 794, h: l.height || 1123 };
    setPageCount(pagesRef.current.length);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      let pages = await db.inkPages.where('[noteId+index]').between([note.id, Dexie.minKey], [note.id, Dexie.maxKey]).toArray();
      if (!pages.length) {
        const p = newInkPage(note.id, 0, settings.defaultPageBackground);
        await db.inkPages.add(p);
        pages = [p];
      }
      if (!alive) return;
      pagesRef.current = pages;
      relayout();
      setLoaded(true);
    })().catch((e) => toastError(e, 'Handschrift konnte nicht geladen werden'));
    return () => {
      alive = false;
      cacheRef.current?.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  /* ---------------------------------------------------------------- */
  /* Ansicht & Zeichnen                                                */
  /* ---------------------------------------------------------------- */

  const clampView = () => {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    const { w: dw, h: dh } = docSize.current;
    v.z = clamp(v.z, MIN_ZOOM, MAX_ZOOM);
    const vw = w / v.z, vh = h / v.z;
    if (dw <= vw) v.x = -(vw - dw) / 2;
    else v.x = clamp(v.x, -40 / v.z, dw - vw + 40 / v.z);
    v.y = clamp(v.y, -Math.max(40, vh * 0.3), Math.max(0, dh - vh * 0.5));
  };

  const fitWidth = () => {
    const { w } = sizeRef.current;
    const v = viewRef.current;
    const curCenterY = v.y + sizeRef.current.h / 2 / v.z;
    v.z = clamp((w - (w < 700 ? 16 : 56)) / docSize.current.w, MIN_ZOOM, 2.2);
    v.y = curCenterY - sizeRef.current.h / 2 / v.z;
    if (!fitted.current) v.y = -24 / v.z;
    clampView();
    setZoomPct(Math.round(v.z * 100));
    requestRender();
  };

  const rafRef = useRef(0);
  const liveRafRef = useRef(0);
  function requestRender() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      renderBase();
    });
  }
  function requestLive() {
    if (liveRafRef.current) return;
    liveRafRef.current = requestAnimationFrame(() => {
      liveRafRef.current = 0;
      renderLive();
    });
  }

  const deskColor = () => (document.documentElement.dataset.theme === 'dark' ? '#141416' : '#e8e6e1');

  function renderBase() {
    const c = baseRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const { w, h, dpr } = sizeRef.current;
    const v = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = deskColor();
    ctx.fillRect(0, 0, w, h);
    const want: string[] = [];
    let cur = 0;
    const centerY = v.y + h / 2 / v.z;
    for (let i = 0; i < layoutRef.current.length; i++) {
      const { page, top } = layoutRef.current[i];
      if (centerY >= top - 14) cur = i;
      const sy = (top - v.y) * v.z;
      const sh = page.height * v.z;
      if (sy > h || sy + sh < 0) continue;
      if (page.bgAttachmentId) want.push(page.bgAttachmentId);
      for (const im of page.images) want.push(im.attachmentId);
      // Schatten
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect((-v.x) * v.z - 1, sy - 1, page.width * v.z + 2, sh + 3);
      // Seiteninhalt in Seitenkoordinaten
      ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * (-v.x * v.z), dpr * sy);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, page.width, page.height);
      ctx.clip();
      const visible = { x0: v.x, y0: v.y - top, x1: v.x + w / v.z, y1: v.y - top + h / v.z };
      drawPageContent(ctx, page, cacheRef.current!.view, visible, 1 / v.z, true);
      ctx.restore();
    }
    cacheRef.current!.want(want);
    setCurrentPage((p) => (p === cur ? p : cur));
    positionOverlay();
  }

  // Aktueller Strich
  const drawingRef = useRef<{ pointerId: number; pageIdx: number; stroke: Stroke; isTouch: boolean } | null>(null);

  function renderLive() {
    const c = liveRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const { w, h, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const d = drawingRef.current;
    if (!d) return;
    const v = viewRef.current;
    const { top, page } = layoutRef.current[d.pageIdx];
    ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * (-v.x * v.z), dpr * (top - v.y) * v.z);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, page.width, page.height);
    ctx.clip();
    const path = outlineToPath(strokeOutline(d.stroke, false));
    if (d.stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = d.stroke.color;
      ctx.fill(path);
    } else drawStroke(ctx, d.stroke, path);
    ctx.restore();
  }

  // Größe der Zeichenfläche
  useLayoutEffect(() => {
    if (!loaded) return;
    const stage = stageRef.current!;
    const resize = () => {
      const r = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      sizeRef.current = { w: r.width, h: r.height, dpr, left: r.left, top: r.top };
      for (const c of [baseRef.current!, liveRef.current!]) {
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.height * dpr);
        c.style.width = r.width + 'px';
        c.style.height = r.height + 'px';
      }
      if (!fitted.current) {
        fitWidth();
        fitted.current = true;
      } else {
        clampView();
        renderBase();
        renderLive();
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    window.addEventListener('scroll', resize, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', resize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Bei Themenwechsel neu zeichnen
  useEffect(() => {
    const mo = new MutationObserver(() => requestRender());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  /* ---------------------------------------------------------------- */
  /* Koordinaten                                                       */
  /* ---------------------------------------------------------------- */

  const toWorld = (clientX: number, clientY: number) => {
    const { left, top } = sizeRef.current;
    const v = viewRef.current;
    return { x: v.x + (clientX - left) / v.z, y: v.y + (clientY - top) / v.z };
  };

  const pageAt = (wx: number, wy: number) => {
    const items = layoutRef.current;
    for (let i = 0; i < items.length; i++) {
      const { page, top } = items[i];
      if (wy >= top && wy <= top + page.height && wx >= 0 && wx <= page.width) return i;
    }
    return -1;
  };

  /* ---------------------------------------------------------------- */
  /* Seiten verändern                                                  */
  /* ---------------------------------------------------------------- */

  const updatePage = (pageId: string, fn: (p: InkPage) => InkPage) => {
    pagesRef.current = pagesRef.current.map((p) => (p.id === pageId ? fn(p) : p));
    relayout();
    markPageDirty(pageId);
  };

  const pushCommand = (c: Command) => {
    undoRef.current.push(c);
    if (undoRef.current.length > 300) undoRef.current.shift();
    redoRef.current = [];
    setHistoryVersion((v) => v + 1);
  };

  const applyCommand = (c: Command, reverse: boolean) => {
    switch (c.t) {
      case 'add':
        updatePage(c.pageId, (p) => ({
          ...p,
          strokes: reverse ? p.strokes.filter((s) => s.id !== c.stroke.id) : [...p.strokes, c.stroke]
        }));
        break;
      case 'erase': {
        const byPage = new Map<string, { stroke: Stroke; index: number }[]>();
        for (const it of c.items) {
          if (!byPage.has(it.pageId)) byPage.set(it.pageId, []);
          byPage.get(it.pageId)!.push(it);
        }
        for (const [pageId, items] of byPage) {
          updatePage(pageId, (p) => {
            if (!reverse) {
              const ids = new Set(items.map((i) => i.stroke.id));
              return { ...p, strokes: p.strokes.filter((s) => !ids.has(s.id)) };
            }
            const strokes = [...p.strokes];
            for (const it of [...items].sort((a, b) => a.index - b.index)) strokes.splice(Math.min(it.index, strokes.length), 0, it.stroke);
            return { ...p, strokes };
          });
        }
        break;
      }
      case 'img-add':
        updatePage(c.pageId, (p) => ({
          ...p,
          images: reverse ? p.images.filter((i) => i.id !== c.image.id) : [...p.images, c.image]
        }));
        if (reverse) setSelected(null);
        break;
      case 'img-change':
        updatePage(c.pageId, (p) => ({
          ...p,
          images: p.images.map((i) => (i.id === c.after.id ? (reverse ? c.before : c.after) : i))
        }));
        break;
      case 'img-del':
        updatePage(c.pageId, (p) => {
          if (!reverse) return { ...p, images: p.images.filter((i) => i.id !== c.image.id) };
          const images = [...p.images];
          images.splice(c.index, 0, c.image);
          return { ...p, images };
        });
        setSelected(null);
        break;
      case 'tasks':
        updatePage(c.pageId, (p) => ({ ...p, tasks: reverse ? c.before : c.after }));
        break;
      case 'clear':
        updatePage(c.pageId, (p) => (reverse ? { ...p, strokes: c.strokes, images: c.images } : { ...p, strokes: [], images: [] }));
        break;
    }
    requestRender();
  };

  const undo = () => {
    const c = undoRef.current.pop();
    if (!c) return;
    applyCommand(c, true);
    redoRef.current.push(c);
    setHistoryVersion((v) => v + 1);
  };
  const redo = () => {
    const c = redoRef.current.pop();
    if (!c) return;
    applyCommand(c, false);
    undoRef.current.push(c);
    setHistoryVersion((v) => v + 1);
  };

  // Tastenkürzel (Tastatur am iPad / PC)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!mod) {
        const k = e.key.toLowerCase();
        if (k === 'p') setTool('pen');
        else if (k === 'h') setTool('highlighter');
        else if (k === 'e') setTool('eraser');
        else if (k === 'v') setTool('select');
        else if ((k === 'delete' || k === 'backspace') && selectedRef.current) deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------------------------------------------------------------- */
  /* Zeigereingaben (Pencil, Finger, Maus)                             */
  /* ---------------------------------------------------------------- */

  const touches = useRef(new Map<number, { x: number; y: number }>());
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const pinchRef = useRef<{ d0: number; z0: number; wx: number; wy: number } | null>(null);
  const eraseRef = useRef<{ pointerId: number; items: { pageId: string; stroke: Stroke; index: number }[] } | null>(null);
  const penDown = useRef(false);
  const lastPenUp = useRef(0);

  const isDrawTool = (t: Tool) => t === 'pen' || t === 'highlighter' || t === 'eraser';

  /**
   * Aufgabenbereich vergrößern/verkleinern. Der Bereich ist unten verankert und wächst nach oben:
   * neue Zeilen kommen oben hinzu, damit bestehende Zeilen (Handschrift + Haken) an ihrem Platz bleiben.
   */
  const resizeTaskArea = (page: InkPage, wanted: number) => {
    const area = page.tasks;
    if (!area) return;
    const cur = taskAreaLayout(page, area).rows.length;
    const rows = clamp(wanted, 1, maxTaskRows(page));
    if (rows === cur) {
      toast(wanted > cur ? 'Mehr Zeilen passen nicht auf die Seite' : 'Mindestens eine Zeile');
      return;
    }
    const checked = Array.from({ length: cur }, (_, i) => !!area.checked[i]);
    const carried = Array.from({ length: cur }, (_, i) => !!area.carried?.[i]);
    let next: boolean[];
    let nextCarried: boolean[];
    if (rows > cur) {
      next = [...Array(rows - cur).fill(false), ...checked];
      nextCarried = [...Array(rows - cur).fill(false), ...carried];
    } else {
      const drop = cur - rows;
      const used = page.strokes.some((st) => {
        const r = taskRowOfStroke(page, st);
        return r >= 0 && r < drop;
      });
      if (used) {
        toast('Die oberste Aufgabenzeile ist beschrieben – erst radieren, dann entfernen');
        return;
      }
      next = checked.slice(drop);
      nextCarried = carried.slice(drop);
    }
    const cmd: Command = { t: 'tasks', pageId: page.id, before: area, after: { rows, checked: next, carried: nextCarried } };
    applyCommand(cmd, false);
    pushCommand(cmd);
  };

  /** Tippen auf ein Aufgaben-Kästchen: Haken setzen/entfernen. true, wenn getroffen. */
  const toggleTaskAt = (clientX: number, clientY: number) => {
    const w = toWorld(clientX, clientY);
    const idx = pageAt(w.x, w.y);
    if (idx < 0) return false;
    const { page, top } = layoutRef.current[idx];
    const tol = 10 / Math.max(0.6, viewRef.current.z);
    const ctrl = hitTaskControl(page, w.x, w.y - top, tol);
    if (ctrl && page.tasks) {
      resizeTaskArea(page, page.tasks.rows + (ctrl === 'add' ? 1 : -1));
      return true;
    }
    const row = hitTaskBox(page, w.x, w.y - top, tol);
    if (row < 0 || !page.tasks) return false;
    const before = page.tasks;
    let after: InkTaskArea;
    if (before.carried?.[row] && !before.checked[row]) {
      // Pfeil antippen: Übertragung aufheben (Aufgabe gilt wieder als offen)
      const carried = [...before.carried];
      carried[row] = false;
      after = { ...before, carried };
    } else {
      const checked = [...before.checked];
      checked[row] = !checked[row];
      after = { ...before, checked };
    }
    const cmd: Command = { t: 'tasks', pageId: page.id, before, after };
    applyCommand(cmd, false);
    pushCommand(cmd);
    return true;
  };

  const startStroke = (e: PointerEvent, isTouch: boolean) => {
    const w = toWorld(e.clientX, e.clientY);
    const idx = pageAt(w.x, w.y);
    if (idx < 0) return false;
    const top = layoutRef.current[idx].top;
    const t = toolRef.current as InkTool;
    const o = optsRef.current;
    const realPressure = e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5;
    const stroke: Stroke = {
      id: uid(),
      tool: t,
      color: t === 'highlighter' ? o.hlColor : o.penColor,
      size: t === 'highlighter' ? HL_SIZES[o.hlSize] : PEN_SIZES[o.penSize],
      points: [w.x, w.y - top, e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5],
      simulated: !realPressure && e.pointerType !== 'pen'
    };
    drawingRef.current = { pointerId: e.pointerId, pageIdx: idx, stroke, isTouch };
    requestLive();
    return true;
  };

  const extendStroke = (e: PointerEvent) => {
    const d = drawingRef.current!;
    const top = layoutRef.current[d.pageIdx].top;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    const z = viewRef.current.z;
    const pts = d.stroke.points;
    for (const ev of list) {
      const w = toWorld(ev.clientX, ev.clientY);
      const x = w.x, y = w.y - top;
      const lx = pts[pts.length - 3], ly = pts[pts.length - 2];
      if (Math.hypot(x - lx, y - ly) < 0.35 / z) continue;
      const pr = ev.pointerType === 'pen' ? (ev.pressure > 0 ? ev.pressure : pts[pts.length - 1]) : 0.5;
      pts.push(+x.toFixed(2), +y.toFixed(2), +pr.toFixed(3));
    }
    requestLive();
  };

  const finishStroke = () => {
    const d = drawingRef.current;
    drawingRef.current = null;
    if (!d) return;
    const pageId = layoutRef.current[d.pageIdx].page.id;
    const stroke: Stroke = { ...d.stroke, points: d.stroke.points.slice() };
    // Wenn kein echter Druck ankam (z. B. Stift ohne Drucksensor), Druck simulieren
    if (!stroke.simulated) {
      const ps = new Set<number>();
      for (let i = 2; i < stroke.points.length; i += 3) ps.add(stroke.points[i]);
      if (ps.size <= 1) stroke.simulated = true;
    }
    applyCommand({ t: 'add', pageId, stroke }, false);
    pushCommand({ t: 'add', pageId, stroke });
    renderLive();
  };

  const eraseAt = (clientX: number, clientY: number) => {
    const w = toWorld(clientX, clientY);
    const idx = pageAt(w.x, w.y);
    if (idx < 0) return;
    const { page, top } = layoutRef.current[idx];
    const r = ERASER_SIZES[optsRef.current.eraserSize] / Math.max(0.6, viewRef.current.z);
    const hits: { stroke: Stroke; index: number }[] = [];
    page.strokes.forEach((s, i) => {
      if (hitStroke(s, w.x, w.y - top, r)) hits.push({ stroke: s, index: i });
    });
    if (!hits.length) return;
    const ids = new Set(hits.map((h) => h.stroke.id));
    eraseRef.current!.items.push(...hits.map((h) => ({ pageId: page.id, ...h })));
    updatePage(page.id, (p) => ({ ...p, strokes: p.strokes.filter((s) => !ids.has(s.id)) }));
    requestRender();
  };

  const selectAt = (clientX: number, clientY: number) => {
    const w = toWorld(clientX, clientY);
    const idx = pageAt(w.x, w.y);
    if (idx < 0) return setSelected(null);
    const { page, top } = layoutRef.current[idx];
    const y = w.y - top;
    const hit = [...page.images].reverse().find((im) => w.x >= im.x && w.x <= im.x + im.w && y >= im.y && y <= im.y + im.h);
    setSelected(hit ? { pageId: page.id, imageId: hit.id } : null);
  };

  const zoomAround = (sx: number, sy: number, nz: number) => {
    const v = viewRef.current;
    const wx = v.x + sx / v.z, wy = v.y + sy / v.z;
    v.z = clamp(nz, MIN_ZOOM, MAX_ZOOM);
    v.x = wx - sx / v.z;
    v.y = wy - sy / v.z;
    clampView();
    setZoomPct(Math.round(v.z * 100));
    requestRender();
    requestLive();
  };

  const startPinch = () => {
    const pts = [...touches.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const { left, top } = sizeRef.current;
    const mx = (a.x + b.x) / 2 - left, my = (a.y + b.y) / 2 - top;
    const v = viewRef.current;
    pinchRef.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: v.z, wx: v.x + mx / v.z, wy: v.y + my / v.z };
    panRef.current = null;
  };

  useEffect(() => {
    if (!loaded) return;
    const el = liveRef.current!;

    const onDown = (e: PointerEvent) => {
      const r = stageRef.current!.getBoundingClientRect();
      sizeRef.current.left = r.left;
      sizeRef.current.top = r.top;
      const t = toolRef.current;
      const isTouch = e.pointerType === 'touch';
      const isPen = e.pointerType === 'pen';

      if (isTouch) {
        // Handballen-Erkennung: während der Stift schreibt oder kurz danach keine Fingereingaben
        if (penDown.current || Date.now() - lastPenUp.current < 300) return;
        // Nur sehr große Auflageflächen (Handballen) ignorieren – Finger auf dem iPad melden bis ca. 80 px
        if (e.width * e.height > 12000) return;
        try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Zeiger */ }
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 2) {
          // Zweiter Finger: begonnenen Finger-Strich verwerfen und Zoomen
          if (drawingRef.current?.isTouch) {
            drawingRef.current = null;
            renderLive();
          }
          if (eraseRef.current) eraseRef.current = null;
          startPinch();
          return;
        }
        if (touches.current.size > 2) return;
        if (touches.current.size === 1 && t !== 'hand' && t !== 'eraser' && toggleTaskAt(e.clientX, e.clientY)) return;
        const fingerDraws = optsRef.current.fingerDraws && t !== 'hand' && t !== 'select';
        if (fingerDraws) {
          if (t === 'eraser') {
            eraseRef.current = { pointerId: e.pointerId, items: [] };
            eraseAt(e.clientX, e.clientY);
          } else startStroke(e, true);
        } else if (t === 'select') {
          selectAt(e.clientX, e.clientY);
          panRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
        } else {
          panRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
        }
        return;
      }

      // Stift oder Maus
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Zeiger */ }
      if (isPen) {
        penDown.current = true;
        // eventuelles Verschieben durch aufliegende Hand abbrechen
        touches.current.clear();
        pinchRef.current = null;
        if (panRef.current && panRef.current.pointerId !== e.pointerId) panRef.current = null;
      }
      if (t === 'hand' || e.button === 1 || spaceDown.current) {
        panRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
      if (t !== 'eraser' && !(isPen && e.button === 5) && toggleTaskAt(e.clientX, e.clientY)) return;
      if (t === 'select') return selectAt(e.clientX, e.clientY);
      if (t === 'eraser' || (isPen && e.button === 5)) {
        eraseRef.current = { pointerId: e.pointerId, items: [] };
        eraseAt(e.clientX, e.clientY);
        return;
      }
      if (isDrawTool(t)) startStroke(e, false);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinchRef.current && touches.current.size >= 2) {
          const [a, b] = [...touches.current.values()];
          const { left, top } = sizeRef.current;
          const p = pinchRef.current;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const mx = (a.x + b.x) / 2 - left, my = (a.y + b.y) / 2 - top;
          const v = viewRef.current;
          v.z = clamp((p.z0 * d) / p.d0, MIN_ZOOM, MAX_ZOOM);
          v.x = p.wx - mx / v.z;
          v.y = p.wy - my / v.z;
          clampView();
          setZoomPct(Math.round(v.z * 100));
          requestRender();
          requestLive();
          return;
        }
      }
      if (drawingRef.current && drawingRef.current.pointerId === e.pointerId) return extendStroke(e);
      if (eraseRef.current && eraseRef.current.pointerId === e.pointerId) {
        const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const ev of evs.length ? evs : [e]) eraseAt(ev.clientX, ev.clientY);
        return;
      }
      if (panRef.current && panRef.current.pointerId === e.pointerId) {
        const v = viewRef.current;
        v.x -= (e.clientX - panRef.current.x) / v.z;
        v.y -= (e.clientY - panRef.current.y) / v.z;
        panRef.current.x = e.clientX;
        panRef.current.y = e.clientY;
        clampView();
        requestRender();
        requestLive();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        penDown.current = false;
        lastPenUp.current = Date.now();
      }
      if (e.pointerType === 'touch') {
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinchRef.current = null;
        if (touches.current.size === 1 && !drawingRef.current) {
          // Weiter verschieben mit verbleibendem Finger
          const [[id, pt]] = [...touches.current.entries()];
          panRef.current = { pointerId: id, x: pt.x, y: pt.y };
        }
      }
      if (drawingRef.current && drawingRef.current.pointerId === e.pointerId) finishStroke();
      if (eraseRef.current && eraseRef.current.pointerId === e.pointerId) {
        if (eraseRef.current.items.length) pushCommand({ t: 'erase', items: eraseRef.current.items });
        eraseRef.current = null;
      }
      if (panRef.current && panRef.current.pointerId === e.pointerId) panRef.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stageRef.current!.getBoundingClientRect();
      sizeRef.current.left = rect.left;
      sizeRef.current.top = rect.top;
      const { left, top } = sizeRef.current;
      if (e.ctrlKey || e.metaKey) {
        zoomAround(e.clientX - left, e.clientY - top, viewRef.current.z * Math.exp(-e.deltaY * 0.01));
      } else {
        const v = viewRef.current;
        const k = e.deltaMode === 1 ? 32 : 1;
        v.x += (e.deltaX * k) / v.z;
        v.y += (e.deltaY * k) / v.z;
        clampView();
        requestRender();
      }
    };

    // iOS: Systemgesten (Seitenzoom, Lupe, Textauswahl) auf der Zeichenfläche unterbinden
    const prevent = (e: Event) => e.preventDefault();
    // Sicherheitsnetz: liegen keine Finger mehr auf, verbliebene Gesten-Zustände zurücksetzen
    // (Safari liefert gelegentlich kein pointerup für den zweiten Finger)
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touches.current.clear();
        pinchRef.current = null;
        if (panRef.current && !penDown.current) panRef.current = null;
      } else if (e.touches.length < 2) pinchRef.current = null;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', prevent, { passive: false });
    el.addEventListener('touchmove', prevent, { passive: false });
    el.addEventListener('gesturestart', prevent);
    el.addEventListener('gesturechange', prevent);
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('contextmenu', prevent);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', prevent);
      el.removeEventListener('touchmove', prevent);
      el.removeEventListener('gesturestart', prevent);
      el.removeEventListener('gesturechange', prevent);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('contextmenu', prevent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Leertaste = temporär verschieben (Desktop)
  const spaceDown = useRef(false);
  useEffect(() => {
    const d = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) {
        spaceDown.current = e.type === 'keydown';
        if (e.type === 'keydown') e.preventDefault();
      }
    };
    window.addEventListener('keydown', d);
    window.addEventListener('keyup', d);
    return () => {
      window.removeEventListener('keydown', d);
      window.removeEventListener('keyup', d);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Bild-Auswahl (verschieben, Größe ändern, löschen)                 */
  /* ---------------------------------------------------------------- */

  const getSelectedImage = () => {
    const s = selectedRef.current;
    if (!s) return null;
    const idx = layoutRef.current.findIndex((l) => l.page.id === s.pageId);
    if (idx < 0) return null;
    const im = layoutRef.current[idx].page.images.find((i) => i.id === s.imageId);
    return im ? { im, top: layoutRef.current[idx].top, pageId: s.pageId } : null;
  };

  function positionOverlay() {
    const o = overlayRef.current;
    if (!o) return;
    const sel = getSelectedImage();
    if (!sel) {
      o.style.display = 'none';
      return;
    }
    const v = viewRef.current;
    o.style.display = 'block';
    o.style.left = (sel.im.x - v.x) * v.z + 'px';
    o.style.top = (sel.top + sel.im.y - v.y) * v.z + 'px';
    o.style.width = sel.im.w * v.z + 'px';
    o.style.height = sel.im.h * v.z + 'px';
  }
  useEffect(() => positionOverlay());

  const dragImg = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    const sel = getSelectedImage();
    if (!sel) return;
    const before = { ...sel.im };
    const start = { x: e.clientX, y: e.clientY };
    const target = e.currentTarget as HTMLElement;
    try { target.setPointerCapture(e.pointerId); } catch { /* ignorieren */ }
    let after = before;
    const move = (ev: PointerEvent) => {
      const z = viewRef.current.z;
      const dx = (ev.clientX - start.x) / z, dy = (ev.clientY - start.y) / z;
      if (mode === 'move') after = { ...before, x: before.x + dx, y: before.y + dy };
      else {
        const w = Math.max(30, before.w + dx);
        after = { ...before, w, h: (w * before.h) / before.w };
      }
      pagesRef.current = pagesRef.current.map((p) =>
        p.id === sel.pageId ? { ...p, images: p.images.map((i) => (i.id === before.id ? after : i)) } : p
      );
      relayout();
      requestRender();
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (after !== before) {
        markPageDirty(sel.pageId);
        pushCommand({ t: 'img-change', pageId: sel.pageId, before, after });
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const deleteSelected = () => {
    const sel = getSelectedImage();
    if (!sel) return;
    const page = pagesRef.current.find((p) => p.id === sel.pageId)!;
    const cmd: Command = { t: 'img-del', pageId: sel.pageId, image: sel.im, index: page.images.findIndex((i) => i.id === sel.im.id) };
    applyCommand(cmd, false);
    pushCommand(cmd);
  };

  /* ---------------------------------------------------------------- */
  /* Aktionen der Werkzeugleiste                                       */
  /* ---------------------------------------------------------------- */

  const curPage = () => pagesRef.current[Math.min(currentPage, pagesRef.current.length - 1)];

  const scrollToPage = (idx: number) => {
    const l = layoutRef.current[idx];
    if (!l) return;
    viewRef.current.y = l.top - 20 / viewRef.current.z;
    clampView();
    requestRender();
  };

  const reindexPages = async (pages: InkPage[]) => {
    pagesRef.current = pages.map((p, i) => ({ ...p, index: i }));
    relayout();
    await track(
      db.transaction('rw', db.inkPages, async () => {
        await db.inkPages.where('noteId').equals(note.id).delete();
        await db.inkPages.bulkPut(pagesRef.current);
      }).then(() => updateNote(note.id, { inkPageCount: pagesRef.current.length }))
    );
    requestRender();
  };

  const addPage = async () => {
    saveDebounced.flush();
    const cur = curPage();
    let p = newInkPage(note.id, 0, cur && !cur.bgAttachmentId ? cur.background : settings.defaultPageBackground);
    let carriedFrom: { pageId: string; rows: number[] } | null = null;
    if (cur?.tasks) {
      p.tasks = { rows: cur.tasks.rows, checked: [], carried: [] };
      const open = openTaskRows(cur);
      if (open.length) {
        const ok = await confirmDialog({
          title: 'Offene Aufgaben übernehmen?',
          text: `Auf dieser Seite ${open.length === 1 ? 'ist 1 Aufgabe' : `sind ${open.length} Aufgaben`} noch nicht abgehakt. Sollen sie auf die neue Seite übernommen werden? Hier werden sie dann mit einem Pfeil als übertragen markiert.`,
          confirmLabel: 'Übernehmen',
          cancelLabel: 'Nicht übernehmen'
        });
        if (ok) {
          const r = placeTaskRows(p, open);
          p = r.page;
          carriedFrom = { pageId: cur.id, rows: r.placed.map((x) => x.row) };
          if (r.placed.length < open.length) toast(`${r.placed.length} von ${open.length} Aufgaben übernommen – mehr passen nicht auf die Seite`);
        }
      }
    }
    let pages = [...pagesRef.current];
    if (carriedFrom) {
      const cf = carriedFrom;
      pages = pages.map((x) => (x.id === cf.pageId ? markCarried(x, cf.rows) : x));
      // Rückgängig-Verlauf: Befehle mit veralteten Aufgabenbereichen dieser Seite entfernen
      undoRef.current = undoRef.current.filter((c) => !(c.t === 'tasks' && c.pageId === cf.pageId));
      redoRef.current = redoRef.current.filter((c) => !(c.t === 'tasks' && c.pageId === cf.pageId));
      setHistoryVersion((v) => v + 1);
    }
    pages.splice(currentPage + 1, 0, p);
    await reindexPages(pages);
    scrollToPage(currentPage + 1);
  };

  const deletePage = async () => {
    if (pagesRef.current.length <= 1) {
      const p = curPage();
      if (!p.strokes.length && !p.images.length) return;
      const cmd: Command = { t: 'clear', pageId: p.id, strokes: p.strokes, images: p.images };
      applyCommand(cmd, false);
      pushCommand(cmd);
      toast('Seite geleert', { action: { label: 'Rückgängig', run: undo } });
      return;
    }
    const ok = await confirmDialog({
      title: `Seite ${currentPage + 1} löschen?`,
      text: 'Die Seite wird mit allen Strichen und Bildern entfernt. Dies kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Seite löschen',
      danger: true
    });
    if (!ok) return;
    saveDebounced.flush();
    const p = curPage();
    const pages = pagesRef.current.filter((x) => x.id !== p.id);
    // Befehle für diese Seite aus dem Verlauf entfernen
    const touchesPage = (c: Command) => ('pageId' in c ? c.pageId === p.id : c.items.some((i) => i.pageId === p.id));
    undoRef.current = undoRef.current.filter((c) => !touchesPage(c));
    redoRef.current = redoRef.current.filter((c) => !touchesPage(c));
    await reindexPages(pages);
    if (p.bgAttachmentId) await db.attachments.delete(p.bgAttachmentId);
    for (const im of p.images) await db.attachments.delete(im.attachmentId);
  };

  const clearPage = () => {
    const p = curPage();
    if (!p.strokes.length && !p.images.length) return;
    const cmd: Command = { t: 'clear', pageId: p.id, strokes: p.strokes, images: p.images };
    applyCommand(cmd, false);
    pushCommand(cmd);
    toast('Seite geleert', { action: { label: 'Rückgängig', run: undo } });
  };

  const setTaskArea = (next: InkTaskArea | null) => {
    const p = curPage();
    const cmd: Command = { t: 'tasks', pageId: p.id, before: p.tasks ?? null, after: next };
    applyCommand(cmd, false);
    pushCommand(cmd);
  };
  const changeTaskRows = (delta: number) => {
    const p = curPage();
    if (p.tasks) resizeTaskArea(p, p.tasks.rows + delta);
  };

  const setBackground = (bg: PageBackground, all: boolean) => {
    const targets = all ? pagesRef.current.filter((p) => !p.bgAttachmentId) : [curPage()];
    for (const t of targets) updatePage(t.id, (p) => ({ ...p, background: bg }));
    requestRender();
    void setSetting('defaultPageBackground', bg);
  };

  const insertImage = async () => {
    const files = await pickFiles('image/*');
    const f = files[0];
    if (!f) return;
    try {
      const blob = await downscaleImage(f, 1600);
      const bmp = await loadBitmap(blob);
      const { w: iw, h: ih } = imageSize(bmp);
      const attachmentId = await addAttachment(note.id, blob, f.name, 'inkimg');
      const page = curPage();
      const v = viewRef.current;
      const l = layoutRef.current[currentPage];
      const w = Math.min(page.width * 0.6, iw);
      const h = (w * ih) / iw;
      const cy = clamp(v.y + sizeRef.current.h / 2 / v.z - l.top - h / 2, 20, page.height - h - 20);
      const image: InkImage = { id: uid(), attachmentId, x: (page.width - w) / 2, y: cy, w, h };
      const cmd: Command = { t: 'img-add', pageId: page.id, image };
      applyCommand(cmd, false);
      pushCommand(cmd);
      setTool('select');
      setSelected({ pageId: page.id, imageId: image.id });
    } catch (e) {
      toastError(e, 'Bild konnte nicht eingefügt werden');
    }
  };

  const importPdf = async () => {
    const files = await pickFiles('application/pdf,.pdf');
    const f = files[0];
    if (!f) return;
    saveDebounced.flush();
    setPdfProgress({ done: 0, total: 1 });
    try {
      const rendered = await renderPdf(f, (done, total) => setPdfProgress({ done, total }));
      const newPages: InkPage[] = [];
      for (const r of rendered) {
        const attId = await addAttachment(note.id, r.blob, `${f.name} – Seite ${newPages.length + 1}`, 'inkbg');
        newPages.push({ ...newInkPage(note.id, 0, 'blank'), height: r.height, width: r.width, bgAttachmentId: attId });
      }
      let pages = [...pagesRef.current];
      const onlyEmpty = pages.length === 1 && !pages[0].strokes.length && !pages[0].images.length && !pages[0].bgAttachmentId;
      if (onlyEmpty) pages = newPages;
      else pages.splice(currentPage + 1, 0, ...newPages);
      await reindexPages(pages);
      if (!note.title) await updateNote(note.id, { title: f.name.replace(/\.pdf$/i, '') });
      toast(`${rendered.length} PDF-Seite${rendered.length === 1 ? '' : 'n'} importiert`);
      scrollToPage(onlyEmpty ? 0 : currentPage + 1);
    } catch (e) {
      toastError(e, 'PDF konnte nicht importiert werden');
    } finally {
      setPdfProgress(null);
    }
  };

  const zoomBy = (f: number) => zoomAround(sizeRef.current.w / 2, sizeRef.current.h / 2, viewRef.current.z * f);
  /* ---------------------------------------------------------------- */

  const colors = settings.penColors;
  const curPageTasks = !!pagesRef.current[Math.min(currentPage, pagesRef.current.length - 1)]?.tasks;
  const toolBtn = (t: Tool, icon: JSX.Element, label: string) => (
    <button className={'icon-btn' + (tool === t ? ' active' : '')} onClick={() => setTool(t)} title={label} aria-label={label} aria-pressed={tool === t}>
      {icon}
    </button>
  );
  const sizeDots = (sizes: number[], cur: number, set: (i: number) => void, scale: number) => (
    <div className="ink-sizes">
      {sizes.map((s, i) => (
        <button key={i} className={'ink-size' + (cur === i ? ' active' : '')} onClick={() => set(i)} aria-label={`Stärke ${i + 1}`}>
          <span style={{ width: Math.max(4, s * scale), height: Math.max(4, s * scale) }} />
        </button>
      ))}
    </div>
  );

  return (
    <div className="ink-wrap">
      {!(fullscreen && !barOpen) && (
      <div className="ink-toolbar no-print" role="toolbar" aria-label="Werkzeuge">
        <div className="ink-group">
          {toolBtn('pen', <PenTool size={20} />, 'Stift (P)')}
          {toolBtn('highlighter', <Highlighter size={20} />, 'Textmarker (H)')}
          {toolBtn('eraser', <Eraser size={20} />, 'Radiergummi (E)')}
          {toolBtn('select', <MousePointer2 size={20} />, 'Bilder auswählen/verschieben (V)')}
          {toolBtn('hand', <Hand size={20} />, 'Verschieben')}
        </div>
        <div className="ink-group">
          {tool === 'pen' &&
            colors.map((c) => (
              <button key={c} className={'swatch' + (penColor === c ? ' active' : '')} style={{ background: c }} onClick={() => setPenColor(c)} aria-label={`Farbe ${c}`} />
            ))}
          {tool === 'pen' && (
            <label className="swatch custom" title="Eigene Farbe" style={{ background: colors.includes(penColor) ? undefined : penColor }}>
              <input type="color" value={penColor} onChange={(e) => setPenColor(e.target.value)} />
            </label>
          )}
          {tool === 'highlighter' &&
            HL_COLORS.map((c) => (
              <button key={c} className={'swatch' + (hlColor === c ? ' active' : '')} style={{ background: c }} onClick={() => setHlColor(c)} aria-label={`Farbe ${c}`} />
            ))}
          {tool === 'pen' && sizeDots(PEN_SIZES, penSize, setPenSize, 2.4)}
          {tool === 'highlighter' && sizeDots(HL_SIZES, hlSize, setHlSize, 0.6)}
          {tool === 'eraser' && sizeDots(ERASER_SIZES, eraserSize, setEraserSize, 0.6)}
          {tool === 'select' && selected && (
            <button className="btn btn-sm btn-danger" onClick={deleteSelected}>
              <Trash2 size={16} /> Bild entfernen
            </button>
          )}
          {tool === 'select' && !selected && <span className="small muted">Bild antippen zum Auswählen</span>}
        </div>
        <div className="ink-group">
          <button className="icon-btn" onClick={undo} disabled={!undoRef.current.length} title="Rückgängig" aria-label="Rückgängig">
            <Undo2 size={20} />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!redoRef.current.length} title="Wiederholen" aria-label="Wiederholen">
            <Redo2 size={20} />
          </button>
        </div>
        <div className="ink-group">
          <button className="icon-btn" onClick={insertImage} title="Bild einfügen" aria-label="Bild einfügen">
            <ImagePlus size={20} />
          </button>
          <button className="icon-btn" onClick={importPdf} title="PDF als Schreibunterlage importieren" aria-label="PDF importieren">
            <FileUp size={20} />
          </button>
          <button className="icon-btn" onClick={addPage} title="Seite hinzufügen" aria-label="Seite hinzufügen">
            <FilePlus2 size={20} />
          </button>
          <MenuButton
            title="Seite"
            items={[
              { label: 'Liniert', icon: <LayoutTemplate size={17} />, onClick: () => setBackground('lines', false) },
              { label: 'Kariert', icon: <LayoutTemplate size={17} />, onClick: () => setBackground('grid', false) },
              { label: 'Gepunktet', icon: <LayoutTemplate size={17} />, onClick: () => setBackground('dots', false) },
              { label: 'Blanko', icon: <LayoutTemplate size={17} />, onClick: () => setBackground('blank', false) },
              { label: 'Hintergrund für alle Seiten: liniert', onClick: () => setBackground('lines', true) },
              { label: 'Hintergrund für alle Seiten: kariert', onClick: () => setBackground('grid', true) },
              'sep',
              ...(curPageTasks
                ? [
                    { label: 'Aufgabenzeile hinzufügen', icon: <ListChecks size={17} />, onClick: () => changeTaskRows(1) },
                    { label: 'Aufgabenzeile entfernen', icon: <ListChecks size={17} />, onClick: () => changeTaskRows(-1) },
                    { label: 'Aufgabenbereich: ganze Seite', icon: <ListChecks size={17} />, onClick: () => changeTaskRows(999) },
                    { label: 'Aufgabenbereich entfernen', icon: <ListChecks size={17} />, onClick: () => setTaskArea(null) }
                  ]
                : [{ label: 'Aufgabenbereich unten einfügen', icon: <ListChecks size={17} />, onClick: () => setTaskArea({ rows: DEFAULT_TASK_ROWS, checked: [], carried: [] }) }]),
              'sep',
              { label: 'Seite leeren', icon: <Eraser size={17} />, onClick: clearPage },
              { label: 'Seite löschen', icon: <Trash2 size={17} />, onClick: deletePage, danger: true }
            ]}
          >
            <LayoutTemplate size={20} />
          </MenuButton>
        </div>
        <div className="ink-group" style={{ marginLeft: 'auto' }}>
          <button
            className={'icon-btn' + (settings.fingerDraws ? ' active' : '')}
            onClick={() => {
              void setSetting('fingerDraws', !settings.fingerDraws);
              toast(settings.fingerDraws ? 'Finger navigiert – Zeichnen mit Pencil' : 'Finger zeichnet – zwei Finger navigieren');
            }}
            title={settings.fingerDraws ? 'Mit Finger zeichnen: an' : 'Mit Finger zeichnen: aus (Finger verschiebt/zoomt)'}
            aria-label="Mit Finger zeichnen"
            aria-pressed={settings.fingerDraws}
          >
            <Fingerprint size={20} />
          </button>
          <button
            className={'icon-btn' + (fullscreen ? ' active' : '')}
            onClick={toggleFullscreen}
            title={fullscreen ? 'Vollbild beenden' : 'Vollbild'}
            aria-label={fullscreen ? 'Vollbild beenden' : 'Vollbild'}
          >
            {fullscreen ? <Shrink size={20} /> : <Expand size={20} />}
          </button>
          {fullscreen && (
            <button className="icon-btn" onClick={() => setBarOpen(false)} title="Werkzeugleiste einklappen" aria-label="Werkzeugleiste einklappen">
              <PanelTopClose size={20} />
            </button>
          )}
          <button className="icon-btn" onClick={() => zoomBy(1 / 1.25)} title="Verkleinern" aria-label="Verkleinern">
            <ZoomOut size={20} />
          </button>
          <button className="btn btn-sm btn-ghost" onClick={fitWidth} title="An Breite anpassen" style={{ minWidth: 62, fontVariantNumeric: 'tabular-nums' }}>
            {zoomPct}%
          </button>
          <button className="icon-btn" onClick={() => zoomBy(1.25)} title="Vergrößern" aria-label="Vergrößern">
            <ZoomIn size={20} />
          </button>
          <button className="icon-btn hide-mobile" onClick={fitWidth} title="An Breite anpassen" aria-label="An Breite anpassen">
            <Maximize2 size={18} />
          </button>
        </div>
      </div>
      )}
      <div className="ink-stage" ref={stageRef}>
        <canvas ref={baseRef} className="ink-canvas" />
        <canvas ref={liveRef} className={'ink-canvas ink-live tool-' + tool} />
        <div ref={overlayRef} className="ink-selection" style={{ display: 'none' }} onPointerDown={(e) => dragImg(e, 'move')}>
          <div className="ink-handle" onPointerDown={(e) => dragImg(e, 'resize')} />
        </div>
        {fullscreen && !barOpen && (
          <div className="ink-float no-print" role="toolbar" aria-label="Werkzeuge (Vollbild)">
            {toolBtn('pen', <PenTool size={20} />, 'Stift (P)')}
            {toolBtn('highlighter', <Highlighter size={20} />, 'Textmarker (H)')}
            {toolBtn('eraser', <Eraser size={20} />, 'Radiergummi (E)')}
            {toolBtn('hand', <Hand size={20} />, 'Verschieben')}
            <span className="ink-float-sep" />
            <button className="icon-btn" onClick={undo} disabled={!undoRef.current.length} title="Rückgängig" aria-label="Rückgängig">
              <Undo2 size={20} />
            </button>
            <button className="icon-btn" onClick={redo} disabled={!redoRef.current.length} title="Wiederholen" aria-label="Wiederholen">
              <Redo2 size={20} />
            </button>
            <button className="icon-btn" onClick={addPage} title="Seite hinzufügen" aria-label="Seite hinzufügen">
              <FilePlus2 size={20} />
            </button>
            <span className="ink-float-sep" />
            <button className="icon-btn" onClick={() => setBarOpen(true)} title="Alle Werkzeuge (Farben, Stärken …)" aria-label="Alle Werkzeuge einblenden">
              <PanelTopOpen size={20} />
            </button>
          </div>
        )}
        {fullscreen && (
          <button className="ink-fs-close no-print" onClick={exitFullscreen} title="Vollbild beenden (Esc)" aria-label="Vollbild beenden">
            <X size={22} />
          </button>
        )}
        {pageCount > 0 && (
          <div className="ink-pageinfo">
            Seite {Math.min(currentPage + 1, pageCount)} / {pageCount}
          </div>
        )}
        {!loaded && <div className="ink-loading">Lade Handschrift …</div>}
      </div>
      {pdfProgress && (
        <Modal title="PDF wird importiert" onClose={() => {}}>
          <p className="small" style={{ marginTop: 0 }}>
            Seite {pdfProgress.done} von {pdfProgress.total} – die PDF wird vollständig auf diesem Gerät verarbeitet.
          </p>
          <div className="progress">
            <div style={{ width: `${(pdfProgress.done / Math.max(1, pdfProgress.total)) * 100}%` }} />
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Seiten einer Handschrift-Notiz laden (für Export) */
export async function loadInkPages(noteId: string) {
  return db.inkPages.where('[noteId+index]').between([noteId, Dexie.minKey], [noteId, Dexie.maxKey]).toArray();
}

