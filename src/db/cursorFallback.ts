import type {
  DBCore, DBCoreCursor, DBCoreIndex, DBCoreTransaction, DBCoreKeyRange, DBCoreOpenCursorRequest, DBCoreTable, DBCoreTableSchema, Middleware
} from 'dexie';

/**
 * Ausweichweg für einen Safari-Fehler (WebKit/IndexedDB):
 * Auf manchen iPads bricht das Öffnen eines Cursors mit „UnknownError: Unable to open cursor“ ab,
 * während das Lesen per getAll() funktioniert. Dann werden die Datensätze per getAll() geholt und
 * ein gleichwertiger Cursor im Speicher nachgebildet. Dexie merkt davon nichts.
 */

const cmp = (a: unknown, b: unknown) => indexedDB.cmp(a, b);

/** Merkt sich Tabellen/Indizes, bei denen der echte Cursor schon einmal versagt hat */
const broken = new Set<string>();
let forceFallback = false;

/** Nur für Tests: Cursor-Ausweichweg erzwingen */
export function __forceCursorFallback(v: boolean) {
  forceFallback = v;
}

function inRange(key: unknown, r: DBCoreKeyRange): boolean {
  if (r.type === 3) return true; // Any
  if (r.type === 4) return false; // Never
  if (r.lower !== undefined) {
    const c = cmp(key, r.lower);
    if (c < 0 || (c === 0 && r.lowerOpen)) return false;
  }
  if (r.upper !== undefined) {
    const c = cmp(key, r.upper);
    if (c > 0 || (c === 0 && r.upperOpen)) return false;
  }
  return true;
}

function isValidKey(k: unknown): boolean {
  if (k === undefined || k === null) return false;
  try {
    indexedDB.cmp(k, 0);
    return true;
  } catch {
    return false;
  }
}

interface Entry {
  key: unknown;
  primaryKey: unknown;
  value: unknown;
}

function buildEntries(values: unknown[], schema: DBCoreTableSchema, index: DBCoreIndex, range: DBCoreKeyRange): Entry[] {
  const pkOf = schema.primaryKey.extractKey;
  const out: Entry[] = [];
  for (const value of values) {
    const primaryKey = pkOf ? pkOf(value) : undefined;
    if (index.isPrimaryKey) {
      if (inRange(primaryKey, range)) out.push({ key: primaryKey, primaryKey, value });
      continue;
    }
    const raw = index.extractKey ? index.extractKey(value) : undefined;
    if (index.multiEntry && Array.isArray(raw)) {
      const seen: unknown[] = [];
      for (const k of raw) {
        if (!isValidKey(k) || !inRange(k, range)) continue;
        if (seen.some((s) => cmp(s, k) === 0)) continue;
        seen.push(k);
        out.push({ key: k, primaryKey, value });
      }
    } else if (isValidKey(raw) && inRange(raw, range)) {
      out.push({ key: raw, primaryKey, value });
    }
  }
  return out;
}

const isInactive = (e: unknown) => /InvalidState|TransactionInactive/.test((e as Error)?.name ?? '');

async function loadEntries(core: DBCore, down: DBCoreTable, req: DBCoreOpenCursorRequest): Promise<Entry[]> {
  const { query, reverse, unique } = req;
  const schema = down.schema;
  const all = { index: schema.primaryKey, range: { type: 3 } as DBCoreKeyRange };
  const read = async (trans: DBCoreTransaction) => {
    try {
      // Zuerst nur den betroffenen Bereich des Index lesen …
      return (await down.query({ trans, values: true, query })).result as unknown[];
    } catch (e) {
      if (isInactive(e)) throw e;
      // … falls auch das scheitert, die ganze Tabelle lesen und im Speicher filtern
      return (await down.query({ trans, values: true, query: all })).result as unknown[];
    }
  };
  let values: unknown[];
  try {
    values = await read(req.trans);
  } catch (e) {
    if (!isInactive(e)) throw e;
    // Ursprüngliche Transaktion ist nach dem Fehler beendet: zum Lesen eine neue öffnen
    values = await read(core.transaction([down.name], 'readonly'));
  }
  const entries = buildEntries(values, schema, query.index, query.range);
  entries.sort((a, b) => cmp(a.key, b.key) || cmp(a.primaryKey, b.primaryKey));
  if (reverse) {
    // IndexedDB: bei "prev" absteigende Schlüssel, bei gleichem Schlüssel absteigende Primärschlüssel
    entries.reverse();
  }
  if (unique) {
    // "nextunique"/"prevunique" liefern je Schlüssel den Eintrag mit dem kleinsten Primärschlüssel
    const res: Entry[] = [];
    for (const e of entries) {
      const last = res[res.length - 1];
      if (last && cmp(last.key, e.key) === 0) {
        if (reverse) res[res.length - 1] = e; // rückwärts kommt der kleinste Primärschlüssel zuletzt
        continue;
      }
      res.push(e);
    }
    return res;
  }
  return entries;
}

function memoryCursor(req: DBCoreOpenCursorRequest, entries: Entry[]): DBCoreCursor | null {
  if (!entries.length) return null;
  const dir = req.reverse ? -1 : 1;
  let pos = 0;
  let onNext: (() => void) | null = null;
  let resolveIt: (v: unknown) => void = () => {};
  let rejectIt: (e: unknown) => void = () => {};
  let pending = false;
  let running = false;

  const notStarted = () => {
    throw new Error('Cursor not started');
  };
  const stopped = () => {
    throw new Error('Cursor not stopped');
  };

  const cursor = {
    trans: req.trans,
    done: false,
    get key() {
      return entries[pos]?.key;
    },
    get primaryKey() {
      return entries[pos]?.primaryKey;
    },
    get value() {
      return req.values === false ? undefined : entries[pos]?.value;
    },
    continue: notStarted as (key?: unknown) => void,
    continuePrimaryKey: notStarted as (key: unknown, primaryKey: unknown) => void,
    advance: notStarted as (n: number) => void,
    stop: notStarted as (v?: unknown) => void,
    fail: (e: Error) => rejectIt(e),
    next(): Promise<DBCoreCursor> {
      let gotOne = 1;
      return cursor.start(() => (gotOne-- ? cursor.continue() : cursor.stop())).then(() => cursor as unknown as DBCoreCursor);
    },
    start(callback: () => void): Promise<unknown> {
      const p = new Promise((res, rej) => {
        resolveIt = res;
        rejectIt = rej;
      });
      onNext = callback;
      cursor.stop = (v?: unknown) => {
        cursor.stop = cursor.continue = cursor.continuePrimaryKey = cursor.advance = stopped;
        onNext = null;
        resolveIt(v);
      };
      cursor.fail = (e: Error) => {
        onNext = null;
        rejectIt(e);
      };
      cursor.continue = (key?: unknown) => {
        if (key === undefined) pos++;
        else {
          pos++;
          while (pos < entries.length && cmp(entries[pos].key, key) * dir < 0) pos++;
        }
        schedule();
      };
      cursor.continuePrimaryKey = (key: unknown, primaryKey: unknown) => {
        pos++;
        while (pos < entries.length) {
          const c = cmp(entries[pos].key, key) * dir;
          if (c > 0 || (c === 0 && cmp(entries[pos].primaryKey, primaryKey) * dir >= 0)) break;
          pos++;
        }
        schedule();
      };
      cursor.advance = (n: number) => {
        pos += Math.max(1, n);
        schedule();
      };
      schedule();
      return p;
    }
  };

  function step() {
    if (!onNext) return;
    if (pos >= entries.length) {
      cursor.done = true;
      cursor.start = () => {
        throw new Error('Cursor behind last entry');
      };
      cursor.stop();
      return;
    }
    try {
      onNext();
    } catch (e) {
      cursor.fail(e as Error);
    }
  }

  // Ohne Rekursion durchlaufen (auch bei tausenden Einträgen)
  function schedule() {
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending) {
        pending = false;
        step();
      }
    } finally {
      running = false;
    }
  }

  return cursor as unknown as DBCoreCursor;
}

function isCursorError(e: unknown) {
  const err = e as { name?: string; message?: string } | null;
  return !!err && (err.name === 'UnknownError' || /cursor/i.test(err.message ?? ''));
}

export const cursorFallbackMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'teCursorFallback',
  level: 0,
  create(down) {
    return {
      ...down,
      table(name) {
        const table = down.table(name);
        return {
          ...table,
          async openCursor(req) {
            const id = name + '|' + (req.query.index.name ?? '');
            if (!forceFallback && !broken.has(id)) {
              try {
                return await table.openCursor(req);
              } catch (e) {
                if (!isCursorError(e)) throw e;
                console.warn(`IndexedDB-Cursor fehlgeschlagen (${id}), nutze Ausweichweg:`, e);
                broken.add(id);
              }
            }
            return memoryCursor(req, await loadEntries(down, table, req));
          }
        };
      }
    };
  }
};
