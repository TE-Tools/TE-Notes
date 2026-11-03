import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive, CheckSquare, FileText, FolderKanban, Home, Menu as MenuIcon, PenLine, Search, Settings, Trash2, Users
} from 'lucide-react';
import { db } from '../db/db';
import { useLookups } from '../lib/hooks';
import { todayISO } from '../lib/util';
import { APP_CLAIM, APP_VERSION, BRAND } from '../lib/version';

interface LayoutCtx {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
}
const Ctx = createContext<LayoutCtx>({ sidebarOpen: true, setSidebarOpen: () => {}, toggleSidebar: () => {} });
export const useLayout = () => useContext(Ctx);

const isSmall = () => window.matchMedia('(max-width: 767px)').matches;

function readSidebarPref() {
  try {
    return localStorage.getItem('te-sidebar') !== '0';
  } catch {
    return true;
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(() => !isSmall() && readSidebarPref());
  const location = useLocation();
  const navigate = useNavigate();

  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (!isSmall()) {
      try {
        localStorage.setItem('te-sidebar', v ? '1' : '0');
      } catch {
        /* privat-Modus */
      }
    }
  };

  // Auf kleinen Geräten nach Navigation schließen
  useEffect(() => {
    if (isSmall()) setOpenState(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <Ctx.Provider value={{ sidebarOpen: open, setSidebarOpen: setOpen, toggleSidebar: () => setOpen(!open) }}>
      <div className="app">
        <Sidebar open={open} />
        {open && isSmall() && <div className="scrim" onClick={() => setOpen(false)} />}
        <main className="main">{children}</main>
        <BottomNav onMore={() => setOpen(true)} />
      </div>
    </Ctx.Provider>
  );
}

function useCounts() {
  return useLiveQuery(async () => {
    const today = todayISO();
    const open = (await db.tasks.where('status').anyOf('open', 'inprogress').toArray()).filter((t) => !t.deletedAt);
    const byType = (type: string) => db.notes.where('[type+archived+deletedAt]').equals([type, 0, 0]).count();
    return {
      all: await db.notes.where('[archived+deletedAt]').equals([0, 0]).count(),
      ink: await byType('ink'),
      meetings: await byType('meeting'),
      archive: await db.notes.where('[archived+deletedAt]').equals([1, 0]).count(),
      trash: (await db.notes.where('deletedAt').above(0).count()) + (await db.tasks.where('deletedAt').above(0).count()),
      tasks: open.length,
      overdue: open.filter((t) => t.dueDate && t.dueDate < today).length
    };
  }, []);
}

function Sidebar({ open }: { open: boolean }) {
  const counts = useCounts();
  const { projects } = useLookups();
  const navigate = useNavigate();
  const activeProjects = projects.filter((p) => p.status !== 'abgeschlossen');
  const isMac = /Mac|iPad|iPhone/.test(navigator.platform) || navigator.maxTouchPoints > 1;

  const item = (to: string, icon: ReactNode, label: string, count?: number, alert?: boolean) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
      {icon}
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className={'nav-count' + (alert ? ' alert' : '')}>{count}</span>}
    </NavLink>
  );

  return (
    <aside className={'sidebar' + (open ? '' : ' collapsed')} aria-label="Hauptnavigation">
      <div className="brand">
        <img src="./icons/icon.svg" alt="" />
        <div>
          <div className="brand-name">TE Notes</div>
          <div className="brand-sub">{APP_CLAIM}</div>
        </div>
      </div>
      <button className="side-search" onClick={() => navigate('/search')}>
        <Search size={17} />
        Suchen
        <kbd className="hide-mobile">{isMac ? '⌘K' : 'Strg K'}</kbd>
      </button>
      <nav>
        {item('/', <Home size={20} />, 'Dashboard')}
        {item('/notes', <FileText size={20} />, 'Alle Notizen', counts?.all)}
        {item('/ink', <PenLine size={20} />, 'Handschriftliche Notizen', counts?.ink)}
        {item('/meetings', <Users size={20} />, 'Besprechungen', counts?.meetings)}
        {item('/tasks', <CheckSquare size={20} />, 'Aufgaben', counts?.overdue || counts?.tasks, !!counts?.overdue)}
        {item('/projects', <FolderKanban size={20} />, 'Projekte')}
        {activeProjects.length > 0 && (
          <div style={{ marginLeft: 8 }}>
            {activeProjects.slice(0, 8).map((p) => (
              <NavLink
                key={p.id}
                to={`/projects/${p.id}`}
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                style={{ minHeight: 36, padding: '6px 12px', fontSize: 14.5 }}
              >
                <span className="nav-dot" style={{ background: p.color }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              </NavLink>
            ))}
          </div>
        )}
        <div className="nav-section">Ablage</div>
        {item('/archive', <Archive size={20} />, 'Archiv', counts?.archive)}
        {item('/trash', <Trash2 size={20} />, 'Papierkorb', counts?.trash)}
        {item('/settings', <Settings size={20} />, 'Einstellungen')}
      </nav>
      <div className="sidebar-footer">
        {BRAND} · Version {APP_VERSION}
        <br />
        Alle Daten bleiben auf diesem Gerät.
      </div>
    </aside>
  );
}

function BottomNav({ onMore }: { onMore: () => void }) {
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  return (
    <nav className="bottom-nav" aria-label="Navigation">
      <NavLink to="/" end className={cls}>
        <Home size={22} />
        Start
      </NavLink>
      <NavLink to="/notes" className={cls}>
        <FileText size={22} />
        Notizen
      </NavLink>
      <NavLink to="/tasks" className={cls}>
        <CheckSquare size={22} />
        Aufgaben
      </NavLink>
      <NavLink to="/search" className={cls}>
        <Search size={22} />
        Suche
      </NavLink>
      <button onClick={onMore}>
        <MenuIcon size={22} />
        Mehr
      </button>
    </nav>
  );
}

/** Schaltfläche zum Ein-/Ausblenden der Seitenleiste */
export function SidebarToggle() {
  const { toggleSidebar } = useLayout();
  return (
    <button className="icon-btn" onClick={toggleSidebar} title="Seitenleiste ein-/ausblenden" aria-label="Seitenleiste ein-/ausblenden">
      <MenuIcon size={21} />
    </button>
  );
}
