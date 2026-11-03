import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X } from 'lucide-react';
import { search, type SearchFilters, type SearchResult } from '../lib/search';
import { useLookups } from '../lib/hooks';
import type { Task } from '../db/types';
import { NoteRow } from '../components/NoteItems';
import { TaskModal, TaskRow } from '../components/TaskItems';
import { Empty, toastError } from '../components/ui';
import { SidebarToggle } from '../components/Layout';
import { fmtRelative } from '../lib/util';

export default function SearchPage() {
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [f, setF] = useState<SearchFilters>({});
  const [res, setRes] = useState<SearchResult | null>(null);
  const [ms, setMs] = useState(0);
  const [taskModal, setTaskModal] = useState<Task | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const t0 = performance.now();
        const r = await search(q, f);
        if (!alive) return;
        setMs(Math.round(performance.now() - t0));
        setRes(r);
        setParams(q ? { q } : {}, { replace: true });
      } catch (e) {
        toastError(e, 'Suche fehlgeschlagen');
      }
    }, 140);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, f, setParams]);

  const set = (patch: Partial<SearchFilters>) => setF((x) => ({ ...x, ...patch }));
  const hasFilter = Object.values(f).some(Boolean);
  const active = q.trim() || hasFilter;

  return (
    <div className="page">
      <div className="page-narrow" style={{ maxWidth: 900 }}>
        <div className="row" style={{ gap: 6, marginBottom: 14 }}>
          <span className="show-mobile" style={{ marginLeft: -10 }}>
            <SidebarToggle />
          </span>
          <h1 className="page-title">Suche</h1>
        </div>
        <div className="search-box">
          <SearchIcon size={21} className="muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Notizen, Besprechungen, Aufgaben, Tags, Projekte …"
            aria-label="Suchbegriff"
            enterKeyHint="search"
          />
          {q && (
            <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Leeren">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="filters">
          <select className="select" value={f.type ?? ''} onChange={(e) => set({ type: e.target.value as SearchFilters['type'], status: '' })} aria-label="Notiztyp">
            <option value="">Alle Typen</option>
            <option value="text">Textnotizen</option>
            <option value="ink">Handschrift</option>
            <option value="meeting">Besprechungen</option>
            <option value="task">Aufgaben</option>
          </select>
          <select className="select" value={f.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value })} aria-label="Projekt">
            <option value="">Alle Projekte</option>
            {lookups.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" value={f.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value })} aria-label="Kategorie">
            <option value="">Alle Kategorien</option>
            {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" value={f.status ?? ''} onChange={(e) => set({ status: e.target.value as SearchFilters['status'] })} aria-label="Status">
            <option value="">Jeder Status</option>
            {f.type !== 'task' && (
              <optgroup label="Notizen">
                <option value="active">Aktiv</option>
                <option value="pinned">Angeheftet</option>
                <option value="archived">Archiviert</option>
              </optgroup>
            )}
            {(!f.type || f.type === 'task') && (
              <optgroup label="Aufgaben">
                <option value="open">Offen</option>
                <option value="inprogress">In Bearbeitung</option>
                <option value="done">Erledigt</option>
                <option value="deferred">Zurückgestellt</option>
              </optgroup>
            )}
          </select>
          <input type="date" className="input" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value })} aria-label="Zeitraum von" title="Von" />
          <input type="date" className="input" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value })} aria-label="Zeitraum bis" title="Bis" />
          {hasFilter && <button className="link-btn" onClick={() => setF({})}>Filter zurücksetzen</button>}
        </div>

        {!active ? (
          <Empty icon={<SearchIcon size={32} />} title="Durchsuchen Sie Ihr Arbeitsgedächtnis">
            Die Suche läuft vollständig auf diesem Gerät. Handschrift wird über Titel und Tags gefunden.
          </Empty>
        ) : res && res.total === 0 ? (
          <Empty icon={<SearchIcon size={32} />} title="Keine Treffer">Versuchen Sie einen kürzeren Begriff oder entfernen Sie Filter.</Empty>
        ) : res ? (
          <>
            <p className="small muted" style={{ marginTop: -6 }}>
              {res.total} Treffer · {ms} ms
            </p>
            {res.notes.length > 0 && (
              <section className="section">
                <div className="section-head"><h2 className="section-title">Notizen <span className="count">{res.notes.length}</span></h2></div>
                <div className="list">
                  {res.notes.map((n) => (
                    <NoteRow key={n.id} n={n} lookups={lookups} side={n.archived ? 'Archiv' : fmtRelative(n.updatedAt)} />
                  ))}
                </div>
              </section>
            )}
            {res.tasks.length > 0 && (
              <section className="section">
                <div className="section-head"><h2 className="section-title">Aufgaben <span className="count">{res.tasks.length}</span></h2></div>
                <div className="list">
                  {res.tasks.map((t) => <TaskRow key={t.id} t={t} onOpen={setTaskModal} />)}
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
      {taskModal && <TaskModal task={taskModal} onClose={() => { setTaskModal(null); setF((x) => ({ ...x })); }} />}
    </div>
  );
}
