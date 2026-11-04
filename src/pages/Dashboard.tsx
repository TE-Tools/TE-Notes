import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Archive, CheckCircle2, FileText, PenLine, Plus, ShieldCheck } from 'lucide-react';
import { db } from '../db/db';
import { pinnedNotes, recentNotes } from '../db/repo';
import type { Task } from '../db/types';
import { useLookups, useSettings } from '../lib/hooks';
import { fmtLongDate, fmtRelative, greeting, todayISO } from '../lib/util';
import { NoteCard, NoteRow, useCreateNote } from '../components/NoteItems';
import { TaskModal, TaskRow } from '../components/TaskItems';
import { Empty } from '../components/ui';
import { SidebarToggle } from '../components/Layout';

export default function Dashboard() {
  const settings = useSettings();
  const lookups = useLookups();
  const create = useCreateNote();
  const navigate = useNavigate();
  const [taskModal, setTaskModal] = useState<Task | 'new' | null>(null);

  const recent = useLiveQuery(() => recentNotes(9), []);
  const pinned = useLiveQuery(() => pinnedNotes(), []);
  const tasks = useLiveQuery(async () => {
    const open = (await db.tasks.where('status').anyOf('open', 'inprogress').toArray()).filter((t) => !t.deletedAt);
    const today = todayISO();
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    const upcoming = open
      .filter((t) => !t.dueDate || t.dueDate >= today)
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.priority - b.priority);
    return { overdue, upcoming, openCount: open.length };
  }, []);
  const archived = useLiveQuery(
    () => db.notes.where('archivedAt').above(0).reverse().filter((n) => !n.deletedAt && n.archived === 1).limit(5).toArray(),
    []
  );

  const days = settings.lastBackupAt ? Math.floor((Date.now() - settings.lastBackupAt) / 86400000) : null;
  const hasData = (recent?.length ?? 0) > 0;
  const backupDue = hasData && settings.backupReminderDays > 0 && (days === null || days >= settings.backupReminderDays);

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="row show-mobile" style={{ marginBottom: 6, marginLeft: -10 }}>
          <SidebarToggle />
        </div>
        <div className="hero">
          <div className="hero-date">{fmtLongDate()}</div>
          <h1 className="hero-title">
            {greeting()}
            {settings.userName ? `, ${settings.userName}` : ''}
          </h1>
          <div className="quick-actions">
            <button className="quick" onClick={() => create('text')}>
              <div className="quick-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <FileText size={22} />
              </div>
              <div>
                <div className="quick-title">Neue Notiz</div>
                <div className="quick-sub">Text, Listen, Tabellen</div>
              </div>
            </button>
            <button className="quick" onClick={() => create('ink')}>
              <div className="quick-icon" style={{ background: '#f3ecdc', color: '#9a6b12' }}>
                <PenLine size={22} />
              </div>
              <div>
                <div className="quick-title">Neue Handschrift-Notiz</div>
                <div className="quick-sub">Für Apple Pencil</div>
              </div>
            </button>
          </div>
        </div>

        {backupDue && (
          <div className="banner">
            <ShieldCheck size={22} />
            <div className="banner-text">
              <strong>Zeit für eine Datensicherung.</strong>{' '}
              {days === null ? 'Es wurde noch keine Sicherung erstellt.' : `Die letzte Sicherung ist ${days} Tage alt.`} Ihre Daten liegen nur auf
              diesem Gerät.
            </div>
            <button className="btn btn-sm" onClick={() => navigate('/settings#backup')}>Jetzt sichern</button>
          </div>
        )}

        <div className="dash-cols">
          <div>
            {(pinned?.length ?? 0) > 0 && (
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Angeheftet</h2>
                </div>
                <div className="note-grid">
                  {pinned!.slice(0, 6).map((n) => (
                    <NoteCard key={n.id} n={n} lookups={lookups} />
                  ))}
                </div>
              </section>
            )}
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Zuletzt bearbeitet</h2>
                <Link className="link-btn" to="/notes">Alle anzeigen</Link>
              </div>
              {recent && recent.length === 0 ? (
                <Empty icon={<FileText size={34} />} title="Noch keine Notizen">
                  Legen Sie oben Ihre erste Notiz oder Handschrift an.
                </Empty>
              ) : (
                <div className="note-grid">
                  {recent?.map((n) => (
                    <NoteCard key={n.id} n={n} lookups={lookups} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <div>
            {(tasks?.overdue.length ?? 0) > 0 && (
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title" style={{ color: 'var(--danger)' }}>
                    <AlertTriangle size={18} /> Überfällig <span className="count">{tasks!.overdue.length}</span>
                  </h2>
                </div>
                <div className="list">
                  {tasks!.overdue.slice(0, 6).map((t) => (
                    <TaskRow key={t.id} t={t} onOpen={setTaskModal} />
                  ))}
                </div>
              </section>
            )}
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">
                  Offene Aufgaben <span className="count">{tasks?.upcoming.length ?? 0}</span>
                </h2>
                <div className="row" style={{ gap: 4 }}>
                  <button className="icon-btn sm" onClick={() => setTaskModal('new')} title="Neue Aufgabe" aria-label="Neue Aufgabe">
                    <Plus size={19} />
                  </button>
                  <Link className="link-btn" to="/tasks">Alle</Link>
                </div>
              </div>
              {tasks && tasks.upcoming.length === 0 ? (
                <Empty compact icon={<CheckCircle2 size={26} />} title="Alles erledigt" />
              ) : (
                <div className="list">
                  {tasks?.upcoming.slice(0, 7).map((t) => (
                    <TaskRow key={t.id} t={t} onOpen={setTaskModal} />
                  ))}
                </div>
              )}
            </section>
            {(archived?.length ?? 0) > 0 && (
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">
                    <Archive size={17} /> Kürzlich archiviert
                  </h2>
                  <Link className="link-btn" to="/archive">Archiv</Link>
                </div>
                <div className="list">
                  {archived!.map((n) => (
                    <NoteRow key={n.id} n={n} lookups={lookups} side={fmtRelative(n.archivedAt)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
      {taskModal && <TaskModal task={taskModal === 'new' ? undefined : taskModal} onClose={() => setTaskModal(null)} />}
    </div>
  );
}
