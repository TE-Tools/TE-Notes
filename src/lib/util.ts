export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowLocalDateTime(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${todayISO(d)}T${hh}:${mm}`;
}

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const longDateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function fmtDate(v: number | string | null | undefined): string {
  if (!v) return '';
  const d = typeof v === 'number' ? new Date(v) : parseLocal(v);
  return isNaN(d.getTime()) ? '' : dateFmt.format(d);
}
export function fmtDateTime(v: number | string | null | undefined): string {
  if (!v) return '';
  const d = typeof v === 'number' ? new Date(v) : parseLocal(v);
  return isNaN(d.getTime()) ? '' : dateTimeFmt.format(d);
}
export function fmtLongDate(d = new Date()): string {
  return longDateFmt.format(d);
}

/** Relative, kompakte Zeitangabe für Listen */
export function fmtRelative(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (todayISO(d) === todayISO(now)) return 'Heute, ' + timeFmt.format(d);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (todayISO(d) === todayISO(y)) return 'Gestern, ' + timeFmt.format(d);
  return dateFmt.format(d);
}

/** Parst YYYY-MM-DD bzw. YYYY-MM-DDTHH:mm als lokale Zeit */
export function parseLocal(s: string): Date {
  const [datePart, timePart] = String(s ?? '').split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart ?? '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}

export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'done' || status === 'deferred') return false;
  return dueDate < todayISO();
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush: () => void;
  cancel: () => void;
  pending: () => boolean;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let t: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;
  const run = () => {
    t = null;
    const a = lastArgs;
    lastArgs = null;
    if (a) fn(...a);
  };
  const wrapped = ((...args: A) => {
    lastArgs = args;
    if (t) clearTimeout(t);
    t = setTimeout(run, ms);
  }) as Debounced<A>;
  wrapped.flush = () => {
    if (t) {
      clearTimeout(t);
      run();
    }
  };
  wrapped.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
    lastArgs = null;
  };
  wrapped.pending = () => t !== null;
  return wrapped;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2).replace('.', ',') + ' GB';
}

const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]+/g;

export function safeFileName(s: string): string {
  const cleaned = Array.from(s)
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('')
    .replace(UNSAFE_FILE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Notiz').slice(0, 80);
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export const COLORS = ['#5b7db1', '#4f9d8a', '#c08a3e', '#b5606b', '#8a6fb3', '#6b7a8f', '#3f8fb5', '#9a8c4a'];
