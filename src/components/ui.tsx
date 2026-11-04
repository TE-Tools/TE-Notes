import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Mini-Store für globale UI (Toasts, Bestätigungen, Datei-Freigabe)   */
/* ------------------------------------------------------------------ */

type Listener = () => void;
function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set: (next: T) => {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }
  };
}
function useStore<T>(store: ReturnType<typeof createStore<T>>) {
  const [, force] = useState(0);
  useEffect(() => {
    const off = store.subscribe(() => force((x) => x + 1));
    return () => {
      off();
    };
  }, [store]);
  return store.get();
}

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}
const toastStore = createStore<ToastItem[]>([]);
let toastId = 0;

export function toast(text: string, opts: { kind?: 'info' | 'error'; action?: ToastItem['action']; ms?: number } = {}) {
  const id = ++toastId;
  toastStore.set([...toastStore.get(), { id, text, kind: opts.kind ?? 'info', action: opts.action }]);
  setTimeout(() => toastStore.set(toastStore.get().filter((t) => t.id !== id)), opts.ms ?? (opts.action ? 6000 : 3200));
}
export function toastError(e: unknown, prefix = 'Fehler') {
  console.error(e);
  const msg = e instanceof Error ? e.message : String(e);
  toast(`${prefix}: ${msg}`, { kind: 'error', ms: 7000 });
}

interface ConfirmReq {
  title: string;
  text?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
const confirmStore = createStore<ConfirmReq | null>(null);
export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => confirmStore.set({ ...opts, resolve }));
}

interface PromptReq {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  resolve: (v: string | null) => void;
}
const promptStore = createStore<PromptReq | null>(null);
export function promptDialog(opts: Omit<PromptReq, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => promptStore.set({ ...opts, resolve }));
}

export function GlobalUI() {
  const toasts = useStore(toastStore);
  const confirm = useStore(confirmStore);
  const prompt = useStore(promptStore);
  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.kind === 'error' ? 'error' : '')}>
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  toastStore.set(toastStore.get().filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {confirm && (
        <Modal
          title={confirm.title}
          onClose={() => {
            confirm.resolve(false);
            confirmStore.set(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  confirm.resolve(false);
                  confirmStore.set(null);
                }}
              >
                {confirm.cancelLabel ?? 'Abbrechen'}
              </button>
              <button
                className={'btn ' + (confirm.danger ? 'btn-danger-solid' : 'btn-primary')}
                autoFocus
                onClick={() => {
                  confirm.resolve(true);
                  confirmStore.set(null);
                }}
              >
                {confirm.confirmLabel ?? 'OK'}
              </button>
            </>
          }
        >
          {confirm.text && <div style={{ color: 'var(--text-2)' }}>{confirm.text}</div>}
        </Modal>
      )}
      {prompt && <PromptModal req={prompt} close={() => promptStore.set(null)} />}
    </>
  );
}

function PromptModal({ req, close }: { req: PromptReq; close: () => void }) {
  const [v, setV] = useState(req.value ?? '');
  const done = (val: string | null) => {
    req.resolve(val);
    close();
  };
  return (
    <Modal
      title={req.title}
      onClose={() => done(null)}
      footer={
        <>
          <button className="btn" onClick={() => done(null)}>Abbrechen</button>
          <button className="btn btn-primary" onClick={() => done(v.trim())} disabled={!v.trim()}>
            {req.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <div className="field">
        {req.label && <label>{req.label}</label>}
        <input
          className="input"
          autoFocus
          value={v}
          placeholder={req.placeholder}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && v.trim()) done(v.trim());
          }}
        />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  title, children, footer, onClose, wide
}: { title: ReactNode; children?: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Kontextmenü                                                         */
/* ------------------------------------------------------------------ */

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export function MenuButton({
  items, children, className = 'icon-btn', title
}: { items: (MenuItem | 'sep')[]; children: ReactNode; className?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const mw = menuRef.current?.offsetWidth ?? 240;
    const mh = menuRef.current?.offsetHeight ?? 300;
    let left = r.right - mw;
    if (left < 8) left = Math.min(r.left, window.innerWidth - mw - 8);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} className={className} onClick={() => setOpen((o) => !o)} title={title} aria-label={title} aria-haspopup="menu">
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {items.map((it, i) =>
              it === 'sep' ? (
                <hr key={i} />
              ) : it.hidden ? null : (
                <button
                  key={i}
                  role="menuitem"
                  className={it.danger ? 'danger' : ''}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  {it.icon}
                  {it.label}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Kleinteile                                                          */
/* ------------------------------------------------------------------ */

export function Empty({ icon, title, children, compact }: { icon?: ReactNode; title: string; children?: ReactNode; compact?: boolean }) {
  return (
    <div className={'empty' + (compact ? ' compact' : '')}>
      {icon}
      <div className="empty-title">{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function TagInput({
  value, onChange, placeholder, suggestions = []
}: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const listId = useRef('tags-' + Math.random().toString(36).slice(2)).current;
  const commit = (raw: string = text) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) {
      const next = [...value];
      for (const p of parts) if (!next.includes(p)) next.push(p);
      onChange(next);
    }
    setText('');
  };
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="chip accent">
          {t}
          <button className="chip-x" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`${t} entfernen`}>
            <X size={13} />
          </button>
        </span>
      ))}
      <input
        value={text}
        list={suggestions.length ? listId : undefined}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          if (e.target.value.endsWith(',')) {
            commit(e.target.value);
          } else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit()}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.filter((s) => !value.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
