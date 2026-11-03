import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Delete } from 'lucide-react';
import { getSettings, setSetting } from '../db/repo';
import { useSettings } from '../lib/hooks';
import { flushAll } from '../lib/saver';

/**
 * Optionale lokale App-Sperre.
 * WICHTIG: Die Sperre verhindert nur den Zugriff über die Oberfläche der App.
 * Die Daten in der Browser-Datenbank sind NICHT verschlüsselt.
 */

const ITERATIONS = 150_000;

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(pin: string, saltHex?: string) {
  const salt = saltHex ? new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt.buffer) };
}

export async function enableLock(pin: string) {
  const { hash, salt } = await hashPin(pin);
  await setSetting('lockHash', hash);
  await setSetting('lockSalt', salt);
  await setSetting('lockEnabled', true);
}

export async function disableLock() {
  await setSetting('lockEnabled', false);
  await setSetting('lockHash', '');
  await setSetting('lockSalt', '');
}

async function verifyPin(pin: string) {
  const s = await getSettings();
  if (!s.lockHash) return true;
  const { hash } = await hashPin(pin, s.lockSalt);
  return hash === s.lockHash;
}

let lockNow: (() => void) | null = null;
export function lockApp() {
  flushAll();
  lockNow?.();
}

export function LockGate({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const hiddenAt = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    getSettings().then((s) => {
      setLocked(!!s.lockEnabled);
      setReady(true);
    });
    lockNow = () => {
      if (settingsRef.current.lockEnabled) setLocked(true);
    };
    const onVis = () => {
      const s = settingsRef.current;
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (s.lockEnabled && hiddenAt.current && Date.now() - hiddenAt.current >= s.lockTimeoutMin * 60_000) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lockNow = null;
    };
  }, []);

  if (!ready) return null;
  return (
    <>
      {/* Beim Start gesperrt: Inhalte gar nicht erst laden */}
      {(!locked || hiddenAt.current > 0) && <div style={locked ? { visibility: 'hidden' } : undefined}>{children}</div>}
      {locked && settings.lockEnabled && <LockScreen onUnlock={() => setLocked(false)} />}
    </>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);

  const submit = async (value: string) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    const ok = await verifyPin(value);
    setBusy(false);
    if (ok) onUnlock();
    else {
      setError(true);
      setTries((t) => t + 1);
      setTimeout(() => {
        setError(false);
        setPin('');
      }, 450);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="lock-screen" role="dialog" aria-label="App gesperrt">
      <img src="./icons/icon-192.png" alt="" />
      <div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>TE Notes ist gesperrt</div>
        <div className="small muted">PIN eingeben</div>
      </div>
      <div className={'pin-dots' + (error ? ' shake' : '')}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={'pin-dot' + (i < pin.length ? ' on' : '')} />
        ))}
      </div>
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="pin-key" onClick={() => press(d)}>{d}</button>
        ))}
        <button className="pin-key ghost" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Löschen">
          <Delete size={22} />
        </button>
        <button className="pin-key" onClick={() => press('0')}>0</button>
        <button className="pin-key ghost" onClick={() => submit(pin)} disabled={pin.length < 4}>OK</button>
      </div>
      {tries >= 3 && (
        <p className="small muted" style={{ maxWidth: 360 }}>
          PIN vergessen? Die Sperre lässt sich nur durch Löschen der Website-Daten in den Browser-Einstellungen aufheben – dabei gehen alle
          Notizen verloren, die nicht gesichert wurden.
        </p>
      )}
    </div>
  );
}
