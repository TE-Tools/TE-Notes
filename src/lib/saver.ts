import { useEffect, useState } from 'react';
import { toast } from '../components/ui';

/**
 * Zentrale Verwaltung der automatischen Speicherung.
 *
 * - `track()` zählt laufende Schreibvorgänge (Anzeige „Speichert …“ / „Gespeichert“).
 * - `registerFlusher()` meldet Funktionen an, die ausstehende (entprellte) Änderungen sofort schreiben.
 *   Sie werden beim Verlassen/Verstecken der App (iPad: App-Wechsel, Home-Geste) und vor
 *   Navigationen aufgerufen, damit keine Eingaben verloren gehen.
 */

type State = { pending: number; dirty: number; lastSaved: number; error: string | null };
let state: State = { pending: 0, dirty: 0, lastSaved: 0, error: null };
const listeners = new Set<() => void>();
const flushers = new Set<() => void>();
function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export async function track<T>(p: Promise<T>): Promise<T> {
  emit({ pending: state.pending + 1 });
  try {
    const r = await p;
    emit({ pending: state.pending - 1, lastSaved: Date.now(), error: null });
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit({ pending: state.pending - 1, error: msg });
    const quota = /quota/i.test(msg) || (e as Error)?.name === 'QuotaExceededError';
    toast(
      quota
        ? 'Speichern fehlgeschlagen: Der Gerätespeicher ist voll. Bitte Platz schaffen und eine Sicherung erstellen.'
        : 'Speichern fehlgeschlagen: ' + msg,
      { kind: 'error', ms: 9000 }
    );
    throw e;
  }
}

/** Markiert ungespeicherte (entprellte) Änderungen */
export function markDirty(delta: 1 | -1) {
  emit({ dirty: Math.max(0, state.dirty + delta) });
}

export function registerFlusher(fn: () => void) {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

export function flushAll() {
  flushers.forEach((f) => {
    try {
      f();
    } catch (e) {
      console.error(e);
    }
  });
}

export function hasUnsaved() {
  return state.pending > 0 || state.dirty > 0;
}

export function useSaveState() {
  const [s, setS] = useState(state);
  useEffect(() => {
    const l = () => setS(state);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return s;
}

let installed = false;
export function installLifecycleFlush() {
  if (installed) return;
  installed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', flushAll);
  window.addEventListener('beforeunload', (e) => {
    flushAll();
    if (hasUnsaved()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
