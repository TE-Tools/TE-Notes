import { lazy, type ComponentType } from 'react';
import { flushAll } from './saver';

const FLAG = 'te-chunk-reload';

/** Programmteil nachladen; schlägt das fehl (z. B. nach einem Update veraltete Dateien),
 *  einmal erneut versuchen und notfalls die Seite einmalig neu laden. */
export async function importWithRetry<T>(factory: () => Promise<T>): Promise<T> {
  try {
    const m = await factory();
    if (m == null) throw new Error('Programmteil ist leer');
    return m;
  } catch (first) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const m = await factory();
      if (m == null) throw first;
      return m;
    } catch {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(FLAG) === '1';
        if (!reloaded) sessionStorage.setItem(FLAG, '1');
      } catch {
        reloaded = true;
      }
      if (!reloaded) {
        flushAll();
        setTimeout(() => location.reload(), 300);
        // Bis zum Neuladen nicht weiter rendern
        return new Promise<T>(() => {});
      }
      throw first;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => importWithRetry(factory));
}

/** Nach erfolgreichem Start die Neulade-Sperre wieder freigeben */
export function clearReloadFlag() {
  setTimeout(() => {
    try {
      sessionStorage.removeItem(FLAG);
    } catch {
      /* ignorieren */
    }
  }, 5000);
}
