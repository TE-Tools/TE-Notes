import { useEffect, useState } from 'react';
import { Download, FolderDown, Share } from 'lucide-react';
import { Modal, toast } from './ui';
import { fmtBytes } from '../lib/util';

interface SaveReq {
  blob: Blob;
  name: string;
  title?: string;
  hint?: string;
  resolve: (saved: boolean) => void;
}

let current: SaveReq | null = null;
const listeners = new Set<() => void>();
function setReq(r: SaveReq | null) {
  current = r;
  listeners.forEach((l) => l());
}

/**
 * Bietet eine fertige Datei zum Speichern an.
 *
 * Auf dem iPad muss das Teilen-Menü (→ „In Dateien sichern“) direkt durch einen Tipp ausgelöst werden.
 * Deshalb wird die Datei zuerst erzeugt und dann in einem Dialog mit passenden Schaltflächen angeboten.
 */
export function saveFile(blob: Blob, name: string, opts: { title?: string; hint?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => setReq({ blob, name, ...opts, resolve }));
}

function canShareFile(file: File) {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
    createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

export function FileSaveUI() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const req = current;
  if (!req) return null;
  const file = new File([req.blob], req.name, { type: req.blob.type || 'application/octet-stream' });
  const shareable = canShareFile(file);
  const w = window as SavePickerWindow;
  const picker = typeof w.showSaveFilePicker === 'function';
  const isTouch = navigator.maxTouchPoints > 1;

  const finish = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };

  const doShare = async () => {
    try {
      await navigator.share({ files: [file], title: req.name });
      finish(true);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Teilen nicht möglich – bitte „Herunterladen“ verwenden.', { kind: 'error' });
    }
  };
  const doPicker = async () => {
    try {
      const ext = req.name.slice(req.name.lastIndexOf('.'));
      const handle = await w.showSaveFilePicker!({
        suggestedName: req.name,
        types: [{ description: 'Datei', accept: { [file.type || 'application/octet-stream']: [ext] } }]
      });
      const ws = await handle.createWritable();
      await ws.write(req.blob);
      await ws.close();
      toast('Datei gespeichert');
      finish(true);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Speichern fehlgeschlagen: ' + (e as Error).message, { kind: 'error' });
    }
  };
  const doDownload = () => {
    download(req.blob, req.name);
    toast(isTouch ? 'Datei wird im Ordner „Downloads“ der Dateien-App abgelegt' : 'Download gestartet');
    finish(true);
  };

  return (
    <Modal title={req.title ?? 'Datei bereit'} onClose={() => finish(false)}>
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <FolderDown size={26} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{req.name}</div>
          <div className="small muted">{fmtBytes(req.blob.size)}</div>
        </div>
      </div>
      {req.hint && <p className="small" style={{ color: 'var(--text-2)', marginTop: 0 }}>{req.hint}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shareable && (
          <button className={'btn btn-lg ' + (isTouch ? 'btn-primary' : '')} onClick={doShare}>
            <Share size={19} /> Teilen / In Dateien sichern
          </button>
        )}
        {picker && (
          <button className="btn btn-lg btn-primary" onClick={doPicker}>
            <FolderDown size={19} /> Speichern unter …
          </button>
        )}
        <button className={'btn btn-lg ' + (!shareable && !picker ? 'btn-primary' : '')} onClick={doDownload}>
          <Download size={19} /> Herunterladen
        </button>
      </div>
    </Modal>
  );
}

/** Öffnet die Dateiauswahl (funktioniert auch mit der Dateien-App auf dem iPad). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    input.onchange = () => {
      done = true;
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    // Abbruch erkennen (nicht in allen Browsern zuverlässig)
    input.addEventListener('cancel', () => {
      if (!done) resolve([]);
      input.remove();
    });
    input.click();
  });
}
