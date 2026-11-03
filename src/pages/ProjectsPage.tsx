import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, FolderKanban, MoreHorizontal, Pencil, PenLine, Plus, Trash2, Users } from 'lucide-react';
import { db } from '../db/db';
import { deleteProject, saveProject } from '../db/repo';
import type { Project, ProjectStatus, Task } from '../db/types';
import { PROJECT_STATUS_LABEL } from '../db/types';
import { useLookups } from '../lib/hooks';
import { COLORS } from '../lib/util';
import { NoteRow, useCreateNote } from '../components/NoteItems';
import { TaskModal, TaskRow } from '../components/TaskItems';
import { confirmDialog, Empty, MenuButton, Modal, toast } from '../components/ui';
import { SidebarToggle } from '../components/Layout';

export function ProjectModal({ project, onClose }: { project?: Project; onClose: (id?: string) => void }) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'aktiv');
  const [color, setColor] = useState(project?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]);
  const save = async () => {
    if (!name.trim()) return;
    const id = await saveProject({ id: project?.id, name: name.trim(), description, status, color });
    onClose(id);
  };
  return (
    <Modal
      title={project ? 'Projekt bearbeiten' : 'Neues Projekt'}
      onClose={() => onClose()}
      footer={
        <>
          <button className="btn" onClick={() => onClose()}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>{project ? 'Speichern' : 'Anlegen'}</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="p-name">Name</label>
        <input id="p-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Margenplanung" onKeyDown={(e) => e.key === 'Enter' && save()} />
      </div>
      <div className="field">
        <label htmlFor="p-desc">Beschreibung</label>
        <textarea id="p-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ziel, Umfang, Ansprechpartner …" />
      </div>
      <div className="field">
        <label htmlFor="p-status">Status</label>
        <select id="p-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Farbe</label>
        <div className="color-picks">
          {COLORS.map((c) => (
            <button key={c} className={'color-pick' + (c === color ? ' active' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Farbe ${c}`} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default function ProjectsPage() {
  const [modal, setModal] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const navigate = useNavigate();
  const stats = useLiveQuery(async () => {
    const projects = await db.projects.toArray();
    const notes = await db.notes.where('deletedAt').equals(0).toArray();
    const tasks = await db.tasks.where('deletedAt').equals(0).toArray();
    return projects
      .map((p) => ({
        p,
        notes: notes.filter((n) => n.projectId === p.id && n.type !== 'meeting').length,
        meetings: notes.filter((n) => n.projectId === p.id && n.type === 'meeting').length,
        open: tasks.filter((t) => t.projectId === p.id && (t.status === 'open' || t.status === 'inprogress')).length
      }))
      .sort((a, b) => a.p.name.localeCompare(b.p.name, 'de'));
  }, []);
  const visible = stats?.filter((s) => showDone || s.p.status !== 'abgeschlossen');
  const doneCount = stats?.filter((s) => s.p.status === 'abgeschlossen').length ?? 0;

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div className="row" style={{ gap: 6 }}>
            <span className="show-mobile" style={{ marginLeft: -10 }}>
              <SidebarToggle />
            </span>
            <div>
              <h1 className="page-title">Projekte</h1>
              <p className="page-sub">Notizen, Besprechungen und Aufgaben nach Projekten bündeln</p>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setModal(true)}>
            <Plus size={19} /> Neues Projekt
          </button>
        </div>
        {visible && visible.length === 0 ? (
          <Empty icon={<FolderKanban size={34} />} title="Noch keine Projekte" />
        ) : (
          <div className="project-grid">
            {visible?.map(({ p, notes, meetings, open }) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="card project-card" style={{ ['--c' as string]: p.color }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="project-name">{p.name}</div>
                  <span className={'chip' + (p.status === 'aktiv' ? ' ok' : p.status === 'pausiert' ? ' warn' : '')}>{PROJECT_STATUS_LABEL[p.status]}</span>
                </div>
                <div className="project-desc">{p.description || <span className="muted">Keine Beschreibung</span>}</div>
                <div className="project-stats">
                  <span>{notes} Notizen</span>
                  <span>{meetings} Besprechungen</span>
                  <span style={open ? { color: 'var(--text)' } : undefined}>{open} offene Aufgaben</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {doneCount > 0 && (
          <button className="link-btn mt" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Abgeschlossene ausblenden' : `${doneCount} abgeschlossene Projekte anzeigen`}
          </button>
        )}
      </div>
      {modal && (
        <ProjectModal
          onClose={(id) => {
            setModal(false);
            if (id) navigate(`/projects/${id}`);
          }}
        />
      )}
    </div>
  );
}

export function ProjectDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const lookups = useLookups();
  const create = useCreateNote();
  const [edit, setEdit] = useState(false);
  const [taskModal, setTaskModal] = useState<Task | 'new' | null>(null);
  const [tab, setTab] = useState<'notes' | 'meetings' | 'tasks'>('notes');
  const project = useLiveQuery(() => db.projects.get(id), [id]);
  const notes = useLiveQuery(
    () => db.notes.where('projectId').equals(id).filter((n) => !n.deletedAt).reverse().sortBy('updatedAt'),
    [id]
  );
  const tasks = useLiveQuery(() => db.tasks.where('projectId').equals(id).filter((t) => !t.deletedAt).toArray(), [id]);

  if (project === undefined) return <div className="page" />;
  if (!project) return <div className="page"><Empty title="Projekt nicht gefunden" /></div>;

  const textNotes = notes?.filter((n) => n.type !== 'meeting') ?? [];
  const meetings = (notes?.filter((n) => n.type === 'meeting') ?? []).sort((a, b) => (b.meeting?.date ?? '').localeCompare(a.meeting?.date ?? ''));
  const openTasks = (tasks ?? []).filter((t) => t.status !== 'done').sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const doneTasks = (tasks ?? []).filter((t) => t.status === 'done').sort((a, b) => b.completedAt - a.completedAt);
  const opts = { projectId: project.id };

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
            <span className="show-mobile" style={{ marginLeft: -10 }}>
              <SidebarToggle />
            </span>
            <div>
              <div className="row" style={{ gap: 10 }}>
                <span className="nav-dot" style={{ background: project.color, width: 14, height: 14, margin: 0 }} />
                <h1 className="page-title">{project.name}</h1>
                <span className={'chip' + (project.status === 'aktiv' ? ' ok' : project.status === 'pausiert' ? ' warn' : '')}>{PROJECT_STATUS_LABEL[project.status]}</span>
              </div>
              {project.description && <p className="page-sub" style={{ whiteSpace: 'pre-wrap', maxWidth: 680 }}>{project.description}</p>}
            </div>
          </div>
          <div className="row">
            <MenuButton
              className="btn btn-primary"
              title="Neu"
              items={[
                { label: 'Neue Notiz', icon: <FileText size={17} />, onClick: () => create('text', opts) },
                { label: 'Neue Handschrift', icon: <PenLine size={17} />, onClick: () => create('ink', opts) },
                { label: 'Neue Besprechung', icon: <Users size={17} />, onClick: () => create('meeting', opts) },
                { label: 'Neue Aufgabe', icon: <Plus size={17} />, onClick: () => setTaskModal('new') }
              ]}
            >
              <Plus size={19} /> Neu
            </MenuButton>
            <MenuButton
              title="Projekt"
              items={[
                { label: 'Bearbeiten', icon: <Pencil size={17} />, onClick: () => setEdit(true) },
                {
                  label: 'Projekt löschen', icon: <Trash2 size={17} />, danger: true,
                  onClick: async () => {
                    if (await confirmDialog({ title: 'Projekt löschen?', text: 'Das Projekt wird entfernt. Zugeordnete Notizen, Besprechungen und Aufgaben bleiben erhalten und verlieren nur die Zuordnung.', confirmLabel: 'Projekt löschen', danger: true })) {
                      await deleteProject(project.id);
                      toast('Projekt gelöscht');
                      navigate('/projects');
                    }
                  }
                }
              ]}
            >
              <MoreHorizontal size={22} />
            </MenuButton>
          </div>
        </div>

        <div className="toolbar-row">
          <div className="segmented">
            <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Notizen <span className="muted">{textNotes.length}</span></button>
            <button className={tab === 'meetings' ? 'active' : ''} onClick={() => setTab('meetings')}>Besprechungen <span className="muted">{meetings.length}</span></button>
            <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>Aufgaben <span className="muted">{openTasks.length}</span></button>
          </div>
        </div>

        {tab === 'notes' &&
          (textNotes.length ? (
            <div className="list">{textNotes.map((n) => <NoteRow key={n.id} n={n} lookups={lookups} />)}</div>
          ) : (
            <Empty compact title="Keine Notizen in diesem Projekt" />
          ))}
        {tab === 'meetings' &&
          (meetings.length ? (
            <div className="list">{meetings.map((n) => <NoteRow key={n.id} n={n} lookups={lookups} />)}</div>
          ) : (
            <Empty compact title="Keine Besprechungen in diesem Projekt" />
          ))}
        {tab === 'tasks' && (
          <>
            {openTasks.length ? (
              <div className="list">{openTasks.map((t) => <TaskRow key={t.id} t={t} onOpen={setTaskModal} />)}</div>
            ) : (
              <Empty compact title="Keine offenen Aufgaben" />
            )}
            {doneTasks.length > 0 && (
              <section className="section mt">
                <div className="section-head"><h2 className="section-title">Erledigt <span className="count">{doneTasks.length}</span></h2></div>
                <div className="list">{doneTasks.map((t) => <TaskRow key={t.id} t={t} onOpen={setTaskModal} />)}</div>
              </section>
            )}
          </>
        )}
      </div>
      {edit && <ProjectModal project={project} onClose={() => setEdit(false)} />}
      {taskModal && <TaskModal task={taskModal === 'new' ? undefined : taskModal} defaults={{ projectId: project.id }} onClose={() => setTaskModal(null)} />}
    </div>
  );
}
