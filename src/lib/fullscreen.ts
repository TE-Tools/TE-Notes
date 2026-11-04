import { useCallback, useEffect, useRef, useState } from 'react';

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };

function exitNative() {
  const d = document as FsDoc;
  try {
    if (d.fullscreenElement) void d.exitFullscreen?.().catch(() => {});
    else if (d.webkitFullscreenElement) d.webkitExitFullscreen?.();
  } catch {
    /* ignorieren */
  }
}

/**
 * Vollbild für den Schreibbereich: setzt `className` auf <html> (blendet per CSS Seitenleiste,
 * Navigation usw. aus) und nutzt – wo der Browser es erlaubt – zusätzlich echtes Vollbild.
 * In der installierten iPad-App genügt das Ausblenden; Escape beendet das Vollbild.
 */
export function useWriteFullscreen(className: string) {
  const [on, setOn] = useState(false);
  const native = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(className, on);
    return () => root.classList.remove(className);
  }, [on, className]);

  useEffect(() => {
    const onFs = () => {
      const d = document as FsDoc;
      if (!(d.fullscreenElement ?? d.webkitFullscreenElement) && native.current) {
        native.current = false;
        setOn(false);
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
      if (native.current) exitNative();
    };
  }, []);

  const exit = useCallback(() => {
    if (native.current) {
      native.current = false;
      exitNative();
    }
    setOn(false);
  }, []);

  // Escape beendet das Vollbild (Tastatur am iPad / PC)
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal')) exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, exit]);

  const toggle = useCallback(() => {
    if (on) return exit();
    setOn(true);
    // muss direkt in der Tipp-Aktion aufgerufen werden (Safari)
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      const r = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
      native.current = true;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => (native.current = false));
    } catch {
      native.current = false;
    }
  }, [on, exit]);

  return { fullscreen: on, toggleFullscreen: toggle, exitFullscreen: exit };
}
