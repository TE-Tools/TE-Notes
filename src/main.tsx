import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { db } from './db/db';
import { ensureSeeded } from './db/repo';
import { flushAll, installLifecycleFlush } from './lib/saver';
import './styles.css';

installLifecycleFlush();

// Nach einem Update können alte Programmteile fehlen: Änderungen sichern und einmalig neu laden
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  flushAll();
  try {
    if (sessionStorage.getItem('te-reloaded') === '1') return;
    sessionStorage.setItem('te-reloaded', '1');
  } catch {
    /* ignorieren */
  }
  setTimeout(() => location.reload(), 400);
});
window.addEventListener('load', () => setTimeout(() => {
  try {
    sessionStorage.removeItem('te-reloaded');
  } catch {
    /* ignorieren */
  }
}, 5000));

function fatal(msg: string) {
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:560px;margin:15vh auto;padding:24px;font-family:-apple-system,Segoe UI,sans-serif;line-height:1.5';
  const h = document.createElement('h2');
  h.textContent = 'TE Notes kann nicht gestartet werden';
  const p = document.createElement('p');
  p.textContent = msg;
  box.append(h, p);
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

  // Dauerhaften Speicher anfordern (Schutz vor automatischem Löschen durch den Browser)
  navigator.storage?.persist?.().catch(() => {});

  // Andere offene Fenster/Tabs mit älterer Version dürfen Migrationen nicht blockieren
  db.on('versionchange', () => {
    db.close();
    location.reload();
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const updateSW = registerSW({
      onNeedRefresh() {
        window.dispatchEvent(new CustomEvent('te-sw-update', { detail: () => updateSW(true) }));
      },
      onOfflineReady() {
        window.dispatchEvent(new Event('te-sw-offline-ready'));
      }
    });
  }
}

start();
