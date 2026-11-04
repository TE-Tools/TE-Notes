import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { db } from './db/db';
import { ensureSeeded, rebuildSearchIndex } from './db/repo';
import { flushAll, installLifecycleFlush } from './lib/saver';
import { clearReloadFlag } from './lib/lazyRetry';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

installLifecycleFlush();

// Nach einem Update können alte Programmteile fehlen. Das Neuladen übernimmt lazyWithRetry;
// hier KEIN preventDefault(), sonst liefert Vite ein leeres Modul und die Seite bleibt weiß.
clearReloadFlag();

// Falls trotzdem ein Fehler die Oberfläche komplett leert: Hinweis statt weißer Seite
function showIfBlank(err: unknown) {
  const root = document.getElementById('root');
  if (root && root.childElementCount === 0 && started) {
    const e = err as Error;
    fatal('Unerwarteter Fehler: ' + (e?.message ?? String(err)) + ' – Bitte die Seite neu laden.');
  }
}
let started = false;
window.addEventListener('error', (e) => setTimeout(() => showIfBlank(e.error ?? e.message), 0));
window.addEventListener('unhandledrejection', (e) => setTimeout(() => showIfBlank(e.reason), 0));

function fatal(msg: string) {
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:560px;margin:15vh auto;padding:24px;font-family:-apple-system,Segoe UI,sans-serif;line-height:1.5';
  const h = document.createElement('h2');
  h.textContent = 'TE Notes kann nicht gestartet werden';
  const p = document.createElement('p');
  p.textContent = msg;
  const btn = document.createElement('button');
  btn.textContent = 'Neu laden';
  btn.style.cssText = 'margin-top:12px;padding:10px 18px;font-size:16px;border-radius:8px;border:1px solid #999;background:#fff';
  btn.onclick = () => location.reload();
  box.append(h, p, btn);
  root.append(box);
}

async function start() {
  if (!('indexedDB' in window)) {
    fatal('Dieser Browser stellt keinen lokalen Speicher (IndexedDB) bereit. Im privaten Modus ist er teilweise deaktiviert.');
    return;
  }
  try {
    await db.open();
    await ensureSeeded();
  } catch (e) {
    const err = e as Error;
    if (err?.name === 'VersionError') fatal('Die gespeicherten Daten stammen von einer neueren Version von TE Notes. Bitte die App aktualisieren (Seite neu laden).');
    else fatal('Die lokale Datenbank konnte nicht geöffnet werden: ' + (err?.message ?? String(e)));
    return;
  }

  // Nach einer Datenbank-Migration den Suchindex im Hintergrund neu aufbauen
  void db.settings.get('reindexPending').then(async (r) => {
    if (!r?.value) return;
    await rebuildSearchIndex();
    await db.settings.delete('reindexPending');
  }).catch((e) => console.warn('Suchindex konnte nicht neu aufgebaut werden', e));

  // Dauerhaften Speicher anfordern (Schutz vor automatischem Löschen durch den Browser)
  navigator.storage?.persist?.().catch(() => {});

  // Andere offene Fenster/Tabs mit älterer Version dürfen Migrationen nicht blockieren
  db.on('versionchange', () => {
    db.close();
    location.reload();
  });

  started = true;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );

  if ('serviceWorker' in navigator && import.meta.env.PROD) setupUpdates();
}

/**
 * Automatische Updates: Die App sucht beim Öffnen, beim Zurückkehren in die App und alle 30 Minuten
 * nach einer neuen Version. Eine gefundene Version wird übernommen, sobald die App in den Hintergrund
 * geht (oder sofort über „Jetzt aktualisieren“) – nie mitten im Schreiben. Die Daten bleiben dabei
 * unverändert auf dem Gerät; nötige Datenbank-Migrationen laufen beim nächsten Start automatisch.
 */
function setupUpdates() {
  let pending = false;
  let applying = false;
  const apply = () => {
    if (applying) return;
    applying = true;
    flushAll();
    // kurz warten, damit gerade entprellte Änderungen gespeichert sind
    setTimeout(() => void updateSW(true), 400);
  };
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      if (document.visibilityState === 'hidden') apply();
      else window.dispatchEvent(new CustomEvent('te-sw-update', { detail: apply }));
    },
    onOfflineReady() {
      window.dispatchEvent(new Event('te-sw-offline-ready'));
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine === false) return;
        reg.update().catch(() => {});
      };
      setInterval(check, 30 * 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending) apply();
  });
}

start();
