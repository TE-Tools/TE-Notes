import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Plus } from 'lucide-react';
import { db } from '../db/db';
import { createTask } from '../db/repo';
import type { Task } from '../db/types';
import { useLookups } from '../lib/hooks';
import { normalize } from '../lib/text';
import { todayISO } from '../lib/util';
import { TaskModal, TaskRow } from '../components/TaskItems';
import { Empty, toastError } from '../components/ui';
import { SidebarToggle } from '../components/Layout';

type Tab = 'open' | 'overdue' | 'deferred' | 'done' | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Offen' },
  { key: 'overdue', label: 'Überfällig' },
  { key: 'deferred', label: 'Zurückgestellt' },
  { key: 'done', label: 'Erledigt' },
  { key: 'all', label: 'Alle' }
];

function addDays(n: number) {
  return todayISO(new Date(Date.now() + n * 86400000));
}

export default function TasksPage() {
  const lookups = useLookups();
  const [tab, setTab] = useState<Tab>('open');
  const [projectId, setProjectId] = useState('');
  const [prio, setPrio] = useState('');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [quickDue, setQuickDue] = useState('');
  const [modal, setModal] = useState<Task | 'new' | null>(null);

  const all = useLiveQuery(() => db.tasks.where('deletedAt').equals(0).toArray(), []);
  const today = todayISO();

  const counts = useMemo(() => {
    const c = { open: 0, overdue: 0, deferred: 0, done: 0, all: 0 };
    for (const t of all ?? []) {
      c.all++;
      if (t.status === 'open' || t.status === 'inprogress') {
        c.open++;
        if (t.dueDate && t.dueDate < today) c.overdue++;
      } else if (t.status === 'deferred') c.deferred++;
      else c.done++;
    }
    return c;
  }, [all, today]);

  const filtered = useMemo(() => {
    const nq = normalize(q.trim());
    return (all ?? []).filter((t) => {
      const open = t.status === 'open' || t.status === 'inprogress';
      if (tab === 'open' && !open) return false;
      if (tab === 'overdue' && !(open && t.dueDate && t.dueDate < today)) return false;
      if (tab === 'deferred' && t.status !== 'deferred') return false;
      if (tab === 'done' && t.status !== 'done') return false;
      if (projectId && t.projectId !== projectId) return false;
      if (prio && String(t.priority) !== prio) return false;
      if (nq && !normalize(`${t.title} ${t.description} ${t.assignee}`).includes(nq)) return false;
      return true;
    });
  }, [all, tab, projectId, prio, q, today]);

  const groups = useMemo(() => {
    if (tab === 'done') {
      const sorted = [...filtered].sort((a, b) => b.completedAt - a.completedAt);
      return [{ label: 'Erledigte Aufgaben (Historie)', items: sorted }];
    }
    const sorted = [...filtered].sort(
      (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.priority - b.priority || b.updatedAt - a.updatedAt
    );
    if (tab !== 'open') return [{ label: '', items: sorted }];
    const tomorrow = addDays(1);
    const week = addDays(7);
    const buckets: { label: string; test: (t: Task) => boolean }[] = [
      { label: 'Überfällig', test: (t) => !!t.dueDate && t.dueDate < today },
      { label: 'Heute', test: (t) => t.dueDate === today },
      { label: 'Morgen', test: (t) => t.dueDate === tomorrow },
      { label: 'Nächste 7 Tage', test: (t) => !!t.dueDate && t.dueDate > tomorrow && t.dueDate <= week },
      { label: 'Später', test: (t) => !!t.dueDate && t.dueDate > week },
      { label: 'Ohne Fälligkeit', test: (t) => !t.dueDate }
    ];
    return buckets.map((b) => ({ label: b.label, items: sorted.filter(b.test) })).filter((g) => g.items.length);
  }, [filtered, tab, today]);

  const addQuick = async () => {
    const title = quick.trim();
    if (!title) return;
    try {
      await createTask({ title, dueDate: quickDue || null, projectId: projectId || null });
      setQuick('');
      setQuickDue('');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="page">
      <div className="page-narrow" style={{ maxWidth: 900 }}>
        <div className="page-header">
          <div className="row" style={{ gap: 6 }}>
            <span className="show-mobile" style={{ marginLeft: -10 }}>
              <SidebarToggle />
            </span>
            <div>
              <h1 className="page-title">Aufgaben</h1>
              <p className="page-sub">
                {counts.open} offen{counts.overdue > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}> · {counts.overdue} überfällig</span>}
              </p>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            <Plus size={19} /> Neue Aufgabe
          </button>
        </div>

        <div className="card" style={{ display: 'flex', gap: 8, padding: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: '1 1 240px', border: 0 }}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Schnell erfassen: Aufgabe eingeben und Enter drücken …"
            onKeyDown={(e) => e.key === 'Enter' && addQuick()}
          />
          <input type="date" className="input" style={{ width: 'auto', border: 0 }} value={quickDue} onChange={(e) => setQuickDue(e.target.value)} aria-label="Fällig am" />
          <button className="btn" onClick={addQuick} disabled={!quick.trim()}>Hinzufügen</button>
        </div>

        <div className="toolbar-row">
          <div className="segmented" role="tablist" style={{ overflowX: 'auto', maxWidth: '100%' }}>
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                {t.label}
                {counts[t.key] > 0 && (
                  <span className="muted" style={{ fontWeight: 500, color: t.key === 'overdue' ? 'var(--danger)' : undefined }}>{counts[t.key]}</span>
                )}
              </button>
            ))}
          </div>
          <select className="select" style={{ width: 'auto' }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Alle Projekte</option>
            {lookups.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select className="select" style={{ width: 'auto' }} value={prio} onChange={(e) => setPrio(e.target.value)}>
            <option value="">Alle Prioritäten</option>
            <option value="1">Hoch</option>
            <option value="2">Mittel</option>
            <option value="3">Niedrig</option>
          </select>
          <input className="input" style={{ width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtern …" />
        </div>

        {all && filtered.length === 0 ? (
          <Empty icon={<CheckCircle2 size={34} />} title={tab === 'open' ? 'Keine offenen Aufgaben' : 'Keine Aufgaben'}>
            {tab === 'open' && 'Aufgaben lassen sich auch direkt aus Notizen und Besprechungen erzeugen.'}
          </Empty>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="section">
              {g.label && (
                <div className="section-head">
                  <h2 className="section-title" style={g.label === 'Überfällig' ? { color: 'var(--danger)' } : undefined}>
                    {g.label} <span className="count">{g.items.length}</span>
                  </h2>
                </div>
              )}
              <div className="list">
                {g.items.map((t) => (
                  <TaskRow key={t.id} t={t} onOpen={setModal} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      {modal && <TaskModal task={modal === 'new' ? undefined : modal} defaults={{ projectId: projectId || null }} onClose={() => setModal(null)} />}
    </div>
  );
}
