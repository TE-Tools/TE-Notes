import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, Check, Flag, Link2, User } from 'lucide-react';
import { db } from '../db/db';
import { createTask, trashTask, updateTask } from '../db/repo';
import type { Task, TaskPriority, TaskStatus } from '../db/types';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from '../db/types';
import { useLookups } from '../lib/hooks';
import { fmtDate, isOverdue, todayISO } from '../lib/util';
import { Modal, toast, toastError } from './ui';

export function TaskRow({ t, onOpen, showNote = true }: { t: Task; onOpen?: (t: Task) => void; showNote?: boolean }) {
  const lookups = useLookups();
  const note = useLiveQuery(() => (t.noteId && showNote ? db.notes.get(t.noteId) : undefined), [t.noteId, showNote]);
  const overdue = isOverdue(t.dueDate, t.status);
  const done = t.status === 'done';
  const p = t.projectId ? lookups.projectMap.get(t.projectId) : undefined;
  const toggle = async () => {
    try {
      await updateTask(t.id, { status: done ? 'open' : 'done' });
      if (!done) toast('Aufgabe erledigt', { action: { label: 'Rückgängig', run: () => updateTask(t.id, { status: t.status }) } });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className={'task-row' + (done ? ' done' : '') + (overdue ? ' overdue' : '')}>
      <button
        className={'task-check' + (done ? ' done' : '') + (t.priority === 1 && !done ? ' prio-1' : '')}
        onClick={toggle}
        aria-label={done ? 'Als offen markieren' : 'Als erledigt markieren'}
      >
        {done && <Check size={15} strokeWidth={3} />}
      </button>
      <div className="task-main" onClick={() => onOpen?.(t)}>
        <div className="task-title">{t.title || 'Ohne Titel'}</div>
        <div className="task-meta">
          {overdue && (
            <span className="chip danger">
              <AlertCircle size={12} /> Überfällig · {fmtDate(t.dueDate)}
            </span>
          )}
          {!overdue && t.dueDate && <span className={'chip' + (t.dueDate === todayISO() && !done ? ' warn' : '')}>Fällig {fmtDate(t.dueDate)}</span>}
          {t.status === 'inprogress' && <span className="chip accent">In Bearbeitung</span>}
          {t.status === 'deferred' && <span className="chip">Zurückgestellt</span>}
          {t.priority === 1 && !done && (
            <span className="chip danger">
              <Flag size={11} /> Hoch
            </span>
          )}
          {t.assignee && (
            <span className="chip">
              <User size={11} /> {t.assignee}
            </span>
          )}
          {p && (
            <span className="chip">
              <span className="dot" style={{ background: p.color }} />
              {p.name}
            </span>
          )}
          {note && (
            <Link to={`/note/${note.id}`} className="chip" onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>
              <Link2 size={11} /> {note.title || 'Ohne Titel'}
            </Link>
          )}
          {done && t.completedAt > 0 && <span>Erledigt am {fmtDate(t.completedAt)}</span>}
        </div>
      </div>
    </div>
  );
}

export function TaskModal({
  task, defaults, onClose
}: { task?: Task; defaults?: Partial<Task>; onClose: () => void }) {
  const lookups = useLookups();
  const [f, setF] = useState<Partial<Task>>(() => task ?? { priority: 2, status: 'open', ...defaults });
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setF((x) => ({ ...x, [k]: v }));
  const note = useLiveQuery(() => (f.noteId ? db.notes.get(f.noteId) : undefined), [f.noteId]);

  const saving = useRef(false);
  const save = async () => {
    const title = (f.title ?? '').trim();
    if (!title || saving.current) return;
    saving.current = true;
    try {
      if (task) await updateTask(task.id, { ...f, title });
      else {
        await createTask({ ...f, title });
        toast('Aufgabe angelegt');
      }
      onClose();
    } catch (e) {
      saving.current = false;
      toastError(e, 'Speichern fehlgeschlagen');
    }
  };

  return (
    <Modal
      title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
      onClose={onClose}
      footer={
        <>
          {task && (
            <button
              className="btn btn-danger"
              style={{ marginRight: 'auto' }}
              onClick={async () => {
                await trashTask(task.id);
                toast('Aufgabe in den Papierkorb verschoben', { action: { label: 'Rückgängig', run: () => updateTask(task.id, { deletedAt: 0 }) } });
                onClose();
              }}
            >
              Löschen
            </button>
          )}
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!(f.title ?? '').trim()}>
            {task ? 'Speichern' : 'Anlegen'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="t-title">Titel</label>
        <input
          id="t-title"
          className="input"
          autoFocus={!task}
          value={f.title ?? ''}
          onChange={(e) => set('title', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Was ist zu tun?"
        />
      </div>
      <div className="field">
        <label htmlFor="t-desc">Beschreibung</label>
        <textarea id="t-desc" className="textarea" value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="t-due">Fällig am</label>
          <input id="t-due" type="date" className="input" value={f.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
        </div>
        <div className="field">
          <label htmlFor="t-assignee">Verantwortlich</label>
          <input id="t-assignee" className="input" value={f.assignee ?? ''} onChange={(e) => set('assignee', e.target.value)} placeholder="Name" />
        </div>
        <div className="field">
          <label htmlFor="t-status">Status</label>
          <select id="t-status" className="select" value={f.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-prio">Priorität</label>
          <select id="t-prio" className="select" value={f.priority} onChange={(e) => set('priority', Number(e.target.value) as TaskPriority)}>
            {([1, 2, 3] as TaskPriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-proj">Projekt</label>
          <select id="t-proj" className="select" value={f.projectId ?? ''} onChange={(e) => set('projectId', e.target.value || null)}>
            <option value="">Kein Projekt</option>
            {lookups.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-cat">Kategorie</label>
          <select id="t-cat" className="select" value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
            <option value="">Keine Kategorie</option>
            {lookups.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      {note && (
        <div className="small muted">
          Zugehörige Notiz:{' '}
          <Link to={`/note/${note.id}`} onClick={onClose}>
            {note.title || 'Ohne Titel'}
          </Link>{' '}
          <button className="link-btn" onClick={() => set('noteId', null)}>Verknüpfung lösen</button>
        </div>
      )}
      {task && (
        <div className="small muted" style={{ marginTop: 8 }}>
          Angelegt {fmtDate(task.createdAt)}
          {task.completedAt > 0 && ` · Erledigt ${fmtDate(task.completedAt)}`}
        </div>
      )}
    </Modal>
  );
}
